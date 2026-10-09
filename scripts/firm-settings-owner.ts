import { Client } from "pg";
import {
  applySetting,
  effectiveSettings,
  type EffectiveSetting,
  type SettingKey,
} from "../src/lib/onboarding/settings";

// A firm's settings (Phase 9, `npm run firm:settings`, scripts/firm-settings.ts): the ones the
// onboarding checklist asks the firm to agree (src/lib/onboarding/settings.ts). As the owner, like
// the brand (scripts/firm-brand-owner.ts): the app role can only read firms, and RLS is forced for
// the owner too, so the change runs with the firm set for its transaction only. Every value is
// checked by reading it back through the app's own reader before anything is saved; the change
// is logged `firm.settings_changed` {keys, from, to} (settings aren't personal).

export type ReadSettingsResult =
  { status: "ok"; settings: EffectiveSetting[] } | { status: "no_firm" };

export type SetSettingsResult =
  | { status: "saved"; keys: SettingKey[]; settings: EffectiveSetting[] }
  | { status: "unchanged" }
  | { status: "no_firm" }
  | { status: "bad"; key: SettingKey };

const SETTINGS_CHANGED = "firm.settings_changed";

async function withOwnerFirm<T>(
  adminUrl: string,
  slug: string,
  fn: (owner: Client, firmId: string) => Promise<T>,
): Promise<T | "no_firm"> {
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ id: string }>(
      "select id::text as id from firms where slug = $1",
      [slug],
    );
    const firmId = rows[0]?.id;
    if (!firmId) return "no_firm";
    await owner.query("begin");
    try {
      await owner.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
      const result = await fn(owner, firmId);
      await owner.query("commit");
      return result;
    } catch (err) {
      await owner.query("rollback").catch(() => undefined);
      throw err;
    }
  } finally {
    await owner.end();
  }
}

export async function readFirmSettings(
  adminUrl: string,
  slug: string,
): Promise<ReadSettingsResult> {
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rows } = await owner.query<{ settings: Record<string, unknown> }>(
      "select settings from firms where id = $1",
      [firmId],
    );
    return effectiveSettings(rows[0]?.settings ?? {});
  });
  return result === "no_firm" ? { status: "no_firm" } : { status: "ok", settings: result };
}

// Changes in the order given; each checked against the settings with the earlier ones applied.
export async function setFirmSettings(
  adminUrl: string,
  slug: string,
  changes: [SettingKey, string][],
): Promise<SetSettingsResult> {
  const result = await withOwnerFirm(
    adminUrl,
    slug,
    async (owner, firmId): Promise<SetSettingsResult> => {
      // The row held, so two runs at once can't both work from the same old settings.
      const { rows } = await owner.query<{ settings: Record<string, unknown> }>(
        "select settings from firms where id = $1 for no key update",
        [firmId],
      );
      const before = rows[0]?.settings ?? {};
      let next = before;
      for (const [key, raw] of changes) {
        const applied = applySetting(next, key, raw);
        if (!applied) return { status: "bad", key };
        next = applied;
      }
      const was = effectiveSettings(before);
      const now = effectiveSettings(next);
      // A value that changed, or one asked for that's now the firm's own (a default made explicit).
      // Not the other quiet-hours parts stored alongside a change to one (their values are the same).
      const asked = new Set(changes.map(([key]) => key));
      const keys = now
        .filter(
          (s, i) => s.value !== was[i]?.value || (asked.has(s.key) && s.source !== was[i]?.source),
        )
        .map((s) => s.key);
      if (keys.length === 0) return { status: "unchanged" };
      await owner.query("update firms set settings = $2 where id = $1", [
        firmId,
        JSON.stringify(next),
      ]);
      await owner.query(
        `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
         values ($1, 'system', $2, 'firm', $1, $3)`,
        [
          firmId,
          SETTINGS_CHANGED,
          JSON.stringify({
            keys,
            // Not personal: what applied before and after (a disputed short-notice day, say).
            from: Object.fromEntries(
              was.filter((s) => keys.includes(s.key)).map((s) => [s.key, s.value]),
            ),
            to: Object.fromEntries(
              now.filter((s) => keys.includes(s.key)).map((s) => [s.key, s.value]),
            ),
          }),
        ],
      );
      return { status: "saved", keys, settings: now };
    },
  );
  return result === "no_firm" ? { status: "no_firm" } : result;
}

import { Client } from "pg";
import { CANCEL_ASKERS, NAME_KINDS, type NameKind } from "../src/lib/db/schema";
import { importPence } from "../src/lib/imports/import";
import { MAX_PAY_RATE_PENCE } from "../src/lib/office/shift-editor";
import { nameKey, normaliseRole } from "../src/lib/roster/names";

// A firm's name map (P3.2, `npm run firm:names`, scripts/firm-names.ts; src/lib/roster/names.ts):
// what the firm's own system calls a role, a qualification, a staff type or a cancellation reason,
// mapped to a ShiftDesk code or to skip. As the owner, like the firm's settings
// (scripts/firm-settings-owner.ts): the app role can only read name_map, and RLS is forced for the
// owner too, so each change runs with the firm set for its transaction only. Each change is logged
// `firm.settings_changed` {keys: ["name_map.<kind>"], name, from, to} (a name isn't personal).
//
// What a name may map to, by kind: a role's code (as the rules spell roles: "Door supervisor" is
// door_supervisor), with its pay rate if it has one; a qualification the firm has (a credential
// type's code); casual for a staff type (the people ShiftDesk serves); who asked for a
// cancellation for its reason (P3.4). Or skip.

export interface MappedNameRow {
  kind: NameKind;
  name: string;
  code: string | null; // null: skip
  payRatePence: number | null;
}

export type NameField = "kind" | "name" | "code" | "rate";

export type SetNameResult =
  | { status: "saved"; row: MappedNameRow }
  | { status: "unchanged" }
  | { status: "removed" }
  | { status: "not_there" }
  | { status: "no_firm" }
  | { status: "bad"; field: NameField };

const CHANGED = "firm.settings_changed";
// The codes a kind may map to, where there's a fixed list.
const FIXED_CODES: Partial<Record<NameKind, readonly string[]>> = {
  staff_type: ["casual"],
  cancellation_reason: CANCEL_ASKERS,
};

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

type Row = {
  kind: NameKind;
  outside_name: string;
  code: string | null;
  pay_rate_pence: number | null;
};
const toRow = (r: Row): MappedNameRow => ({
  kind: r.kind,
  name: r.outside_name,
  code: r.code,
  payRatePence: r.pay_rate_pence,
});
// What a log entry says a name maps to: its code, "skip", or null (not mapped).
const said = (r: MappedNameRow | undefined) => (r ? (r.code ?? "skip") : null);

export async function listNames(
  adminUrl: string,
  slug: string,
): Promise<{ status: "ok"; rows: MappedNameRow[] } | { status: "no_firm" }> {
  const result = await withOwnerFirm(adminUrl, slug, async (owner, firmId) => {
    const { rows } = await owner.query<Row>(
      `select kind, outside_name, code, pay_rate_pence from name_map
        where firm_id = $1 order by kind, outside_name`,
      [firmId],
    );
    return rows.map(toRow);
  });
  return result === "no_firm" ? { status: "no_firm" } : { status: "ok", rows: result };
}

// Maps one name (code "skip" to skip it), or with `remove` takes it off the map. Nothing is
// written for a value that isn't allowed.
export async function setName(
  adminUrl: string,
  slug: string,
  change: { kind: string; name: string; code?: string; rate?: string; remove?: boolean },
): Promise<SetNameResult> {
  const kind = (NAME_KINDS as readonly string[]).includes(change.kind)
    ? (change.kind as NameKind)
    : null;
  if (!kind) return { status: "bad", field: "kind" };
  const name = nameKey(change.name);
  if (!name) return { status: "bad", field: "name" };
  const rawCode = (change.code ?? "").trim();
  let code: string | null = null;
  let payRatePence: number | null = null;
  if (!change.remove) {
    if (rawCode === "") return { status: "bad", field: "code" };
    if (rawCode.toLowerCase() !== "skip") {
      code = kind === "role" ? normaliseRole(rawCode) : rawCode;
      const fixed = FIXED_CODES[kind];
      if (!code || (fixed && !fixed.includes(code))) return { status: "bad", field: "code" };
    }
    const rate = (change.rate ?? "").trim();
    if (rate !== "") {
      payRatePence = importPence(rate);
      if (kind !== "role" || code === null || payRatePence === null) {
        return { status: "bad", field: "rate" };
      }
      if (payRatePence > MAX_PAY_RATE_PENCE) return { status: "bad", field: "rate" };
    }
  } else if (rawCode !== "" || (change.rate ?? "").trim() !== "") {
    return { status: "bad", field: "code" };
  }

  const result = await withOwnerFirm(
    adminUrl,
    slug,
    async (owner, firmId): Promise<SetNameResult> => {
      // A qualification the firm has: its own credential types.
      if (kind === "qualification" && code !== null) {
        const { rows } = await owner.query(
          "select 1 from credential_types where firm_id = $1 and code = $2",
          [firmId, code],
        );
        if (rows.length === 0) return { status: "bad", field: "code" };
      }
      const { rows: held } = await owner.query<Row>(
        `select kind, outside_name, code, pay_rate_pence from name_map
          where firm_id = $1 and kind = $2 and outside_name = $3 for update`,
        [firmId, kind, name],
      );
      const before = held[0] ? toRow(held[0]) : undefined;
      const log = async (after: MappedNameRow | undefined) =>
        owner.query(
          `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
           values ($1, 'system', $2, 'firm', $1, $3)`,
          [
            firmId,
            CHANGED,
            JSON.stringify({
              keys: [`name_map.${kind}`],
              name,
              from: said(before),
              to: said(after),
              ...(before?.payRatePence != null || after?.payRatePence != null
                ? {
                    fromRatePence: before?.payRatePence ?? null,
                    toRatePence: after?.payRatePence ?? null,
                  }
                : {}),
            }),
          ],
        );
      if (change.remove) {
        if (!before) return { status: "not_there" };
        await owner.query(
          "delete from name_map where firm_id = $1 and kind = $2 and outside_name = $3",
          [firmId, kind, name],
        );
        await log(undefined);
        return { status: "removed" };
      }
      const after: MappedNameRow = { kind, name, code, payRatePence };
      if (before && before.code === code && before.payRatePence === payRatePence) {
        return { status: "unchanged" };
      }
      await owner.query(
        `insert into name_map (firm_id, kind, outside_name, code, pay_rate_pence)
         values ($1, $2, $3, $4, $5)
         on conflict (firm_id, kind, outside_name)
         do update set code = excluded.code, pay_rate_pence = excluded.pay_rate_pence`,
        [firmId, kind, name, code, payRatePence],
      );
      await log(after);
      return { status: "saved", row: after };
    },
  );
  return result === "no_firm" ? { status: "no_firm" } : result;
}

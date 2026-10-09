import { Client } from "pg";

// Gate B, recorded (`npm run firm:agreement`, scripts/firm-agreement.ts): the day a firm's
// agreement and DPA were signed, in `firms.agreement_signed_on`. Only the owner sets it (the app
// role can only read firms). Until it's set, a live database takes no real staff data for the firm
// (src/lib/imports/gate-b.ts). RLS is forced for the owner too, so the change runs with the firm
// set for its transaction only, like scripts/firm-settings-owner.ts. Logged
// `firm.agreement_recorded` {signedOn} (a date, nothing personal).

export type AgreementResult =
  | { status: "recorded"; signedOn: string; was: string | null }
  | { status: "cleared"; was: string }
  | { status: "unchanged"; signedOn: string }
  | { status: "shown"; signedOn: string | null }
  | { status: "no_firm" };

const RECORDED = "firm.agreement_recorded";

// "2026-10-04" or "04/10/2026" (day first), a real day, not in the future.
export function signingDay(raw: string, today: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${m[2]}-${m[3]}`;
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    iso = `${m[3]}-${(m[2] ?? "").padStart(2, "0")}-${(m[1] ?? "").padStart(2, "0")}`;
  }
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso <= today && iso >= "2026-01-01" ? iso : null;
}

export async function firmAgreement(
  adminUrl: string,
  slug: string,
  signedOn: string | null | "clear", // null: just show it; "clear": recorded on the wrong firm
): Promise<AgreementResult> {
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ id: string }>(
      "select id::text as id from firms where slug = $1",
      [slug],
    );
    const firmId = rows[0]?.id;
    if (!firmId) return { status: "no_firm" };
    await owner.query("begin");
    try {
      await owner.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
      const { rows: firm } = await owner.query<{ signed: string | null }>(
        "select agreement_signed_on::text as signed from firms where id = $1 for no key update",
        [firmId],
      );
      const was = firm[0]?.signed ?? null;
      let result: AgreementResult;
      if (signedOn === null) result = { status: "shown", signedOn: was };
      else if (signedOn === "clear") {
        if (was === null) result = { status: "shown", signedOn: null };
        else {
          await owner.query("update firms set agreement_signed_on = null where id = $1", [firmId]);
          await owner.query(
            `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
             values ($1, 'system', $2, 'firm', $1, $3)`,
            [firmId, RECORDED, JSON.stringify({ cleared: true, was })],
          );
          result = { status: "cleared", was };
        }
      } else if (was === signedOn) result = { status: "unchanged", signedOn };
      else {
        await owner.query("update firms set agreement_signed_on = $2 where id = $1", [
          firmId,
          signedOn,
        ]);
        await owner.query(
          `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
           values ($1, 'system', $2, 'firm', $1, $3)`,
          [firmId, RECORDED, JSON.stringify({ signedOn, ...(was ? { was } : {}) })],
        );
        result = { status: "recorded", signedOn, was };
      }
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

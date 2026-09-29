import { Client } from "pg";

// Setting a firm's shifts line (its own WhatsApp, text and calls number: firms.shifts_line_e164),
// for `npm run firm:line` (scripts/firm-line.ts). We buy the numbers (Twilio: PLAN.md Parking lot,
// "Connect Twilio") and set them here, as the owner: the app role can't change firms. RLS is forced
// for the owner too, so the change runs with the firm set for its transaction only, like the
// seed's firm provisioning. This is an owner-only operations script, kept out of src/ on purpose:
// the app itself never sets the firm outside withFirm (scripts/invariants.sh, invariant 5).
// One number belongs to one firm (a unique column).

export type SetLineResult =
  | { status: "set"; number: string; before: string | null }
  | { status: "cleared"; before: string | null }
  | { status: "unchanged" } // it already had that number (or none, when clearing)
  | { status: "no_firm" }
  | { status: "taken" } // another firm has that number
  | { status: "has_other"; before: string } // a different line is set: pass `replace` to change it
  | { status: "bad_number" };

const E164 = /^\+[1-9]\d{6,14}$/;

// "07700 900000", "+44 7700 900000", "+44 (0)7700 900000" or "+447700900000" (UK numbers may
// start with 0; the "(0)" in the international form is dropped, as people mean it). A 0 straight
// after +44 is never a real number.
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\(0\)/g, "").replace(/[\s()-]/g, "");
  const e164 = digits.startsWith("0") ? `+44${digits.slice(1)}` : digits;
  return E164.test(e164) && !e164.startsWith("+440") ? e164 : null;
}

export async function setShiftsLine(
  adminUrl: string,
  slug: string,
  raw: string | null,
  opts: { replace?: boolean } = {},
): Promise<SetLineResult> {
  const number = raw === null ? null : toE164(raw);
  if (raw !== null && number === null) return { status: "bad_number" };
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ id: string; line: string | null }>(
      "select id::text as id, shifts_line_e164 as line from firms where slug = $1",
      [slug],
    );
    const firm = rows[0];
    if (!firm) return { status: "no_firm" };
    if (firm.line === number) return { status: "unchanged" };
    if (number !== null && firm.line !== null && !opts.replace) {
      return { status: "has_other", before: firm.line };
    }
    await owner.query("begin");
    try {
      await owner.query("select set_config('app.current_firm_id', $1, true)", [firm.id]);
      const updated = await owner.query("update firms set shifts_line_e164 = $2 where id = $1", [
        firm.id,
        number,
      ]);
      if (updated.rowCount !== 1) throw new Error("the firm's row wasn't updated");
      await owner.query("commit");
    } catch (err) {
      // The first error is the one that matters, even if the rollback fails too.
      await owner.query("rollback").catch(() => undefined);
      if ((err as { code?: string }).code === "23505") return { status: "taken" };
      throw err;
    }
    return number === null
      ? { status: "cleared", before: firm.line }
      : { status: "set", number, before: firm.line };
  } finally {
    await owner.end();
  }
}

import { eq, sql } from "drizzle-orm";
import { firms } from "../db/schema";
import { withFirm, type WithFirm } from "../db/scoped";

// A firm's shifts line (its own WhatsApp, text and calls number: firms.shifts_line_e164), for
// showing it. Null until we've bought one (Twilio: PLAN.md Parking lot, "Connect Twilio").

export async function firmShiftsLine(ctx: {
  firm: { id: string };
  run?: WithFirm;
}): Promise<string | null> {
  const [row] = await (ctx.run ?? withFirm)(ctx.firm.id, (tx) =>
    tx
      .select({ line: firms.shiftsLineE164 })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`)),
  );
  return row?.line ?? null;
}

// "+44 7700 900000" for a UK number (+44 then 10 digits); anything else as stored.
export function lineWords(e164: string): string {
  const uk = /^\+44(\d{4})(\d{6})$/.exec(e164);
  return uk ? `+44 ${uk[1]} ${uk[2]}` : e164;
}

// The office dashboard's line.
export function shiftsLineText(e164: string | null): string {
  return e164
    ? `Your shifts line: ${lineWords(e164)} (WhatsApp, text and calls).`
    : "No shifts line yet.";
}

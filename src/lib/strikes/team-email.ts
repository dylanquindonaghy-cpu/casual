import { sql } from "drizzle-orm";
import type { FirmTx } from "../db/scoped";

// The strikes team's email address in a firm's settings (docs/office-v2.md 3.10; 12B.7), and the
// lock that orders everything about it. Saving and confirming the address (src/lib/office/
// strikes-email.ts) and the evidence email's claim (src/lib/strikes/evidence.ts) all take the lock
// first, so a strike's evidence can't read "not confirmed" while a confirmation is landing and be
// left behind by it.

type Settings = Record<string, unknown>;

export interface StrikesEmail {
  address: string | null;
  confirmedAt: Date | null;
}

// The address and its confirmed time as stored (settings.strikes), each only when it makes sense.
export function strikesEmailOf(settings: Settings): StrikesEmail {
  const strikes = settings.strikes;
  if (typeof strikes !== "object" || strikes === null) return { address: null, confirmedAt: null };
  const { email, email_verified_at: at } = strikes as Record<string, unknown>;
  const address = typeof email === "string" && email.length > 0 ? email : null;
  const confirmedAt =
    address && typeof at === "string" && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
  return { address, confirmedAt };
}

// Where strike evidence may go: the address, only once it's confirmed.
export function confirmedStrikesEmail(settings: Settings): string | null {
  const { address, confirmedAt } = strikesEmailOf(settings);
  return address && confirmedAt ? address : null;
}

// The firm's strikes-email lock, held until the transaction ends.
export const lockStrikesEmail = (tx: FirmTx) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('strikes-email:' || app_current_firm_id()::text, 0))`,
  );

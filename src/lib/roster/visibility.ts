import { sql } from "drizzle-orm";
import { shifts } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// What casuals see (docs/office-v2.md 3.3, "What a switch does"): a session is shown to casuals only
// while its own switch (shifts.showing_to_casuals) and its event's (shift_events.showing_to_casuals)
// are both on. This is the one check, used by open shifts (and so the urgent board and the Home
// count), the shift page, a casual's own booking, offer waves (the waves after a dropout too) and the
// office's offers. The office still sees and assigns a hidden session, and booked casuals keep their
// bookings. A display choice, not an eligibility rule: it stays out of the rules engine.

// For a query over `shifts` (no alias).
export const visibleToCasuals = sql<boolean>`(${shifts.showingToCasuals} and exists (
  select 1 from shift_events e
   where e.firm_id = ${shifts.firmId} and e.id = ${shifts.shiftEventId} and e.showing_to_casuals))`;

// One session. `lock`: the event row is share-locked until the transaction ends, so switching the
// event off waits for a booking or an offer that read it on (and one after reads it off). The caller
// holds the shift's lock already (booking and the offer jobs take it first): switching the session
// itself off waits on that. The lock is taken whatever the switches say (no filter on them), so it
// always waits for a switch in progress. Only setShowing() locks event rows exclusively, and it
// waits on nothing after that (src/lib/office/showing.ts): the share lock can't deadlock. False when
// the shift isn't there.
export async function isVisibleToCasuals(
  tx: FirmTx,
  shiftId: string,
  opts: { lock?: boolean } = {},
): Promise<boolean> {
  const { rows } = await tx.execute<{ visible: boolean }>(sql`
    select s.showing_to_casuals and e.showing_to_casuals as visible
      from shifts s
      join shift_events e on e.firm_id = s.firm_id and e.id = s.event_id
     where s.id = ${shiftId}
    ${opts.lock ? sql`for share of e` : sql``}
  `);
  return rows[0]?.visible === true;
}

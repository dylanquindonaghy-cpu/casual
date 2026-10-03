import { and, eq, isNull, or, sql } from "drizzle-orm";
import { CANCELLED_ASSIGNMENT_STATUSES, offers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";

// Offers still waiting when their shift fills are answered at once, whatever filled it and whatever
// the firm's allocation mode: a worker taking the last place, the office placing someone (Assign)
// or marking the shift filled, a sheet sync booking its names, or a re-check after an edit, an import
// or a sync finding no place free (refreshShiftStatus in src/lib/roster/native.ts). An offered
// worker who now holds a place took it (`accepted`); everyone else's was filled by someone else
// (`filled_elsewhere`). Logged `offer.closed` {reason: "filled", accepted, filledElsewhere} when any
// changed. (Before Phase 10 only a later offer-wave job noticing the fill closed them, so under first
// come, first served, the default, they stayed "waiting" for ever: audit finding M5.)

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export interface ClosedOffers {
  accepted: number;
  filledElsewhere: number;
}

// Whether an offer counts as unanswered for a worker who now holds a place: waiting, or closed
// earlier only because the shift filled then (a dropout has since reopened it, and they took it).
const unansweredFor = () => or(isNull(offers.response), eq(offers.response, "filled_elsewhere"));

// The booked worker's own offer of this shift is answered: they took it (they tapped Take shift,
// the office placed them, or the sheet named them).
export async function acceptOwnOffer(
  tx: FirmTx,
  shiftId: string,
  workerId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(offers)
    .set({ response: "accepted", respondedAt: now })
    .where(and(eq(offers.shiftId, shiftId), eq(offers.workerId, workerId), unansweredFor()));
}

// Closes every offer of the shift still waiting: holders' as accepted, the rest filled elsewhere.
// For a caller that already knows the shift is full (the office marking it filled, a wave finding
// it filled).
export async function closeOpenOffers(
  tx: FirmTx,
  shiftId: string,
  now: Date,
): Promise<ClosedOffers> {
  const holders = sql`(select a.worker_id from assignments a
    where a.shift_id = ${shiftId} and a.worker_id is not null
      and a.status not in (${CANCELLED}))`;
  const accepted = await tx
    .update(offers)
    .set({ response: "accepted", respondedAt: now })
    .where(and(eq(offers.shiftId, shiftId), unansweredFor(), sql`${offers.workerId} in ${holders}`))
    .returning({ id: offers.id });
  const elsewhere = await tx
    .update(offers)
    .set({ response: "filled_elsewhere", respondedAt: now })
    .where(and(eq(offers.shiftId, shiftId), isNull(offers.response)))
    .returning({ id: offers.id });
  const closed = { accepted: accepted.length, filledElsewhere: elsewhere.length };
  if (closed.accepted + closed.filledElsewhere > 0) {
    await recordEvent(tx, {
      actorType: "system",
      action: "offer.closed",
      entityType: "shift",
      entityId: shiftId,
      data: { reason: "filled", ...closed },
    });
  }
  return closed;
}

// The same, only if the shift is full now: marked filled, or open with no place free. Called after
// every change that can fill a shift (src/lib/roster/book.ts, refreshShiftStatus in
// src/lib/roster/native.ts). A shift with a place free, or cancelled or draft, is left alone.
export async function closeOffersIfFilled(
  tx: FirmTx,
  shiftId: string,
  now: Date,
): Promise<ClosedOffers> {
  const { rows } = await tx.execute<{ status: string; headcount: number; taken: number }>(sql`
    select s.status, s.headcount,
           (select count(*)::int from assignments a
             where a.shift_id = s.id and a.worker_id is not null
               and a.status not in (${CANCELLED}) and a.slot <= s.headcount) as taken
      from shifts s
     where s.id = ${shiftId}
  `);
  const shift = rows[0];
  const full =
    shift !== undefined &&
    (shift.status === "filled" || (shift.status === "open" && shift.taken >= shift.headcount));
  return full ? closeOpenOffers(tx, shiftId, now) : { accepted: 0, filledElsewhere: 0 };
}

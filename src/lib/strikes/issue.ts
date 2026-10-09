import { and, count, eq, gt, sql } from "drizzle-orm";
import { assignments, firms, strikes } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { strikeDecision, type StrikeDecision } from "./decide";
import { strikeSettings, type StrikeSettings } from "./settings";

// Strikes in the database (12C.1; docs/office-v2.md 3.5): the facts strikeDecision() needs about a
// booking, read inside the cancellation's own transaction (the session's row is already locked, so
// nothing about it can change underneath), and the strike row when one is issued.

const DAY_MS = 24 * 60 * 60 * 1000;

// Changes that make a later cancellation exempt: moved, shortened, or a new role, site or pay.
const CHANGED_FIELDS = sql.raw(`array['startsAt', 'endsAt', 'siteId', 'role', 'payRatePence']`);

export interface BookingFacts {
  by: "worker" | "office";
  overridden: boolean;
  changedAfterBooking: boolean;
}

// Who made the booking, from its shift.assigned entry ("worker": the casual took it themselves,
// an offer they accepted included; "firm": Assign, the rota sheet). An override is in that entry or
// on the booking (its reason is purged in time; the entry's flag stays). A change counts when its
// entry came after the booking's (event ids only grow: no clock is compared): shift.moved or
// shift.curtailed for this booking, or shift.changed naming the times, role, site or pay.
export async function bookingFacts(
  tx: FirmTx,
  booking: { assignmentId: string; shiftId: string },
): Promise<BookingFacts> {
  const { rows: assigned } = await tx.execute<{
    id: number | string;
    data: Record<string, unknown>;
  }>(
    sql`select e.id, e.data from events e
         where e.action = 'shift.assigned' and e.entity_id = ${booking.assignmentId}
         order by e.id desc limit 1`,
  );
  const [row] = await tx
    .select({ overrideReason: assignments.overrideReason })
    .from(assignments)
    .where(eq(assignments.id, booking.assignmentId));
  const entry = assigned[0];
  const overridden = Boolean(entry && "overridden" in entry.data) || Boolean(row?.overrideReason);
  if (!entry || entry.data.by !== "worker") {
    return { by: "office", overridden, changedAfterBooking: false };
  }
  const { rows: changed } = await tx.execute(sql`
    select 1 from events e
     where e.id > ${Number(entry.id)}
       and ((e.entity_id = ${booking.assignmentId} and e.action in ('shift.moved', 'shift.curtailed'))
         or (e.entity_id = ${booking.shiftId} and e.action = 'shift.changed'
             and e.data -> 'fields' ?| ${CHANGED_FIELDS}))
     limit 1
  `);
  return { by: "worker", overridden, changedAfterBooking: changed.length > 0 };
}

export async function firmStrikeSettings(
  tx: FirmTx,
): Promise<StrikeSettings & { firmName: string }> {
  const [firm] = await tx
    .select({ name: firms.name, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return { ...strikeSettings(firm?.settings ?? {}), firmName: firm?.name ?? "" };
}

// The decision for a casual cancelling their own booking: for the cancel step's warning (no reason
// yet) and on confirm (with it).
export async function decideForWorker(
  tx: FirmTx,
  input: {
    assignmentId: string;
    shiftId: string;
    noticeHours: number;
    reason: string | null;
    settings: StrikeSettings;
  },
): Promise<StrikeDecision> {
  const facts = await bookingFacts(tx, input);
  return strikeDecision({
    cancelledBy: "worker",
    noticeHours: input.noticeHours,
    thresholdHours: input.settings.noticeHours,
    booking: { by: facts.by, overridden: facts.overridden },
    changedAfterBooking: facts.changedAfterBooking,
    reason: input.reason,
  });
}

// A casual's strikes that count now: live (not withdrawn) and not past their date.
export async function liveStrikeCount(tx: FirmTx, workerId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(strikes)
    .where(
      and(eq(strikes.workerId, workerId), eq(strikes.status, "live"), gt(strikes.expiresAt, now)),
    );
  return Number(row?.n ?? 0);
}

// The strike row and strike.issued (ids and hours only). The review flag and its reasons stay on the
// row, never in the append-only log: "unwell" is about health, and the flag alone would say the
// reason was health or caring long after the row is deleted. One per booking (a unique key).
export async function issueStrike(
  tx: FirmTx,
  input: {
    decision: Extract<StrikeDecision, { result: "strike" }>;
    workerId: string;
    assignmentId: string;
    shiftId: string;
    noticeHours: number;
    settings: StrikeSettings;
    now: Date;
  },
): Promise<{ strikeId: string; expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + input.settings.liveDays * DAY_MS);
  const review = input.decision.reviewReasons.length > 0;
  const [row] = await tx
    .insert(strikes)
    .values({
      firmId: sql`app_current_firm_id()`,
      workerId: input.workerId,
      assignmentId: input.assignmentId,
      shiftId: input.shiftId,
      noticeHours: input.noticeHours.toFixed(2),
      thresholdHours: input.settings.noticeHours,
      issuedAt: input.now,
      expiresAt,
      reviewNeeded: review,
      reviewReasons: input.decision.reviewReasons,
    })
    .returning({ id: strikes.id });
  if (!row) throw new Error("strike insert returned nothing");
  await recordEvent(tx, {
    actorType: "system",
    action: "strike.issued",
    entityType: "strike",
    entityId: row.id,
    data: {
      assignmentId: input.assignmentId,
      shiftId: input.shiftId,
      workerId: input.workerId,
      noticeHours: input.noticeHours,
      thresholdHours: input.settings.noticeHours,
    },
  });
  return { strikeId: row.id, expiresAt };
}

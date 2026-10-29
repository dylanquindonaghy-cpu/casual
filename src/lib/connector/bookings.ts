import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { assignments, events, shifts, workers } from "../db/schema";
import { retryAborted } from "../db/retry";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { acceptOwnOffer, closeOffersIfFilled } from "../offers/close";
import { checkBooking } from "../roster/book";
import { RulesSettingsError } from "../roster/eligibility-input";
import { firmCallerMay, type PlannerCaller } from "../roster/firm-caller";
import { FIRM_CHANGE_REASONS, type FirmChangeReason } from "../roster/firm-reasons";
import { mergeHolders } from "../roster/sheets/merge";
import { nativeRosterPlug, placeAfterCancel } from "../roster/native";
import { noticeHours } from "../roster/notice";
import type { OverridableCode } from "../rules/eligibility";
import { strikeDecision } from "../strikes/decide";
import type { SourceBookings } from "./demo-portal";

// Who's booked on a connector's session, mirrored from the firm's own system (P5.5; ADR-026), in
// two steps around the session's own change (apply.ts):
// 1. before it, the bookings cancelled there (mirrorCancellations), so a change the planner's
//    rules refuse (places lowered below a booked place, a move a booked casual can't make) never
//    keeps a cancellation from landing: cancelled here, cancelled_firm (never a strike),
//    `cancel_via` api, who asked unknown, with notice hours from the system's own cancelled time
//    only when it belongs to this booking (after it was confirmed here, and since the session was
//    last read), else from this read: the latest the cancellation can have been, so the shorter
//    notice, the reading that favours the casual. The evidence (which time, and the system's own)
//    is on the log entry. No message and no offers: the firm made the change in its own system
//    (as a name taken off the rota sheet), and its gap is filled there;
// 2. after it, once the session is in (mirrorBookings), a booking made there: the rules run as
//    for an office placement (with the office's overrides: rest, weekly hours, a day marked
//    unavailable), and it's booked only if they pass and a place is left, booked_via "api" and
//    logged as the firm's (`shift.assigned` {by: "firm", via: "api", sourceId}); refused, it isn't
//    booked and `shift.booking_refused` says why, again only when something about that casual on
//    this session happened since the last time it said so. No message goes to the casual: the
//    firm's system booked them.
// A booking here that the system doesn't list is never cancelled (only a person, or the system
// saying it's cancelled, ends a confirmed booking) and is kept out of the merge base, so the next
// read keeps it too; the office may cancel it here (src/lib/roster/cancel.ts), as the firm's
// system no longer has it. The merge base is shifts.synced_holders, as the sheet sync's
// (src/lib/roster/sheets/merge.ts): what the system listed, less those it couldn't book here, so a
// booking cancelled here while the system still lists it stays cancelled.
//
// Each step is one transaction: the source's row held first (the planner's lock order), then the
// session's. A read older than the session's last (shifts.source_read_at) changes nothing, so two
// reads applied out of order never book or cancel what the newer one has undone; each step takes
// the session's read time on. Retried if Postgres aborts it (a deadlock with a booking elsewhere).

export const CONNECTOR_OVERRIDES: readonly OverridableCode[] = [
  "rest",
  "weekly_hours",
  "unavailable",
];

export interface MirrorResult {
  booked: number;
  refused: number;
  cancelled: number;
  kept: number; // booked here, not in the system's list: kept
}

export interface MirrorInput {
  run: WithFirm;
  firmId: string;
  by: Extract<PlannerCaller, { type: "connector" }>;
  ref: string; // the session's ref
  bookings: SourceBookings;
  readAt: Date; // when this record was read from the system (after the fetch, or the pull's list)
  now: Date;
}

type Refused = "not_allowed" | "no_session" | "older_read";

const sourceMarks = (sourceId: string) => ({ by: "firm", via: "api", sourceId });

async function liveHolders(tx: FirmTx, shiftId: string) {
  return tx
    .select({
      assignmentId: assignments.id,
      workerId: assignments.workerId,
      ref: workers.externalRef,
      confirmedAt: assignments.confirmedAt,
      createdAt: assignments.createdAt,
    })
    .from(assignments)
    .innerJoin(
      workers,
      and(eq(workers.firmId, assignments.firmId), eq(workers.id, assignments.workerId)),
    )
    .where(
      and(
        eq(assignments.shiftId, shiftId),
        eq(assignments.status, "confirmed"),
        isNotNull(assignments.workerId),
      ),
    )
    .orderBy(asc(assignments.slot));
}

// The source first (allowed now?), then the session, held for the step; a read older than the
// session's last refused.
async function lockedSession(tx: FirmTx, a: MirrorInput) {
  if (!(await firmCallerMay(tx, a.by))) return "not_allowed" as const;
  const [shift] = await tx
    .select({
      id: shifts.id,
      status: shifts.status,
      startsAt: shifts.startsAt,
      headcount: shifts.headcount,
      base: shifts.syncedHolders,
      lastRead: shifts.sourceReadAt,
    })
    .from(shifts)
    .where(and(eq(shifts.source, "api"), eq(shifts.externalRef, a.ref)))
    .for("no key update");
  if (!shift) return "no_session" as const;
  if (shift.lastRead && shift.lastRead.getTime() > a.readAt.getTime()) return "older_read" as const;
  return shift;
}

async function takeRead(tx: FirmTx, shiftId: string, readAt: Date): Promise<void> {
  await tx
    .update(shifts)
    .set({ sourceReadAt: readAt })
    .where(
      and(eq(shifts.id, shiftId), or(isNull(shifts.sourceReadAt), lt(shifts.sourceReadAt, readAt))),
    );
}

const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

// The system's latest cancellation of each staff ref (a ref it lists cancelled twice: the later).
function latestCancellations(list: SourceBookings["cancelled"]) {
  const byRef = new Map<string, SourceBookings["cancelled"][number]>();
  for (const c of list) {
    const had = byRef.get(c.ref);
    if (!had || (c.at && (!had.at || c.at.getTime() > had.at.getTime()))) byRef.set(c.ref, c);
  }
  return byRef;
}

// A reason the system gave, if it's one of ours (its own keys only: never "constructor").
function reasonCode(reason: string | null): FirmChangeReason {
  return reason !== null && Object.hasOwn(FIRM_CHANGE_REASONS, reason)
    ? (reason as FirmChangeReason)
    : "other";
}

export async function mirrorCancellations(a: MirrorInput): Promise<number | Refused> {
  return retryAborted(() =>
    a.run(a.firmId, async (tx) => {
      const shift = await lockedSession(tx, a);
      if (typeof shift === "string") return shift;
      let cancelled = 0;
      // A cancelled or started session: its bookings are what they were.
      if (shift.status !== "cancelled" && shift.startsAt.getTime() > a.now.getTime()) {
        const plug = nativeRosterPlug(tx, { clock: { now: () => a.now } });
        const marks = sourceMarks(a.by.sourceId);
        const cancelledThere = latestCancellations(a.bookings.cancelled);
        for (const holder of await liveHolders(tx, shift.id)) {
          const c = holder.ref ? cancelledThere.get(holder.ref) : undefined;
          if (!c || !holder.workerId) continue;
          // Its own: after this booking was confirmed here, and since the session was last read.
          const confirmed = holder.confirmedAt ?? holder.createdAt;
          const since = Math.max(confirmed.getTime(), shift.lastRead?.getTime() ?? 0);
          const own =
            c.at !== null && c.at.getTime() > since && c.at.getTime() <= a.readAt.getTime();
          const at = own && c.at ? c.at : later(a.readAt, confirmed);
          const reason = FIRM_CHANGE_REASONS[reasonCode(c.reason)];
          const done = await plug.markCancelled(shift.id, holder.workerId, {
            reason,
            by: "firm",
            at,
            via: "api",
          });
          if (done.status !== "cancelled") continue;
          cancelled += 1;
          await recordEvent(tx, {
            actorType: "system",
            action: "shift.cancelled",
            entityType: "assignment",
            entityId: done.assignmentId,
            data: {
              ...marks,
              shiftId: shift.id,
              workerId: holder.workerId,
              reason,
              noticeHours: done.noticeHours,
              askedBy: "unknown",
              // The evidence: which time the notice was counted from, and the system's own.
              noticeFrom: own ? "source" : "read",
              ...(c.at ? { sourceCancelledAt: c.at.toISOString() } : {}),
              strike: strikeDecision({ cancelledBy: "firm" }).code,
              ...(await placeAfterCancel(tx, done.assignmentId)),
            },
          });
        }
      }
      await takeRead(tx, shift.id, a.readAt);
      return cancelled;
    }),
  );
}

// Logged again only when something about this casual on this session happened since its last
// refusal said the same (a booking, a cancellation, other reasons), so a system read every 15
// minutes doesn't say it again every time.
async function refusedBefore(
  tx: FirmTx,
  shiftId: string,
  workerId: string,
  codes: string[],
): Promise<boolean> {
  const [last] = await tx
    .select({ action: events.action, codes: sql<unknown>`${events.data} -> 'codes'` })
    .from(events)
    .where(
      and(
        sql`${events.data} ->> 'workerId' = ${workerId}`,
        or(
          and(
            eq(events.entityType, "shift"),
            eq(events.entityId, shiftId),
            eq(events.action, "shift.booking_refused"),
            sql`${events.data} ->> 'via' = 'api'`,
          ),
          and(
            inArray(events.action, ["shift.assigned", "shift.cancelled"]),
            sql`${events.data} ->> 'shiftId' = ${shiftId}`,
          ),
        ),
      ),
    )
    .orderBy(desc(events.id))
    .limit(1);
  return (
    last?.action === "shift.booking_refused" && JSON.stringify(last.codes) === JSON.stringify(codes)
  );
}

export async function mirrorBookings(a: MirrorInput): Promise<MirrorResult | Refused> {
  return retryAborted(() =>
    a.run(a.firmId, async (tx) => {
      const shift = await lockedSession(tx, a);
      if (typeof shift === "string") return shift;
      const result: MirrorResult = { booked: 0, refused: 0, cancelled: 0, kept: 0 };
      // A cancelled or started session: its bookings are what they were.
      if (shift.status === "cancelled" || shift.startsAt.getTime() <= a.now.getTime()) {
        await takeRead(tx, shift.id, a.readAt);
        return result;
      }
      const plug = nativeRosterPlug(tx, { clock: { now: () => a.now } });
      const marks = sourceMarks(a.by.sourceId);

      const live = await liveHolders(tx, shift.id);
      const ours = live.flatMap((h) => (h.ref ? [h.ref] : []));
      const base = shift.base ?? [];
      const merged = mergeHolders({
        base,
        theirs: a.bookings.booked,
        ours,
        headcount: Number.MAX_SAFE_INTEGER,
      });
      const held = new Set(ours);
      const theirs = new Set(a.bookings.booked);
      result.kept = ours.filter((ref) => !theirs.has(ref)).length;
      const wanted = merged.holders.filter((ref) => !held.has(ref) && theirs.has(ref));
      const ids = wanted.length
        ? await tx
            .select({ id: workers.id, ref: workers.externalRef })
            .from(workers)
            .where(inArray(workers.externalRef, wanted))
        : [];
      const idOf = new Map(ids.map((w) => [w.ref, w.id]));
      let room = shift.headcount - live.length;
      // Listed there, not booked here this time: tried again at the next read (out of the base).
      const notBooked = new Set<string>();
      const refuse = async (ref: string, workerId: string, codes: string[]) => {
        result.refused += 1;
        notBooked.add(ref);
        if (await refusedBefore(tx, shift.id, workerId, codes)) return;
        await recordEvent(tx, {
          actorType: "system",
          action: "shift.booking_refused",
          entityType: "shift",
          entityId: shift.id,
          data: { ...marks, workerId, codes },
        });
      };
      for (const ref of wanted) {
        const workerId = idOf.get(ref);
        // A staff ref nobody here has yet (their staff record hasn't come in): tried again next read.
        if (!workerId) {
          result.refused += 1;
          notBooked.add(ref);
          continue;
        }
        let check: Awaited<ReturnType<typeof checkBooking>>;
        try {
          check = await checkBooking(tx, {
            shiftId: shift.id,
            workerId,
            now: a.now,
            overrides: [...CONNECTOR_OVERRIDES],
          });
        } catch (err) {
          if (!(err instanceof RulesSettingsError)) throw err;
          await refuse(ref, workerId, ["settings_invalid"]);
          continue;
        }
        if (check.status !== "checked") {
          notBooked.add(ref);
          continue;
        }
        if (!check.result.pass) {
          await refuse(ref, workerId, check.result.codes);
          continue;
        }
        // The rules first, then a place: someone they refuse is told why, not "no place".
        if (room <= 0) {
          await refuse(ref, workerId, ["no_place"]);
          continue;
        }
        const assigned = await plug.assign(shift.id, workerId, check.result.pass);
        if (assigned.status !== "assigned") {
          await refuse(ref, workerId, ["no_place"]);
          continue;
        }
        room -= 1;
        result.booked += 1;
        await tx
          .update(assignments)
          .set({ bookedVia: "api" })
          .where(eq(assignments.id, assigned.assignmentId));
        await recordEvent(tx, {
          actorType: "system",
          action: "shift.assigned",
          entityType: "assignment",
          entityId: assigned.assignmentId,
          data: {
            ...marks,
            shiftId: shift.id,
            workerId,
            slot: assigned.slot,
            noticeHours: noticeHours(check.startsAt, a.now),
            ...(check.result.overridden.length > 0 ? { overridden: check.result.overridden } : {}),
          },
        });
        await acceptOwnOffer(tx, shift.id, workerId, a.now);
      }
      if (result.booked > 0) await closeOffersIfFilled(tx, shift.id, a.now);
      // The base: what the system listed, less those it couldn't book here (tried again). A booking
      // here the system doesn't list stays out of it (so it's kept again next time); one cancelled
      // here that the system still lists stays in (so it isn't booked again).
      const nextBase = a.bookings.booked.filter((ref) => !notBooked.has(ref));
      if (nextBase.length !== base.length || nextBase.some((ref, i) => ref !== base[i])) {
        await tx.update(shifts).set({ syncedHolders: nextBase }).where(eq(shifts.id, shift.id));
      }
      await takeRead(tx, shift.id, a.readAt);
      return result;
    }),
  );
}

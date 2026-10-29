import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { assignments, events, shifts, workers } from "../db/schema";
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

// Who's booked on a connector's session, mirrored from the firm's own system (P5.5; ADR-026),
// after the session itself is applied (apply.ts). In one transaction, the source's row held first
// (the planner's lock order), then the session's:
// - a booking made there: the rules run as for an office placement (with the office's overrides:
//   rest, weekly hours, a day marked unavailable), and it's booked only if they pass and a place
//   is left, booked_via "api" and logged as the firm's (`shift.assigned` {by: "firm", via: "api",
//   sourceId}); refused, it isn't booked and `shift.booking_refused` says why, once for each
//   refusal. No message goes to the casual: the firm's system booked them;
// - a booking cancelled there: cancelled here, cancelled_firm (never a strike), `cancel_via` api,
//   who asked unknown, with notice hours from the system's own cancelled time only when it
//   belongs to this booking (after it was made here) and falls since the source was last read,
//   else from now: of the two, the later time, which gives the casual the shorter notice they'd be
//   owed for (the reading that favours them). The evidence (which time, and the system's own) is
//   on the log entry;
// - a booking here that the system doesn't list: never cancelled (only a person, or the system
//   saying it's cancelled, ends a confirmed booking), and kept out of the merge base, so the next
//   read keeps it too.
// The merge base is shifts.synced_holders, as the sheet sync's (src/lib/roster/sheets/merge.ts).

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

const sourceMarks = (sourceId: string) => ({ by: "firm", via: "api", sourceId });

async function liveHolders(tx: FirmTx, shiftId: string) {
  return tx
    .select({
      assignmentId: assignments.id,
      workerId: assignments.workerId,
      ref: workers.externalRef,
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

// Logged once for each refusal (the same worker and codes on this shift), so a system read every
// 15 minutes doesn't say it again every time.
async function refusedBefore(
  tx: FirmTx,
  shiftId: string,
  workerId: string,
  codes: string[],
): Promise<boolean> {
  const [hit] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.entityType, "shift"),
        eq(events.entityId, shiftId),
        eq(events.action, "shift.booking_refused"),
        sql`${events.data} ->> 'via' = 'api'`,
        sql`${events.data} ->> 'workerId' = ${workerId}`,
        sql`${events.data} -> 'codes' = ${JSON.stringify(codes)}::jsonb`,
      ),
    )
    .limit(1);
  return hit !== undefined;
}

export async function mirrorBookings(a: {
  run: WithFirm;
  firmId: string;
  by: Extract<PlannerCaller, { type: "connector" }>;
  ref: string; // the session's ref
  bookings: SourceBookings;
  lastReadAt: Date | null; // when the source was last read before this (its pull's times)
  now: Date;
}): Promise<MirrorResult | "not_allowed" | "no_session"> {
  return a.run(a.firmId, async (tx) => {
    if (!(await firmCallerMay(tx, a.by))) return "not_allowed";
    const [shift] = await tx
      .select({
        id: shifts.id,
        status: shifts.status,
        startsAt: shifts.startsAt,
        headcount: shifts.headcount,
        base: shifts.syncedHolders,
      })
      .from(shifts)
      .where(and(eq(shifts.source, "api"), eq(shifts.externalRef, a.ref)))
      .for("no key update");
    if (!shift) return "no_session";
    const result: MirrorResult = { booked: 0, refused: 0, cancelled: 0, kept: 0 };
    // A cancelled or started session: its bookings are what they were.
    if (shift.status === "cancelled" || shift.startsAt.getTime() <= a.now.getTime()) return result;
    const plug = nativeRosterPlug(tx, { clock: { now: () => a.now } });
    const marks = sourceMarks(a.by.sourceId);

    // 1. Cancelled in the system.
    let live = await liveHolders(tx, shift.id);
    const cancelledThere = new Map(a.bookings.cancelled.map((c) => [c.ref, c]));
    for (const holder of live) {
      const c = holder.ref ? cancelledThere.get(holder.ref) : undefined;
      if (!c || !holder.workerId) continue;
      const since = Math.max(holder.createdAt.getTime(), a.lastReadAt?.getTime() ?? 0);
      const own = c.at !== null && c.at.getTime() > since && c.at.getTime() <= a.now.getTime();
      const at = own && c.at ? c.at : a.now;
      const code: FirmChangeReason =
        c.reason && c.reason in FIRM_CHANGE_REASONS ? (c.reason as FirmChangeReason) : "other";
      const reason = FIRM_CHANGE_REASONS[code];
      const done = await plug.markCancelled(shift.id, holder.workerId, {
        reason,
        by: "firm",
        at,
        via: "api",
      });
      if (done.status !== "cancelled") continue;
      result.cancelled += 1;
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

    // 2. Booked in the system: through the merge, then the rules.
    live = await liveHolders(tx, shift.id);
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
    const agreed = ours.filter((ref) => theirs.has(ref));
    const refuse = async (workerId: string, codes: string[]) => {
      result.refused += 1;
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
        await refuse(workerId, ["settings_invalid"]);
        continue;
      }
      if (check.status !== "checked") continue;
      if (!check.result.pass) {
        await refuse(workerId, check.result.codes);
        continue;
      }
      // The rules first, then a place: someone they refuse is told why, not "no place".
      if (room <= 0) {
        await refuse(workerId, ["no_place"]);
        continue;
      }
      const assigned = await plug.assign(shift.id, workerId, check.result.pass);
      if (assigned.status !== "assigned") {
        await refuse(workerId, ["no_place"]);
        continue;
      }
      room -= 1;
      result.booked += 1;
      agreed.push(ref);
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
    // The base: who both sides hold now. A booking here the system doesn't list stays out of it
    // (so it's kept again next time); a refused one too (so it's tried again).
    const nextBase = a.bookings.booked.filter((ref) => agreed.includes(ref));
    if (nextBase.length !== base.length || nextBase.some((ref, i) => ref !== base[i])) {
      await tx.update(shifts).set({ syncedHolders: nextBase }).where(eq(shifts.id, shift.id));
    }
    return result;
  });
}

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { MINUTE, systemClock, type Clock } from "../auth/clock";
import { assignments, officeUsers, rosterSources, shifts, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { retryAborted } from "../db/retry";
import { maskText } from "../log/mask";
import { queueShiftConfirmed } from "../notices/shift-confirmed";
import { acceptOwnOffer, closeOffersIfFilled } from "../offers/close";
import {
  checkEligibility,
  OVERRIDABLE_CODES,
  type EligibilityInput,
  type EligibilityResult,
  type OverridableCode,
  type RuleCheck,
  type RuleCode,
} from "../rules/eligibility";
import { localDateOf } from "../time/zoned";
import { loadAllocationGate } from "./allocation-input";
import { loadEligibilityInput, loadEligibilityInputs } from "./eligibility-input";
import { nativeRosterPlug, sheetsRosterPlug } from "./native";
import { noticeHours } from "./notice";
import type { AssignResult, RosterPlug, RosterSource } from "./plug";
import { isVisibleToCasuals } from "./visibility";

// Booking a shift: the one path every "yes" goes through (docs/architecture.md, "Take an open
// shift"; golden rules 1, 4 and 5).
//
// bookShift(): a worker taking a shift, or the office placing someone. In its own transaction:
//   1. who may book whom: a worker only themselves; an office user only while active and an admin
//      or resourcer; only the office may override, only checks 0 and 6-8, always with a reason;
//   2. checkBooking(): lock the shift, then the worker, load the current rows and run the rules
//      (never what the page showed a moment ago); a worker's own booking only of a session shown
//      to casuals (its switch and its event's, src/lib/roster/visibility.ts: hidden reads as not
//      found, as on the shift page); the office can still place someone on a hidden one;
//   2b. the firm's allocation mode (a worker's own booking only): under fair rotation, a newly
//      opened place is held a few minutes for the workers with the fewest hours that week;
//   3. re-check the live source: our tables for native and imported shifts (the lock and the
//      conditional update below work on them directly); for a shift from a Google Sheet, our copy
//      must have synced in the last SHEET_COPY_FRESH_MS, or nothing is confirmed (the sheet itself
//      is never read per request, ADR-013);
//   4. the plug's one conditional update (first yes wins), with the rules' single-use pass;
//   5. the shift.assigned event, in the same transaction. A refusal by the rules is logged too
//      (shift.booking_refused, with the reason codes).
// A deadlock retries the whole transaction (twice at most): nothing outside it has happened yet.
//
// checkBooking(): step 2 alone, for the Sheets sync (names the office put in its sheet), which
// runs inside its own long transaction.
//
// Locks, in this order: the shift, then the worker, then (only when the booking would rely on the
// firm's "applied" allowance) the firm's day, then (a worker's own booking) a share lock on the
// shift's event, so switching the event off waits for it. The offer waves (src/lib/offers/waves.ts) follow the
// same order: the shift, then each offered worker (key share, through the offers row's link). The worker lock makes two bookings for one person
// queue, so two tabs can't both pass the overlap, rest or weekly-hours checks; the day lock does
// the same for two applied workers and the allowance. Two portal bookings can't deadlock each
// other. The Sheets sync can still deadlock with a portal booking (in one long transaction it
// takes worker locks, from its staff updates and earlier bookings, before later shift locks):
// Postgres then aborts one side, nothing is double-booked, and both retry (bookShift here, the
// sync's mirror transaction there). The office's move (src/lib/roster/firm-change.ts) takes the
// shift, then each booked worker in id order; it too can deadlock with the Sheets sync or a staff
// import (which take workers in sheet or file order): one side is aborted and retried.

export const SHEET_COPY_FRESH_MS = 20 * MINUTE;
export const OFFICE_ROLES_THAT_PLACE = ["admin", "resourcer"] as const;

// Ids as the database writes them (lower case), so they match the pass the rules issue.
export const rosterId = z.uuid().transform((id) => id.toLowerCase());
const uuid = rosterId;

// Strict: a worker's request carrying overrides is refused, not quietly stripped.
export const bookingRequestSchema = z.strictObject({
  shiftId: uuid,
  workerId: uuid,
  by: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("worker"), id: uuid }),
    z.strictObject({
      type: z.literal("office"),
      id: uuid,
      overrides: z.array(z.enum(OVERRIDABLE_CODES)).max(OVERRIDABLE_CODES.length).default([]),
      reason: z.string().trim().max(500).optional(),
    }),
  ]),
});
export type BookingRequest = z.input<typeof bookingRequestSchema>;

export type BookingResult =
  | { status: "booked"; assignmentId: string; slot: number; overridden: OverridableCode[] }
  // The rules said no: reasons in plain English for the person, codes for the office.
  | { status: "not_eligible"; reasons: string[]; codes: RuleCode[] }
  // Our copy of the firm's sheet is too old to confirm against: try again shortly.
  | { status: "source_stale" }
  // Fair rotation: the place is held for workers with fewer hours that week (the shift's own week)
  // until opensAt.
  | { status: "not_yet"; opensAt: Date }
  // The office user can't place staff (disabled, or payroll).
  | { status: "not_allowed" }
  // An override without a reason, or a reason holding a phone number or email address (it's kept
  // with the booking, which a worker's deletion clears; never in the log).
  | { status: "invalid_reason" }
  | Exclude<AssignResult, { status: "assigned" }>;

export type BookingCheck =
  | { status: "not_found" }
  | { status: "checked"; source: RosterSource; startsAt: Date; result: EligibilityResult };

export async function checkBooking(
  tx: FirmTx,
  request: { shiftId: string; workerId: string; now: Date; overrides?: OverridableCode[] },
): Promise<BookingCheck> {
  if (!uuid.safeParse(request.shiftId).success || !uuid.safeParse(request.workerId).success) {
    return { status: "not_found" };
  }
  const [shift] = await tx
    .select({ source: shifts.source, startsAt: shifts.startsAt })
    .from(shifts)
    .where(eq(shifts.id, request.shiftId))
    .for("no key update");
  const [worker] = await tx
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.id, request.workerId))
    .for("no key update");
  if (!shift || !worker) return { status: "not_found" };
  let input = await loadEligibilityInput(tx, request);
  if (!input) return { status: "not_found" };
  if (reliesOnApplied(input)) {
    // Queue behind anyone else booking that day on an application in progress, then count again:
    // the day's applied and deployed counts now include whoever got there first.
    await lockAppliedDay(tx, localDateOf(shift.startsAt, input.timeZone));
    input = await loadEligibilityInput(tx, request);
    if (!input) return { status: "not_found" };
  }
  return {
    status: "checked",
    source: shift.source,
    startsAt: shift.startsAt,
    result: checkEligibility(input),
  };
}

// The firm's day lock for the "applied" allowance (one firm-local day): taken after the shift and
// the worker, by a booking that relies on an application in progress and by the office's move
// (src/lib/roster/firm-change.ts), so two of them on one day count in turn.
export async function lockAppliedDay(tx: FirmTx, day: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('applied-day:' || app_current_firm_id()::text || ':' || ${day}, 0))`,
  );
}

// The rules' answer for one worker and shift, on the current rows, for showing (the open shifts
// list): no locks, and never a pass, so nothing can book with it. Booking re-checks everything
// under locks in bookShift(). Null when the shift or worker isn't there.
export async function previewBooking(
  tx: FirmTx,
  request: { shiftId: string; workerId: string; now: Date },
): Promise<Verdict | null> {
  if (!uuid.safeParse(request.shiftId).success || !uuid.safeParse(request.workerId).success) {
    return null;
  }
  // Only these three fields: a worker's preview never carries the office's overrides.
  const { shiftId, workerId, now } = request;
  const input = await loadEligibilityInput(tx, { shiftId, workerId, now });
  if (!input) return null;
  // The same verdict as previewBookings() gives for the pair (never the pass).
  const { ok, reasons, codes, checks } = checkEligibility(input);
  return { ok, reasons, codes, checks };
}

// The same verdicts for many pairs at once (Open shifts, the urgent board, the offer candidate
// list), keyed by pairKey(shiftId, workerId), with a fixed number of queries
// (loadEligibilityInputs). A pair missing from the map has a shift or worker that isn't there.
export async function previewBookings(
  tx: FirmTx,
  request: { shiftIds: string[]; workerIds: string[]; now: Date },
): Promise<Map<string, Verdict>> {
  const valid = (ids: string[]) => ids.filter((id) => uuid.safeParse(id).success);
  const inputs = await loadEligibilityInputs(tx, {
    shiftIds: valid(request.shiftIds),
    workerIds: valid(request.workerIds),
    now: request.now,
  });
  const verdicts = new Map<string, Verdict>();
  for (const [key, input] of inputs) {
    const { ok, reasons, codes, checks } = checkEligibility(input);
    verdicts.set(key, { ok, reasons, codes, checks });
  }
  return verdicts;
}

// One pair's verdict, without the pass: the decision, its reasons and every check with its figures
// (the shifts line's personal reply shows the office the checks, 12D.2).
export interface Verdict {
  ok: boolean;
  reasons: string[];
  codes: RuleCode[];
  checks: RuleCheck[];
}

// Whether the rules may count one of the worker's applications in progress for this shift: a
// type the role or the session itself (its extra requirements) needs, that may count "applied" at
// this firm, held as applied. (Holding a valid one too only means the lock wasn't needed.)
function reliesOnApplied(input: EligibilityInput): boolean {
  const { settings, credentials, shift } = input;
  if (settings.appliedAllowancePct <= 0) return false;
  return [...(shift.requiredTypes ?? []), ...shift.extraTypes].some(
    (type) =>
      settings.appliedAllowedTypes.includes(type) &&
      credentials.some((c) => c.type === type && c.status === "applied"),
  );
}

export async function bookShift(
  run: WithFirm,
  firmId: string,
  raw: BookingRequest,
  deps: { clock?: Clock } = {},
): Promise<BookingResult> {
  const request = bookingRequestSchema.parse(raw);
  if (request.by.type === "worker" && request.by.id !== request.workerId) {
    throw new Error("a worker can only book themselves");
  }
  if (request.by.type === "office") {
    const { overrides, reason } = request.by;
    if (overrides.length > 0 && !reason) return { status: "invalid_reason" };
    if (reason !== undefined && (reason === "" || maskText(reason) !== reason)) {
      return { status: "invalid_reason" };
    }
  }
  // The request's time, taken once: a retry books at the same moment, with the same notice.
  const now = (deps.clock ?? systemClock).now();
  return retryAborted(() => run(firmId, (tx) => bookInTransaction(tx, request, now)));
}

async function bookInTransaction(
  tx: FirmTx,
  request: z.output<typeof bookingRequestSchema>,
  now: Date,
): Promise<BookingResult> {
  const { shiftId, workerId, by } = request;
  if (by.type === "office" && !(await officeCanPlace(tx, by.id))) return { status: "not_allowed" };

  const check = await checkBooking(tx, {
    shiftId,
    workerId,
    now,
    overrides: by.type === "office" ? by.overrides : [],
  });
  if (check.status === "not_found") return { status: "not_found" };
  if (by.type === "worker" && !(await isVisibleToCasuals(tx, shiftId, { lock: true }))) {
    return { status: "not_found" };
  }
  const { result } = check;
  if (!result.pass) {
    await recordEvent(tx, {
      actorType: by.type,
      actorId: by.id,
      action: "shift.booking_refused",
      entityType: "shift",
      entityId: shiftId,
      data: { by: by.type === "worker" ? "worker" : "firm", workerId, codes: result.codes },
    });
    return { status: "not_eligible", reasons: result.reasons, codes: result.codes };
  }
  // The firm's allocation mode: under fair rotation a newly opened place waits a few minutes for
  // the workers with the fewest hours that week. Only a worker's own booking waits; the office
  // chooses who works.
  if (by.type === "worker") {
    const gate = await loadAllocationGate(tx, { shiftId, workerId, now });
    if (!gate.ok) {
      // Logged, so a fairness question later has the evidence.
      await recordEvent(tx, {
        actorType: "worker",
        actorId: by.id,
        action: "shift.booking_held",
        entityType: "shift",
        entityId: shiftId,
        data: { by: "worker", workerId, opensAt: gate.opensAt.toISOString() },
      });
      return { status: "not_yet", opensAt: gate.opensAt };
    }
  }
  if (check.source === "sheets" && !(await sheetCopyFresh(tx, now))) {
    return { status: "source_stale" };
  }

  const plug = plugFor(tx, check.source, now);
  const assigned = await plug.assign(shiftId, workerId, result.pass);
  if (assigned.status !== "assigned") return assigned;

  // The office's reason is free text about a person: kept on the booking (which a deletion and the
  // retention purge can clear), never in the append-only log, which only says one was given
  // (audit L23, L30, L85).
  // Only with an override: the shift's page shows it as "placed despite a rule".
  const reason = by.type === "office" && result.overridden.length > 0 ? by.reason : undefined;
  // Where the booking was made (P2.2), in this transaction with the booking itself: the casual's
  // own (a shift they took, an offer they accepted) or the office's.
  await tx
    .update(assignments)
    .set({
      bookedVia: by.type === "worker" ? "app" : "office",
      ...(reason ? { overrideReason: reason } : {}),
    })
    .where(eq(assignments.id, assigned.assignmentId));
  const assignedEventId = await recordEvent(tx, {
    actorType: by.type,
    actorId: by.id,
    action: "shift.assigned",
    entityType: "assignment",
    entityId: assigned.assignmentId,
    data: {
      by: by.type === "worker" ? "worker" : "firm",
      shiftId,
      workerId,
      slot: assigned.slot,
      noticeHours: noticeHours(check.startsAt, now),
      ...(result.overridden.length > 0 ? { overridden: result.overridden } : {}),
      ...(reason ? { reasonGiven: true } : {}),
      // The office's booking queues a message to tell them (below); a change notice waits for it
      // (src/lib/notices/firm-change.ts). A sheet's or a worker's own booking doesn't.
      ...(by.type === "office" ? { bookingMessage: true } : {}),
    },
  });
  // A worker booked onto a shift they were offered (they took it, or the office placed them) has
  // answered that offer. Full now: every other offer still waiting is closed (src/lib/offers/close.ts).
  await acceptOwnOffer(tx, shiftId, workerId, now);
  await closeOffersIfFilled(tx, shiftId, now);
  // Placed by the office: the worker is told by message (audit L22; src/lib/notices/shift-confirmed.ts).
  // One who took it themselves sees it on screen.
  if (by.type === "office") {
    await queueShiftConfirmed(tx, {
      eventId: assignedEventId,
      assignmentId: assigned.assignmentId,
    });
  }
  return {
    status: "booked",
    assignmentId: assigned.assignmentId,
    slot: assigned.slot,
    overridden: result.overridden,
  };
}

// Only active admins and resourcers place or cancel staff (payroll doesn't).
export async function officeCanPlace(tx: FirmTx, officeUserId: string): Promise<boolean> {
  const [placer] = await tx
    .select({ id: officeUsers.id })
    .from(officeUsers)
    .where(
      and(
        eq(officeUsers.id, officeUserId),
        eq(officeUsers.status, "active"),
        inArray(officeUsers.role, [...OFFICE_ROLES_THAT_PLACE]),
      ),
    );
  return placer !== undefined;
}

// The plug for a shift, by where the shift came from: our own tables for native and imported
// shifts, our copy of the sheet for Sheets shifts. Its clock is the request's time.
export function plugFor(tx: FirmTx, source: RosterSource, now: Date): RosterPlug {
  const clock = { now: () => now };
  return source === "sheets" ? sheetsRosterPlug(tx, { clock }) : nativeRosterPlug(tx, { clock });
}

// The firm's enabled sheet synced successfully recently enough to book against our copy of it.
async function sheetCopyFresh(tx: FirmTx, now: Date): Promise<boolean> {
  const [source] = await tx
    .select({ lastSyncedAt: rosterSources.lastSyncedAt })
    .from(rosterSources)
    .where(and(eq(rosterSources.kind, "sheets"), eq(rosterSources.enabled, true)));
  const synced = source?.lastSyncedAt;
  return synced != null && now.getTime() - synced.getTime() <= SHEET_COPY_FRESH_MS;
}

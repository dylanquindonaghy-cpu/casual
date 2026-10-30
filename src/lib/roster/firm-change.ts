import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import { firms, offers, shifts, sites } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { queueFirmChangeNotice } from "../notices/firm-change";
import { OVERRIDABLE_CODES, RULE_CODES, type RuleCode } from "../rules/eligibility";
import { rosterId } from "./book";
import {
  callerActor,
  callerMarks,
  firmCallerMay,
  firmCallerSchema,
  sourceRefusal,
  type FirmCaller,
} from "./firm-caller";
import {
  FIRM_CHANGE_REASONS,
  SHIFT_CHANGE_REASON_CODES,
  type FirmChangeReason,
} from "./firm-reasons";
import { changeNoticeHours } from "./notice";
import { recheckHolders } from "./recheck";
import { sameAsLastRefusal } from "./refusal-repeat";
import { isoDate, timesOn } from "./shift-times";
import { queueTravelEstimates } from "../travel/estimate-queue";

// The firm moving or shortening a shift people are booked on (docs/api-and-jobs.md,
// "Firm-initiated changes"; golden rule 12): the office, or the firm's planner through the API
// (src/lib/roster/firm-caller.ts). One transaction: the caller checked (an active admin or
// resourcer, or a live key); the shift locked (shift first, as every booking); not a Google
// Sheet's, nor a planner's for the office (the planner only its own); not started, not cancelled;
// the new start still ahead. A reason from the fixed list is required. The office gives the
// firm's local date and clock times; the planner gives instants, in whole minutes.
//
// - Curtailed when the new times sit inside the old ones at the same site (a shorter shift);
//   otherwise moved (the Sheets sync's rule).
// - Each confirmed worker: shift.curtailed / shift.moved {by: "firm", shiftId, workerId, reason,
//   old and new times, old and new site, noticeHours counted from the earlier of the old and new
//   start (changeNoticeHours: a move earlier records the warning they really had)}, and a
//   firm-change-notice job to tell them. The shift itself: shift.changed {by: "firm", fields,
//   from/to}. Offers still out describe the old shift, so they expire. The planner's entries also
//   carry {via: "api", keyId} (a connector's sourceId in its place), with the system actor.
// - Before anything is logged, the rules are run for each booked worker at the new time (the
//   shift itself is left out of their other bookings). If anyone fails a check the office can't
//   override (a credential not in date through the new day, their role, …), the move is refused
//   and nothing changes: the office cancels those bookings first, with notice (golden rule 6).
//   For the planner every failed check refuses it, rest, weekly hours and a day off included:
//   nobody is there to see a warning, so a machine can never push someone past the 11-hour rest
//   or the 48-hour week. The refusal is logged (shift.move_refused {by, reason, workers:
//   [{workerId, codes}]}). No answer for someone (their record missing) counts as such a no.
//   Anyone failing only checks the office may override stays booked and is listed for the office.
//   Every worker's event records the rules' answer (rulesOk, codes).

const reasonCode = z.enum(SHIFT_CHANGE_REASON_CODES);

// The office's form: the firm's local date and clock times, and a site id ("" for none).
const localMoveSchema = z.strictObject({
  shiftId: rosterId,
  date: z.string().max(20),
  start: z.string().max(10),
  end: z.string().max(10),
  siteId: z.string().max(100),
  reason: reasonCode,
  by: firmCallerSchema,
});
// The planner's: the new start and finish as instants, and the site's id (null for none).
const instantMoveSchema = z.strictObject({
  shiftId: rosterId,
  startsAt: z.date(),
  endsAt: z.date(),
  siteId: rosterId.nullable(),
  reason: reasonCode,
  by: firmCallerSchema,
});
export const moveShiftRequestSchema = z.union([localMoveSchema, instantMoveSchema]);
export type MoveShiftRequest = z.input<typeof moveShiftRequestSchema>;

export type MoveShiftResult =
  | {
      status: "moved" | "curtailed";
      told: number; // booked workers, each told
      noticeHours: number;
      warnings: { workerId: string; name: string; reasons: string[] }[];
    }
  | { status: "unchanged" }
  // Someone booked couldn't work it at the new time for a reason the caller can't override (for
  // the office a credential or their role; for the planner any): nothing changed. Cancel those
  // bookings first (with notice).
  | { status: "blocked"; workers: { workerId: string; name: string; reasons: string[] }[] }
  | { status: "invalid"; problem: "bad_date" | "bad_time" | "in_past" | "bad_site" }
  | { status: "not_open" } // started or cancelled
  | { status: "sheet" } // the office, on a Google Sheet's shift
  | { status: "planner" } // the office, on a session from the firm's planner
  | { status: "not_found" } // also the planner, on a session it didn't send
  | { status: "not_allowed" }; // not an active admin or resourcer, or a key no longer live

// Thrown inside the transaction when the rules refuse the move, so that everything rolls back.
// The caller logs the refusal afterwards in its own transaction (recordMoveRefused).
export class MoveBlocked extends Error {
  constructor(
    readonly workers: { workerId: string; name: string; reasons: string[]; codes: RuleCode[] }[],
  ) {
    super("move blocked by the rules");
  }
}

type Times = { startsAt: Date; endsAt: Date };
type TimesOf = (timeZone: string) => Times | { problem: "bad_date" | "bad_time" };

const DAY_MS = 24 * 60 * 60 * 1000;

// The planner's instants, held to the office's rules (src/lib/roster/shift-window.ts): whole
// minutes, a finish after the start, and less than a day long.
const fromInstants =
  (startsAt: Date, endsAt: Date): TimesOf =>
  () => {
    const length = endsAt.getTime() - startsAt.getTime();
    const whole = startsAt.getTime() % 60_000 === 0 && endsAt.getTime() % 60_000 === 0;
    return whole && length > 0 && length < DAY_MS ? { startsAt, endsAt } : { problem: "bad_time" };
  };

const fromLocal =
  (date: string, start: string, end: string): TimesOf =>
  (timeZone) => {
    const day = isoDate(date);
    if (!day) return { problem: "bad_date" };
    return timesOn(day, start, end, timeZone) ?? { problem: "bad_time" };
  };

async function siteExists(tx: FirmTx, siteId: string): Promise<boolean> {
  if (!z.uuid().safeParse(siteId).success) return false;
  const [site] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId));
  return site !== undefined;
}

export async function moveShiftByFirm(
  run: WithFirm,
  firmId: string,
  raw: MoveShiftRequest,
  deps: { clock?: Clock } = {},
): Promise<MoveShiftResult> {
  const request = moveShiftRequestSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  const move = {
    shiftId: request.shiftId,
    reason: request.reason,
    by: request.by,
    now,
    ...("date" in request
      ? {
          siteId: request.siteId.trim() || null,
          times: fromLocal(request.date, request.start, request.end),
        }
      : { siteId: request.siteId, times: fromInstants(request.startsAt, request.endsAt) }),
  };
  try {
    return await retryAborted(() => run(firmId, (tx) => moveInTx(tx, move)));
  } catch (error) {
    if (!(error instanceof MoveBlocked)) throw error;
    // The whole transaction rolled back: nothing moved, nothing queued. The refusal itself is
    // logged in a short transaction of its own (ids and rule codes only), so the attempt and the
    // rules' answer are on the record.
    await recordMoveRefused(run, firmId, {
      shiftId: request.shiftId,
      reason: request.reason,
      by: request.by,
      workers: error.workers,
    });
    return {
      status: "blocked",
      workers: error.workers.map(({ workerId, name, reasons }) => ({ workerId, name, reasons })),
    };
  }
}

const moveInTxSchema = z.strictObject({
  shiftId: rosterId,
  startsAt: z.date(),
  endsAt: z.date(),
  siteId: rosterId.nullable(),
  reason: reasonCode,
  by: firmCallerSchema,
  now: z.date(),
  timeZone: z.string().min(1).max(100).optional(), // the firm's (read from it when left out)
});

// The move inside a transaction the caller already holds (the planner's PUT: one transaction for
// the whole session). Throws MoveBlocked when the rules refuse it: the caller lets its transaction
// roll back, then logs the refusal with recordMoveRefused. Take the key's lock (firmCallerMay)
// before locking the session, as this does, so every path locks the key first.
export async function moveShiftInTx(
  tx: FirmTx,
  input: z.input<typeof moveInTxSchema>,
): Promise<MoveShiftResult> {
  const m = moveInTxSchema.parse(input);
  return moveInTx(tx, { ...m, times: fromInstants(m.startsAt, m.endsAt) });
}

async function moveInTx(
  tx: FirmTx,
  m: {
    shiftId: string;
    siteId: string | null;
    reason: FirmChangeReason;
    by: FirmCaller;
    now: Date;
    timeZone?: string;
    times: TimesOf;
  },
): Promise<MoveShiftResult> {
  const { shiftId, siteId, by, now } = m;
  const reason = FIRM_CHANGE_REASONS[m.reason];
  if (!(await firmCallerMay(tx, by))) return { status: "not_allowed" };
  const [shift] = await tx
    .select({
      source: shifts.source,
      status: shifts.status,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      siteId: shifts.siteId,
    })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .for("no key update");
  if (!shift) return { status: "not_found" };
  const refused = sourceRefusal(shift.source, by);
  if (refused) return refused;
  if (shift.status === "cancelled" || shift.startsAt.getTime() <= now.getTime()) {
    return { status: "not_open" };
  }
  const timeZone = m.timeZone ?? (await firmZone(tx));
  const times = m.times(timeZone);
  if ("problem" in times) return { status: "invalid", problem: times.problem };
  if (times.startsAt.getTime() <= now.getTime()) return { status: "invalid", problem: "in_past" };
  if (siteId && siteId !== shift.siteId && !(await siteExists(tx, siteId))) {
    return { status: "invalid", problem: "bad_site" };
  }
  const timesChanged =
    times.startsAt.getTime() !== shift.startsAt.getTime() ||
    times.endsAt.getTime() !== shift.endsAt.getTime();
  const siteChanged = siteId !== shift.siteId;
  if (!timesChanged && !siteChanged) return { status: "unchanged" };
  const curtailed =
    !siteChanged &&
    times.startsAt.getTime() >= shift.startsAt.getTime() &&
    times.endsAt.getTime() <= shift.endsAt.getTime();
  const notice = changeNoticeHours(shift.startsAt, times.startsAt, now);

  await tx
    .update(shifts)
    .set({ startsAt: times.startsAt, endsAt: times.endsAt, siteId })
    .where(eq(shifts.id, shiftId));
  // New times or a new site: its travel estimates again (12G.2).
  await queueTravelEstimates(tx, [shiftId]);

  // Can each booked worker still work it? The rules at the new time and site, with their rows
  // (and the new day's "applied" lock) held: src/lib/roster/recheck.ts.
  const { holders, blocked } = await recheckHolders(tx, {
    shiftId,
    now,
    startsAt: times.startsAt,
    timeZone,
    siteChanged,
    allowed: by.type === "office" ? OVERRIDABLE_CODES : [],
    honourKept: by.type === "office",
  });
  if (blocked.length > 0) {
    throw new MoveBlocked(
      blocked.map((h) => ({
        workerId: h.workerId,
        name: h.name,
        reasons: h.reasons,
        codes: h.codes,
      })),
    );
  }
  await tx
    .update(offers)
    .set({ response: "expired", respondedAt: now })
    .where(and(eq(offers.shiftId, shiftId), isNull(offers.response)));

  const actor = callerActor(by);
  const marks = callerMarks(by);
  const moved = {
    oldStartsAt: shift.startsAt.toISOString(),
    oldEndsAt: shift.endsAt.toISOString(),
    newStartsAt: times.startsAt.toISOString(),
    newEndsAt: times.endsAt.toISOString(),
    oldSiteId: shift.siteId,
    newSiteId: siteId,
  };
  for (const h of holders) {
    const eventId = await recordEvent(tx, {
      ...actor,
      action: curtailed ? "shift.curtailed" : "shift.moved",
      entityType: "assignment",
      entityId: h.assignmentId,
      data: {
        by: "firm",
        ...marks,
        shiftId,
        workerId: h.workerId,
        reason,
        ...moved,
        noticeHours: notice,
        // The rules' answer at the new time (codes only): what the office was shown.
        rulesOk: h.ok,
        ...(!h.ok ? { codes: h.codes } : {}),
      },
    });
    await queueFirmChangeNotice(tx, { eventId, assignmentId: h.assignmentId });
  }
  await recordEvent(tx, {
    ...actor,
    action: "shift.changed",
    entityType: "shift",
    entityId: shiftId,
    data: {
      by: "firm",
      ...marks,
      fields: [
        ...(siteChanged ? ["siteId"] : []),
        ...(times.startsAt.getTime() !== shift.startsAt.getTime() ? ["startsAt"] : []),
        ...(times.endsAt.getTime() !== shift.endsAt.getTime() ? ["endsAt"] : []),
      ],
      reason,
      from: { startsAt: moved.oldStartsAt, endsAt: moved.oldEndsAt, siteId: moved.oldSiteId },
      to: { startsAt: moved.newStartsAt, endsAt: moved.newEndsAt, siteId: moved.newSiteId },
    },
  });

  const warnings = holders
    .filter((h) => !h.ok)
    .map((h) => ({ workerId: h.workerId, name: h.name, reasons: h.reasons }));
  return {
    status: curtailed ? "curtailed" : "moved",
    told: holders.length,
    noticeHours: notice,
    warnings,
  };
}

async function firmZone(tx: FirmTx): Promise<string> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  return firm?.timezone ?? "Europe/London";
}

const moveRefusedSchema = z.strictObject({
  shiftId: rosterId,
  reason: reasonCode,
  by: firmCallerSchema,
  workers: z.array(z.object({ workerId: rosterId, codes: z.array(z.enum(RULE_CODES)) })).min(1),
  // A connector's: what it asked for, as a fingerprint (src/lib/roster/refusal-repeat.ts).
  attempt: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
});

// A refused move on the record (shift.move_refused {by: "firm", reason, workers: [{workerId,
// codes}]}, the planner's with {via: "api", keyId or sourceId} too), in a short transaction of its
// own after the move's rolled back. Ids and rule codes only: never a name. Its `workers` list is
// how the action log finds it by worker (WORKER_LIST_ACTIONS, src/lib/office/action-log.ts).
export async function recordMoveRefused(
  run: WithFirm,
  firmId: string,
  input: z.input<typeof moveRefusedSchema>,
): Promise<void> {
  const r = moveRefusedSchema.parse(input);
  const data = {
    by: "firm",
    ...callerMarks(r.by),
    reason: FIRM_CHANGE_REASONS[r.reason],
    workers: r.workers.map((w) => ({ workerId: w.workerId, codes: w.codes })),
    ...(r.attempt ? { attempt: r.attempt } : {}),
  };
  await run(firmId, async (tx) => {
    // A connector's source says the same again at its next read: logged once (refusal-repeat.ts).
    if (
      r.by.type === "connector" &&
      (await sameAsLastRefusal(tx, r.shiftId, "shift.move_refused", data))
    ) {
      return;
    }
    await recordEvent(tx, {
      ...callerActor(r.by),
      action: "shift.move_refused",
      entityType: "shift",
      entityId: r.shiftId,
      data,
    });
  });
}

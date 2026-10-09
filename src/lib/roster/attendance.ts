import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import { assignments, shifts } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeCanPlace, rosterId } from "./book";

// The office marking who worked a shift and who didn't attend (docs/screens.md, the shift's
// "Places"; golden rule 5). Our own record, whatever the rota source: a Google Sheet has no
// attendance, and its sync changes only `confirmed` bookings and keeps marked ones as holders.
//
// - Only an active admin or resourcer, and only once the shift has started (a no-show is known
//   once they're late). No end limit: timesheets and corrections come days later.
// - Only a live booking (confirmed, completed or no_show). A marked one can be changed (a
//   mistake), and the log keeps what it was.
// - The shift is locked first (the order every booking uses), then the booking.
// - Logged shift.completed / shift.no_show {by: "firm", shiftId, workerId, from}.
//
// markRestWorked: once the shift has ended, everyone still `confirmed` is marked as worked, one
// event each. For a big event where only a few didn't come.

export const ATTENDANCE_OUTCOMES = ["completed", "no_show"] as const;
export type AttendanceOutcome = (typeof ATTENDANCE_OUTCOMES)[number];
const LIVE = ["confirmed", "completed", "no_show"] as const;
type Live = (typeof LIVE)[number];

const by = z.strictObject({ type: z.literal("office"), id: rosterId });

export const markAttendanceRequestSchema = z.strictObject({
  shiftId: rosterId,
  workerId: rosterId,
  outcome: z.enum(ATTENDANCE_OUTCOMES),
  by,
});
export type MarkAttendanceRequest = z.input<typeof markAttendanceRequestSchema>;

export type MarkAttendanceResult =
  | { status: "marked"; outcome: AttendanceOutcome; from: Live }
  | { status: "unchanged" } // already marked that way
  | { status: "not_started" }
  | { status: "not_booked" } // no live booking for them on it (never booked, or cancelled)
  | { status: "not_found" }
  | { status: "not_allowed" };

export const markRestWorkedRequestSchema = z.strictObject({ shiftId: rosterId, by });
export type MarkRestWorkedRequest = z.input<typeof markRestWorkedRequestSchema>;

export type MarkRestWorkedResult =
  | { status: "marked"; count: number } // 0: nobody was left to mark
  | { status: "not_ended" }
  | { status: "not_found" }
  | { status: "not_allowed" };

type Deps = { clock?: Clock };

async function lockShift(tx: FirmTx, shiftId: string) {
  const [shift] = await tx
    .select({ startsAt: shifts.startsAt, endsAt: shifts.endsAt })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .for("no key update");
  return shift;
}

async function logMark(
  tx: FirmTx,
  mark: {
    officeId: string;
    assignmentId: string;
    shiftId: string;
    workerId: string;
    outcome: AttendanceOutcome;
    from: Live;
  },
) {
  await recordEvent(tx, {
    actorType: "office",
    actorId: mark.officeId,
    action: mark.outcome === "completed" ? "shift.completed" : "shift.no_show",
    entityType: "assignment",
    entityId: mark.assignmentId,
    data: { by: "firm", shiftId: mark.shiftId, workerId: mark.workerId, from: mark.from },
  });
}

export async function markAttendance(
  run: WithFirm,
  firmId: string,
  raw: MarkAttendanceRequest,
  deps: Deps = {},
): Promise<MarkAttendanceResult> {
  const request = markAttendanceRequestSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  return retryAborted(() =>
    run(firmId, async (tx): Promise<MarkAttendanceResult> => {
      if (!(await officeCanPlace(tx, request.by.id))) return { status: "not_allowed" };
      const shift = await lockShift(tx, request.shiftId);
      if (!shift) return { status: "not_found" };
      if (shift.startsAt.getTime() > now.getTime()) return { status: "not_started" };
      const [booking] = await tx
        .select({ id: assignments.id, status: assignments.status })
        .from(assignments)
        .where(
          and(
            eq(assignments.shiftId, request.shiftId),
            eq(assignments.workerId, request.workerId),
            inArray(assignments.status, [...LIVE]),
          ),
        )
        .for("no key update");
      if (!booking) return { status: "not_booked" };
      const from = booking.status as Live;
      if (from === request.outcome) return { status: "unchanged" };
      await tx
        .update(assignments)
        .set({ status: request.outcome })
        .where(eq(assignments.id, booking.id));
      await logMark(tx, {
        officeId: request.by.id,
        assignmentId: booking.id,
        shiftId: request.shiftId,
        workerId: request.workerId,
        outcome: request.outcome,
        from,
      });
      return { status: "marked", outcome: request.outcome, from };
    }),
  );
}

export async function markRestWorked(
  run: WithFirm,
  firmId: string,
  raw: MarkRestWorkedRequest,
  deps: Deps = {},
): Promise<MarkRestWorkedResult> {
  const request = markRestWorkedRequestSchema.parse(raw);
  const now = (deps.clock ?? systemClock).now();
  return retryAborted(() =>
    run(firmId, async (tx): Promise<MarkRestWorkedResult> => {
      if (!(await officeCanPlace(tx, request.by.id))) return { status: "not_allowed" };
      const shift = await lockShift(tx, request.shiftId);
      if (!shift) return { status: "not_found" };
      if (shift.endsAt.getTime() > now.getTime()) return { status: "not_ended" };
      const rest = await tx
        .update(assignments)
        .set({ status: "completed" })
        .where(and(eq(assignments.shiftId, request.shiftId), eq(assignments.status, "confirmed")))
        .returning({ id: assignments.id, workerId: assignments.workerId, slot: assignments.slot });
      rest.sort((a, b) => a.slot - b.slot);
      for (const r of rest) {
        if (!r.workerId) throw new Error("a confirmed booking without a worker");
        await logMark(tx, {
          officeId: request.by.id,
          assignmentId: r.id,
          shiftId: request.shiftId,
          workerId: r.workerId,
          outcome: "completed",
          from: "confirmed",
        });
      }
      return { status: "marked", count: rest.length };
    }),
  );
}

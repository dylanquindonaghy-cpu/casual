import { and, asc, desc, eq, gt, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { DAY, systemClock } from "../auth/clock";
import { retryAborted } from "../db/retry";
import { assignments, requests, shifts, sites } from "../db/schema";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { dayLabel } from "../rules/reasons";
import { RELIABILITY_DAYS } from "../rules/reliability";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { roleLabel, shiftWhen } from "./format";
import type { PortalContext } from "./my-shifts";
import {
  attendancePayloadSchema,
  requestPayloadSchemas,
  type AttendanceOutcome,
  type AttendancePayload,
  type CreateRequestOutcome,
  type RequestPayload,
  type WithdrawOutcome,
  type WorkerRequestKind,
} from "./request-kinds";

// Worker requests (docs/screens.md, `/requests`): a time change or a swap for one of the worker's
// own upcoming shifts, for the office to approve or decline (src/lib/requests/resolve.ts).
// Server only (it reaches the database); the browser-safe kinds and wording are request-kinds.ts.
//
// - createRequest: only for the worker's confirmed booking on a shift that hasn't started; one
//   open request per shift and kind (asking again returns the waiting one's reference). The row
//   and a request.created event go in together; the event holds ids and the kind only, never
//   the worker's typed note or a colleague's name (they stay on the row).
// - myRequests: the worker's requests from the last 90 days, newest first, with their status and
//   the office's note with its answer.
// - requestableShifts: the worker's upcoming bookings, for the form's shift picker.
// - withdrawRequest (Phase 28.2; 28.9): she takes back one still waiting for the office (open or
//   escalated: both read "Waiting for the office"). One conditional UPDATE: if the office answered
//   first, nothing changes and she's told so. Never a question she sent as a message: Enquiries
//   has it (canWithdrawRequest says where "Take back" shows).
// - askAboutMark (Phase 28.2; 28.13): "Think this mark is wrong?" on one of her sessions marked
//   worked or not attended in the last 90 days, an attendance question for a person. It never
//   changes the mark (golden rule 12): the office looks again on who-worked.

export const REQUESTS_SHOWN_DAYS = 90;

const refOf = (id: string) => id.slice(0, 8).toUpperCase();
const uuid = z.uuid();

type Ctx = PortalContext & { firm: { id: string; timezone: string; signOff: string } };

export async function createRequest(
  ctx: Ctx,
  workerId: string,
  input: { shiftId: string; kind: WorkerRequestKind; payload: RequestPayload },
): Promise<CreateRequestOutcome> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  const payload = requestPayloadSchemas[input.kind].safeParse(input.payload);
  if (!payload.success) return { status: "invalid" };
  if (!uuid.safeParse(input.shiftId).success || !uuid.safeParse(workerId).success) {
    return { status: "not_yours" };
  }
  return run(ctx.firm.id, async (tx) => {
    // Their own confirmed booking, on a shift that hasn't started. The shift row is locked, so
    // two taps can't both find no open request and both add one.
    const [booking] = await tx
      .select({ startsAt: shifts.startsAt, endsAt: shifts.endsAt })
      .from(assignments)
      .innerJoin(
        shifts,
        and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
      )
      .where(
        and(
          eq(assignments.shiftId, input.shiftId),
          eq(assignments.workerId, workerId),
          eq(assignments.status, "confirmed"),
          gt(shifts.startsAt, now),
          ne(shifts.status, "cancelled"),
        ),
      )
      .for("no key update", { of: shifts });
    if (!booking) return { status: "not_yours" };

    const [waiting] = await tx
      .select({ id: requests.id })
      .from(requests)
      .where(
        and(
          eq(requests.workerId, workerId),
          eq(requests.shiftId, input.shiftId),
          eq(requests.type, input.kind),
          inArray(requests.status, ["open", "escalated"]),
        ),
      );
    if (waiting) return { status: "already_open", ref: refOf(waiting.id), kind: input.kind };

    const [created] = await tx
      .insert(requests)
      .values({
        firmId: ctx.firm.id,
        workerId,
        shiftId: input.shiftId,
        type: input.kind,
        payload: payload.data,
      })
      .returning({ id: requests.id });
    if (!created) throw new Error("request insert returned nothing");
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "request.created",
      entityType: "request",
      entityId: created.id,
      data: { type: input.kind, shiftId: input.shiftId },
    });
    const w = wallTimeOf(now, ctx.firm.timezone);
    const pad = (n: number) => String(n).padStart(2, "0");
    const asked = "start" in payload.data ? `${payload.data.start} to ${payload.data.end}` : null;
    return {
      status: "created",
      ref: refOf(created.id),
      kind: input.kind,
      when: shiftWhen(booking.startsAt, booking.endsAt, ctx.firm.timezone),
      asked,
      sentAt: `${pad(w.hour)}:${pad(w.minute)} on ${dayLabel(localDateOf(now, ctx.firm.timezone))}`,
      signOff: ctx.firm.signOff,
    };
  });
}

export interface MyRequest {
  ref: string;
  type: string;
  status: string;
  note: string | null; // the office's note with its answer
  createdAt: Date;
  shift: { when: string; role: string; siteName: string | null } | null;
  // Phase 28.2 (myRequests always fills these; optional so a list built by hand needn't):
  id?: string; // for "Take back this request" (withdrawRequest)
  shiftId?: string | null;
  // The message a question came in as (the shifts line or the app's messages), or null: with
  // type and status, whether "Take back" shows (canWithdrawRequest).
  messageId?: string | null;
  // An attendance question's session as it's marked now ("Your shift now shows: …"): her
  // booking's mark, or null when it isn't marked (or isn't an attendance question).
  mark?: "completed" | "no_show" | null;
}

export async function myRequests(ctx: Ctx, workerId: string): Promise<MyRequest[]> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  const rows = await run(ctx.firm.id, (tx) =>
    tx
      .select({
        id: requests.id,
        type: requests.type,
        status: requests.status,
        note: requests.resolutionNote,
        createdAt: requests.createdAt,
        shiftId: requests.shiftId,
        messageId: requests.messageId,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        role: shifts.role,
        siteName: sites.name,
        // Her own booking's mark on an attendance question's session (one live booking per
        // casual per session).
        mark: sql<string | null>`(
          select a.status from assignments a
           where a.firm_id = ${requests.firmId} and a.shift_id = ${requests.shiftId}
             and a.worker_id = ${requests.workerId} and a.status in ('completed', 'no_show')
             and ${requests.type} = 'attendance'
           limit 1)`,
      })
      .from(requests)
      .leftJoin(shifts, and(eq(shifts.firmId, requests.firmId), eq(shifts.id, requests.shiftId)))
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(
        and(
          eq(requests.workerId, workerId),
          gt(requests.createdAt, new Date(now.getTime() - REQUESTS_SHOWN_DAYS * DAY)),
        ),
      )
      .orderBy(desc(requests.createdAt), asc(requests.id)),
  );
  return rows.map((r) => ({
    id: r.id,
    ref: refOf(r.id),
    type: r.type,
    status: r.status,
    note: r.note,
    createdAt: r.createdAt,
    shiftId: r.shiftId,
    messageId: r.messageId,
    mark: r.mark === "completed" || r.mark === "no_show" ? r.mark : null,
    shift:
      r.startsAt && r.endsAt && r.role
        ? {
            when: shiftWhen(r.startsAt, r.endsAt, ctx.firm.timezone),
            role: roleLabel(r.role),
            siteName: r.siteName,
          }
        : null,
  }));
}

export interface RequestableShift {
  shiftId: string;
  label: string; // "Sat 7 Nov, 14:00 to 22:00, Door supervisor at Demo Arena"
}

export async function requestableShifts(ctx: Ctx, workerId: string): Promise<RequestableShift[]> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  const rows = await run(ctx.firm.id, (tx) =>
    tx
      .select({
        shiftId: shifts.id,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        role: shifts.role,
        siteName: sites.name,
      })
      .from(assignments)
      .innerJoin(
        shifts,
        and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
      )
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(
        and(
          eq(assignments.workerId, workerId),
          eq(assignments.status, "confirmed"),
          gt(shifts.startsAt, now),
          ne(shifts.status, "cancelled"),
        ),
      )
      .orderBy(asc(shifts.startsAt)),
  );
  return rows.map((r) => ({
    shiftId: r.shiftId,
    label: `${shiftWhen(r.startsAt, r.endsAt, ctx.firm.timezone)}, ${roleLabel(r.role)}${
      r.siteName ? ` at ${r.siteName}` : ""
    }`,
  }));
}

// Whether "Take back this request" can work on it, for the pages to hide it where it can't: still
// waiting (open or escalated), and not a question she sent as a message, which Enquiries answers
// with its message locked (requestWaiting's rule, src/lib/office/enquiry-sql.ts). Pure.
export function canWithdrawRequest(r: {
  type: string;
  status: string;
  messageId?: string | null;
}): boolean {
  const waiting = r.status === "open" || r.status === "escalated";
  return waiting && !(r.type === "general" && r.messageId != null);
}

// "Take back this request" (Phase 28.2): one conditional UPDATE on her own request while it's
// still waiting (open or escalated). Zero rows: it isn't hers, or it was answered (or taken back)
// first, and nothing changes. The office's answer (src/lib/requests/resolve.ts) locks the row and
// checks it's still waiting, so whichever commits first wins and the other changes nothing. A
// question she sent as a message (general, with its message_id) is never taken back: Enquiries
// answers it with the message locked, and taking it back would drop it from Need a person while a
// reply may already be on its way (canWithdrawRequest). The event holds ids and the kind only.
export async function withdrawRequest(
  ctx: Ctx,
  workerId: string,
  requestId: string,
): Promise<WithdrawOutcome> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(workerId).success) {
    return { status: "not_yours" };
  }
  return run(ctx.firm.id, async (tx): Promise<WithdrawOutcome> => {
    const [taken] = await tx
      .update(requests)
      .set({ status: "withdrawn", resolvedAt: now, resolvedBy: null })
      .where(
        and(
          eq(requests.id, requestId),
          eq(requests.workerId, workerId),
          inArray(requests.status, ["open", "escalated"]),
          sql`not (${requests.type} = 'general' and ${requests.messageId} is not null)`,
        ),
      )
      .returning({ id: requests.id, type: requests.type, shiftId: requests.shiftId });
    if (taken) {
      await recordEvent(tx, {
        actorType: "worker",
        actorId: workerId,
        action: "request.withdrawn",
        entityType: "request",
        entityId: taken.id,
        data: { type: taken.type, workerId, ...(taken.shiftId ? { shiftId: taken.shiftId } : {}) },
      });
      return { status: "withdrawn", ref: refOf(taken.id) };
    }
    const [current] = await tx
      .select({
        id: requests.id,
        status: requests.status,
        type: requests.type,
        messageId: requests.messageId,
      })
      .from(requests)
      .where(and(eq(requests.id, requestId), eq(requests.workerId, workerId)));
    if (!current) return { status: "not_yours" };
    if (current.status === "withdrawn") return { status: "already", ref: refOf(current.id) };
    const waiting = current.status === "open" || current.status === "escalated";
    if (waiting && !canWithdrawRequest(current)) {
      return { status: "office_has_it", ref: refOf(current.id) };
    }
    return { status: "answered_first", ref: refOf(current.id) };
  });
}

// "Think this mark is wrong?" (Phase 28.2): an attendance question about one of her own sessions
// the office marked worked (completed) or not attended (no_show), that started within
// RELIABILITY_DAYS (by starts_at, as src/lib/office/reliability.ts counts them). Her booking row is
// locked first, so two taps at once find one waiting question, not none (createRequest locks the
// shift the same way). One waiting question per session; saying what the mark already says is
// refused. The row and request.created ({type, shiftId, assignmentId, said}: ids and codes, never
// her note) go in together. A person answers it (28.9); the mark changes only if the office marks
// the session again on who-worked. Run again if Postgres aborts it to break a deadlock: it locks
// her booking, then the request's insert share-locks her worker row, while an erasure locks the
// worker, then updates her bookings. It holds everything it does, so a second run repeats nothing.
export async function askAboutMark(
  ctx: Ctx,
  workerId: string,
  input: { shiftId: string; payload: AttendancePayload },
): Promise<AttendanceOutcome> {
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  const payload = attendancePayloadSchema.safeParse(input.payload);
  if (!payload.success) return { status: "invalid" };
  if (!uuid.safeParse(input.shiftId).success || !uuid.safeParse(workerId).success) {
    return { status: "not_yours" };
  }
  const from = new Date(now.getTime() - RELIABILITY_DAYS * DAY);
  return retryAborted(() =>
    run(ctx.firm.id, async (tx): Promise<AttendanceOutcome> => {
      const [booking] = await tx
        .select({ id: assignments.id, status: assignments.status })
        .from(assignments)
        .innerJoin(
          shifts,
          and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
        )
        .where(
          and(
            eq(assignments.shiftId, input.shiftId),
            eq(assignments.workerId, workerId),
            inArray(assignments.status, ["completed", "no_show"]),
            gte(shifts.startsAt, from),
            lte(shifts.startsAt, now),
          ),
        )
        .for("no key update", { of: assignments });
      if (!booking) return { status: "not_yours" };
      const marked = booking.status === "completed" ? "worked" : "not_worked";
      if (payload.data.said === marked) return { status: "matches_mark" };

      const [waiting] = await tx
        .select({ id: requests.id })
        .from(requests)
        .where(
          and(
            eq(requests.workerId, workerId),
            eq(requests.shiftId, input.shiftId),
            eq(requests.type, "attendance"),
            inArray(requests.status, ["open", "escalated"]),
          ),
        );
      if (waiting) return { status: "already_open", ref: refOf(waiting.id) };

      const [created] = await tx
        .insert(requests)
        .values({
          firmId: ctx.firm.id,
          workerId,
          shiftId: input.shiftId,
          type: "attendance",
          payload: payload.data,
        })
        .returning({ id: requests.id });
      if (!created) throw new Error("request insert returned nothing");
      await recordEvent(tx, {
        actorType: "worker",
        actorId: workerId,
        action: "request.created",
        entityType: "request",
        entityId: created.id,
        data: {
          type: "attendance",
          shiftId: input.shiftId,
          assignmentId: booking.id,
          said: payload.data.said,
        },
      });
      const w = wallTimeOf(now, ctx.firm.timezone);
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        status: "created",
        ref: refOf(created.id),
        sentAt: `${pad(w.hour)}:${pad(w.minute)} on ${dayLabel(localDateOf(now, ctx.firm.timezone))}`,
        signOff: ctx.firm.signOff,
      };
    }),
  );
}

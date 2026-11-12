import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { shifts } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";
import { createShifts, type ShiftProblem } from "../office/shift-editor";
import { setShowing } from "../office/showing";
import { cancelBookingInTx, cancelShiftInTx } from "../roster/cancel";
import { MoveBlocked, moveShiftInTx, recordMoveRefused } from "../roster/firm-change";
import {
  FIRM_CHANGE_REASONS,
  SHIFT_CHANGE_REASON_CODES,
  type FirmChangeReason,
} from "../roster/firm-reasons";
import { refreshShiftStatus } from "../roster/native";
import { lowerPlacesTo } from "../roster/places";
import { isoDate, timesOn } from "../roster/shift-times";
import { offerPlacesInTx, type OfferPlacesResult } from "../roster/urgent";
import { queueClientRequestAnswer } from "./jobs";
import type { ClientPayload } from "./payloads";
import { placesChange } from "./preview-math";
import { bookedOn, loadClientRequest, ownerOf, type OfficeClientRequest } from "./queue";
import { firmTimeZone, placesOf } from "./reads";

// The office's answers to a client request (Phase 36.4; Dylan's approval, 2026-11-11: "the office
// accepts or declines each request"). Admins and resourcers (client_requests), checked inside the
// firm's transaction; the request's row is held first, so two answers (or an answer and the
// client's reply) take turns and only one wins. Only a request waiting for the office, or one it
// asked the client about, can be answered.
//
// Accepting applies it through the office's own paths, in one transaction (all of it or none):
// - more places: the session's places go up and, unless the office says not to, are offered at
//   once by "Offer N open places"'s path (offerPlacesInTx: marked urgent, offer waves, only while
//   the session shows to casuals; a session the office marked filled stays closed);
// - fewer places: the bookings the cut needs are cancelled first, by the firm with notice ("The
//   client needs fewer staff", asked by the client; cancelBookingInTx: each logged, each casual
//   told: golden rule 12), the latest booked unless the office chose who, then the free places go
//   (lowerPlacesTo);
// - new times: the firm's move or shortening (moveShiftInTx: the rules re-run for everyone booked,
//   notice per casual, each told; refused as a whole when someone can't work the new time);
// - cancel: the firm cancels the session (cancelShiftInTx: every booking cancelled with notice,
//   "The event was cancelled" unless the office picks another reason);
// - a new event: made here as "Shifts for an event" makes one (createShifts), at one of the
//   contract's venues (the client's, or one the office chooses: required for a typed address,
//   checked to be the contract's in the transaction), each session's notes as its instructions,
//   hidden from casuals until the office shows it (setShowing);
// - something else: nothing changes by itself (the office does what was asked);
// - a session from the firm's planner, sheet or connector: never changed here (the next sync or
//   PUT would undo it). The request is accepted as "done_in_planner": listed "To do in <planner>"
//   until someone marks it done.
// Declining needs a reason the client sees; asking the client needs the question. Each answer is
// logged (client_request.accepted, .declined, .asked, .planner_done: ids, the kind and counts
// only) and the client is emailed (jobs.ts).

const inTx =
  (tx: FirmTx): WithFirm =>
  (_firmId, fn) =>
    fn(tx);

export const acceptInputSchema = z.strictObject({
  requestId: z.uuid(),
  // More places: offer them at once (default yes, the mock-up's "Accept and offer the places").
  offer: z.boolean().optional(),
  // New times, cancel: the firm's reason from its list (defaults: the event's times or place
  // changed; the event was cancelled). Fewer places always says the client needs fewer staff.
  reason: z.enum(SHIFT_CHANGE_REASON_CODES).optional(),
  // Fewer places: which bookings go (exactly as many as the cut needs). Default: the latest booked.
  cancel: z.array(z.uuid()).max(1000).optional(),
  // A word to the client with the acceptance (optional).
  note: z.string().trim().max(1000).optional(),
  // A new event: the contract's venue it's made at. Required when the client typed an address (the
  // firm has no venue for it yet); otherwise the client's venue unless the office chooses another
  // of the contract's. Checked inside the transaction to be one of the contract's venues.
  siteId: z.uuid().optional(),
});
export type AcceptInput = z.input<typeof acceptInputSchema>;

export type Applied =
  | {
      kind: "more_places";
      from: number;
      to: number;
      offers: OfferPlacesResult["status"] | "not_asked" | "closed";
    }
  | { kind: "fewer_places"; from: number; to: number; cancelled: number }
  | {
      kind: "new_times";
      status: "moved" | "curtailed";
      told: number;
      noticeHours: number;
      warnings: { workerId: string; name: string; reasons: string[] }[];
    }
  | { kind: "cancel_session"; bookings: number }
  | { kind: "new_event"; eventId: string; shiftIds: string[] }
  | { kind: "other" };

export type AcceptResult =
  | { status: "accepted"; applied: Applied }
  | { status: "planner"; owner: "sheet" | "planner" } // listed under "To do in <planner>"
  // New times someone booked can't work (a check the office can't override): nothing changed.
  | { status: "blocked"; workers: { workerId: string; name: string; reasons: string[] }[] }
  | {
      status: "invalid";
      problem:
        | "form"
        | "last_place" // fewer places down to none: cancel the session instead
        | "choose" // the bookings chosen to cancel aren't the session's, or not as many as needed
        | "too_many_places" // more than 1,000 places on one session
        | "times" // the new times don't make a session, or have started
        | "venue" // a new event: no venue chosen for an address, or one that isn't the contract's
        | "new_event"; // the event's details don't make sessions (see `problems`)
      problems?: { line: number | null; problem: ShiftProblem }[];
    }
  | { status: "not_open" } // the session has started, was cancelled or is gone
  | { status: "already_answered" }
  | { status: "not_found" }
  | { status: "not_allowed" };

// Thrown inside the transaction when a step refuses, so that everything rolls back.
class Refused extends Error {
  constructor(readonly result: AcceptResult) {
    super("client request accept refused");
  }
}

const open = (r: OfficeClientRequest) => r.status === "waiting" || r.status === "asked";

async function answer(
  tx: FirmTx,
  ctx: OfficeContext,
  r: OfficeClientRequest,
  a: {
    status: "accepted" | "declined" | "asked" | "done_in_planner";
    words: string | null;
    now: Date;
    action: string;
    data: Record<string, unknown>;
    eventId?: string;
  },
): Promise<void> {
  await tx.execute(sql`
    update client_requests
       set status = ${a.status}, office_answer = ${a.words}, answered_by = ${ctx.officeUserId}::uuid,
           answered_at = ${a.now}, updated_at = ${a.now}
           ${a.eventId ? sql`, event_id = ${a.eventId}::uuid` : sql``}
     where id = ${r.id}::uuid
  `);
  const answerEventId = await recordEvent(tx, {
    actorType: "office",
    actorId: ctx.officeUserId,
    action: a.action,
    entityType: "client_request",
    entityId: r.id,
    data: {
      contractId: r.contractId,
      kind: r.kind,
      ...(r.session ? { shiftId: r.session.shiftId } : {}),
      ...a.data,
    },
  });
  await queueClientRequestAnswer(tx, { requestId: r.id, answerEventId });
}

// The change itself, for a session ShiftDesk owns (native or a file import's).
async function apply(
  tx: FirmTx,
  ctx: OfficeContext,
  r: OfficeClientRequest,
  input: z.output<typeof acceptInputSchema>,
  now: Date,
): Promise<Applied> {
  const by = { type: "office" as const, id: ctx.officeUserId };
  if (r.kind === "other") return { kind: "other" };
  if (r.kind === "new_event") {
    const p = r.payload as ClientPayload["new_event"] | null;
    if (!p) throw new Refused({ status: "invalid", problem: "new_event" });
    // The venue: the office's choice, else the client's; an address alone can't make an event the
    // client would ever see (they see their contract's venues only), so one must be chosen.
    const chosen = input.siteId ?? null;
    const siteId = chosen ?? ("siteId" in p.venue ? p.venue.siteId : null);
    if (!siteId) throw new Refused({ status: "invalid", problem: "venue" });
    // Still one of the contract's venues, held so it can't move to another contract meanwhile.
    const { rows: venue } = await tx.execute(sql`
      select 1 from sites where id = ${siteId}::uuid and client_id = ${r.contractId}::uuid
         for share
    `);
    if (venue.length === 0) {
      throw new Refused(
        chosen
          ? { status: "invalid", problem: "venue" }
          : {
              status: "invalid",
              problem: "new_event",
              problems: [{ line: null, problem: "bad_site" }],
            },
      );
    }
    const octx = { ...ctx, run: inTx(tx), clock: { now: () => now } };
    // Each session's notes are its instructions (the editor's instructions are one per call, and a
    // post holds only 200 characters): the sessions with the same notes are made together, the
    // first lot making the event and the rest joining it.
    const lots = new Map<string, { line: number; s: (typeof p.sessions)[number] }[]>();
    p.sessions.forEach((s, i) => {
      const notes = s.notes ?? "";
      lots.set(notes, [...(lots.get(notes) ?? []), { line: i + 1, s }]);
    });
    let eventId: string | null = null;
    const shiftIds: string[] = [];
    for (const [notes, lot] of lots) {
      const made = await createShifts(octx, {
        date: p.date,
        siteId,
        instructions: notes,
        ...(eventId ? { eventId } : { eventName: p.name }),
        lines: lot.map(({ s }) => ({
          role: s.role,
          start: s.start,
          end: s.end,
          headcount: String(s.places),
        })),
      });
      if (made.status === "not_allowed") throw new Refused({ status: "not_allowed" });
      if (made.status === "invalid") {
        throw new Refused({
          status: "invalid",
          problem: "new_event",
          // The client's session numbers, not the lot's.
          problems: made.problems.map((x) => ({
            line: x.line === null ? null : (lot[x.line - 1]?.line ?? null),
            problem: x.problem,
          })),
        });
      }
      shiftIds.push(...made.shiftIds);
      if (!eventId) {
        const [first] = made.shiftIds;
        const [shift] = first
          ? await tx
              .select({ eventId: shifts.shiftEventId })
              .from(shifts)
              .where(eq(shifts.id, first))
          : [];
        if (!shift) throw new Error("the new event's sessions weren't found");
        eventId = shift.eventId;
      }
    }
    if (!eventId) throw new Error("a new event with no sessions");
    // Hidden from casuals until the office shows it (the event's switch, logged event.hidden).
    const hidden = await setShowing(octx, { target: "event", id: eventId, showing: false });
    if (hidden.status !== "hidden") throw new Error(`hiding the new event: ${hidden.status}`);
    return { kind: "new_event", eventId, shiftIds };
  }

  const s = r.session;
  if (!s) throw new Refused({ status: "not_open" });
  // The session held (the same shift-first order as every booking), then read as it is now.
  const [shift] = await tx
    .select({
      status: shifts.status,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      headcount: shifts.headcount,
      siteId: shifts.siteId,
    })
    .from(shifts)
    .where(eq(shifts.id, s.shiftId))
    .for("no key update");
  if (!shift || shift.status === "cancelled" || shift.status === "draft") {
    throw new Refused({ status: "not_open" });
  }
  if (shift.startsAt.getTime() <= now.getTime()) throw new Refused({ status: "not_open" });
  const { rows: held } = await tx.execute<{ booked: number }>(sql`
    select count(*)::int as booked from assignments
     where shift_id = ${s.shiftId}::uuid and worker_id is not null
       and status not in ('cancelled_worker', 'cancelled_firm') and slot <= ${shift.headcount}
  `);
  const booked = held[0]?.booked ?? 0;
  // The firm's reason from its list: the office's, else the one for what was asked (cancellations
  // and casuals' notices say it: golden rule 12).
  const reason: FirmChangeReason =
    input.reason ??
    (r.kind === "new_times"
      ? "event_changed"
      : r.kind === "cancel_session"
        ? "event_cancelled"
        : "fewer_staff");

  switch (r.kind) {
    case "more_places": {
      const n = placesOf(r.payload) ?? 0;
      const to = shift.headcount + n;
      if (n < 1) throw new Refused({ status: "invalid", problem: "form" });
      if (to > 1000) throw new Refused({ status: "invalid", problem: "too_many_places" });
      await tx.update(shifts).set({ headcount: to }).where(eq(shifts.id, s.shiftId));
      // A session the office marked filled with places still free stays closed (as the editor
      // leaves it: "Open it again" reopens it); otherwise the status follows the places.
      const closed = shift.status === "filled" && booked < shift.headcount;
      if (!closed) await refreshShiftStatus(tx, s.shiftId, now);
      await recordEvent(tx, {
        actorType: "office",
        actorId: ctx.officeUserId,
        action: "shift.changed",
        entityType: "shift",
        entityId: s.shiftId,
        data: {
          by: "firm",
          fields: ["headcount"],
          from: { headcount: shift.headcount },
          to: { headcount: to },
          clientRequestId: r.id,
        },
      });
      const offers = closed
        ? ("closed" as const)
        : input.offer === false
          ? ("not_asked" as const)
          : (await offerPlacesInTx(tx, { shiftId: s.shiftId, by, now })).status;
      return { kind: "more_places", from: shift.headcount, to, offers };
    }
    case "fewer_places": {
      const change = placesChange(
        "fewer_places",
        { headcount: shift.headcount, booked },
        {
          places: placesOf(r.payload),
        },
      );
      if (change === "last_place") throw new Refused({ status: "invalid", problem: "last_place" });
      if (change === null) throw new Refused({ status: "invalid", problem: "form" });
      const casuals = await bookedOn(tx, s.shiftId, () => 0, shift.startsAt);
      let chosen = casuals.slice(0, change.cancels);
      if (input.cancel !== undefined) {
        const ids = new Set(input.cancel);
        chosen = casuals.filter((c) => ids.has(c.assignmentId));
        if (ids.size !== change.cancels || chosen.length !== change.cancels) {
          throw new Refused({ status: "invalid", problem: "choose" });
        }
      } else if (chosen.length !== change.cancels) {
        throw new Refused({ status: "invalid", problem: "choose" });
      }
      for (const c of chosen) {
        const cancelled = await cancelBookingInTx(
          tx,
          {
            shiftId: s.shiftId,
            workerId: c.workerId,
            reason: FIRM_CHANGE_REASONS.fewer_staff,
            askedBy: "client",
            by,
          },
          now,
        );
        if (cancelled.status !== "cancelled") {
          throw new Error(`cancelling a booking for fewer places returned ${cancelled.status}`);
        }
      }
      // The rest of the cut: free places only now.
      const [after] = await tx
        .select({ headcount: shifts.headcount })
        .from(shifts)
        .where(eq(shifts.id, s.shiftId));
      const target = change.after.places;
      if (after && after.headcount > target) {
        const lowered = await lowerPlacesTo(tx, s.shiftId, target, now);
        if (lowered) {
          await recordEvent(tx, {
            actorType: "office",
            actorId: ctx.officeUserId,
            action: "shift.changed",
            entityType: "shift",
            entityId: s.shiftId,
            data: {
              by: "firm",
              fields: ["headcount"],
              from: { headcount: lowered.from },
              to: { headcount: lowered.to },
              reason: FIRM_CHANGE_REASONS.fewer_staff,
              clientRequestId: r.id,
            },
          });
        }
      }
      return {
        kind: "fewer_places",
        from: shift.headcount,
        to: target,
        cancelled: chosen.length,
      };
    }
    case "new_times": {
      const t = r.payload as ClientPayload["new_times"] | null;
      const timeZone = await firmTimeZone(tx);
      const day = t ? isoDate(t.date) : null;
      const times = t && day ? timesOn(day, t.start, t.end, timeZone) : null;
      if (!times || times.startsAt.getTime() <= now.getTime()) {
        throw new Refused({ status: "invalid", problem: "times" });
      }
      const moved = await moveShiftInTx(tx, {
        shiftId: s.shiftId,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        siteId: shift.siteId,
        reason,
        by,
        now,
        timeZone,
      });
      if (moved.status === "moved" || moved.status === "curtailed") {
        return {
          kind: "new_times",
          status: moved.status,
          told: moved.told,
          noticeHours: moved.noticeHours,
          warnings: moved.warnings,
        };
      }
      if (moved.status === "not_allowed") throw new Refused({ status: "not_allowed" });
      if (moved.status === "blocked") throw new Refused(moved);
      if (moved.status === "invalid" || moved.status === "unchanged") {
        throw new Refused({ status: "invalid", problem: "times" });
      }
      throw new Refused({ status: "not_open" });
    }
    case "cancel_session": {
      const cancelled = await cancelShiftInTx(tx, {
        shiftId: s.shiftId,
        reason,
        askedBy: "client",
        by,
        now,
      });
      if (cancelled.status === "cancelled") {
        return { kind: "cancel_session", bookings: cancelled.bookings };
      }
      if (cancelled.status === "not_allowed") throw new Refused({ status: "not_allowed" });
      throw new Refused({ status: "not_open" });
    }
  }
}

export async function acceptClientRequest(
  ctx: OfficeContext,
  raw: AcceptInput,
): Promise<AcceptResult> {
  const parsed = acceptInputSchema.safeParse(raw);
  if (!parsed.success) {
    return z.uuid().safeParse((raw as { requestId?: unknown } | null)?.requestId).success
      ? { status: "invalid", problem: "form" }
      : { status: "not_found" };
  }
  const input = parsed.data;
  const now = (ctx.clock ?? systemClock).now();
  const { run } = parts(ctx);
  let refusedMove: {
    shiftId: string;
    reason: FirmChangeReason;
    workers: MoveBlocked["workers"];
  } | null = null;
  try {
    return await run(ctx.firm.id, async (tx): Promise<AcceptResult> => {
      if (!(await officeUserMay(tx, ctx.officeUserId, "client_requests")))
        return { status: "not_allowed" };
      const r = await loadClientRequest(tx, now, input.requestId, { lock: true });
      if (!r) return { status: "not_found" };
      if (!open(r)) return { status: "already_answered" };
      // A planner's, sheet's or connector's session: on the planner's to-do list, unchanged here.
      const owner = r.session ? ownerOf(r.session.source) : null;
      if (owner) {
        await answer(tx, ctx, r, {
          status: "done_in_planner",
          words: input.note || null,
          now,
          action: "client_request.accepted",
          data: { plannerToDo: true, owner },
        });
        return { status: "planner", owner };
      }
      try {
        const applied = await apply(tx, ctx, r, input, now);
        await answer(tx, ctx, r, {
          status: "accepted",
          words: input.note || null,
          now,
          action: "client_request.accepted",
          data: appliedData(applied),
          ...(applied.kind === "new_event" ? { eventId: applied.eventId } : {}),
        });
        return { status: "accepted", applied };
      } catch (error) {
        if (error instanceof MoveBlocked && r.session) {
          refusedMove = {
            shiftId: r.session.shiftId,
            reason: input.reason ?? "event_changed",
            workers: error.workers,
          };
        }
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof Refused) return error.result;
    if (error instanceof MoveBlocked && refusedMove) {
      // The whole accept rolled back: nothing moved, the request still waits. The refusal is logged
      // in a short transaction of its own, as the office's own move logs one.
      const m: { shiftId: string; reason: FirmChangeReason; workers: MoveBlocked["workers"] } =
        refusedMove;
      await recordMoveRefused(run, ctx.firm.id, {
        shiftId: m.shiftId,
        reason: m.reason,
        by: { type: "office", id: ctx.officeUserId },
        workers: m.workers.map((w) => ({ workerId: w.workerId, codes: w.codes })),
      });
      return {
        status: "blocked",
        workers: m.workers.map(({ workerId, name, reasons }) => ({ workerId, name, reasons })),
      };
    }
    throw error;
  }
}

// What the log keeps of what accepting did: kinds, ids and counts, never a name.
function appliedData(a: Applied): Record<string, unknown> {
  switch (a.kind) {
    case "more_places":
      return { from: a.from, to: a.to, offers: a.offers };
    case "fewer_places":
      return { from: a.from, to: a.to, cancelled: a.cancelled };
    case "new_times":
      return { moved: a.status, told: a.told };
    case "cancel_session":
      return { bookings: a.bookings };
    case "new_event":
      return { eventId: a.eventId, sessions: a.shiftIds.length };
    case "other":
      return {};
  }
}

const wordsSchema = z.string().trim().min(1).max(1000);

export type AnswerResult =
  | { status: "declined" | "asked" }
  | { status: "invalid" } // no reason, or no question
  | { status: "already_answered" }
  | { status: "not_found" }
  | { status: "not_allowed" };

async function answerWith(
  ctx: OfficeContext,
  input: { requestId: string; words: unknown },
  as: "declined" | "asked",
): Promise<AnswerResult> {
  if (!z.uuid().safeParse(input.requestId).success) return { status: "not_found" };
  const words = wordsSchema.safeParse(input.words);
  if (!words.success) return { status: "invalid" };
  const now = (ctx.clock ?? systemClock).now();
  return parts(ctx).run(ctx.firm.id, async (tx): Promise<AnswerResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "client_requests")))
      return { status: "not_allowed" };
    const r = await loadClientRequest(tx, now, input.requestId, { lock: true });
    if (!r) return { status: "not_found" };
    if (!open(r)) return { status: "already_answered" };
    await answer(tx, ctx, r, {
      status: as,
      words: words.data,
      now,
      action: as === "declined" ? "client_request.declined" : "client_request.asked",
      data: {},
    });
    return { status: as };
  });
}

// Decline, with the reason the client sees (required).
export const declineClientRequest = (
  ctx: OfficeContext,
  input: { requestId: string; reason: unknown },
) => answerWith(ctx, { requestId: input.requestId, words: input.reason }, "declined");

// Ask the client something (required): the request waits for their reply (status asked).
export const askClient = (ctx: OfficeContext, input: { requestId: string; question: unknown }) =>
  answerWith(ctx, { requestId: input.requestId, words: input.question }, "asked");

export type PlannerDoneResult =
  | { status: "done" }
  | { status: "not_to_do" } // not on the planner's list (or marked done already)
  | { status: "not_found" }
  | { status: "not_allowed" };

// "Mark done" on "To do in <planner>": the change was made in the planner.
export async function markPlannerDone(
  ctx: OfficeContext,
  requestId: string,
): Promise<PlannerDoneResult> {
  if (!z.uuid().safeParse(requestId).success) return { status: "not_found" };
  const now = (ctx.clock ?? systemClock).now();
  return parts(ctx).run(ctx.firm.id, async (tx): Promise<PlannerDoneResult> => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "client_requests")))
      return { status: "not_allowed" };
    const r = await loadClientRequest(tx, now, requestId, { lock: true });
    if (!r) return { status: "not_found" };
    if (r.status !== "done_in_planner" || r.plannerDoneAt !== null) return { status: "not_to_do" };
    await tx.execute(sql`
      update client_requests
         set planner_done_at = ${now}, planner_done_by = ${ctx.officeUserId}::uuid,
             updated_at = ${now}
       where id = ${requestId}::uuid
    `);
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "client_request.planner_done",
      entityType: "client_request",
      entityId: requestId,
      data: { contractId: r.contractId, kind: r.kind },
    });
    return { status: "done" };
  });
}

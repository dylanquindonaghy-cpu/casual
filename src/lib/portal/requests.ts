import { and, asc, desc, eq, gt, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { DAY, systemClock } from "../auth/clock";
import { assignments, requests, shifts, sites } from "../db/schema";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { dayLabel } from "../rules/reasons";
import { localDateOf, wallTimeOf } from "../time/zoned";
import { roleLabel, shiftWhen } from "./format";
import type { PortalContext } from "./my-shifts";
import {
  requestPayloadSchemas,
  type CreateRequestOutcome,
  type RequestPayload,
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
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        role: shifts.role,
        siteName: sites.name,
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
    ref: refOf(r.id),
    type: r.type,
    status: r.status,
    note: r.note,
    createdAt: r.createdAt,
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

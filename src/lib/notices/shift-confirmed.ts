import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { assignments, events, firms, shifts, sites, workers } from "../db/schema";
import { retryAborted } from "../db/retry";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport } from "../messaging";
import {
  bookedPush,
  shiftConfirmedEmailSubject,
  shiftConfirmedMessage,
} from "../messaging/templates";
import {
  deliverToWorker,
  recordPushes,
  smsAllowedFor,
  type DeliveryChannel,
  type NotifyDeps,
  type WorkerChannel,
} from "../notify/send";
import { getPushTransport } from "../push/transport";
import { dayLabel } from "../rules/reasons";
import { mayMessageNow, quietHours } from "../rules/quiet-hours";
import { insideUrgentWindow, urgentWindowHours } from "../rules/urgent";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { localDateOf, wallTimeOf } from "../time/zoned";

// Telling a worker the office booked them onto a shift (Phase 10, audit L22): the office's "Assign"
// (bookShift with by: office) queues one shift-confirmed job per booking, in the transaction that
// logged shift.assigned. Before, the worker first heard of it from the 24-hour reminder. A worker
// who takes a shift themselves sees "Booked" on screen and gets no message. The payload is ids only:
// the shift.assigned event's id and the booking.
//
// At most once, like the office's change notices (src/lib/notices/firm-change.ts): a short
// transaction claims it (the shift.booked_notice event, under an advisory lock on the booking) and
// commits; the message goes outside any transaction (shift_confirmed: a push to their phones, else
// by their channel with the WhatsApp-to-text fallback, else email: deliverToWorker, P2.4); a second
// short transaction logs shift.booked_notice_sent or _failed. A job that stops part-way leaves the claim: the message may
// have gone, so it's never sent again.
//
// It describes the shift as it is when it goes (a move since is in it). Not sent, and logged
// (shift.booked_notice_skipped {reason}): the worker was deleted (erased), the shift is over
// (ended), the booking was cancelled since (cancelled), or it was already marked as worked or not
// attended (not_booked: a message held past the start).
//
// Quiet hours: a shift starting within the firm's urgent window, or already under way, is urgent
// and goes at night if the firm lets urgent through; otherwise it waits for the quiet hours to end
// (shift.booked_notice_held, queued again for then), never dropped.

export const SHIFT_CONFIRMED_QUEUE = "shift-confirmed";

export const shiftConfirmedPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^shift-confirmed:\d{1,18}(:after-quiet)?$/),
  eventId: z.number().int().positive(),
  assignmentId: z.uuid(),
});
export type ShiftConfirmedPayload = z.infer<typeof shiftConfirmedPayload>;

const job = { queue: SHIFT_CONFIRMED_QUEUE, schema: shiftConfirmedPayload };

// Queued by the office's booking, in its transaction.
export async function queueShiftConfirmed(
  tx: FirmTx,
  booking: { eventId: number; assignmentId: string },
): Promise<void> {
  await sendFirmJob(tx, job, {
    idempotencyKey: `shift-confirmed:${booking.eventId}`,
    eventId: booking.eventId,
    assignmentId: booking.assignmentId,
  });
}

export interface ConfirmedDeps extends NotifyDeps {
  baseDomain: string;
  clock: Clock;
}

export type ConfirmedResult =
  | { status: "sent"; channel: DeliveryChannel }
  | { status: "failed" }
  | { status: "held"; until: Date }
  | { status: "already" }
  | { status: "skipped"; reason: SkipReason } // logged
  | { status: "gone" }; // no such booking event

type SkipReason = "cancelled" | "not_booked" | "ended" | "erased";

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

type Claim =
  | {
      status: "send";
      workerId: string;
      mobile: string;
      channel: WorkerChannel;
      smsAllowed: boolean;
      body: string;
      from: string | null; // the firm's shifts line
      push: { title: string; body: string; url: string };
      email: { to: string; subject: string; body: string } | null; // P2.4
    }
  | Exclude<ConfirmedResult, { status: "sent" } | { status: "failed" }>;

async function claimConfirmed(
  tx: FirmTx,
  payload: ShiftConfirmedPayload,
  deps: ConfirmedDeps,
  now: Date,
): Promise<Claim> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('shift-confirmed:' || app_current_firm_id()::text || ':' || ${payload.assignmentId}, 0))`,
  );
  // The shift, then the booking, shared-locked (the order every change takes them): an office move
  // or cancellation either finished first (and is read below) or waits for this claim, and then its
  // change notice sees it (src/lib/notices/firm-change.ts). So the two messages never cross.
  await tx.execute(sql`
    select 1 from shifts s
      join assignments a on a.firm_id = s.firm_id and a.shift_id = s.id
     where a.id = ${payload.assignmentId}
       for share of s
  `);
  await tx.execute(sql`select 1 from assignments where id = ${payload.assignmentId} for share`);
  const { rows: done } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${payload.assignmentId} and action = 'shift.booked_notice'
       and (data ->> 'assignedEventId')::bigint = ${payload.eventId}
     limit 1
  `);
  if (done.length > 0) return { status: "already" };
  const [assigned] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, payload.eventId),
        eq(events.entityId, payload.assignmentId),
        eq(events.action, "shift.assigned"),
      ),
    );
  if (!assigned) return { status: "gone" };
  const [row] = await tx
    .select({
      bookingStatus: assignments.status,
      workerId: workers.id,
      mobile: workers.mobileE164,
      channel: workers.notifyChannel,
      smsOptedOutAt: workers.smsOptedOutAt,
      email: workers.email,
      shiftId: shifts.id,
      role: shifts.role,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      site: sites.name,
      firmName: firms.name,
      line: firms.shiftsLineE164,
      slug: firms.slug,
      timezone: firms.timezone,
      settings: firms.settings,
    })
    .from(assignments)
    .innerJoin(
      workers,
      and(eq(workers.firmId, assignments.firmId), eq(workers.id, assignments.workerId)),
    )
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
    )
    .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
    .innerJoin(firms, eq(firms.id, assignments.firmId))
    .where(eq(assignments.id, payload.assignmentId));
  if (!row) return { status: "gone" };
  const tz = row.timezone;

  const skip = async (reason: SkipReason) => {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.booked_notice_skipped",
      entityType: "assignment",
      entityId: payload.assignmentId,
      data: { assignedEventId: payload.eventId, workerId: row.workerId, reason },
    });
    return { status: "skipped" as const, reason };
  };
  if (row.mobile === null) return skip("erased");
  if (row.endsAt.getTime() <= now.getTime()) return skip("ended");
  if (row.bookingStatus.startsWith("cancelled")) return skip("cancelled");
  if (row.bookingStatus !== "confirmed") return skip("not_booked");

  const urgent =
    row.startsAt.getTime() <= now.getTime() ||
    insideUrgentWindow(row.startsAt, now, urgentWindowHours(row.settings));
  const timing = mayMessageNow({ now, timeZone: tz, quiet: quietHours(row.settings), urgent });
  if (!timing.ok && timing.until.getTime() - now.getTime() > 60_000) {
    await sendFirmJob(
      tx,
      job,
      {
        ...payload,
        idempotencyKey: payload.idempotencyKey.endsWith(":after-quiet")
          ? payload.idempotencyKey
          : `${payload.idempotencyKey}:after-quiet`,
      },
      { startAfter: timing.until },
    );
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.booked_notice_held",
      entityType: "assignment",
      entityId: payload.assignmentId,
      data: {
        assignedEventId: payload.eventId,
        workerId: row.workerId,
        until: timing.until.toISOString(),
        // It will reach them after the shift starts: the office should phone.
        afterStart: timing.until.getTime() >= row.startsAt.getTime(),
      },
    });
    return { status: "held", until: timing.until };
  }

  const voice = { name: row.firmName, signOff: signOffFor(row.firmName, row.settings.sign_off) };
  const date = dayLabel(localDateOf(row.startsAt, tz));
  const start = hhmm(row.startsAt, tz);
  const path = `/shifts/${row.shiftId}`;
  const body = shiftConfirmedMessage(voice, {
    role: row.role,
    site: row.site,
    date,
    start,
    end: hhmm(row.endsAt, tz),
    link: `${portalUrl(row.slug, deps.baseDomain)}${path}`,
  });
  await recordEvent(tx, {
    actorType: "system",
    action: "shift.booked_notice",
    entityType: "assignment",
    entityId: payload.assignmentId,
    data: { assignedEventId: payload.eventId, workerId: row.workerId, status: "sending" },
  });
  return {
    status: "send",
    workerId: row.workerId,
    mobile: row.mobile,
    channel: row.channel,
    smsAllowed: smsAllowedFor(row),
    body,
    from: row.line,
    push: { ...bookedPush({ site: row.site, date, start }), url: path },
    email: row.email
      ? { to: row.email, subject: shiftConfirmedEmailSubject({ date }), body }
      : null,
  };
}

export async function runShiftConfirmed(
  payload: ShiftConfirmedPayload,
  run: WithFirm,
  deps: ConfirmedDeps,
): Promise<ConfirmedResult> {
  const now = deps.clock.now();
  // Retried if Postgres breaks a deadlock with it (it shares the shift's and booking's locks with
  // the sheet sync and deletions, which take them in another order); a claim keeps nothing until it
  // commits, so running it again repeats nothing.
  const claim = await retryAborted(() =>
    run(payload.firmId, (tx) => claimConfirmed(tx, payload, deps, now)),
  );
  if (claim.status !== "send") return claim;
  const sent = await deliverToWorker((fn) => run(payload.firmId, fn), deps, {
    workerId: claim.workerId,
    push: claim.push,
    text: {
      mobile: claim.mobile,
      channel: claim.channel,
      smsAllowed: claim.smsAllowed,
      body: { whatsapp: claim.body, sms: claim.body },
      from: claim.from,
    },
    email: claim.email,
  });
  await run(payload.firmId, async (tx) => {
    // A phone the push service says is gone is forgotten whatever came of the message.
    const pushes = await recordPushes(tx, sent.push);
    if (!sent.ok) {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.booked_notice_failed",
        entityType: "assignment",
        entityId: payload.assignmentId,
        data: {
          assignedEventId: payload.eventId,
          workerId: claim.workerId,
          channel: sent.channel,
          code: sent.code,
        },
      });
      return;
    }
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.booked_notice_sent",
      entityType: "assignment",
      entityId: payload.assignmentId,
      data: {
        assignedEventId: payload.eventId,
        workerId: claim.workerId,
        channel: sent.channel,
        providerMessageId: sent.providerMessageId,
        pushes,
        ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
      },
    });
  });
  return sent.ok ? { status: "sent", channel: sent.channel } : { status: "failed" };
}

export function createShiftConfirmedTask(
  deps: () => ConfirmedDeps,
): FirmTask<ShiftConfirmedPayload> {
  return {
    queue: SHIFT_CONFIRMED_QUEUE,
    schema: shiftConfirmedPayload,
    task: (payload, run) => runShiftConfirmed(payload, run, deps()),
  };
}

const workerDeps = (): ConfirmedDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    push: getPushTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
  };
};
export const shiftConfirmedTask = createShiftConfirmedTask(workerDeps);

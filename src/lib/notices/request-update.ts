import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { firms, requests, shifts, workers } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport } from "../messaging";
import {
  requestUpdateEmailSubject,
  requestUpdateMessage,
  requestUpdatePush,
} from "../messaging/templates";
import {
  deliverToWorker,
  recordPushes,
  type DeliveryChannel,
  type NotifyDeps,
  type WorkerChannel,
  smsAllowedFor,
} from "../notify/send";
import { KIND_NAMES, statusWord } from "../portal/request-kinds";
import { getPushTransport } from "../push/transport";
import { mayMessageNow, quietHours } from "../rules/quiet-hours";
import { insideUrgentWindow, urgentWindowHours } from "../rules/urgent";
import { signOffFor } from "../tenancy/sign-off";

// Telling a worker the office answered their request (docs/messaging-templates.md
// `request_update`; docs/api-and-jobs.md): one request-update job per answer, queued in the
// transaction that recorded it (src/lib/requests/resolve.ts). The payload is the request's id only.
//
// At most once, like the other notices: (1) a short transaction claims it (request.update_notice,
// under an advisory lock on the request) and commits; (2) the message goes outside any
// transaction: a push to their phones, else by their channel with the WhatsApp-to-text fallback,
// else email (deliverToWorker, P2.4); (3) a second short transaction logs request.update_sent or
// _failed. A job that stops
// part-way leaves the claim: the message may have gone, so it's never sent again.
//
// Quiet hours: a reply waits for them to end (logged request.update_held and queued again, never
// dropped), unless it's about a shift starting within the firm's urgent window (or under way).
//
// The office's note goes in the message on one line (WhatsApp variables can't hold line breaks)
// and never in an event.

export const REQUEST_UPDATE_QUEUE = "request-update";

export const requestUpdatePayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^request-update:[0-9a-f-]{36}(:after-quiet)?$/),
  requestId: z.uuid(),
});
export type RequestUpdatePayload = z.infer<typeof requestUpdatePayload>;

const job = { queue: REQUEST_UPDATE_QUEUE, schema: requestUpdatePayload };

export async function queueRequestUpdate(tx: FirmTx, r: { requestId: string }): Promise<void> {
  await sendFirmJob(tx, job, {
    idempotencyKey: `request-update:${r.requestId}`,
    requestId: r.requestId,
  });
}

export interface RequestUpdateDeps extends NotifyDeps {
  clock: Clock;
}

export type RequestUpdateResult =
  | { status: "sent"; channel: DeliveryChannel }
  | { status: "failed" }
  | { status: "held"; until: Date }
  | { status: "already" }
  | { status: "gone" }; // no such answered request

// The note as one line: runs of spaces, tabs and line breaks become one space.
export const oneLineNote = (note: string) => note.replace(/\s+/g, " ").trim();

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
  | Exclude<RequestUpdateResult, { status: "sent" } | { status: "failed" }>;

async function claim(tx: FirmTx, payload: RequestUpdatePayload, now: Date): Promise<Claim> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('request-update:' || app_current_firm_id()::text || ':' || ${payload.requestId}, 0))`,
  );
  const { rows: done } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${payload.requestId} and action = 'request.update_notice'
     limit 1
  `);
  if (done.length > 0) return { status: "already" };
  const [row] = await tx
    .select({
      status: requests.status,
      type: requests.type,
      note: requests.resolutionNote,
      workerId: workers.id,
      mobile: workers.mobileE164,
      channel: workers.notifyChannel,
      smsOptedOutAt: workers.smsOptedOutAt,
      email: workers.email,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      firmName: firms.name,
      line: firms.shiftsLineE164,
      timezone: firms.timezone,
      settings: firms.settings,
    })
    .from(requests)
    .innerJoin(workers, and(eq(workers.firmId, requests.firmId), eq(workers.id, requests.workerId)))
    .leftJoin(shifts, and(eq(shifts.firmId, requests.firmId), eq(shifts.id, requests.shiftId)))
    .innerJoin(firms, eq(firms.id, requests.firmId))
    .where(eq(requests.id, payload.requestId));
  // An erased worker has no mobile: nobody to tell.
  if (!row || (row.status !== "approved" && row.status !== "declined") || row.mobile === null) {
    return { status: "gone" };
  }

  // A reply about a shift starting soon (or under way) goes at night if the firm lets urgent
  // messages through; anything else waits for the morning.
  const underWay =
    row.startsAt !== null &&
    row.endsAt !== null &&
    row.startsAt.getTime() <= now.getTime() &&
    row.endsAt.getTime() > now.getTime();
  const urgent =
    underWay ||
    (row.startsAt !== null &&
      insideUrgentWindow(row.startsAt, now, urgentWindowHours(row.settings)));
  const timing = mayMessageNow({
    now,
    timeZone: row.timezone,
    quiet: quietHours(row.settings),
    urgent,
  });
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
      action: "request.update_held",
      entityType: "request",
      entityId: payload.requestId,
      data: { workerId: row.workerId, until: timing.until.toISOString() },
    });
    return { status: "held", until: timing.until };
  }

  const voice = { name: row.firmName, signOff: signOffFor(row.firmName, row.settings.sign_off) };
  const kind = KIND_NAMES[row.type] ?? "Request";
  // "approved", "declined", or "answered" for a question (PLAN.md Messages 13).
  const status = statusWord(row.type, row.status).toLowerCase();
  const ref = payload.requestId.slice(0, 8).toUpperCase();
  const body = requestUpdateMessage(voice, {
    type: kind.toLowerCase(),
    ref,
    status,
    note: row.note ? oneLineNote(row.note) || null : null,
  });
  await recordEvent(tx, {
    actorType: "system",
    action: "request.update_notice",
    entityType: "request",
    entityId: payload.requestId,
    data: { workerId: row.workerId, status: "sending" },
  });
  return {
    status: "send",
    workerId: row.workerId,
    mobile: row.mobile,
    channel: row.channel,
    smsAllowed: smsAllowedFor(row),
    body,
    from: row.line,
    push: { ...requestUpdatePush({ type: kind, status }), url: "/requests" },
    email: row.email
      ? { to: row.email, subject: requestUpdateEmailSubject({ ref, status }), body }
      : null,
  };
}

export async function runRequestUpdate(
  payload: RequestUpdatePayload,
  run: WithFirm,
  deps: RequestUpdateDeps,
): Promise<RequestUpdateResult> {
  const now = deps.clock.now();
  const c = await run(payload.firmId, (tx) => claim(tx, payload, now));
  if (c.status !== "send") return c;
  const sent = await deliverToWorker((fn) => run(payload.firmId, fn), deps, {
    workerId: c.workerId,
    push: c.push,
    text: {
      mobile: c.mobile,
      channel: c.channel,
      smsAllowed: c.smsAllowed,
      body: { whatsapp: c.body, sms: c.body },
      from: c.from,
    },
    email: c.email,
  });
  await run(payload.firmId, async (tx) => {
    // A phone the push service says is gone is forgotten whatever came of the message.
    const pushes = await recordPushes(tx, sent.push);
    if (!sent.ok) {
      await recordEvent(tx, {
        actorType: "system",
        action: "request.update_failed",
        entityType: "request",
        entityId: payload.requestId,
        data: { workerId: c.workerId, channel: sent.channel, code: sent.code },
      });
      return;
    }
    await recordEvent(tx, {
      actorType: "system",
      action: "request.update_sent",
      entityType: "request",
      entityId: payload.requestId,
      data: {
        workerId: c.workerId,
        channel: sent.channel,
        providerMessageId: sent.providerMessageId,
        pushes,
        ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
      },
    });
  });
  return sent.ok ? { status: "sent", channel: sent.channel } : { status: "failed" };
}

export function createRequestUpdateTask(
  deps: () => RequestUpdateDeps,
): FirmTask<RequestUpdatePayload> {
  return {
    queue: REQUEST_UPDATE_QUEUE,
    schema: requestUpdatePayload,
    task: (payload, run) => runRequestUpdate(payload, run, deps()),
  };
}

const workerDeps = (): RequestUpdateDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    push: getPushTransport(env),
    clock: systemClock,
  };
};
export const requestUpdateTask = createRequestUpdateTask(workerDeps);

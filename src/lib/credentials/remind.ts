import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import { events, firms, workers } from "../db/schema";
import { retryAborted } from "../db/retry";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport, type MessagingTransport } from "../messaging";
import {
  credentialExpiredEmailSubject,
  credentialExpiredMessage,
  credentialExpiringEmailSubject,
  credentialExpiringMessage,
} from "../messaging/templates";
import { sendTextOrEmail, smsAllowedFor, type WorkerChannel } from "../notify/send";
import { mayMessageNow, quietHours } from "../rules/quiet-hours";
import { shortDate } from "../rules/reasons";
import { portalUrl } from "../tenancy/portal-url";
import { signOffFor } from "../tenancy/sign-off";
import { localDateOf } from "../time/zoned";
import { qualificationsFor } from "./qualifications";

// "Remind" on Casuals' Need updating (Phase 26.7, cas-4): the office sends a casual the licence
// message again, the same words the daily scan sends (docs/messaging-templates.md
// `credential_expired` or `credential_expiring`, with the upload link where they may upload it),
// for the worst of their out-of-date or expiring qualifications. The office's request logs
// `casual.reminded` {workerId, type} and queues one casual-reminder job keyed by that event
// (src/lib/office/casual-follow-up.ts).
//
// At most once, like the notices: a short transaction claims it (casual.reminder_notice under an
// advisory lock on the worker; a second run finds it and sends nothing), the message goes with no
// transaction open (a text, or an email when they chose it or a text can't go:
// sendTextOrEmail, as the scan's), and a second short transaction logs casual.reminder_sent or
// _failed. Not sent (casual.reminder_skipped {reason}): erased or no longer active (gone), or the
// qualification has been sorted since (sorted: renewed, or it's waiting for the office's check).
// Quiet hours hold it until they end (casual.reminder_held), never dropped.

export const CASUAL_REMINDER_QUEUE = "casual-reminder";

export const casualReminderPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^casual-reminder:\d{1,18}(:after-quiet)?$/),
  eventId: z.number().int().positive(),
});
export type CasualReminderPayload = z.infer<typeof casualReminderPayload>;

const job = { queue: CASUAL_REMINDER_QUEUE, schema: casualReminderPayload };

export async function queueCasualReminder(tx: FirmTx, eventId: number): Promise<void> {
  await sendFirmJob(tx, job, { idempotencyKey: `casual-reminder:${eventId}`, eventId });
}

export interface CasualReminderDeps {
  transport: MessagingTransport;
  baseDomain: string;
  clock: Clock;
}

type SkipReason = "gone" | "sorted";

export type CasualReminderResult =
  | { status: "sent" }
  | { status: "failed" }
  | { status: "held"; until: Date }
  | { status: "already" }
  | { status: "skipped"; reason: SkipReason }
  | { status: "missing" }; // no such reminder event

type Claim =
  | {
      status: "send";
      workerId: string;
      mobile: string;
      channel: WorkerChannel;
      smsAllowed: boolean;
      body: string;
      from: string | null;
      email: { to: string; subject: string; body: string } | null;
    }
  | Exclude<CasualReminderResult, { status: "sent" } | { status: "failed" }>;

async function claim(
  tx: FirmTx,
  payload: CasualReminderPayload,
  deps: CasualReminderDeps,
  now: Date,
): Promise<Claim> {
  const [asked] = await tx
    .select({ entityId: events.entityId, data: events.data })
    .from(events)
    .where(and(eq(events.id, payload.eventId), eq(events.action, "casual.reminded")));
  if (!asked) return { status: "missing" };
  const workerId = String(asked.entityId);
  const type = String(asked.data.type ?? "");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('casual-reminder:' || app_current_firm_id()::text || ':' || ${workerId}, 0))`,
  );
  const { rows: done } = await tx.execute(sql`
    select 1 from events
     where entity_id = ${workerId} and action = 'casual.reminder_notice'
       and (data ->> 'reminderEventId')::bigint = ${payload.eventId}
     limit 1
  `);
  if (done.length > 0) return { status: "already" };
  const skip = async (reason: SkipReason) => {
    await recordEvent(tx, {
      actorType: "system",
      action: "casual.reminder_skipped",
      entityType: "worker",
      entityId: workerId,
      data: { reminderEventId: payload.eventId, workerId, reason },
    });
    return { status: "skipped" as const, reason };
  };
  const [w] = await tx
    .select({
      status: workers.status,
      roles: workers.roles,
      mobile: workers.mobileE164,
      channel: workers.notifyChannel,
      smsOptedOutAt: workers.smsOptedOutAt,
      email: workers.email,
      firmName: firms.name,
      slug: firms.slug,
      line: firms.shiftsLineE164,
      timezone: firms.timezone,
      settings: firms.settings,
    })
    .from(workers)
    .innerJoin(firms, eq(firms.id, workers.firmId))
    .where(eq(workers.id, workerId));
  if (!w || w.status !== "active" || w.mobile === null) return skip("gone");
  const held = (
    await qualificationsFor(tx, [workerId], {
      now,
      timeZone: w.timezone,
      people: [{ id: workerId, roles: w.roles }],
    })
  ).get(workerId);
  const q = held?.qualifications.find((x) => x.type === type);
  // Still to be sorted: out of date, or expiring with no renewal on its way.
  if (
    !q ||
    !q.expiresOn ||
    (q.status !== "expired" && q.status !== "expiring_soon") ||
    q.renewing
  ) {
    return skip("sorted");
  }
  const timing = mayMessageNow({
    now,
    timeZone: w.timezone,
    quiet: quietHours(w.settings),
    urgent: false,
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
      action: "casual.reminder_held",
      entityType: "worker",
      entityId: workerId,
      data: { reminderEventId: payload.eventId, workerId, until: timing.until.toISOString() },
    });
    return { status: "held", until: timing.until };
  }
  const voice = { name: w.firmName, signOff: signOffFor(w.firmName, w.settings.sign_off) };
  const year = Number(localDateOf(now, w.timezone).slice(0, 4));
  const date = shortDate(q.expiresOn, year);
  const upload = q.uploadable
    ? `${portalUrl(w.slug, deps.baseDomain)}/profile/upload/${q.type}`
    : null;
  const expired = q.status === "expired";
  const body = expired
    ? credentialExpiredMessage(voice, q.name, date, upload)
    : credentialExpiringMessage(voice, q.name, date, upload);
  const subject = expired
    ? credentialExpiredEmailSubject(q.name)
    : credentialExpiringEmailSubject(q.name, date);
  await recordEvent(tx, {
    actorType: "system",
    action: "casual.reminder_notice",
    entityType: "worker",
    entityId: workerId,
    data: { reminderEventId: payload.eventId, workerId, type: q.type, status: "sending" },
  });
  return {
    status: "send",
    workerId,
    mobile: w.mobile,
    channel: w.channel,
    smsAllowed: smsAllowedFor(w),
    body,
    from: w.line,
    email: w.email ? { to: w.email, subject, body } : null,
  };
}

export async function runCasualReminder(
  payload: CasualReminderPayload,
  run: WithFirm,
  deps: CasualReminderDeps,
): Promise<CasualReminderResult> {
  const now = deps.clock.now();
  const c = await retryAborted(() => run(payload.firmId, (tx) => claim(tx, payload, deps, now)));
  if (c.status !== "send") return c;
  const sent = await sendTextOrEmail(deps, {
    text: {
      mobile: c.mobile,
      channel: c.channel,
      smsAllowed: c.smsAllowed,
      body: { whatsapp: c.body, sms: c.body },
      from: c.from,
    },
    email: c.email,
  });
  await run(payload.firmId, (tx) =>
    recordEvent(tx, {
      actorType: "system",
      action: sent.ok ? "casual.reminder_sent" : "casual.reminder_failed",
      entityType: "worker",
      entityId: c.workerId,
      data: sent.ok
        ? {
            reminderEventId: payload.eventId,
            workerId: c.workerId,
            channel: sent.channel,
            providerMessageId: sent.providerMessageId,
            ...(sent.fellBackFrom ? { fellBackFrom: sent.fellBackFrom } : {}),
          }
        : {
            reminderEventId: payload.eventId,
            workerId: c.workerId,
            channel: sent.channel,
            code: sent.code,
          },
    }),
  );
  return sent.ok ? { status: "sent" } : { status: "failed" };
}

export function createCasualReminderTask(
  deps: () => CasualReminderDeps,
): FirmTask<CasualReminderPayload> {
  return {
    queue: CASUAL_REMINDER_QUEUE,
    schema: casualReminderPayload,
    task: (payload, run) => runCasualReminder(payload, run, deps()),
  };
}

const workerDeps = (): CasualReminderDeps => {
  const env = workerEnv();
  return { transport: getTransport(env), baseDomain: env.APP_BASE_DOMAIN, clock: systemClock };
};
export const casualReminderTask = createCasualReminderTask(workerDeps);

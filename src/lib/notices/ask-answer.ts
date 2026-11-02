import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock, type Clock } from "../auth/clock";
import {
  CANCELLED_ASSIGNMENT_STATUSES,
  events,
  firms,
  sessionAsks,
  shifts,
  sites,
  workers,
} from "../db/schema";
import { retryAborted } from "../db/retry";
import type { FirmTx, WithFirm } from "../db/scoped";
import { workerEnv } from "../env";
import { recordEvent } from "../events/record";
import { firmJobEnvelope, sendFirmJob, type FirmTask } from "../jobs/firm-job";
import { getTransport } from "../messaging";
import {
  notBookedEmailSubject,
  notBookedPush,
  shiftNotBookedMessage,
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

// Telling a casual they weren't booked from their ask (Phase 26.6, ses-6; docs/messaging-templates.md
// `shift_not_booked`): the office's "Not this time" (shift.ask_declined), or the session filling with
// others while they waited (shift.ask_closed). One ask-answer job per answer, queued in the
// transaction that logged it (src/lib/roster/asks.ts). A casual the office books hears by
// `shift_confirmed` instead (src/lib/notices/shift-confirmed.ts). The payload is ids only: the
// answer's event and the ask.
//
// At most once, like the other notices: a short transaction claims it (shift.ask_answer_notice,
// under an advisory lock on the ask) and commits; the message goes outside any transaction (a push
// to their phones, else by their channel with the WhatsApp-to-text fallback, else email:
// deliverToWorker); a second short transaction logs shift.ask_answer_sent or _failed. A job that
// stops part-way leaves the claim: the message may have gone, so it's never sent again.
//
// Not sent, and logged (shift.ask_answer_skipped {reason}): the casual was deleted (erased), the
// session is over (ended), they hold a place on it now (booked: however they were booked, the sheet
// sync's and a connector's too), or the ask isn't the answer any more (changed: they asked again
// after a place opened, or the session moved). Quiet hours hold it (shift.ask_answer_held) unless
// the session starts within the firm's urgent window.

export const ASK_ANSWER_QUEUE = "ask-answer";

const CANCELLED = sql.raw(CANCELLED_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(", "));

export const askAnswerPayload = firmJobEnvelope.extend({
  idempotencyKey: z.string().regex(/^ask-answer:\d{1,18}(:after-quiet)?$/),
  eventId: z.number().int().positive(),
  askId: z.uuid(),
});
export type AskAnswerPayload = z.infer<typeof askAnswerPayload>;

const job = { queue: ASK_ANSWER_QUEUE, schema: askAnswerPayload };

export async function queueAskAnswer(
  tx: FirmTx,
  answer: { eventId: number; askId: string },
): Promise<void> {
  await sendFirmJob(tx, job, {
    idempotencyKey: `ask-answer:${answer.eventId}`,
    eventId: answer.eventId,
    askId: answer.askId,
  });
}

export interface AskAnswerDeps extends NotifyDeps {
  baseDomain: string;
  clock: Clock;
}

type SkipReason = "erased" | "ended" | "booked" | "changed";

export type AskAnswerResult =
  | { status: "sent"; channel: DeliveryChannel }
  | { status: "failed" }
  | { status: "held"; until: Date }
  | { status: "already" }
  | { status: "skipped"; reason: SkipReason }
  | { status: "gone" }; // no such answer

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

type Claim =
  | {
      status: "send";
      shiftId: string;
      workerId: string;
      mobile: string;
      channel: WorkerChannel;
      smsAllowed: boolean;
      body: string;
      from: string | null;
      push: { title: string; body: string; url: string };
      email: { to: string; subject: string; body: string } | null;
    }
  | Exclude<AskAnswerResult, { status: "sent" } | { status: "failed" }>;

async function claim(
  tx: FirmTx,
  payload: AskAnswerPayload,
  deps: AskAnswerDeps,
  now: Date,
): Promise<Claim> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('ask-answer:' || app_current_firm_id()::text || ':' || ${payload.askId}, 0))`,
  );
  const { rows: done } = await tx.execute(sql`
    select 1 from events
     where entity_id = (select shift_id from session_asks where id = ${payload.askId})
       and action = 'shift.ask_answer_notice'
       and (data ->> 'answerEventId')::bigint = ${payload.eventId}
     limit 1
  `);
  if (done.length > 0) return { status: "already" };
  const [answer] = await tx
    .select({ id: events.id, action: events.action })
    .from(events)
    .where(
      and(
        eq(events.id, payload.eventId),
        sql`${events.action} in ('shift.ask_declined', 'shift.ask_closed')`,
      ),
    );
  if (!answer) return { status: "gone" };
  const [row] = await tx
    .select({
      askStatus: sessionAsks.status,
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
    .from(sessionAsks)
    .innerJoin(
      workers,
      and(eq(workers.firmId, sessionAsks.firmId), eq(workers.id, sessionAsks.workerId)),
    )
    .innerJoin(
      shifts,
      and(eq(shifts.firmId, sessionAsks.firmId), eq(shifts.id, sessionAsks.shiftId)),
    )
    .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
    .innerJoin(firms, eq(firms.id, sessionAsks.firmId))
    .where(eq(sessionAsks.id, payload.askId));
  if (!row) return { status: "gone" };
  const tz = row.timezone;
  const skip = async (reason: SkipReason) => {
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.ask_answer_skipped",
      entityType: "shift",
      entityId: row.shiftId,
      data: { answerEventId: payload.eventId, workerId: row.workerId, reason },
    });
    return { status: "skipped" as const, reason };
  };
  if (row.mobile === null) return skip("erased");
  if (row.endsAt.getTime() <= now.getTime()) return skip("ended");
  const { rows: holds } = await tx.execute(sql`
    select 1 from assignments
     where shift_id = ${row.shiftId} and worker_id = ${row.workerId}
       and status not in (${CANCELLED})
     limit 1
  `);
  if (row.askStatus === "booked" || holds.length > 0) return skip("booked");
  const stands = answer.action === "shift.ask_declined" ? "not_this_time" : "closed";
  if (row.askStatus !== stands) return skip("changed");

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
      action: "shift.ask_answer_held",
      entityType: "shift",
      entityId: row.shiftId,
      data: {
        answerEventId: payload.eventId,
        workerId: row.workerId,
        until: timing.until.toISOString(),
      },
    });
    return { status: "held", until: timing.until };
  }

  const voice = { name: row.firmName, signOff: signOffFor(row.firmName, row.settings.sign_off) };
  const date = dayLabel(localDateOf(row.startsAt, tz));
  const start = hhmm(row.startsAt, tz);
  const body = shiftNotBookedMessage(voice, {
    role: row.role,
    site: row.site,
    date,
    start,
    end: hhmm(row.endsAt, tz),
    link: `${portalUrl(row.slug, deps.baseDomain)}/shifts/open`,
  });
  await recordEvent(tx, {
    actorType: "system",
    action: "shift.ask_answer_notice",
    entityType: "shift",
    entityId: row.shiftId,
    data: { answerEventId: payload.eventId, workerId: row.workerId, status: "sending" },
  });
  return {
    status: "send",
    shiftId: row.shiftId,
    workerId: row.workerId,
    mobile: row.mobile,
    channel: row.channel,
    smsAllowed: smsAllowedFor(row),
    body,
    from: row.line,
    push: { ...notBookedPush({ site: row.site, date, start }), url: "/shifts/open" },
    email: row.email ? { to: row.email, subject: notBookedEmailSubject({ date }), body } : null,
  };
}

export async function runAskAnswer(
  payload: AskAnswerPayload,
  run: WithFirm,
  deps: AskAnswerDeps,
): Promise<AskAnswerResult> {
  const now = deps.clock.now();
  const c = await retryAborted(() => run(payload.firmId, (tx) => claim(tx, payload, deps, now)));
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
    const pushes = await recordPushes(tx, sent.push);
    if (!sent.ok) {
      await recordEvent(tx, {
        actorType: "system",
        action: "shift.ask_answer_failed",
        entityType: "shift",
        entityId: c.shiftId,
        data: {
          answerEventId: payload.eventId,
          workerId: c.workerId,
          channel: sent.channel,
          code: sent.code,
        },
      });
      return;
    }
    await recordEvent(tx, {
      actorType: "system",
      action: "shift.ask_answer_sent",
      entityType: "shift",
      entityId: c.shiftId,
      data: {
        answerEventId: payload.eventId,
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

export function createAskAnswerTask(deps: () => AskAnswerDeps): FirmTask<AskAnswerPayload> {
  return {
    queue: ASK_ANSWER_QUEUE,
    schema: askAnswerPayload,
    task: (payload, run) => runAskAnswer(payload, run, deps()),
  };
}

const workerDeps = (): AskAnswerDeps => {
  const env = workerEnv();
  return {
    transport: getTransport(env),
    push: getPushTransport(env),
    baseDomain: env.APP_BASE_DOMAIN,
    clock: systemClock,
  };
};
export const askAnswerTask = createAskAnswerTask(workerDeps);

import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { firms, rosterSources } from "../db/schema";
import type { ConnectionWaits, FirmTx, WithFirm } from "../db/scoped";
import { INBOUND_MESSAGE_QUEUE } from "../inbound/job";
import { log, type Logger } from "../log";
import { NO_TEXT_SENDER } from "../notify/send";
import { OFFER_WAVE_QUEUE } from "../offers/waves";
import {
  aiFallbackAlert,
  backlogAlert,
  connectionWaitAlert,
  healthAlert,
  jobFailureAlert,
  loginLinkAlerts,
  opsAlertSchema,
  runningLongAlert,
  sendFailureAlert,
  syncAlert,
  THRESHOLDS,
  volumeAlerts,
  type AlertTransport,
  type HealthResult,
  type OpsAlert,
  type QueueRunningLong,
  type QueueWait,
} from "./alerts";

// The ops alerts job (docs/api-and-jobs.md `ops-alerts-tick`, `ops-alert`). Every 5 minutes, with
// no firm, the tick looks at the last hour:
// - jobs that failed after their last retry (pg-boss `failed`), by queue, across all firms (the
//   worker's own pg-boss connection reads them: `failedJobs`);
// - each firm (inside its own transaction, RLS): an enabled rota sheet whose last sync failed, its
//   WhatsApp and text sends (the events every sender writes) against the failures, its emails the
//   same (P2.5: with no text sender a casual's messages go by push or email), and its casuals' login
//   links by WhatsApp and text, and by email since P2.6 (14.2: more than usual means a crowd, or
//   someone running up its messages);
// - each firm, too (P4.8): its messages the AI couldn't sort, its messages in and its offers out;
// - pg-boss's queues (P4.8, the worker's pg-boss connection again: `queueHealth`): jobs waiting to
//   start longer than their queue's limit, and jobs running past 80% of their time limit;
// - the worker's own waits for a database connection since the last tick (P4.8:
//   `connectionWaits`, from withFirm);
// - the web app's health check from inside the server (`health`, when HEALTH_CHECK_URL is set).
// Each alert that fires is queued as an `ops-alert` job, unless one with the same key was queued in
// the last hour (the worker looks: `queueOpsAlert()`), so an ongoing problem alerts at most once an
// hour; the job sends it (retried if the send fails). One part failing (listing firms, a firm, the
// failed jobs, the health check, queueing one alert) never stops the others.

export const OPS_ALERTS_TICK_QUEUE = "ops-alerts-tick";
export const OPS_ALERT_QUEUE = "ops-alert";
export const OPS_ALERTS_CRON = "*/5 * * * *";
export const OPS_ALERT_REPEAT_SECONDS = 60 * 60;

const HOUR_MS = 60 * 60 * 1000;

// WhatsApp and text sends, and the failures, as the senders log them, each with its channel (a
// licence warning caught up after a crash has none since 14.3, so it isn't counted: it went in an
// earlier hour, if at all).
// Only senders that log their failures too, so the rate compares like with like. Since Phase 10
// every sender claims, sends, then records (a failed send is logged, never retried), so the login
// links and codes and the credential messages are counted here too.
export const SEND_ACTIONS = [
  "offer.sent",
  "auth.link_sent",
  "auth.otp_sent",
  "credential.expiry_warning",
  "credential.expiry_notice_sent",
  "shift.reminder_sent",
  "shift.change_notice_sent",
  "shift.booked_notice_sent",
  "request.update_sent",
  "pay_query.update_sent",
  "message.replied",
] as const;
export const SEND_FAILED_ACTIONS = [
  "offer.send_failed",
  "auth.link_send_failed",
  "auth.otp_send_failed",
  "credential.expiry_warning_failed",
  "credential.expiry_notice_failed",
  "shift.reminder_failed",
  "shift.change_notice_failed",
  "shift.booked_notice_failed",
  "request.update_failed",
  "pay_query.update_failed",
  "message.reply_failed",
] as const;

// Failures that aren't the provider's: a casual who replied STOP (no text is tried), and no text
// sender at all (P2.5: MESSAGING_TRANSPORT=none; nothing is tried).
export const NOT_SEND_FAILURES = ["sms_opted_out", NO_TEXT_SENDER] as const;

// A casual's login links (sent or tried), counted for the login-link alerts (14.2).
export const LOGIN_LINK_ACTIONS = ["auth.link_sent", "auth.link_send_failed"] as const;

const list = (actions: readonly string[]) =>
  sql.join(
    actions.map((a) => sql`${a}`),
    sql`, `,
  );

// A sheet sync counts as failing once it hasn't worked for 30 minutes (a single hiccup backs off
// and usually recovers) and is still being tried (a source no tick runs for isn't reported for
// ever).
export const SYNC_FAILING_MINUTES = 30;

// How long a queue's jobs may wait to start (P4.8; THRESHOLDS.backlogSeconds): a casual's message,
// an offer wave, anything else.
export function backlogLimitSeconds(queue: string): number {
  if (queue === INBOUND_MESSAGE_QUEUE) return THRESHOLDS.backlogSeconds.inbound;
  if (queue === OFFER_WAVE_QUEUE) return THRESHOLDS.backlogSeconds.waves;
  return THRESHOLDS.backlogSeconds.other;
}

// What the AI said when it couldn't sort a message (`message.received` aiFallback): no answer in
// time (an error, the 5 seconds, busy or the breaker: P4.6), or not one of the labels. Not
// "not_connected" (the AI is off, so nothing was asked) or "no_text" (a photo: nothing to ask).
export const AI_FAILED = ["no_answer", "not_a_label"] as const;

// One firm's part: its failing sheet sync, its sends and its login links over the last hour, and
// (P4.8) the AI's misses, its messages in and its offers out.
export async function firmAlerts(tx: FirmTx, firmId: string, now: Date): Promise<OpsAlert[]> {
  const [firm] = await tx.select({ slug: firms.slug }).from(firms).where(eq(firms.id, firmId));
  if (!firm) return [];
  const alerts: OpsAlert[] = [];
  const stale = new Date(now.getTime() - SYNC_FAILING_MINUTES * 60_000);
  const [failing] = await tx
    .select({ code: rosterSources.lastErrorCode, kind: rosterSources.kind })
    .from(rosterSources)
    .where(
      and(
        eq(rosterSources.enabled, true),
        isNotNull(rosterSources.lastErrorCode),
        or(isNull(rosterSources.lastSyncedAt), lt(rosterSources.lastSyncedAt, stale)),
        gt(rosterSources.lastAttemptedAt, new Date(now.getTime() - HOUR_MS)),
      ),
    );
  if (failing?.code) {
    alerts.push(syncAlert({ firmId, slug: firm.slug, code: failing.code, kind: failing.kind }));
  }

  const since = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS);
  // The last hour's sends, texts and emails apart; the login links over the last 24 hours too (only
  // those are read that far back).
  const texts = sql`e.data ->> 'channel' in ('whatsapp', 'sms')`;
  const email = sql`e.data ->> 'channel' = 'email'`;
  // A casual's login links by WhatsApp and text, and since P2.6 by email (not the office's own).
  const casualLinks = sql`(${texts} or (${email} and e.data ->> 'purpose' = 'worker_login'))`;
  const counted = sql`(e.data ->> 'code') is null or e.data ->> 'code' not in (${list(NOT_SEND_FAILURES)})`;
  const topCode = (channels: string[]) => sql`
    (select f.data ->> 'code' from events f
      where f.created_at > ${since} and f.created_at <= ${now}
        and f.action in (${list(SEND_FAILED_ACTIONS)})
        and f.data ->> 'channel' in (${list(channels)})
        and f.data ->> 'code' not in (${list(NOT_SEND_FAILURES)})
        and f.data ->> 'code' ~ '^[A-Za-z0-9_.-]{1,50}$'
      group by 1 order by count(*) desc, 1 limit 1)`;
  const { rows } = await tx.execute<{
    sent: number;
    failed: number;
    top_code: string | null;
    email_sent: number;
    email_failed: number;
    email_top_code: string | null;
    login_links: number;
    login_links_day: number;
  }>(sql`
    select count(*) filter (where e.created_at > ${since} and ${texts}
                              and e.action in (${list(SEND_ACTIONS)}))::int as sent,
           count(*) filter (where e.created_at > ${since} and ${casualLinks}
                              and e.action in (${list(LOGIN_LINK_ACTIONS)}))::int as login_links,
           count(*) filter (where ${casualLinks}
                              and e.action in (${list(LOGIN_LINK_ACTIONS)}))::int as login_links_day,
           count(*) filter (where e.created_at > ${since} and ${texts}
                              and e.action in (${list(SEND_FAILED_ACTIONS)})
                              and (${counted}))::int as failed,
           ${topCode(["whatsapp", "sms"])} as top_code,
           count(*) filter (where e.created_at > ${since} and ${email}
                              and e.action in (${list(SEND_ACTIONS)}))::int as email_sent,
           count(*) filter (where e.created_at > ${since} and ${email}
                              and e.action in (${list(SEND_FAILED_ACTIONS)}))::int as email_failed,
           ${topCode(["email"])} as email_top_code
      from events e
     where e.created_at <= ${now}
       and (e.created_at > ${since}
            or (e.created_at > ${dayAgo} and e.action in (${list(LOGIN_LINK_ACTIONS)})))
       and e.data ->> 'channel' in ('whatsapp', 'sms', 'email')
  `);
  const counts = rows[0];
  for (const by of ["texts", "email"] as const) {
    const sends = sendFailureAlert({
      firmId,
      slug: firm.slug,
      sent: (by === "email" ? counts?.email_sent : counts?.sent) ?? 0,
      failed: (by === "email" ? counts?.email_failed : counts?.failed) ?? 0,
      topCode: (by === "email" ? counts?.email_top_code : counts?.top_code) ?? null,
      by,
    });
    if (sends) alerts.push(sends);
  }
  alerts.push(
    ...loginLinkAlerts({
      firmId,
      slug: firm.slug,
      lastHour: counts?.login_links ?? 0,
      lastDay: counts?.login_links_day ?? 0,
    }),
  );

  // The AI's part in sorting the shifts line's messages (each `message.received`: sorted by it, or
  // its fallback), the messages that came in and the offers that went, over the last hour. Each by
  // its own index (events by action and time, messages and offers by time).
  const { rows: load } = await tx.execute<{
    ai_asked: number;
    ai_failed: number;
    inbound: number;
    offers: number;
  }>(sql`
    select
      (select count(*) from events e
        where e.action = 'message.received' and e.created_at > ${since} and e.created_at <= ${now}
          and (e.data ->> 'handledAs' = 'ai' or e.data ->> 'aiFallback' in (${list(AI_FAILED)})))::int
        as ai_asked,
      (select count(*) from events e
        where e.action = 'message.received' and e.created_at > ${since} and e.created_at <= ${now}
          and e.data ->> 'aiFallback' in (${list(AI_FAILED)}))::int as ai_failed,
      (select count(*) from messages m
        where m.direction = 'in' and m.created_at > ${since} and m.created_at <= ${now})::int
        as inbound,
      (select count(*) from offers o
        where o.sent_at > ${since} and o.sent_at <= ${now})::int as offers
  `);
  const l = load[0];
  const ai = aiFallbackAlert({
    firmId,
    slug: firm.slug,
    asked: l?.ai_asked ?? 0,
    fellBack: l?.ai_failed ?? 0,
  });
  if (ai) alerts.push(ai);
  alerts.push(
    ...volumeAlerts({ firmId, slug: firm.slug, inbound: l?.inbound ?? 0, offers: l?.offers ?? 0 }),
  );
  return alerts;
}

// pg-boss's queues, as the worker reads them (src/worker/jobs/index.ts queueHealth).
export interface QueueHealth {
  waiting: Omit<QueueWait, "limitSeconds">[];
  runningLong: QueueRunningLong[];
}

export interface OpsTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  failedJobs: () => Promise<{ queue: string; count: number }[]>;
  queueHealth: () => Promise<QueueHealth>;
  // The worker's waits for a connection since the last tick, then counting from zero.
  connectionWaits: () => ConnectionWaits & { poolMax: number };
  health?: () => Promise<HealthResult>;
  queue: (alert: OpsAlert) => Promise<void>;
  clock?: Clock;
  logger?: Logger;
}

export async function runOpsAlertsTick(deps: OpsTickDeps): Promise<{ alerts: OpsAlert[] }> {
  const now = (deps.clock ?? systemClock).now();
  const logger = deps.logger ?? log;
  const alerts: OpsAlert[] = [];
  let failed: { queue: string; count: number }[] = [];
  try {
    failed = await deps.failedJobs();
  } catch (error) {
    logger.error("ops alerts: failed jobs couldn't be read", { error });
  }
  const jobs = jobFailureAlert(failed);
  if (jobs) alerts.push(jobs);
  try {
    const queues = await deps.queueHealth();
    const backlog = backlogAlert(
      queues.waiting.map((w) => ({ ...w, limitSeconds: backlogLimitSeconds(w.queue) })),
    );
    if (backlog) alerts.push(backlog);
    const long = runningLongAlert(queues.runningLong);
    if (long) alerts.push(long);
  } catch (error) {
    logger.error("ops alerts: the queues couldn't be read", { error });
  }
  try {
    const waits = connectionWaitAlert(deps.connectionWaits());
    if (waits) alerts.push(waits);
  } catch (error) {
    logger.error("ops alerts: the connection waits couldn't be read", { error });
  }
  let firmIds: string[] = [];
  try {
    firmIds = await deps.listFirmIds();
  } catch (error) {
    logger.error("ops alerts: the firms couldn't be listed", { error });
  }
  for (const firmId of firmIds) {
    try {
      alerts.push(...(await deps.run(firmId, (tx) => firmAlerts(tx, firmId, now))));
    } catch (error) {
      logger.error("ops alerts failed for a firm", { firmId, error });
    }
  }
  if (deps.health) {
    try {
      const health = healthAlert(await deps.health());
      if (health) alerts.push(health);
    } catch (error) {
      logger.error("ops alerts: the health check failed to run", { error });
    }
  }
  for (const alert of alerts) {
    try {
      await deps.queue(alert);
    } catch (error) {
      logger.error("ops alert couldn't be queued", { alert: alert.kind, error });
    }
  }
  return { alerts };
}

// The ops-alert job: one alert, checked again, sent.
export async function sendOpsAlert(data: unknown, transport: AlertTransport): Promise<void> {
  await transport.send(opsAlertSchema.parse(data));
}

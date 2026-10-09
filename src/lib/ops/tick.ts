import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { firms, rosterSources } from "../db/schema";
import type { FirmTx, WithFirm } from "../db/scoped";
import { log, type Logger } from "../log";
import {
  healthAlert,
  jobFailureAlert,
  opsAlertSchema,
  sendFailureAlert,
  syncAlert,
  type AlertTransport,
  type HealthResult,
  type OpsAlert,
} from "./alerts";

// The ops alerts job (docs/api-and-jobs.md `ops-alerts-tick`, `ops-alert`). Every 5 minutes, with
// no firm, the tick looks at the last hour:
// - jobs that failed after their last retry (pg-boss `failed`), by queue, across all firms (the
//   worker's own pg-boss connection reads them: `failedJobs`);
// - each firm (inside its own transaction, RLS): an enabled rota sheet whose last sync failed, and
//   its WhatsApp and text sends (the events every sender writes) against the failures;
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

// WhatsApp and text sends, and the failures, as the senders log them (each carries its channel).
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

const list = (actions: readonly string[]) =>
  sql.join(
    actions.map((a) => sql`${a}`),
    sql`, `,
  );

// A sheet sync counts as failing once it hasn't worked for 30 minutes (a single hiccup backs off
// and usually recovers) and is still being tried (a source no tick runs for isn't reported for
// ever).
export const SYNC_FAILING_MINUTES = 30;

// One firm's part: its failing sheet sync, and its sends over the last hour.
export async function firmAlerts(tx: FirmTx, firmId: string, now: Date): Promise<OpsAlert[]> {
  const [firm] = await tx.select({ slug: firms.slug }).from(firms).where(eq(firms.id, firmId));
  if (!firm) return [];
  const alerts: OpsAlert[] = [];
  const stale = new Date(now.getTime() - SYNC_FAILING_MINUTES * 60_000);
  const [failing] = await tx
    .select({ code: rosterSources.lastErrorCode })
    .from(rosterSources)
    .where(
      and(
        eq(rosterSources.enabled, true),
        isNotNull(rosterSources.lastErrorCode),
        or(isNull(rosterSources.lastSyncedAt), lt(rosterSources.lastSyncedAt, stale)),
        gt(rosterSources.lastAttemptedAt, new Date(now.getTime() - HOUR_MS)),
      ),
    );
  if (failing?.code) alerts.push(syncAlert({ firmId, slug: firm.slug, code: failing.code }));

  const since = new Date(now.getTime() - HOUR_MS);
  const { rows } = await tx.execute<{ sent: number; failed: number; top_code: string | null }>(sql`
    select count(*) filter (where e.action in (${list(SEND_ACTIONS)}))::int as sent,
           count(*) filter (where e.action in (${list(SEND_FAILED_ACTIONS)})
                              and e.data ->> 'code' is distinct from 'sms_opted_out')::int as failed,
           (select f.data ->> 'code' from events f
             where f.created_at > ${since} and f.created_at <= ${now}
               and f.action in (${list(SEND_FAILED_ACTIONS)})
               and f.data ->> 'channel' in ('whatsapp', 'sms')
               and f.data ->> 'code' is distinct from 'sms_opted_out'
               and f.data ->> 'code' ~ '^[A-Za-z0-9_.-]{1,50}$'
             group by 1 order by count(*) desc, 1 limit 1) as top_code
      from events e
     where e.created_at > ${since} and e.created_at <= ${now}
       and e.data ->> 'channel' in ('whatsapp', 'sms')
  `);
  const counts = rows[0];
  const sends = sendFailureAlert({
    firmId,
    slug: firm.slug,
    sent: counts?.sent ?? 0,
    failed: counts?.failed ?? 0,
    topCode: counts?.top_code ?? null,
  });
  if (sends) alerts.push(sends);
  return alerts;
}

export interface OpsTickDeps {
  listFirmIds: () => Promise<string[]>;
  run: WithFirm;
  failedJobs: () => Promise<{ queue: string; count: number }[]>;
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

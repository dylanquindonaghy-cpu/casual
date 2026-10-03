import type { PgBoss } from "pg-boss";
import { systemClock, type Clock } from "../../lib/auth/clock";
import { sendLoginCodeJob } from "../../lib/auth/send-login-code";
import { sendPortalLinkJob } from "../../lib/auth/send-portal-link";
import {
  credentialScanFirmTask,
  CREDENTIAL_SCAN_CRON,
  CREDENTIAL_SCAN_TICK_QUEUE,
  CREDENTIAL_SCAN_TZ,
  runCredentialScanTick,
} from "../../lib/credentials/scan";
import { listFirmIds } from "../../lib/db/directory";
import { appEnv } from "../../lib/env";
import {
  RETENTION_PURGE_CRON,
  RETENTION_PURGE_TICK_QUEUE,
  RETENTION_PURGE_TZ,
  retentionPurgeFirmTask,
  runRetentionPurgeTick,
} from "../../lib/gdpr/retention";
import { withFirm } from "../../lib/db/scoped";
import {
  runFirmJob,
  runFirmTask,
  type FirmJob,
  type FirmJobEnvelope,
  type FirmTask,
} from "../../lib/jobs/firm-job";
import {
  METRICS_ROLLUP_CRON,
  METRICS_ROLLUP_TICK_QUEUE,
  METRICS_ROLLUP_TZ,
  metricsRollupFirmTask,
  runMetricsRollupTick,
} from "../../lib/metrics/rollup";
import type { InboundMessagePayload } from "../../lib/inbound/job";
import { inboundMessageFirmTask } from "../../lib/inbound/reply";
import { firmChangeNoticeTask, type FirmChangeNoticePayload } from "../../lib/notices/firm-change";
import { payQueryUpdateTask, type PayQueryUpdatePayload } from "../../lib/notices/pay-query-update";
import { requestUpdateTask, type RequestUpdatePayload } from "../../lib/notices/request-update";
import { officeOfferJob, type OfficeOfferPayload } from "../../lib/offers/office-offer";
import {
  PAY_DIGEST_TICK_CRON,
  PAY_DIGEST_TICK_QUEUE,
  payDigestFirmTask,
  runPayDigestTick,
  type PayDigestPayload,
} from "../../lib/pay/digest";
import {
  escalateShiftTask,
  offerWaveTask,
  type EscalateShiftPayload,
  type OfferWavePayload,
} from "../../lib/offers/waves";
import {
  runShiftReminderTick,
  SHIFT_REMINDER_TICK_CRON,
  SHIFT_REMINDER_TICK_QUEUE,
  shiftRemindersTask,
  type ShiftRemindersPayload,
} from "../../lib/reminders/send";
import type { SheetsClient } from "../../lib/roster/sheets/client";
import {
  runSheetsTick,
  SHEETS_TICK_CRON,
  SHEETS_TICK_QUEUE,
  sheetsSyncTask,
} from "../../lib/roster/sheets/jobs";
import { alertTransport, type AlertTransport, type OpsAlert } from "../../lib/ops/alerts";
import { checkWebHealth } from "../../lib/ops/health-check";
import {
  OPS_ALERT_QUEUE,
  OPS_ALERT_REPEAT_SECONDS,
  OPS_ALERTS_CRON,
  OPS_ALERTS_TICK_QUEUE,
  runOpsAlertsTick,
  sendOpsAlert,
} from "../../lib/ops/tick";
import { HELLO_QUEUE, handleHello } from "./hello";
import { QUEUES } from "./queues";

export interface JobDeps {
  // Absent (SHEETS_TRANSPORT=none): no sheet is ever synced, and the tick is unscheduled.
  sheets?: SheetsClient;
  clock?: Clock;
  // Tests replace the offer jobs' transport and clock; the worker uses its configuration.
  offers?: {
    wave: FirmTask<OfferWavePayload>;
    escalate: FirmTask<EscalateShiftPayload>;
    office?: FirmJob<OfficeOfferPayload>;
  };
  reminders?: FirmTask<ShiftRemindersPayload>;
  firmChangeNotices?: FirmTask<FirmChangeNoticePayload>;
  requestUpdates?: FirmTask<RequestUpdatePayload>;
  payDigest?: FirmTask<PayDigestPayload>;
  payQueryUpdates?: FirmTask<PayQueryUpdatePayload>;
  inboundMessages?: FirmTask<InboundMessagePayload>;
  // Alerts to the founder: where they go (default: the console), and the web app's health check as
  // seen inside the server (unset: not checked).
  alerts?: AlertTransport;
  healthCheckUrl?: string;
}

// One alert, unless one with the same key was queued in the last hour (pg-boss's singleton alone
// is per clock hour: a problem at 10:50 would alert again at 11:00). The singleton still stops two
// ticks at once from both queueing it. True when queued.
export async function queueOpsAlert(boss: PgBoss, alert: OpsAlert): Promise<boolean> {
  const { rows } = await boss.getDb().executeSql(
    `select 1 from pgboss.job
      where name = $1 and singleton_key = $2 and created_on > now() - interval '1 hour'
      limit 1`,
    [OPS_ALERT_QUEUE, alert.key],
  );
  if (rows.length > 0) return false;
  const id = await boss.send(OPS_ALERT_QUEUE, alert, {
    singletonKey: alert.key,
    singletonSeconds: OPS_ALERT_REPEAT_SECONDS,
  });
  return id !== null;
}

// Jobs that failed after their last retry in the last hour, by queue (not the alerts' own queue:
// an alert that can't be sent can't report itself). Read through the worker's pg-boss connection
// (the jobs role owns pgboss).
export async function failedJobCounts(boss: PgBoss): Promise<{ queue: string; count: number }[]> {
  const { rows } = await boss.getDb().executeSql(
    `select name as queue, count(*)::int as count from pgboss.job
      where state = 'failed' and completed_on > now() - interval '1 hour' and name <> $1
      group by name order by name`,
    [OPS_ALERT_QUEUE],
  );
  return rows as { queue: string; count: number }[];
}

// Used by the worker process and by the integration tests, so both run the same wiring.
export async function registerJobs(boss: PgBoss, deps: JobDeps = {}): Promise<void> {
  for (const queue of QUEUES) await boss.createQueue(queue.name, queue.options);
  await registerFirmJob(boss, sendPortalLinkJob);
  await registerFirmJob(boss, sendLoginCodeJob);
  // Offer waves and escalation for urgent gaps (messages through the configured transport).
  await registerFirmTask(boss, deps.offers?.wave ?? offerWaveTask);
  await registerFirmTask(boss, deps.offers?.escalate ?? escalateShiftTask);
  // An offer the office sends to one worker (Today's "Offer to someone").
  await registerFirmJob(boss, deps.offers?.office ?? officeOfferJob);
  // Telling workers the office changed or cancelled their booked shift (golden rule 12).
  await registerFirmTask(boss, deps.firmChangeNotices ?? firmChangeNoticeTask);
  await registerFirmTask(boss, deps.requestUpdates ?? requestUpdateTask);
  // Telling a worker payroll has sorted their pay query.
  await registerFirmTask(boss, deps.payQueryUpdates ?? payQueryUpdateTask);
  // Answering WhatsApps on the shifts line (stored by the Twilio webhook).
  await registerFirmTask(boss, deps.inboundMessages ?? inboundMessageFirmTask);

  // Shift reminders, 24 h and 2 h before the start: the tick queues a firm's job when one is due.
  await registerFirmTask(boss, deps.reminders ?? shiftRemindersTask);
  await boss.work(SHIFT_REMINDER_TICK_QUEUE, async () => {
    await runShiftReminderTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
  });
  await boss.schedule(SHIFT_REMINDER_TICK_QUEUE, SHIFT_REMINDER_TICK_CRON);

  // Credential expiry: always on (messages go through the configured transport).
  await registerFirmTask(boss, credentialScanFirmTask);
  await boss.work(CREDENTIAL_SCAN_TICK_QUEUE, async () => {
    await runCredentialScanTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
  });
  await boss.schedule(CREDENTIAL_SCAN_TICK_QUEUE, CREDENTIAL_SCAN_CRON, null, {
    tz: CREDENTIAL_SCAN_TZ,
  });

  // Pilot metrics: each firm's daily figures, recomputed for the last 7 days every night.
  await registerFirmTask(boss, metricsRollupFirmTask);
  await boss.work(METRICS_ROLLUP_TICK_QUEUE, async () => {
    await runMetricsRollupTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
  });
  await boss.schedule(METRICS_ROLLUP_TICK_QUEUE, METRICS_ROLLUP_CRON, null, {
    tz: METRICS_ROLLUP_TZ,
  });

  // Retention (docs/compliance.md): each firm's old messages and login leftovers, every night.
  await registerFirmTask(boss, retentionPurgeFirmTask);
  await boss.work(RETENTION_PURGE_TICK_QUEUE, async () => {
    await runRetentionPurgeTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
  });
  await boss.schedule(RETENTION_PURGE_TICK_QUEUE, RETENTION_PURGE_CRON, null, {
    tz: RETENTION_PURGE_TZ,
  });

  // The payroll digest: each firm's new pay queries at its digest time (the tick checks every 5
  // minutes), or when payroll presses "Send the digest now".
  await registerFirmTask(boss, deps.payDigest ?? payDigestFirmTask);
  await boss.work(PAY_DIGEST_TICK_QUEUE, async () => {
    await runPayDigestTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
  });
  await boss.schedule(PAY_DIGEST_TICK_QUEUE, PAY_DIGEST_TICK_CRON);

  // Alerts to the founder (src/lib/ops/): the tick every 5 minutes; each alert a job of its own.
  const alerts = deps.alerts ?? alertTransport(appEnv().ALERTS_TRANSPORT);
  await boss.work(OPS_ALERT_QUEUE, async ([job]) => {
    if (job) await sendOpsAlert(job.data, alerts);
  });
  await boss.work(OPS_ALERTS_TICK_QUEUE, async () => {
    const url = deps.healthCheckUrl;
    await runOpsAlertsTick({
      listFirmIds,
      run: withFirm,
      clock: deps.clock ?? systemClock,
      failedJobs: () => failedJobCounts(boss),
      ...(url ? { health: () => checkWebHealth(url) } : {}),
      queue: async (alert) => {
        await queueOpsAlert(boss, alert);
      },
    });
  });
  await boss.schedule(OPS_ALERTS_TICK_QUEUE, OPS_ALERTS_CRON);

  if (deps.sheets) {
    const clock = deps.clock ?? systemClock;
    await registerFirmTask(boss, sheetsSyncTask(deps.sheets, clock));
    await boss.work(SHEETS_TICK_QUEUE, async () => {
      await runSheetsTick({ listFirmIds, run: withFirm, clock });
    });
    await boss.schedule(SHEETS_TICK_QUEUE, SHEETS_TICK_CRON);
  } else {
    await boss.unschedule(SHEETS_TICK_QUEUE);
  }

  await boss.work(HELLO_QUEUE, { perJobResults: true }, async (jobs) =>
    jobs.map((job) => ({
      id: job.id,
      status: "completed" as const,
      output: handleHello(job.data),
    })),
  );
}

// How the worker takes firm jobs. pg-boss's default is one job per fetch and then its polling
// interval (2 seconds) after every fetch, even with a queue full of work: 200 WhatsApps took about
// 400 seconds to answer, and a cancelled shift's 50 notices would take 100 (the pre-pilot load
// smoke found it: tests/e2e/load.smoke.spec.ts). So up to 5 per fetch, and while a fetch comes back
// full it fetches again at once; a short fetch means the queue has caught up and it goes back to
// polling. The jobs of a batch still run one after another, in the order they were queued (as one
// job per fetch did): a worker's STOP is handled before their next text, and an offer wave locks its
// shift only for each worker's claim, never across a message (src/lib/offers/waves.ts).
// `runFirmJob`/`runFirmTask` never throw, so one job failing leaves the rest of its batch alone.
export const FIRM_WORK_OPTIONS = {
  perJobResults: true,
  batchSize: 5,
  burstWhenBatchFull: true,
} as const;

// One after another, in the batch's order, one result per job.
export async function inOrder<J, R>(jobs: J[], run: (job: J) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const job of jobs) results.push(await run(job));
  return results;
}

export async function registerFirmTask<P extends FirmJobEnvelope>(
  boss: PgBoss,
  task: FirmTask<P>,
): Promise<void> {
  await boss.work(task.queue, FIRM_WORK_OPTIONS, (jobs) =>
    inOrder(jobs, (j) => runFirmTask(task, j)),
  );
}

// Each job in a batch gets its own result, and each handler runs inside withFirm(firmId).
export async function registerFirmJob<P extends FirmJobEnvelope>(
  boss: PgBoss,
  job: FirmJob<P>,
): Promise<void> {
  await boss.work(job.queue, FIRM_WORK_OPTIONS, (jobs) => inOrder(jobs, (j) => runFirmJob(job, j)));
}

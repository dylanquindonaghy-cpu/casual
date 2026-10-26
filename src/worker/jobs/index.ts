import type { Job, PgBoss } from "pg-boss";
import { systemClock, type Clock } from "../../lib/auth/clock";
import { sendLoginCodeTask } from "../../lib/auth/send-login-code";
import { sendPortalLinkTask } from "../../lib/auth/send-portal-link";
import {
  credentialScanFirmTask,
  CREDENTIAL_SCAN_CRON,
  CREDENTIAL_SCAN_TICK_QUEUE,
  CREDENTIAL_SCAN_TZ,
  runCredentialScanTick,
} from "../../lib/credentials/scan";
import { listFirmIds } from "../../lib/db/directory";
import { appEnv } from "../../lib/env";
import { log, type Logger } from "../../lib/log";
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
import { enquiryReplyTask, type EnquiryReplyPayload } from "../../lib/notices/enquiry-reply";
import { requestUpdateTask, type RequestUpdatePayload } from "../../lib/notices/request-update";
import { shiftConfirmedTask, type ShiftConfirmedPayload } from "../../lib/notices/shift-confirmed";
import { officeOfferTask, type OfficeOfferPayload } from "../../lib/offers/office-offer";
import { strikesEmailLinkTask, type StrikesEmailLinkPayload } from "../../lib/office/strikes-email";
import { strikeEvidenceTask } from "../../lib/strikes/evidence";
import type { StrikeEvidencePayload } from "../../lib/strikes/evidence-queue";
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
import type { TravelEstimatesPayload } from "../../lib/travel/estimate-queue";
import {
  runTravelEstimatesTick,
  TRAVEL_ESTIMATES_CRON,
  TRAVEL_ESTIMATES_TICK_QUEUE,
  TRAVEL_ESTIMATES_TZ,
  travelEstimatesTask,
} from "../../lib/travel/estimates";
import { webhookDeliverTask } from "../../lib/integrations/deliver";
import type { WebhookDeliverPayload } from "../../lib/integrations/outbox";
import { ensureQueues } from "./queues";

export interface JobDeps {
  // Absent (SHEETS_TRANSPORT=none): no sheet is ever synced, and the tick is unscheduled.
  sheets?: SheetsClient;
  clock?: Clock;
  // Tests replace the offer jobs' transport and clock; the worker uses its configuration.
  offers?: {
    wave: FirmTask<OfferWavePayload>;
    escalate: FirmTask<EscalateShiftPayload>;
    office?: FirmTask<OfficeOfferPayload>;
  };
  reminders?: FirmTask<ShiftRemindersPayload>;
  firmChangeNotices?: FirmTask<FirmChangeNoticePayload>;
  shiftConfirmed?: FirmTask<ShiftConfirmedPayload>;
  requestUpdates?: FirmTask<RequestUpdatePayload>;
  enquiryReplies?: FirmTask<EnquiryReplyPayload>;
  payDigest?: FirmTask<PayDigestPayload>;
  payQueryUpdates?: FirmTask<PayQueryUpdatePayload>;
  strikesEmailLinks?: FirmTask<StrikesEmailLinkPayload>;
  strikeEvidence?: FirmTask<StrikeEvidencePayload>;
  travelEstimates?: FirmTask<TravelEstimatesPayload>;
  inboundMessages?: FirmTask<InboundMessagePayload>;
  webhooks?: FirmTask<WebhookDeliverPayload>;
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
  await ensureQueues(boss);
  await registerFirmTask(boss, sendPortalLinkTask);
  await registerFirmTask(boss, sendLoginCodeTask);
  // Offer waves and escalation for urgent gaps (messages through the configured transport).
  await registerFirmTask(boss, deps.offers?.wave ?? offerWaveTask, OFFER_WAVE_WORK_OPTIONS);
  await registerFirmTask(boss, deps.offers?.escalate ?? escalateShiftTask);
  // An offer the office sends to one worker (the dashboard's "Offer to someone").
  await registerFirmTask(boss, deps.offers?.office ?? officeOfferTask);
  // Telling workers the office changed or cancelled their booked shift (golden rule 12).
  await registerFirmTask(boss, deps.firmChangeNotices ?? firmChangeNoticeTask);
  // Telling a worker the office booked them onto a shift (audit L22).
  await registerFirmTask(boss, deps.shiftConfirmed ?? shiftConfirmedTask);
  await registerFirmTask(boss, deps.requestUpdates ?? requestUpdateTask);
  // The office's reply to a message on the shifts line (Enquiries, 12D.1).
  await registerFirmTask(boss, deps.enquiryReplies ?? enquiryReplyTask);
  // Telling a worker payroll has sorted their pay query.
  await registerFirmTask(boss, deps.payQueryUpdates ?? payQueryUpdateTask);
  // The link that confirms the strikes team's email (Settings, 12B.7).
  await registerFirmTask(boss, deps.strikesEmailLinks ?? strikesEmailLinkTask);
  // The evidence email to the strikes team, with the record's PDF (12C.4).
  await registerFirmTask(boss, deps.strikeEvidence ?? strikeEvidenceTask);
  // Answering WhatsApps on the shifts line (stored by the Twilio webhook).
  await registerInboundTask(boss, deps.inboundMessages ?? inboundMessageFirmTask);

  // The planner's webhooks (12J.2): each try knows whether it's the last (includeMetadata), and a
  // firm's deliveries never run two at once (WEBHOOK_WORK_OPTIONS).
  const webhooks = deps.webhooks ?? webhookDeliverTask;
  await boss.work(webhooks.queue, WEBHOOK_WORK_OPTIONS, (jobs) =>
    inOrder(jobs, (j) => runFirmTask(webhooks, j)),
  );

  // Shift reminders, 24 h and 2 h before the start: the tick queues a firm's job when one is due.
  await registerFirmTask(boss, deps.reminders ?? shiftRemindersTask);
  await boss.work(
    SHIFT_REMINDER_TICK_QUEUE,
    logFailures(SHIFT_REMINDER_TICK_QUEUE, async () => {
      await runShiftReminderTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
    }),
  );
  await boss.schedule(SHIFT_REMINDER_TICK_QUEUE, SHIFT_REMINDER_TICK_CRON);

  // Credential expiry: always on (messages go through the configured transport).
  await registerFirmTask(boss, credentialScanFirmTask);
  await boss.work(
    CREDENTIAL_SCAN_TICK_QUEUE,
    logFailures(CREDENTIAL_SCAN_TICK_QUEUE, async () => {
      await runCredentialScanTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
    }),
  );
  await boss.schedule(CREDENTIAL_SCAN_TICK_QUEUE, CREDENTIAL_SCAN_CRON, null, {
    tz: CREDENTIAL_SCAN_TZ,
  });

  // Pilot metrics: each firm's daily figures, recomputed for the last 7 days every night.
  await registerFirmTask(boss, metricsRollupFirmTask);
  await boss.work(
    METRICS_ROLLUP_TICK_QUEUE,
    logFailures(METRICS_ROLLUP_TICK_QUEUE, async () => {
      await runMetricsRollupTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
    }),
  );
  await boss.schedule(METRICS_ROLLUP_TICK_QUEUE, METRICS_ROLLUP_CRON, null, {
    tz: METRICS_ROLLUP_TZ,
  });

  // Travel estimates (12G.2): queued with the change that needs them, and every night for each
  // firm's sessions in the window. One at a time (TRAVEL_WORK_OPTIONS).
  await registerFirmTask(boss, deps.travelEstimates ?? travelEstimatesTask, TRAVEL_WORK_OPTIONS);
  await boss.work(
    TRAVEL_ESTIMATES_TICK_QUEUE,
    logFailures(TRAVEL_ESTIMATES_TICK_QUEUE, async () => {
      await runTravelEstimatesTick({
        listFirmIds,
        run: withFirm,
        clock: deps.clock ?? systemClock,
      });
    }),
  );
  await boss.schedule(TRAVEL_ESTIMATES_TICK_QUEUE, TRAVEL_ESTIMATES_CRON, null, {
    tz: TRAVEL_ESTIMATES_TZ,
  });

  // Retention (docs/compliance.md): each firm's old messages and login leftovers, every night.
  await registerFirmTask(boss, retentionPurgeFirmTask);
  await boss.work(
    RETENTION_PURGE_TICK_QUEUE,
    logFailures(RETENTION_PURGE_TICK_QUEUE, async () => {
      await runRetentionPurgeTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
    }),
  );
  await boss.schedule(RETENTION_PURGE_TICK_QUEUE, RETENTION_PURGE_CRON, null, {
    tz: RETENTION_PURGE_TZ,
  });

  // The payroll digest: each firm's new pay queries at its digest time (the tick checks every 5
  // minutes), or when payroll presses "Send the digest now".
  await registerFirmTask(boss, deps.payDigest ?? payDigestFirmTask);
  await boss.work(
    PAY_DIGEST_TICK_QUEUE,
    logFailures(PAY_DIGEST_TICK_QUEUE, async () => {
      await runPayDigestTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
    }),
  );
  await boss.schedule(PAY_DIGEST_TICK_QUEUE, PAY_DIGEST_TICK_CRON);

  // Alerts to the founder (src/lib/ops/): the tick every 5 minutes; each alert a job of its own.
  const alerts = deps.alerts ?? alertTransport(appEnv().ALERTS_TRANSPORT);
  await boss.work(
    OPS_ALERT_QUEUE,
    logFailures(OPS_ALERT_QUEUE, async (jobs: Job[]) => {
      const job = jobs[0];
      if (job) await sendOpsAlert(job.data, alerts);
    }),
  );
  await boss.work(
    OPS_ALERTS_TICK_QUEUE,
    logFailures(OPS_ALERTS_TICK_QUEUE, async () => {
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
    }),
  );
  await boss.schedule(OPS_ALERTS_TICK_QUEUE, OPS_ALERTS_CRON);

  if (deps.sheets) {
    const clock = deps.clock ?? systemClock;
    await registerFirmTask(boss, sheetsSyncTask(deps.sheets, clock));
    await boss.work(
      SHEETS_TICK_QUEUE,
      logFailures(SHEETS_TICK_QUEUE, async () => {
        await runSheetsTick({ listFirmIds, run: withFirm, clock });
      }),
    );
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

// The shifts line (inbound-message): answering a WhatsApp waits on the provider (a few hundred ms
// for Twilio, more for an AI label), so one loop answering one at a time would leave 200 messages
// a minute behind at the busiest moment. Here INBOUND_LOOPS loops each take a batch, and a sender's
// jobs (one group: src/lib/inbound/job.ts) never run two at once on this worker. The handler also
// answers a sender's older messages first (src/lib/inbound/reply.ts), so a STOP still comes before
// the text after it. tests/integration/inbound.load.test.ts holds the bound: 200 workers' messages
// answered within INBOUND_DRAIN_BOUND_MS of the last one arriving when each send takes 300 ms.
// With includeMetadata each job carries its retry limit, so the last try can pass the message to a
// person (src/lib/inbound/reply.ts).
export const INBOUND_LOOPS = 8;
export const INBOUND_DRAIN_BOUND_MS = 20_000;
export const INBOUND_WORK_OPTIONS = {
  ...FIRM_WORK_OPTIONS,
  includeMetadata: true,
  localConcurrency: INBOUND_LOOPS,
  localGroupConcurrency: 1,
} as const;

// The planner's webhooks (12J.2): like the shifts line, WEBHOOK_LOOPS loops, and one firm's
// deliveries (one group: src/lib/integrations/outbox.ts) never run two at once here, so an endpoint
// that hangs for its 10 seconds holds up only its own firm, using one loop of four. Unlike the
// shifts line, each loop takes one job at a time: pg-boss runs a fetched batch's jobs one after
// another, so a batch holding a hanging firm's job and another firm's would hold the other up too
// (tests/integration/webhooks.test.ts). With includeMetadata each job carries its retry limit, so
// the last try can log webhook.failed and complete (src/lib/integrations/deliver.ts).
export const WEBHOOK_LOOPS = 4;
export const WEBHOOK_WORK_OPTIONS = {
  perJobResults: true,
  batchSize: 1,
  includeMetadata: true,
  localConcurrency: WEBHOOK_LOOPS,
  localGroupConcurrency: 1,
} as const;

// The travel job (12G.2) runs for up to its budget (10 minutes). pg-boss times a batch out, and
// fails every job in it, at one job's expiry (15 minutes), so two long runs in one batch would fail
// both (and the abandoned one would carry on beside its retry). One job per fetch keeps each run
// inside its own expiry.
export const TRAVEL_WORK_OPTIONS = { ...FIRM_WORK_OPTIONS, batchSize: 1 } as const;

// Offer waves (P4.4): one per fetch. A wave runs for seconds (up to 50 messages, 4 at a time:
// src/lib/offers/waves.ts), and a fetched batch's other waves are marked taken (active) the whole
// time it runs: hidden from another worker process, and their expiry clock running. With this one
// worker process the next wave still waits for the one running (one loop), so this keeps the
// queue's state true rather than making waves run side by side. pg-boss never bursts at a batch of
// 1 (burstWhenBatchFull is ignored there), so the loop polls every half second (pg-boss's least)
// instead of every 2: a wave longer than 0.4 s is followed by the next at once, a shorter one waits
// at most 0.5 s, and a new urgent wave is picked up within half a second. That costs 2 small
// fetches a second on this queue (tests/integration/worker.hello.test.ts).
export const OFFER_WAVE_WORK_OPTIONS = {
  perJobResults: true,
  batchSize: 1,
  pollingIntervalSeconds: 0.5,
} as const;

type FirmWorkOptions =
  typeof FIRM_WORK_OPTIONS | typeof TRAVEL_WORK_OPTIONS | typeof OFFER_WAVE_WORK_OPTIONS;

// One after another, in the batch's order, one result per job.
export async function inOrder<J, R>(jobs: J[], run: (job: J) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const job of jobs) results.push(await run(job));
  return results;
}

// The shifts line's task (INBOUND_WORK_OPTIONS): each try knows whether it's the last.
export async function registerInboundTask<P extends FirmJobEnvelope>(
  boss: PgBoss,
  task: FirmTask<P>,
): Promise<void> {
  await boss.work(task.queue, INBOUND_WORK_OPTIONS, (jobs) =>
    inOrder(jobs, (j) => runFirmTask(task, j)),
  );
}

export async function registerFirmTask<P extends FirmJobEnvelope>(
  boss: PgBoss,
  task: FirmTask<P>,
  options: FirmWorkOptions = FIRM_WORK_OPTIONS,
): Promise<void> {
  await boss.work(task.queue, options, (jobs) => inOrder(jobs, (j) => runFirmTask(task, j)));
}

// Each job in a batch gets its own result, and each handler runs inside withFirm(firmId).
export async function registerFirmJob<P extends FirmJobEnvelope>(
  boss: PgBoss,
  job: FirmJob<P>,
): Promise<void> {
  await boss.work(job.queue, FIRM_WORK_OPTIONS, (jobs) => inOrder(jobs, (j) => runFirmJob(job, j)));
}

// A handler whose failures are logged (as a JSON error, through the masker) before pg-boss retries
// or fails the job: the ticks and the ops alerts. Firm jobs log their own (runFirmTask). Without
// it, pg-boss records a failed tick or alert and nothing reaches the log, so the e2e run's check of
// the servers' output (tests/e2e/server-output.ts) couldn't see it.
export function logFailures<A extends unknown[], R>(
  queue: string,
  handler: (...args: A) => Promise<R>,
  logger: Logger = log,
): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      logger.error("job failed", { queue, error });
      throw error;
    }
  };
}

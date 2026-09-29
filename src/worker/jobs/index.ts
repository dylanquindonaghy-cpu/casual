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
import { firmChangeNoticeTask, type FirmChangeNoticePayload } from "../../lib/notices/firm-change";
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
  escalateShiftJob,
  offerWaveJob,
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
import { HELLO_QUEUE, handleHello } from "./hello";
import { QUEUES } from "./queues";

export interface JobDeps {
  // Absent (SHEETS_TRANSPORT=none): no sheet is ever synced, and the tick is unscheduled.
  sheets?: SheetsClient;
  clock?: Clock;
  // Tests replace the offer jobs' transport and clock; the worker uses its configuration.
  offers?: {
    wave: FirmJob<OfferWavePayload>;
    escalate: FirmJob<EscalateShiftPayload>;
    office?: FirmJob<OfficeOfferPayload>;
  };
  reminders?: FirmTask<ShiftRemindersPayload>;
  firmChangeNotices?: FirmTask<FirmChangeNoticePayload>;
  requestUpdates?: FirmTask<RequestUpdatePayload>;
  payDigest?: FirmTask<PayDigestPayload>;
}

// Used by the worker process and by the integration tests, so both run the same wiring.
export async function registerJobs(boss: PgBoss, deps: JobDeps = {}): Promise<void> {
  for (const queue of QUEUES) await boss.createQueue(queue.name, queue.options);
  await registerFirmJob(boss, sendPortalLinkJob);
  await registerFirmJob(boss, sendLoginCodeJob);
  // Offer waves and escalation for urgent gaps (messages through the configured transport).
  await registerFirmJob(boss, deps.offers?.wave ?? offerWaveJob);
  await registerFirmJob(boss, deps.offers?.escalate ?? escalateShiftJob);
  // An offer the office sends to one worker (Today's "Offer to someone").
  await registerFirmJob(boss, deps.offers?.office ?? officeOfferJob);
  // Telling workers the office changed or cancelled their booked shift (golden rule 12).
  await registerFirmTask(boss, deps.firmChangeNotices ?? firmChangeNoticeTask);
  await registerFirmTask(boss, deps.requestUpdates ?? requestUpdateTask);

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

  // The payroll digest: each firm's new pay queries at its digest time (the tick checks every 5
  // minutes), or when payroll presses "Send the digest now".
  await registerFirmTask(boss, deps.payDigest ?? payDigestFirmTask);
  await boss.work(PAY_DIGEST_TICK_QUEUE, async () => {
    await runPayDigestTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
  });
  await boss.schedule(PAY_DIGEST_TICK_QUEUE, PAY_DIGEST_TICK_CRON);

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

export async function registerFirmTask<P extends FirmJobEnvelope>(
  boss: PgBoss,
  task: FirmTask<P>,
): Promise<void> {
  await boss.work(task.queue, { perJobResults: true }, (jobs) =>
    Promise.all(jobs.map((j) => runFirmTask(task, j))),
  );
}

// Each job in a batch gets its own result, and each handler runs inside withFirm(firmId).
export async function registerFirmJob<P extends FirmJobEnvelope>(
  boss: PgBoss,
  job: FirmJob<P>,
): Promise<void> {
  await boss.work(job.queue, { perJobResults: true }, (jobs) =>
    Promise.all(jobs.map((j) => runFirmJob(job, j))),
  );
}

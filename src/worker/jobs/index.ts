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
}

// Used by the worker process and by the integration tests, so both run the same wiring.
export async function registerJobs(boss: PgBoss, deps: JobDeps = {}): Promise<void> {
  for (const queue of QUEUES) await boss.createQueue(queue.name, queue.options);
  await registerFirmJob(boss, sendPortalLinkJob);
  await registerFirmJob(boss, sendLoginCodeJob);

  // Credential expiry: always on (messages go through the configured transport).
  await registerFirmTask(boss, credentialScanFirmTask);
  await boss.work(CREDENTIAL_SCAN_TICK_QUEUE, async () => {
    await runCredentialScanTick({ listFirmIds, run: withFirm, clock: deps.clock ?? systemClock });
  });
  await boss.schedule(CREDENTIAL_SCAN_TICK_QUEUE, CREDENTIAL_SCAN_CRON, null, {
    tz: CREDENTIAL_SCAN_TZ,
  });

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

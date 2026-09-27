import type { PgBoss } from "pg-boss";
import { sendLoginCodeJob } from "../../lib/auth/send-login-code";
import { sendPortalLinkJob } from "../../lib/auth/send-portal-link";
import { runFirmJob, type FirmJob, type FirmJobEnvelope } from "../../lib/jobs/firm-job";
import { HELLO_QUEUE, handleHello } from "./hello";
import { QUEUES } from "./queues";

// Used by the worker process and by the integration tests, so both run the same wiring.
export async function registerJobs(boss: PgBoss): Promise<void> {
  for (const queue of QUEUES) await boss.createQueue(queue.name, queue.options);
  await registerFirmJob(boss, sendPortalLinkJob);
  await registerFirmJob(boss, sendLoginCodeJob);

  await boss.work(HELLO_QUEUE, { perJobResults: true }, async (jobs) =>
    jobs.map((job) => ({
      id: job.id,
      status: "completed" as const,
      output: handleHello(job.data),
    })),
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

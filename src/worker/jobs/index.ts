import type { PgBoss } from "pg-boss";
import { HELLO_QUEUE, handleHello } from "./hello";

// Used by the worker process and by the integration tests, so both run the same wiring.
export async function registerJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(HELLO_QUEUE);
  await boss.work(HELLO_QUEUE, { perJobResults: true }, async (jobs) =>
    jobs.map((job) => ({
      id: job.id,
      status: "completed" as const,
      output: handleHello(job.data),
    })),
  );
}

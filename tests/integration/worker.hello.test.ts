import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBoss } from "@/worker/boss";
import { registerJobs } from "@/worker/jobs";
import { HELLO_QUEUE } from "@/worker/jobs/hello";
import { testDatabaseUrl } from "../setup/test-db";

async function waitForFinalState(boss: PgBoss, id: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await boss.getJobById(HELLO_QUEUE, id);
    if (job && ["completed", "failed", "cancelled"].includes(job.state)) return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`job ${id} did not finish within ${timeoutMs} ms`);
}

describe("worker (real pg-boss on the test database)", () => {
  let boss: PgBoss;

  beforeAll(async () => {
    boss = createBoss(testDatabaseUrl());
    await boss.start();
    await registerJobs(boss);
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
  });

  it("picks up a hello job and completes it with output", async () => {
    const id = await boss.send(HELLO_QUEUE, { name: "Acme" });
    expect(id).toBeTruthy();

    const job = await waitForFinalState(boss, id as string);
    expect(job.state).toBe("completed");
    expect(job.output).toEqual({ greeting: "hello Acme" });
  });

  it("fails a hello job with an invalid payload", async () => {
    const id = await boss.send(HELLO_QUEUE, { name: "" }, { retryLimit: 0 });
    const job = await waitForFinalState(boss, id as string);
    expect(job.state).toBe("failed");
  });
});

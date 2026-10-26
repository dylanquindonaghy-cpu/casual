import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ESCALATE_SHIFT_QUEUE,
  escalateShiftPayload,
  OFFER_WAVE_QUEUE,
  offerWavePayload,
} from "@/lib/offers/waves";
import { PAY_QUERY_UPDATE_QUEUE, payQueryUpdatePayload } from "@/lib/notices/pay-query-update";
import { inboundMessageJob } from "@/lib/inbound/job";
import { payDigestJob } from "@/lib/pay/digest";
import { createBoss } from "@/worker/boss";
import { OFFER_WAVE_WORK_OPTIONS, registerJobs } from "@/worker/jobs";
import { HELLO_QUEUE } from "@/worker/jobs/hello";
import { urls } from "../helpers/db";

async function waitForFinalState(boss: PgBoss, id: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await boss.getJobById(HELLO_QUEUE, id);
    if (job && ["completed", "failed", "cancelled"].includes(job.state)) return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`job ${id} did not finish within ${timeoutMs} ms`);
}

describe("worker (real pg-boss on the test database, as the jobs role)", () => {
  let boss: PgBoss;

  beforeAll(async () => {
    boss = createBoss(urls.jobs);
    await boss.start();
    // Offer jobs, a payroll digest and pay query notices that do nothing: this real worker mustn't
    // pick up another test file's queued jobs (it would message and write for them with the real
    // clock).
    await registerJobs(boss, {
      payDigest: { ...payDigestJob, task: async () => null },
      inboundMessages: { ...inboundMessageJob, task: async () => null },
      payQueryUpdates: {
        queue: PAY_QUERY_UPDATE_QUEUE,
        schema: payQueryUpdatePayload,
        task: async () => null,
      },
      offers: {
        wave: { queue: OFFER_WAVE_QUEUE, schema: offerWavePayload, task: async () => null },
        escalate: {
          queue: ESCALATE_SHIFT_QUEUE,
          schema: escalateShiftPayload,
          task: async () => null,
        },
      },
    });
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

  // Offer waves one per fetch (P4.4). pg-boss never bursts at a batch of 1, so at its 2-second poll
  // each short wave would start about 2 seconds after the one before (8 from first to last of 5); at
  // the waves' half-second poll, about half a second. On its own queue, so no other file's queued
  // jobs are in the way.
  it("a queue of short jobs under the offer waves' options starts each within a second of the one before", async () => {
    const queue = `waves-drain-${Date.now()}`;
    await boss.createQueue(queue);
    const started: number[] = [];
    await boss.work(queue, OFFER_WAVE_WORK_OPTIONS, async (jobs) => {
      started.push(...jobs.map(() => Date.now()));
      return jobs.map((j) => ({ id: j.id, status: "completed" as const }));
    });
    for (let i = 0; i < 5; i += 1) await boss.send(queue, { i });
    const deadline = Date.now() + 15_000;
    while (started.length < 5 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await boss.offWork(queue);
    await boss.deleteQueue(queue);
    expect(started).toHaveLength(5);
    const gaps = started.slice(1).map((at, i) => at - (started[i] ?? at));
    for (const gap of gaps) expect(gap).toBeLessThan(1_000);
    expect((started.at(-1) ?? 0) - (started[0] ?? 0)).toBeLessThan(4_000);
  }, 30_000);
});

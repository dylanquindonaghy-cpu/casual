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
import { registerJobs } from "@/worker/jobs";
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
});

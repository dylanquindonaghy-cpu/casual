import type { PgBoss } from "pg-boss";
import { describe, expect, it } from "vitest";
import { firmJobEnvelope, type FirmTask } from "@/lib/jobs/firm-job";
import { ESCALATE_SHIFT_QUEUE, OFFER_WAVE_QUEUE } from "@/lib/offers/waves";
import {
  FIRM_WORK_OPTIONS,
  inOrder,
  OFFER_WAVE_WORK_OPTIONS,
  registerFirmTask,
  registerJobs,
} from "@/worker/jobs";

// How the worker takes firm jobs (src/worker/jobs/index.ts): up to 5 per fetch, fetching again at
// once while fetches come back full (the load smoke's fix), and the jobs of a batch still one after
// another, in order: a worker's STOP is handled before their next text, as with one job per fetch.

const FIRM = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("firm jobs, taken in bursts and run in order", () => {
  it("up to 5 per fetch, and fetch again at once while a fetch comes back full", () => {
    expect(FIRM_WORK_OPTIONS).toEqual({
      perJobResults: true,
      batchSize: 5,
      burstWhenBatchFull: true,
    });
  });

  it("a batch runs one job at a time, in its order; one failing leaves the rest alone", async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const task: FirmTask<{ firmId: string; idempotencyKey: string }> = {
      queue: "test-queue",
      schema: firmJobEnvelope,
      task: async (payload) => {
        running += 1;
        most = Math.max(most, running);
        order.push(payload.idempotencyKey);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        if (payload.idempotencyKey === "fails") throw new Error("boom");
        return payload.idempotencyKey;
      },
    };
    let handler: ((jobs: { id: string; data: unknown }[]) => Promise<unknown>) | undefined;
    const boss = {
      work: async (_name: string, options: unknown, fn: typeof handler) => {
        expect(options).toEqual(FIRM_WORK_OPTIONS);
        handler = fn;
        return "worker-id";
      },
    } as unknown as PgBoss;
    await registerFirmTask(boss, task);
    const job = (id: string, key: string) => ({ id, data: { firmId: FIRM, idempotencyKey: key } });
    const results = (await handler?.([
      job("1", "stop"),
      job("2", "fails"),
      { id: "3", data: { not: "a payload" } },
      job("4", "why"),
    ])) as { id: string; status: string }[];
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ["1", "completed"],
      ["2", "failed"],
      ["3", "deadletter"],
      ["4", "completed"],
    ]);
    expect(order).toEqual(["stop", "fails", "why"]);
    expect(most).toBe(1);
  });

  it("offer waves one per fetch (P4.4), polled every half second", async () => {
    const options = new Map<string, unknown>();
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string, opts: unknown) => {
        options.set(name, opts);
        return "id";
      },
      schedule: async () => undefined,
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(boss);
    // One per fetch; pg-boss ignores burstWhenBatchFull at a batch of 1, so a half-second poll.
    expect(OFFER_WAVE_WORK_OPTIONS).toEqual({
      perJobResults: true,
      batchSize: 1,
      pollingIntervalSeconds: 0.5,
    });
    expect(options.get(OFFER_WAVE_QUEUE)).toEqual(OFFER_WAVE_WORK_OPTIONS);
    // The rest as before: escalation, say.
    expect(options.get(ESCALATE_SHIFT_QUEUE)).toEqual(FIRM_WORK_OPTIONS);
  });

  it("inOrder waits for each before starting the next", async () => {
    const seen: number[] = [];
    const out = await inOrder([30, 1, 10], async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      seen.push(ms);
      return ms * 2;
    });
    expect(seen).toEqual([30, 1, 10]);
    expect(out).toEqual([60, 2, 20]);
  });
});

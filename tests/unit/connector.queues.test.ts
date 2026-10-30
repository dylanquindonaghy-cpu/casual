import { describe, expect, it } from "vitest";
import { CONNECTOR_EVENT_QUEUE, CONNECTOR_RETRY_LIMIT } from "@/lib/connector/job";
import {
  CONNECTOR_PULL_EXPIRE_SECONDS,
  CONNECTOR_PULL_QUEUE,
  CONNECTOR_PULL_TICK_QUEUE,
  PULL_BUDGET_MS,
  PULL_LEASE_MS,
} from "@/lib/connector/pull";
import { CONNECTOR_PULL_WORK_OPTIONS, CONNECTOR_WORK_OPTIONS } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";

// The connector's queues (P5.3, P5.4; src/worker/jobs/queues.ts): an event's read is retried with
// each try knowing whether it's the last (or a failed event would never be saved as failed), one
// source's events never two at once; a pull stops itself, and is given up on, before its lease runs
// out.

const spec = (name: string) => QUEUES.find((q) => q.name === name);

describe("the connector's queues", () => {
  it("an event: 5 retries a minute apart and doubling, at most 30 minutes; each try knows if it's the last", () => {
    expect(spec(CONNECTOR_EVENT_QUEUE)?.options).toMatchObject({
      policy: "standard",
      retryLimit: CONNECTOR_RETRY_LIMIT,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 30 * 60,
    });
    expect(CONNECTOR_RETRY_LIMIT).toBe(5);
    expect(CONNECTOR_WORK_OPTIONS).toMatchObject({
      includeMetadata: true,
      localGroupConcurrency: 1,
      batchSize: 1,
    });
  });

  it("a pull: stops itself, then is given up on, before its lease runs out; never retried; one per fetch; its tick a plain cron queue", () => {
    expect(spec(CONNECTOR_PULL_QUEUE)?.options).toMatchObject({
      expireInSeconds: CONNECTOR_PULL_EXPIRE_SECONDS,
      retryLimit: 0,
    });
    expect(PULL_BUDGET_MS).toBeLessThan(CONNECTOR_PULL_EXPIRE_SECONDS * 1000);
    expect(CONNECTOR_PULL_EXPIRE_SECONDS * 1000).toBeLessThan(PULL_LEASE_MS);
    // pg-boss fails a whole batch at one job's expiry: one pull per fetch, two loops.
    expect(CONNECTOR_PULL_WORK_OPTIONS).toEqual({
      perJobResults: true,
      batchSize: 1,
      localConcurrency: 2,
    });
    expect(spec(CONNECTOR_PULL_TICK_QUEUE)?.options?.policy).toBe("standard");
  });
});

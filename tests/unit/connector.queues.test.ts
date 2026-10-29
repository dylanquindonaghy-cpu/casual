import { describe, expect, it } from "vitest";
import { CONNECTOR_EVENT_QUEUE, CONNECTOR_RETRY_LIMIT } from "@/lib/connector/job";
import {
  CONNECTOR_PULL_EXPIRE_SECONDS,
  CONNECTOR_PULL_QUEUE,
  CONNECTOR_PULL_TICK_QUEUE,
  PULL_LEASE_MS,
} from "@/lib/connector/pull";
import { CONNECTOR_WORK_OPTIONS } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";

// The connector's queues (P5.3, P5.4; src/worker/jobs/queues.ts): an event's read is retried with
// each try knowing whether it's the last (or a failed event would never be saved as failed), one
// source's events never two at once; a pull is given up on before its lease runs out.

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

  it("a pull: given up on before its lease runs out; its tick a plain cron queue", () => {
    expect(spec(CONNECTOR_PULL_QUEUE)?.options?.expireInSeconds).toBe(
      CONNECTOR_PULL_EXPIRE_SECONDS,
    );
    expect(CONNECTOR_PULL_EXPIRE_SECONDS * 1000).toBeLessThan(PULL_LEASE_MS);
    expect(spec(CONNECTOR_PULL_TICK_QUEUE)?.options?.policy).toBe("standard");
  });
});

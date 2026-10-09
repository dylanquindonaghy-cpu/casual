import { afterEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_EVERY_MS, startHeartbeat } from "@/worker/heartbeat";

// The worker's sign of life for its container's health check (deploy/docker-compose.yml reads the
// file's age: under a minute is healthy).

afterEach(() => vi.useRealTimers());

describe("the worker's heartbeat", () => {
  it("writes the time at once, then every 15 seconds, until stopped", () => {
    vi.useFakeTimers();
    const writes: [string, string][] = [];
    let t = 1000;
    const stop = startHeartbeat(
      "/tmp/x",
      (f, text) => writes.push([f, text]),
      () => t,
    );
    expect(writes).toEqual([["/tmp/x", "1000"]]);
    t = 16_000;
    vi.advanceTimersByTime(HEARTBEAT_EVERY_MS);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(["/tmp/x", "16000"]);
    stop();
    vi.advanceTimersByTime(HEARTBEAT_EVERY_MS * 4);
    expect(writes).toHaveLength(2);
    // Often enough that the health check's one-minute limit is never missed by a working worker.
    expect(HEARTBEAT_EVERY_MS).toBeLessThanOrEqual(20_000);
  });
});

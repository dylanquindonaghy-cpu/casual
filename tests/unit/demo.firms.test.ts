import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { seedFirms, seedId as seedDataSeedId } from "@/lib/db/admin/seed-data";
import { DEMO_FIRM_SLUGS, demoViewFor, isDemoFirm } from "@/lib/demo/firms";
import {
  assertDemoServer,
  NotADemoServer,
  watchDemoServer,
  type DemoServerChecks,
} from "@/lib/demo/guard";
import { seedId } from "@/lib/demo/seed-id";

// Which firms demo mode runs with (16.1; ADR-025), what it does on each firm's address, and the
// worker's check that only the demo firms and their made-up people are there.

const [acme, northline] = seedFirms(new Date("2026-10-20T09:00:00Z"));
const realFirm = "0f3c2b8e-9a41-4d7e-8b2a-5c6d7e8f9a0b";

describe("the demo firms", () => {
  it("are exactly the seed's made-up firms, by their fixed ids", () => {
    expect([...DEMO_FIRM_SLUGS]).toEqual(seedFirms().map((f) => f.slug));
    for (const f of seedFirms()) expect(isDemoFirm(f.id)).toBe(true);
    expect(isDemoFirm(realFirm)).toBe(false);
    expect(isDemoFirm("")).toBe(false);
  });

  it("the seed's ids come from the one shared function", () => {
    expect(seedDataSeedId).toBe(seedId);
    expect(acme?.id).toBe(seedId("firm/acme"));
    expect(northline?.id).toBe(seedId("firm/northline"));
  });
});

describe("what demo mode does on an address", () => {
  it("a demo firm's pages: the demo bar and the Demo phone; any other firm's: not served", () => {
    expect(demoViewFor("on", acme!.id)).toBe("demo");
    expect(demoViewFor("on", northline!.id)).toBe("demo");
    expect(demoViewFor("on", realFirm)).toBe("refused");
  });

  it("without demo mode, or on the platform's own address: as usual", () => {
    expect(demoViewFor(undefined, acme!.id)).toBe("off");
    expect(demoViewFor(undefined, realFirm)).toBe("off");
    expect(demoViewFor("on", null)).toBe("off");
  });
});

describe("the worker's check", () => {
  const checks = (ids: string[], real: Record<string, number> = {}): DemoServerChecks => ({
    listFirmIds: () => Promise.resolve(ids),
    realPeople: (firmId) => Promise.resolve(real[firmId] ?? 0),
  });

  it("passes with only demo firms of made-up people (or no firm yet)", async () => {
    await expect(assertDemoServer(checks([acme!.id, northline!.id]))).resolves.toBeUndefined();
    await expect(assertDemoServer(checks([acme!.id]))).resolves.toBeUndefined();
    await expect(assertDemoServer(checks([]))).resolves.toBeUndefined();
  });

  it("refuses when any firm isn't a demo firm, counting them without naming them", async () => {
    const one = assertDemoServer(checks([acme!.id, realFirm]));
    await expect(one).rejects.toBeInstanceOf(NotADemoServer);
    await expect(one).rejects.toThrow(/1 firm isn't one of the made-up demo firms/);
    await expect(
      assertDemoServer(checks([realFirm, "1d2e3f40-5a6b-4c7d-8e9f-a0b1c2d3e4f5"])),
    ).rejects.toThrow(/2 firms aren't/);
    const said = await assertDemoServer(checks([realFirm])).catch((err: unknown) => String(err));
    expect(said).not.toContain(realFirm);
  });

  it("refuses when anyone in a demo firm has a real number or email, counting them", async () => {
    await expect(assertDemoServer(checks([acme!.id], { [acme!.id]: 1 }))).rejects.toThrow(
      /1 person in the demo firms has a number or email that isn't made up/,
    );
    await expect(
      assertDemoServer(checks([acme!.id, northline!.id], { [acme!.id]: 2, [northline!.id]: 1 })),
    ).rejects.toThrow(/3 people in the demo firms have/);
  });

  it("checks again every minute: a firm added later stops it; a check that can't run doesn't, once", async () => {
    vi.useFakeTimers();
    try {
      let ids = [acme!.id];
      let fail = false;
      const watched: DemoServerChecks = {
        listFirmIds: () => (fail ? Promise.reject(new Error("db away")) : Promise.resolve(ids)),
        realPeople: () => Promise.resolve(0),
      };
      const stop = vi.fn();
      const missed = vi.fn();
      const end = watchDemoServer(watched, { stop, missed }, 60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stop).not.toHaveBeenCalled();
      fail = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(missed).toHaveBeenCalledTimes(1);
      expect(stop).not.toHaveBeenCalled();
      fail = false;
      ids = [acme!.id, realFirm];
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(stop.mock.calls[0]?.[0]).toBeInstanceOf(NotADemoServer);
      end();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never runs unchecked: three checks in a row that can't run stop it", async () => {
    vi.useFakeTimers();
    try {
      let fail = true;
      const watched: DemoServerChecks = {
        listFirmIds: () =>
          fail ? Promise.reject(new Error("db away")) : Promise.resolve([acme!.id]),
        realPeople: () => Promise.resolve(0),
      };
      const stop = vi.fn();
      const missed = vi.fn();
      const end = watchDemoServer(watched, { stop, missed }, 60_000);
      // Two misses, then a check that runs: the count starts again.
      await vi.advanceTimersByTimeAsync(120_000);
      fail = false;
      await vi.advanceTimersByTimeAsync(60_000);
      fail = true;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(missed).toHaveBeenCalledTimes(4);
      expect(stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(String(stop.mock.calls[0]?.[0])).toMatch(/its checks couldn't run 3 times in a row/);
      end();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the worker checks before its first job, then refuses other firms' jobs between checks", () => {
    const source = readFileSync(join(process.cwd(), "src/worker/index.ts"), "utf8");
    const check = source.indexOf("await assertDemoServer(checks);");
    const only = source.indexOf("onlyRunJobsFor(isDemoFirm);");
    const watch = source.indexOf("watchDemoServer(checks, {");
    const start = source.indexOf("await boss.start();");
    expect(check).toBeGreaterThan(-1);
    expect(source.slice(source.indexOf('if (env.DEMO_MODE === "on") {'), check)).toContain(
      "realPeople: (firmId) => withFirm(firmId, realPeopleIn)",
    );
    expect(only).toBeGreaterThan(check);
    expect(watch).toBeGreaterThan(only);
    expect(start).toBeGreaterThan(watch);
    // A stop really stops it: the process ends (its container can't start again while it fails).
    const stop = source.slice(watch, start);
    expect(stop.slice(stop.indexOf("stop: (err) => {"), stop.indexOf("missed:"))).toContain(
      "process.exit(1);",
    );
  });
});

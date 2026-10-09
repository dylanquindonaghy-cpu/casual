import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webHealthy } from "@/lib/db/health";
import { appRolePool } from "../helpers/db";

// GET /api/health (src/app/api/health/route.ts, src/lib/db/health.ts; Phase 8): Docker's health
// check. Healthy only when the web app reaches its database as the app role; nothing more is said.

let app: Pool;

beforeAll(() => {
  app = appRolePool(2);
});
afterAll(async () => {
  await app.end();
});

describe("the web app's health", () => {
  it("healthy when the database answers, as the app role", async () => {
    expect(await webHealthy(app)).toBe(true);
  });

  it("not healthy when the database can't be reached (quickly, not hanging)", async () => {
    const nowhere = new Pool({
      connectionString: "postgres://shiftdesk_app:x@127.0.0.1:1/shiftdesk",
      max: 1,
      connectionTimeoutMillis: 500,
    });
    try {
      const started = Date.now();
      expect(await webHealthy(nowhere, 2000)).toBe(false);
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      await nowhere.end();
    }
  });
});

describe("the public answer is reused briefly, and never checked twice at once", () => {
  it("many calls at once make one check; within 5 seconds, none; after, a fresh one", async () => {
    const { createHealthCache } = await import("@/lib/db/health");
    let checks = 0;
    let clock = 1_000;
    let release: (ok: boolean) => void = () => undefined;
    const cache = createHealthCache(
      () =>
        new Promise<boolean>((resolve) => {
          checks += 1;
          release = resolve;
        }),
      5000,
      () => clock,
    );
    const together = Promise.all([cache(), cache(), cache()]);
    release(false);
    expect(await together).toEqual([false, false, false]);
    expect(checks).toBe(1);
    clock += 4_999;
    expect(await cache()).toBe(false);
    expect(checks).toBe(1);
    clock += 2;
    const fresh = cache();
    release(true);
    expect(await fresh).toBe(true);
    expect(checks).toBe(2);
  });
});

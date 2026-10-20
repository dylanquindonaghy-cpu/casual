import { beforeEach, describe, expect, it, vi } from "vitest";

// The health check on a demo server (16.2; src/lib/demo/gate.ts): with no password set, the web app
// turns every request away, so it reports itself unhealthy and the deploy says so, instead of
// "healthy" for a site nobody can use. The settings and the database check are stand-ins here; the
// database side is tests/integration/health.test.ts.

const settings = vi.hoisted(() => ({
  current: { NODE_ENV: "production", DEMO_MODE: "on" } as Record<string, string | undefined>,
}));
vi.mock("@/lib/env", () => ({ appEnv: () => settings.current }));
vi.mock("@/lib/db/health", () => ({ webHealth: async () => true }));

const { GET } = await import("@/app/api/health/route");

describe("the health check on a demo server", () => {
  beforeEach(() => {
    settings.current = { NODE_ENV: "production", DEMO_MODE: "on" };
  });

  it("unhealthy with no password set, though the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("healthy with its password, and on any server without demo mode", async () => {
    settings.current = { ...settings.current, DEMO_SITE_PASSWORD: "made-up-demo-password" };
    expect((await GET()).status).toBe(200);
    settings.current = { NODE_ENV: "production" };
    expect((await GET()).status).toBe(200);
  });
});

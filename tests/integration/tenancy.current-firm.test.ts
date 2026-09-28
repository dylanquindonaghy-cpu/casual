import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getCurrentFirm, withCurrentFirm } from "@/lib/tenancy/current-firm";
import { superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// getCurrentFirm() and withCurrentFirm() as pages and actions call them: the request's headers
// are the only stand-in (next/headers needs a live request), everything else is real.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));

const BASE = "localhost:3000";
let su: Pool;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  su = superuserPool();
  A = await createTenant(su);
  B = await createTenant(su);
});
afterAll(async () => {
  await su.end();
});

const on = (host: string, extra: Record<string, string> = {}) => {
  request.headers = new Headers({ host, ...extra });
};
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

describe("getCurrentFirm", () => {
  it("each firm's subdomain gives that firm, one request after another", async () => {
    on(`${A.slug}.${BASE}`);
    expect((await getCurrentFirm()).id).toBe(A.firmId);
    on(`${B.slug}.${BASE}`);
    expect((await getCurrentFirm()).id).toBe(B.firmId);
  });

  it("ignores X-Forwarded-Host pointing at another firm", async () => {
    on(`${A.slug}.${BASE}`, { "x-forwarded-host": `${B.slug}.${BASE}` });
    expect((await getCurrentFirm()).id).toBe(A.firmId);
  });

  it.each([
    ["an unknown firm", `nobody-here.${BASE}`],
    ["the home page", BASE],
    ["a host we don't serve", "evil.example:3000"],
  ])("shows the 404 page for %s", async (_label, host) => {
    on(host);
    await expect(getCurrentFirm()).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("withCurrentFirm", () => {
  it("runs inside the request's firm, so RLS shows only that firm's rows", async () => {
    on(`${A.slug}.${BASE}`);
    const seen = await withCurrentFirm(async (tx, firm) => {
      const r = await tx.execute<{ firm: string; workers: number }>(
        sql`select app_current_firm_id() as firm, (select count(*)::int from workers) as workers`,
      );
      return { ...r.rows[0], name: firm.name };
    });
    // Ground truth as the superuser: Firm A's own workers, and more than that across all firms.
    const truth = await su.query<{ mine: number; total: number }>(
      `select (select count(*)::int from workers where firm_id = $1) as mine,
              (select count(*)::int from workers) as total`,
      [A.firmId],
    );
    const { mine, total } = truth.rows[0] ?? { mine: -1, total: -1 };
    expect(mine).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(mine);
    expect(seen).toEqual({ firm: A.firmId, workers: mine, name: `Test Firm ${A.slug}` });
  });

  it("never opens a firm transaction for a host that isn't a firm", async () => {
    on("evil.example:3000");
    const fn = vi.fn(async () => "ran");
    await expect(withCurrentFirm(fn)).rejects.toMatchObject(NOT_FOUND);
    expect(fn).not.toHaveBeenCalled();
  });
});

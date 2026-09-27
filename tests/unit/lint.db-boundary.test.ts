import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// The ESLint rule that keeps app code on withFirm(): the raw pool, the owner connection and the
// pg driver can't be imported from app code in any spelling, including dynamic import().

const eslint = new ESLint({ cwd: process.cwd() });
const BOUNDARY_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function boundaryErrors(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId && BOUNDARY_RULES.has(m.ruleId)).length;
}

describe("database import boundary", () => {
  it.each([
    ["src/app/x.ts", 'import { Pool } from "pg";'],
    ["src/app/x.ts", 'import { drizzle } from "drizzle-orm/node-postgres";'],
    ["src/app/x.ts", 'import { appPool } from "@/lib/db/pool";'],
    ["src/app/x.ts", 'import { appPool } from "../lib/db/pool";'],
    ["src/app/admin/x.ts", 'import { appPool } from "../../lib/db/pool.ts";'],
    ["src/app/x.ts", 'import { runMigrations } from "@/lib/db/admin/migrate";'],
    ["src/worker/x.ts", 'import { runMigrations } from "../lib/db/admin/migrate";'],
    ["src/lib/auth/x.ts", 'export * from "../db/pool";'],
    ["src/lib/x.ts", 'import { runMigrations } from "./db/admin/migrate";'],
    ["src/lib/auth/x.ts", 'export const m = await import("../db/admin");'],
    ["src/app/x.ts", 'export const m = await import("@/lib/db/admin/migrate");'],
    ["src/app/x.ts", 'export const pg = await import("pg");'],
    ["src/app/x.ts", 'import { Client } from "pg/lib/client";'],
    ["src/app/x.ts", 'import Pool from "pg-pool";'],
    ["src/app/x.ts", 'import { NodePgSession } from "drizzle-orm/node-postgres/session";'],
    ["src/app/x.ts", 'import { drizzle } from "drizzle-orm/postgres-js";'],
    ["src/app/x.ts", 'const pg = require("pg"); export default pg;'],
    ["src/app/x.ts", 'import { PgBoss } from "pg-boss";'],
    ["src/lib/auth/x.ts", 'export const b = await import("pg-boss");'],
    ["src/app/x.ts", 'import { adminEnv } from "@/lib/env";'],
    ["src/lib/auth/x.ts", 'import { parseAdminEnv } from "../env";'],
    ["src/worker/x.ts", 'import { adminEnv } from "../lib/env";'],
    ["src/worker/x.ts", 'import { Pool } from "pg";'],
    ["src/app/login/actions.ts", 'import { withFirm } from "@/lib/db/scoped";'],
    ["src/app/office/page.tsx", 'import { createWithFirm } from "../../lib/db/scoped";'],
    ["src/app/x.ts", 'import { Pool } from "pg";'],
    ["src/app/login/actions.ts", 'export const m = await import("pg");'],
    ["src/app/session-actions.ts", 'const pg = require("pg"); export default pg;'],
  ])("blocks %s: %s", async (filePath, code) => {
    expect(await boundaryErrors(code, filePath)).toBeGreaterThan(0);
  });

  it.each([
    ["src/app/x.ts", 'import { withCurrentFirm } from "@/lib/tenancy/current-firm";'],
    ["src/app/x.ts", 'import type { FirmTx } from "@/lib/db/scoped";'],
    ["src/lib/auth/x.ts", 'import { withFirm } from "@/lib/db/scoped";'],
    ["src/app/x.ts", 'import { resolveFirmBySlug } from "@/lib/db/directory";'],
    ["src/app/x.ts", 'import { appEnv } from "@/lib/env";'],
    ["src/app/x.ts", 'import { sendFirmJob } from "@/lib/jobs/firm-job";'],
    ["src/worker/x.ts", 'import { PgBoss } from "pg-boss";'],
    ["src/lib/jobs/x.ts", 'import { fromDrizzle } from "pg-boss";'],
    ["src/lib/db/scoped.ts", 'import { appPool } from "./pool";'],
    ["scripts/x.ts", 'import { runMigrations } from "../src/lib/db/admin/migrate";'],
    ["tests/x.ts", 'import { Pool } from "pg";'],
  ])("allows %s: %s", async (filePath, code) => {
    expect(await boundaryErrors(code, filePath)).toBe(0);
  });
});

describe("server actions and redirects", () => {
  it.each([
    ["src/app/l/actions.ts", 'import { redirect } from "next/navigation";'],
    ["src/app/session-actions.ts", 'import { permanentRedirect } from "next/navigation";'],
  ])("blocks redirect in %s", async (filePath, code) => {
    const [result] = await eslint.lintText(code, { filePath });
    expect(result?.messages.some((m) => /don't redirect/.test(m.message))).toBe(true);
  });

  it("pages may still redirect while rendering", async () => {
    const [result] = await eslint.lintText('import { redirect } from "next/navigation";', {
      filePath: "src/app/login/page.tsx",
    });
    expect(result?.messages.some((m) => /don't redirect/.test(m.message))).toBe(false);
  });
});

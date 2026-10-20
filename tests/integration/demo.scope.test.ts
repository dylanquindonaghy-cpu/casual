import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiKeyHash, apiKeyHint, newApiKey } from "@/lib/integrations/keys";
import { superuserPool } from "../helpers/db";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// In demo mode the app's own look-ups know the made-up demo firms alone (16.1; ADR-025;
// src/lib/demo/scope.ts): on the real database, a firm that isn't a demo firm isn't found by its
// address, its shifts line's number or one of its planner keys, so its pages, server actions, route
// handlers (each starts at getCurrentFirm()), webhooks and planner calls are all not found. The
// same firm is found without demo mode. The look-ups are the app's own (src/lib/db/directory.ts),
// loaded afresh with the settings each case needs.

let su: Pool;
let firm: Tenant;
let line: string;
let keyHash: Buffer;

beforeAll(async () => {
  su = superuserPool();
  firm = await createTenant(su);
  // Ofcom's drama range for Leeds: a number nobody has.
  line = `+44113496${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  await su.query("update firms set shifts_line_e164 = $2 where id = $1", [firm.firmId, line]);
  const key = newApiKey();
  keyHash = apiKeyHash(key);
  await su.query(
    `insert into api_keys (firm_id, label, token_hash, hint, created_by)
     values ($1, 'Planner', $2, $3, $4)`,
    [firm.firmId, keyHash, apiKeyHint(key), firm.officeUserId],
  );
});
afterAll(async () => {
  await su.query("update firms set shifts_line_e164 = null where id = $1", [firm.firmId]);
  await su.end();
});

// The app's directory, loaded afresh with demo mode on or off (the settings are read once per
// load). Demo mode needs an outbox file; in tests it needs no site password.
async function directoryWith(demoMode: "on" | "") {
  const saved = { DEMO_MODE: process.env.DEMO_MODE, OUTBOX: process.env.CONSOLE_OUTBOX_FILE };
  process.env.DEMO_MODE = demoMode;
  process.env.CONSOLE_OUTBOX_FILE = ".dev/demo-scope-test.jsonl";
  vi.resetModules();
  try {
    // Read now, while these are the settings (they're read once, on first use).
    (await import("@/lib/env")).appEnv();
    const directory = await import("@/lib/db/directory");
    const { firmForHost } = await import("@/lib/tenancy/firm");
    return { directory, firmForHost };
  } finally {
    process.env.DEMO_MODE = saved.DEMO_MODE;
    if (saved.OUTBOX === undefined) delete process.env.CONSOLE_OUTBOX_FILE;
    else process.env.CONSOLE_OUTBOX_FILE = saved.OUTBOX;
  }
}

describe("the app's firm look-ups", () => {
  it("in demo mode, a firm that isn't a demo firm isn't found: address, shifts line, planner key", async () => {
    const { directory, firmForHost } = await directoryWith("on");
    expect(await directory.resolveFirmBySlug(firm.slug)).toBeNull();
    expect(await firmForHost(`${firm.slug}.localhost:3000`, "localhost:3000")).toBeNull();
    expect(await directory.resolveFirmByLine(line)).toBeNull();
    expect(await directory.resolveApiKey(keyHash)).toBeNull();
    // The worker's check still sees every firm (it's what stops a demo server holding this one).
    expect(await directory.listFirmIds()).toContain(firm.firmId);
  });

  it("without demo mode, the same firm is found by each", async () => {
    const { directory, firmForHost } = await directoryWith("");
    expect((await directory.resolveFirmBySlug(firm.slug))?.id).toBe(firm.firmId);
    expect((await firmForHost(`${firm.slug}.localhost:3000`, "localhost:3000"))?.id).toBe(
      firm.firmId,
    );
    expect((await directory.resolveFirmByLine(line))?.id).toBe(firm.firmId);
    expect((await directory.resolveApiKey(keyHash))?.firmId).toBe(firm.firmId);
  });
});

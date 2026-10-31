import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKeyDirectory, type ResolveApiKey } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { apiKeyHash, MAX_LIVE_KEYS } from "@/lib/integrations/keys";
import {
  createApiKey,
  integrationsPage,
  revokeApiKey,
  type CreateApiKeyResult,
} from "@/lib/office/integrations";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Integrations (12J.1; docs/office-v2.md 5.3.2 "Keys and tenancy", 5.3.4) on the real database, as
// the app role, with a fixed clock (NOW is Monday 2 November 2026, 09:00 London): an admin creates
// a planner's API key (returned once, in the answer; only its sha256 and last 4 characters stored;
// `api_key.created` {keyId} logged), at most 10 live per firm, refused by Gate B on a live database
// until the firm's agreement is recorded; revokes one (it stops resolving at once); everything is
// for admins only and checked inside the firm's transaction; one firm never sees or touches
// another's keys.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let lookUp: ResolveApiKey;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
  lookUp = createKeyDirectory(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const clock = { now: () => NOW };
const KEY_SHAPE = /^shiftdesk_[A-Za-z0-9_-]{43}$/;

async function keysFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const ctx = (officeUserId: string, o: { localDatabase?: boolean } = {}) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock,
    ...o,
  });
  const create = async (label = "Event planner", by = admin, o: { localDatabase?: boolean } = {}) =>
    createApiKey(ctx(by, o), { label });
  const created = async (label = "Event planner") => {
    const result = await create(label);
    if (result.status !== "created") throw new Error(`not created: ${result.status}`);
    return result;
  };
  const rows = async () =>
    (
      await su.query<{
        id: string;
        label: string;
        token_hash: Buffer;
        hint: string;
        created_by: string;
        revoked_by: string | null;
        revoked_at: Date | null;
        last_used_at: Date | null;
      }>(
        `select id::text, label, token_hash, hint, created_by::text, revoked_by::text, revoked_at,
                last_used_at
           from api_keys where firm_id = $1 order by created_at, id`,
        [f.firmId],
      )
    ).rows;
  const logged = async (action: string) =>
    (
      await su.query<{
        actor_type: string;
        actor_id: string | null;
        entity_type: string;
        entity_id: string | null;
        data: Record<string, unknown>;
      }>(
        `select actor_type, actor_id::text, entity_type, entity_id::text, data from events
          where firm_id = $1 and action = $2 order by id`,
        [f.firmId, action],
      )
    ).rows;
  return { f, admin, ctx, create, created, rows, logged };
}

describe("creating a key", () => {
  it("returns the key once, stores only its sha256 and last 4 characters, and logs the key's id only", async () => {
    const t = await keysFirm();
    const result = await t.created("  Event planner  ");
    expect(result.key).toMatch(KEY_SHAPE);
    expect(result).toEqual({
      status: "created",
      keyId: expect.any(String),
      key: result.key,
      label: "Event planner",
      hint: result.key.slice(-4),
    });
    const [row] = await t.rows();
    expect(row).toMatchObject({
      id: result.keyId,
      label: "Event planner",
      hint: result.key.slice(-4),
      created_by: t.admin,
      revoked_by: null,
      revoked_at: null,
      last_used_at: null,
    });
    expect(row?.token_hash.equals(createHash("sha256").update(result.key, "utf8").digest())).toBe(
      true,
    );
    expect(row?.token_hash.equals(apiKeyHash(result.key))).toBe(true);
    // The key itself is nowhere in the database: not in its row, not in the action log.
    const holding = async (secret: string) =>
      (
        await su.query<{ n: number }>(
          `select (select count(*) from api_keys k
                    where k.firm_id = $1 and strpos(row_to_json(k)::text, $2) > 0)::int
                + (select count(*) from events e
                    where e.firm_id = $1 and strpos(row_to_json(e)::text, $2) > 0)::int as n`,
          [t.f.firmId, secret],
        )
      ).rows[0]?.n;
    expect(await holding(result.key)).toBe(0);
    expect(await holding(result.key.slice("shiftdesk_".length))).toBe(0);
    // (The check itself finds what it looks for: the key's id is in both.)
    expect(await holding(result.keyId)).toBe(2);
    expect(await t.logged("api_key.created")).toEqual([
      {
        actor_type: "office",
        actor_id: t.admin,
        entity_type: "api_key",
        entity_id: result.keyId,
        data: { keyId: result.keyId },
      },
    ]);
    // The new key works at once: the look-up before a firm is known finds this firm and key.
    expect(await lookUp(apiKeyHash(result.key))).toEqual({
      firmId: t.f.firmId,
      keyId: result.keyId,
    });
  });

  it("the page lists it by name, last 4 characters and who made it: never the key or its hash", async () => {
    const t = await keysFirm();
    const result = await t.created();
    const page = await integrationsPage(t.ctx(t.admin));
    expect(page?.keys).toEqual([
      {
        id: result.keyId,
        label: "Event planner",
        hint: result.key.slice(-4),
        createdBy: "Office Person",
        createdAt: expect.any(Date),
        lastUsedAt: null,
      },
    ]);
    const json = JSON.stringify(page);
    expect(json).not.toContain(result.key);
    expect(json).not.toContain(result.key.slice(0, -4));
    expect(json).not.toMatch(/tokenHash|token_hash/);
  });

  it("a name that's empty, too long or not text is refused, and nothing is stored or logged", async () => {
    const t = await keysFirm();
    for (const label of ["", "   ", "x".repeat(61), "Event\nplanner"]) {
      expect(await t.create(label)).toEqual({ status: "invalid" });
    }
    expect(await createApiKey(t.ctx(t.admin), { label: 42 })).toEqual({ status: "invalid" });
    expect(await createApiKey(t.ctx(t.admin), { label: "P", firmId: "x" })).toEqual({
      status: "invalid",
    });
    expect(await t.rows()).toEqual([]);
    expect(await t.logged("api_key.created")).toEqual([]);
  });

  it("at most 10 live keys: the 11th is refused; revoking one makes room", async () => {
    const t = await keysFirm();
    const made: Extract<CreateApiKeyResult, { status: "created" }>[] = [];
    for (let i = 0; i < MAX_LIVE_KEYS; i += 1) made.push(await t.created(`Key ${i + 1}`));
    expect(await t.create("Key 11")).toEqual({ status: "too_many" });
    expect(await t.rows()).toHaveLength(MAX_LIVE_KEYS);
    expect(await t.logged("api_key.created")).toHaveLength(MAX_LIVE_KEYS);
    expect(await revokeApiKey(t.ctx(t.admin), { keyId: made[0]?.keyId })).toEqual({
      status: "revoked",
    });
    expect((await t.create("Key 11")).status).toBe("created");
    expect(await t.create("Key 12")).toEqual({ status: "too_many" });
    // A revoked row stays (its id is the actor on every change the key made).
    expect(await t.rows()).toHaveLength(MAX_LIVE_KEYS + 1);
  });

  it("two admins creating at once with 9 live keys: one gets the 10th, the other is refused", async () => {
    const t = await keysFirm();
    const other = await t.f.office("admin");
    for (let i = 0; i < MAX_LIVE_KEYS - 1; i += 1) await t.created(`Key ${i + 1}`);
    const results = await Promise.all([t.create("A", t.admin), t.create("B", other)]);
    expect(results.map((r) => r.status).sort()).toEqual(["created", "too_many"]);
    const live = (await t.rows()).filter((r) => r.revoked_at === null);
    expect(live).toHaveLength(MAX_LIVE_KEYS);
  });

  it("Gate B: on a live database, no key until the firm's agreement is recorded", async () => {
    const t = await keysFirm();
    expect(await t.create("Event planner", t.admin, { localDatabase: false })).toEqual({
      status: "agreement_needed",
    });
    expect(await t.rows()).toEqual([]);
    expect(await t.logged("api_key.created")).toEqual([]);
    await su.query("update firms set agreement_signed_on = '2026-10-01' where id = $1", [
      t.f.firmId,
    ]);
    const result = await t.create("Event planner", t.admin, { localDatabase: false });
    expect(result.status).toBe("created");
    // On this machine (the default here) the check doesn't apply.
    const local = await keysFirm();
    expect((await local.create()).status).toBe("created");
  });
});

describe("revoking a key", () => {
  it("stamps who and when, logs the key's id only, and the key stops resolving at once", async () => {
    const t = await keysFirm();
    const result = await t.created();
    const other = await t.created("Zapier");
    expect(await revokeApiKey(t.ctx(t.admin), { keyId: result.keyId })).toEqual({
      status: "revoked",
    });
    const [row, kept] = await t.rows();
    expect(row).toMatchObject({ revoked_by: t.admin, revoked_at: NOW, label: "Event planner" });
    expect(kept).toMatchObject({ revoked_by: null, revoked_at: null });
    expect(await t.logged("api_key.revoked")).toEqual([
      {
        actor_type: "office",
        actor_id: t.admin,
        entity_type: "api_key",
        entity_id: result.keyId,
        data: { keyId: result.keyId },
      },
    ]);
    expect(await lookUp(apiKeyHash(result.key))).toBeNull();
    expect(await lookUp(apiKeyHash(other.key))).toEqual({
      firmId: t.f.firmId,
      keyId: other.keyId,
    });
    // The page lists live keys only.
    expect((await integrationsPage(t.ctx(t.admin)))?.keys.map((k) => k.id)).toEqual([other.keyId]);
  });

  it("already revoked, unknown or malformed: says so and changes nothing", async () => {
    const t = await keysFirm();
    const result = await t.created();
    await revokeApiKey(t.ctx(t.admin), { keyId: result.keyId });
    expect(await revokeApiKey(t.ctx(t.admin), { keyId: result.keyId })).toEqual({
      status: "already_revoked",
    });
    expect(
      await revokeApiKey(t.ctx(t.admin), { keyId: "00000000-0000-4000-8000-000000000999" }),
    ).toEqual({ status: "not_found" });
    expect(await revokeApiKey(t.ctx(t.admin), { keyId: "not-a-key" })).toEqual({
      status: "not_found",
    });
    expect(await revokeApiKey(t.ctx(t.admin), { keyId: result.keyId, extra: 1 })).toEqual({
      status: "not_found",
    });
    expect(await t.logged("api_key.revoked")).toHaveLength(1);
  });
});

describe("admins only, checked inside the firm's transaction", () => {
  it("a resourcer, payroll or a turned-off admin can't see the page, create or revoke", async () => {
    const t = await keysFirm();
    const result = await t.created();
    const others = [
      await t.f.office("resourcer"),
      await t.f.office("payroll"),
      await t.f.office("admin", "disabled"),
    ];
    for (const who of others) {
      expect(await integrationsPage(t.ctx(who))).toBeNull();
      expect(await t.create("Sneaky", who)).toEqual({ status: "not_allowed" });
      expect(await revokeApiKey(t.ctx(who), { keyId: result.keyId })).toEqual({
        status: "not_allowed",
      });
    }
    expect(await t.rows()).toHaveLength(1);
    expect((await t.rows())[0]?.revoked_at).toBeNull();
    expect(await t.logged("api_key.revoked")).toEqual([]);
  });

  it("an admin who lost the role since the page loaded is refused by the check in the transaction", async () => {
    const t = await keysFirm();
    await su.query("update office_users set role = 'resourcer' where id = $1", [t.admin]);
    expect(await t.create()).toEqual({ status: "not_allowed" });
    expect(await t.rows()).toEqual([]);
  });
});

describe("one firm never sees or touches another's keys", () => {
  it("another firm's admin can't list or revoke them, and their 10 don't count against it", async () => {
    const a = await keysFirm();
    const b = await keysFirm();
    const made: string[] = [];
    for (let i = 0; i < MAX_LIVE_KEYS; i += 1) made.push((await a.created(`A ${i + 1}`)).keyId);
    expect((await integrationsPage(b.ctx(b.admin)))?.keys).toEqual([]);
    // Firm A's admin acting in firm B is no office user there.
    expect(await integrationsPage(b.ctx(a.admin))).toBeNull();
    expect(await revokeApiKey(b.ctx(b.admin), { keyId: made[0] })).toEqual({
      status: "not_found",
    });
    expect((await a.rows())[0]?.revoked_at).toBeNull();
    expect((await b.create()).status).toBe("created");
    expect(await a.rows()).toHaveLength(MAX_LIVE_KEYS);
    expect(await b.rows()).toHaveLength(1);
  });
});

describe("the page", () => {
  it("Your planner: not connected, then the Google Sheet, then the API while a key is live", async () => {
    const t = await keysFirm();
    const planner = async () => (await integrationsPage(t.ctx(t.admin)))?.planner;
    expect(await planner()).toEqual({ kind: "none" });
    await t.f.sheetSource(null);
    expect(await planner()).toEqual({ kind: "sheet", syncedAt: null });
    await su.query("update roster_sources set last_synced_at = $2 where firm_id = $1", [
      t.f.firmId,
      NOW,
    ]);
    expect(await planner()).toEqual({ kind: "sheet", syncedAt: NOW });
    // A change from the planner (logged with via "api", as the API logs every change).
    const result = await t.created();
    const at = new Date(NOW.getTime() - 19 * 60_000);
    const log = (when: Date) =>
      su.query(
        `insert into events (firm_id, actor_type, action, entity_type, data, created_at)
         values ($1, 'system', 'shift.changed', 'shift', $2, $3)`,
        [t.f.firmId, JSON.stringify({ by: "firm", via: "api", keyId: result.keyId }), when],
      );
    await log(new Date(at.getTime() - 60 * 60_000));
    await log(at);
    expect(await planner()).toEqual({ kind: "api", lastChangeAt: at });
    // Another firm's planner changes don't count.
    const other = await keysFirm();
    await other.created();
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, data)
       values ($1, 'system', 'shift.changed', 'shift', '{"by":"firm","via":"api"}')`,
      [other.f.firmId],
    );
    expect((await integrationsPage(other.ctx(other.admin)))?.planner).toMatchObject({
      kind: "api",
    });
    expect(await planner()).toEqual({ kind: "api", lastChangeAt: at });
    // Every key revoked: the planner isn't connected by API any more.
    await revokeApiKey(t.ctx(t.admin), { keyId: result.keyId });
    expect(await planner()).toEqual({ kind: "sheet", syncedAt: NOW });
  });

  // Phase 25.4: a firm whose planner is a connector to its own system (P5) was read as a sheet.
  it("Your planner: a connector to the firm's own portal, its reads' times and why the last failed", async () => {
    const t = await keysFirm();
    const planner = async () => (await integrationsPage(t.ctx(t.admin)))?.planner;
    const connector = async (firmId: string, enabled = true) =>
      (
        await su.query<{ id: string }>(
          `insert into roster_sources (firm_id, kind, enabled, connector, base_url, mapping)
           values ($1, 'connector', $2, 'demo_portal', 'https://portal.example.test/api', '{}')
           returning id::text as id`,
          [firmId, enabled],
        )
      ).rows[0]?.id ?? "";
    // Another firm's portal, read and failing, is never this firm's planner.
    const other = await keysFirm();
    const theirs = await connector(other.f.firmId);
    await su.query(
      `update roster_sources set last_synced_at = $2, last_near_synced_at = $2,
              last_error_code = 'unreachable' where id = $1`,
      [theirs, NOW],
    );
    expect(await planner()).toEqual({ kind: "none" });
    // Switched off: not the planner.
    const off = await connector(t.f.firmId, false);
    expect(await planner()).toEqual({ kind: "none" });
    await su.query("delete from roster_sources where id = $1", [off]);
    // Never read yet.
    const mine = await connector(t.f.firmId);
    expect(await planner()).toEqual({
      kind: "connector",
      connector: "demo_portal",
      nearReadAt: null,
      fullReadAt: null,
      failing: null,
    });
    // Read: the quick read of the next 48 hours, and the nightly read of everything.
    const near = new Date(NOW.getTime() - 29 * 60_000);
    const full = new Date(NOW.getTime() - 4 * 86_400_000);
    await su.query(
      "update roster_sources set last_near_synced_at = $2, last_synced_at = $3 where id = $1",
      [mine, near, full],
    );
    expect(await planner()).toEqual({
      kind: "connector",
      connector: "demo_portal",
      nearReadAt: near,
      fullReadAt: full,
      failing: null,
    });
    // The last read failed: its code, the times of the reads that worked kept.
    await su.query("update roster_sources set last_error_code = 'unauthorised' where id = $1", [
      mine,
    ]);
    expect(await planner()).toMatchObject({ kind: "connector", failing: "unauthorised" });
    expect((await integrationsPage(other.ctx(other.admin)))?.planner).toEqual({
      kind: "connector",
      connector: "demo_portal",
      nearReadAt: NOW,
      fullReadAt: NOW,
      failing: "unreachable",
    });
    // A live key with a change from it: the API is the planner, as for a sheet.
    const result = await t.created();
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, data, created_at)
       values ($1, 'system', 'shift.changed', 'shift', $2, $3)`,
      [t.f.firmId, JSON.stringify({ by: "firm", via: "api", keyId: result.keyId }), near],
    );
    expect(await planner()).toEqual({ kind: "api", lastChangeAt: near });
  });

  it("Codes your planner can use: the firm's own role and qualification codes, sorted", async () => {
    const t = await keysFirm();
    const other = await keysFirm();
    await su.query(
      `insert into credential_rules (firm_id, sector, role, required_types)
       values ($1, 'security', 'other_firms_role', '{}')`,
      [other.f.firmId],
    );
    const page = await integrationsPage(t.ctx(t.admin));
    expect(page?.roles).toContain("door_supervisor");
    expect(page?.roles).toContain("steward");
    expect(page?.roles).not.toContain("other_firms_role");
    expect(page?.roles).toEqual([...(page?.roles ?? [])].sort());
    expect(page?.qualifications).toContainEqual({ code: "SIA_DS", name: expect.any(String) });
    expect(page?.qualifications.map((q) => q.code)).toEqual(
      [...(page?.qualifications ?? [])].map((q) => q.code).sort(),
    );
  });
});

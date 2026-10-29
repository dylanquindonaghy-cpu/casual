import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyConnectorEvent, type ConnectorApplyDeps } from "@/lib/connector/apply";
import { demoPortal } from "@/lib/connector/demo-portal";
import { receiveConnectorEvent } from "@/lib/connector/job";
import { ConnectorFetchError, fakeConnectorTransport } from "@/lib/connector/transport";
import { handleConnectorWebhook } from "@/lib/connector/webhook";
import { connectorWebhookKey } from "@/lib/connector/webhook-secret";
import { createConnectorSourceDirectory } from "@/lib/db/directory";
import { firmSecretReader, SecretsKeyMissing } from "@/lib/db/firm-secret";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { signedHeaders } from "@/lib/integrations/sign";
import { secretsKey } from "@/lib/secret-store/crypto";
import { fakeGeocoder } from "@/lib/travel/geocoder";
import {
  connectConnector,
  showConnector,
  switchOffConnector,
} from "../../scripts/firm-connector-owner";
import { setSecret } from "../../scripts/firm-secret-owner";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { plannerKey } from "../helpers/planner-api";

// A connector's webhooks in and its job (P5.3; src/lib/connector/), on the real database as the app
// role, against the made-up portal (src/lib/connector/demo-portal.ts) in memory: never a real
// system. The webhook stores one row per event and queues one job; the job reads the record from
// the portal itself, never the webhook's body, and applies it as the planner's. NOW is Monday 2
// November 2026, 09:00 London; sessions are on Saturday 7 November. Made-up people and addresses.

const SECRET = "test-only-integrations-secret-0123456789abcdef";
const API_KEY = "made-up-portal-key-0001";

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
let seq = 0;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(6);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

// A firm with a connector on, its made-up portal, and the job's deps.
async function portalFirm(o: { enabled?: boolean } = {}) {
  const f = await bookingFirm(su, withFirm);
  seq += 1;
  const baseUrl = `https://portal-${seq}-${randomBytes(4).toString("hex")}.example.test/api`;
  const { rows } = await su.query<{ id: string }>(
    `insert into roster_sources (firm_id, kind, enabled, connector, base_url, mapping)
     values ($1, 'connector', $2, 'demo_portal', $3, '{}') returning id::text as id`,
    [f.firmId, o.enabled ?? true, baseUrl],
  );
  const sourceId = rows[0]?.id ?? "";
  const system = demoPortal.system(baseUrl, API_KEY);
  const deps: ConnectorApplyDeps = {
    transport: fakeConnectorTransport,
    readSecret: async (_firmId, name) => (name === "connector.api_key" ? API_KEY : null),
    clock: { now: () => NOW },
    geocoder: fakeGeocoder,
    localDatabase: true,
  };
  let n = 0;
  // An event as its webhook stores it (received), then its job run (apply).
  const received = async (type: "session.changed" | "staff.changed", ref: string) => {
    n += 1;
    const eventId = `evt-${n}`;
    await receiveConnectorEvent(f.firmId, { sourceId, eventId, type, ref }, { run: withFirm });
    const { rows: row } = await su.query<{ id: string }>(
      "select id::text as id from connector_events where firm_id = $1 and event_id = $2",
      [f.firmId, eventId],
    );
    return row[0]?.id ?? "";
  };
  const apply = (eventId: string, attempt = { retryCount: 0, retryLimit: 5 }, d = deps) =>
    applyConnectorEvent(
      { firmId: f.firmId, idempotencyKey: `connector-event:${eventId}`, eventId },
      withFirm,
      d,
      attempt,
    );
  return { f, sourceId, baseUrl, system, deps, received, apply };
}

const session = (o: Record<string, unknown> = {}) => ({
  ref: "PORTAL-S1",
  site: { name: "Riverside Arena" },
  role_name: "Steward",
  starts_at: "2026-11-07T08:00:00Z",
  ends_at: "2026-11-07T16:00:00Z",
  places: 2,
  status: "open",
  ...o,
});

const eventRow = async (id: string) =>
  (
    await su.query(
      "select status, outcome_code, processed_at is not null as processed from connector_events where id = $1",
      [id],
    )
  ).rows[0];

const count = async (sql: string, params: unknown[]) =>
  Number(Object.values((await su.query(sql, params)).rows[0] ?? {})[0] ?? Number.NaN);

describe("the webhook on the real database", () => {
  const post = (sourceId: string, id: string, body: string, key: Buffer) =>
    new Request(`https://shiftdesk.example/api/webhooks/connector/${sourceId}`, {
      method: "POST",
      headers: { ...signedHeaders(key, id, Math.floor(NOW.getTime() / 1000), body) },
      body,
    });
  const deps = () => ({
    secret: SECRET,
    resolveSource: createConnectorSourceDirectory(app),
    receive: (firmId: string, e: Parameters<typeof receiveConnectorEvent>[1]) =>
      receiveConnectorEvent(firmId, e, { run: withFirm }),
    now: () => NOW,
  });
  const body = JSON.stringify({ type: "session.changed", ref: "PORTAL-S1" });

  it("stores one row per event and queues its job in the same transaction; the same event again, nothing more", async () => {
    const t = await portalFirm();
    const key = connectorWebhookKey(SECRET, t.sourceId);
    for (let i = 0; i < 2; i += 1) {
      const r = await handleConnectorWebhook(
        post(t.sourceId, "evt-a1", body, key),
        t.sourceId,
        deps(),
      );
      expect(r.status).toBe(200);
    }
    const { rows } = await su.query(
      "select source_id::text as source, event_id, type, ref, status from connector_events where firm_id = $1",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      {
        source: t.sourceId,
        event_id: "evt-a1",
        type: "session.changed",
        ref: "PORTAL-S1",
        status: "queued",
      },
    ]);
    expect(
      await count(
        "select count(*) from pgboss.job where name = 'connector-event' and data ->> 'firmId' = $1",
        [t.f.firmId],
      ),
    ).toBe(1);
  });

  it("a wrong signature, a switched-off source or a sheet's id: nothing stored", async () => {
    const t = await portalFirm();
    const wrong = connectorWebhookKey(SECRET, "7b1f6c0e-3c8a-4b0e-9d6a-2f1e0c9b8a71");
    expect(
      (await handleConnectorWebhook(post(t.sourceId, "evt-b1", body, wrong), t.sourceId, deps()))
        .status,
    ).toBe(403);
    await su.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
    const key = connectorWebhookKey(SECRET, t.sourceId);
    expect(
      (await handleConnectorWebhook(post(t.sourceId, "evt-b2", body, key), t.sourceId, deps()))
        .status,
    ).toBe(200);
    await t.f.sheetSource(null);
    const { rows: sheet } = await su.query<{ id: string }>(
      "select id::text as id from roster_sources where firm_id = $1 and kind = 'sheets'",
      [t.f.firmId],
    );
    const sheetId = sheet[0]?.id ?? "";
    const sheetKey = connectorWebhookKey(SECRET, sheetId);
    expect(
      (await handleConnectorWebhook(post(sheetId, "evt-b3", body, sheetKey), sheetId, deps()))
        .status,
    ).toBe(200);
    expect(
      await count("select count(*) from connector_events where firm_id = $1", [t.f.firmId]),
    ).toBe(0);
  });
});

describe("the job: the record from the source, applied as the planner's", () => {
  it("a session made, then changed, from what the portal holds; a job run twice reads once", async () => {
    const t = await portalFirm();
    t.system.sessions.set("PORTAL-S1", session());
    const first = await t.received("session.changed", "PORTAL-S1");
    expect(await t.apply(first)).toEqual({ status: "applied", code: "created" });
    expect(await eventRow(first)).toEqual({
      status: "applied",
      outcome_code: "created",
      processed: true,
    });
    const { rows: shifts } = await su.query(
      "select source, external_ref, headcount from shifts where firm_id = $1",
      [t.f.firmId],
    );
    expect(shifts).toEqual([{ source: "api", external_ref: "PORTAL-S1", headcount: 2 }]);
    const { rows: logged } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'shift.created'",
      [t.f.firmId],
    );
    expect(logged.map((e) => e.data)).toEqual([{ by: "firm", via: "api", sourceId: t.sourceId }]);

    t.system.sessions.set("PORTAL-S1", session({ places: 3 }));
    const second = await t.received("session.changed", "PORTAL-S1");
    expect(await t.apply(second)).toEqual({ status: "applied", code: "updated" });
    expect(await count("select headcount from shifts where firm_id = $1", [t.f.firmId])).toBe(3);

    // Already done (a retry after a crash once it was saved): nothing is read again.
    const reads = t.system.reads;
    expect(await t.apply(first)).toEqual({ status: "done" });
    expect(t.system.reads).toBe(reads);
  });

  it("a staff record: the worker added through upsertWorker, roles through the firm's name map", async () => {
    const t = await portalFirm();
    await su.query(
      "insert into name_map (firm_id, kind, outside_name, code) values ($1, 'role', 'steward (day)', 'steward')",
      [t.f.firmId],
    );
    t.system.staff.set("PORTAL-W1", {
      ref: "PORTAL-W1",
      first_name: "Ann",
      last_name: "Example",
      mobile: "+447700900321",
      role_names: ["Steward (Day)"],
      status: "active",
    });
    const id = await t.received("staff.changed", "PORTAL-W1");
    expect(await t.apply(id)).toEqual({ status: "applied", code: "added" });
    const { rows } = await su.query(
      "select first_name, roles, external_ref, mobile_e164 from workers where firm_id = $1 and external_ref = 'PORTAL-W1'",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      {
        first_name: "Ann",
        roles: ["steward"],
        external_ref: "PORTAL-W1",
        mobile_e164: "+447700900321",
      },
    ]);
    const { rows: logged } = await su.query<{ actor_type: string; data: Record<string, unknown> }>(
      "select actor_type, data from events where firm_id = $1 and action = 'worker.added'",
      [t.f.firmId],
    );
    expect(logged).toEqual([{ actor_type: "system", data: { source: "api" } }]);
  });

  it("what isn't applied says why: gone, a skipped name, a name it can't read, the planner's refusal", async () => {
    const t = await portalFirm();
    await su.query(
      "insert into name_map (firm_id, kind, outside_name, code) values ($1, 'role', 'holiday', null)",
      [t.f.firmId],
    );
    const gone = await t.received("session.changed", "PORTAL-GONE");
    expect(await t.apply(gone)).toEqual({ status: "ignored", code: "gone" });
    t.system.sessions.set("PORTAL-S2", session({ ref: "PORTAL-S2", role_name: "Holiday" }));
    expect(await t.apply(await t.received("session.changed", "PORTAL-S2"))).toEqual({
      status: "ignored",
      code: "skipped_name",
    });
    t.system.sessions.set("PORTAL-S3", session({ ref: "PORTAL-S3", role_name: "!!!" }));
    expect(await t.apply(await t.received("session.changed", "PORTAL-S3"))).toEqual({
      status: "refused",
      code: "bad_role",
    });
    // A record under another ref than the one that changed: refused, never applied as either.
    t.system.sessions.set("PORTAL-S4", session({ ref: "PORTAL-S9" }));
    expect(await t.apply(await t.received("session.changed", "PORTAL-S4"))).toEqual({
      status: "refused",
      code: "ref_mismatch",
    });
    // The planner's own rules: a new session starting in the past is refused.
    t.system.sessions.set(
      "PORTAL-S5",
      session({
        ref: "PORTAL-S5",
        starts_at: "2026-11-01T08:00:00Z",
        ends_at: "2026-11-01T16:00:00Z",
      }),
    );
    expect(await t.apply(await t.received("session.changed", "PORTAL-S5"))).toEqual({
      status: "refused",
      code: "session_started",
    });
    expect(await count("select count(*) from shifts where firm_id = $1", [t.f.firmId])).toBe(0);
  });

  it("a source that doesn't answer is tried again; the last try saves it as failed and completes", async () => {
    const t = await portalFirm();
    t.system.sessions.set("PORTAL-S1", session());
    t.system.down = true;
    const id = await t.received("session.changed", "PORTAL-S1");
    await expect(t.apply(id)).rejects.toBeInstanceOf(ConnectorFetchError);
    expect(await eventRow(id)).toEqual({ status: "queued", outcome_code: null, processed: false });
    expect(await t.apply(id, { retryCount: 5, retryLimit: 5 })).toEqual({
      status: "failed",
      code: "unreachable",
    });
    expect(await eventRow(id)).toEqual({
      status: "failed",
      outcome_code: "unreachable",
      processed: true,
    });
    // A key the portal doesn't take, on the last try.
    t.system.down = false;
    const wrong = await t.received("session.changed", "PORTAL-S1");
    expect(
      await t.apply(
        wrong,
        { retryCount: 5, retryLimit: 5 },
        {
          ...t.deps,
          readSecret: async () => "another-key",
        },
      ),
    ).toEqual({ status: "failed", code: "unauthorised" });
  });

  it("no key to read with: failed at once, nothing read", async () => {
    const t = await portalFirm();
    t.system.sessions.set("PORTAL-S1", session());
    const none = await t.received("session.changed", "PORTAL-S1");
    expect(await t.apply(none, undefined, { ...t.deps, readSecret: async () => null })).toEqual({
      status: "failed",
      code: "no_api_key",
    });
    const off = await t.received("session.changed", "PORTAL-S1");
    expect(
      await t.apply(off, undefined, {
        ...t.deps,
        readSecret: () => Promise.reject(new SecretsKeyMissing()),
      }),
    ).toEqual({ status: "failed", code: "secrets_off" });
    expect(t.system.reads).toBe(0);
  });

  it("a source switched off before its job: nothing read; with a live planner key: nothing changed", async () => {
    const t = await portalFirm();
    t.system.sessions.set("PORTAL-S1", session());
    const id = await t.received("session.changed", "PORTAL-S1");
    await su.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
    expect(await t.apply(id)).toEqual({ status: "ignored", code: "source_off" });
    expect(t.system.reads).toBe(0);

    const k = await portalFirm();
    k.system.sessions.set("PORTAL-S1", session());
    await plannerKey(su, k.f.firmId, await k.f.office("admin"));
    expect(await k.apply(await k.received("session.changed", "PORTAL-S1"))).toEqual({
      status: "ignored",
      code: "not_allowed",
    });
    expect(await count("select count(*) from shifts where firm_id = $1", [k.f.firmId])).toBe(0);
    // A staff record too: the caller is checked before upsertWorker().
    k.system.staff.set("PORTAL-W1", {
      ref: "PORTAL-W1",
      first_name: "Ben",
      last_name: "Example",
      mobile: "+447700900322",
      role_names: ["steward"],
      status: "active",
    });
    expect(await k.apply(await k.received("staff.changed", "PORTAL-W1"))).toEqual({
      status: "ignored",
      code: "not_allowed",
    });
    expect(
      await count(
        "select count(*) from workers where firm_id = $1 and external_ref = 'PORTAL-W1'",
        [k.f.firmId],
      ),
    ).toBe(0);
  });

  it("reads its key from the secret store, sealed under the worker's key, on its own jobs-role connection", async () => {
    const t = await portalFirm();
    t.system.sessions.set("PORTAL-S1", session());
    const key = secretsKey(randomBytes(32).toString("base64"));
    if (!key) throw new Error("no key");
    const { rows } = await su.query<{ slug: string }>("select slug from firms where id = $1", [
      t.f.firmId,
    ]);
    await setSecret(urls.admin, rows[0]?.slug ?? "", key, "connector.api_key", API_KEY);
    const id = await t.received("session.changed", "PORTAL-S1");
    expect(
      await t.apply(id, undefined, { ...t.deps, readSecret: firmSecretReader(urls.jobs, key) }),
    ).toEqual({ status: "applied", code: "created" });
  });
});

describe("the owner's command (npm run firm:connector)", () => {
  const slugOf = async (firmId: string) =>
    (await su.query<{ slug: string }>("select slug from firms where id = $1", [firmId])).rows[0]
      ?.slug ?? "";
  const BASE = "https://portal.example.test/api";

  it("connects, keeps, replaces and switches off a firm's connector, each logged as a settings change", async () => {
    const f = await bookingFirm(su, withFirm);
    const slug = await slugOf(f.firmId);
    const connect = (baseUrl: string, replace = false) =>
      connectConnector(urls.admin, slug, {
        connector: "demo_portal",
        baseUrl,
        replace,
        localDatabase: true,
      });
    const made = await connect(BASE);
    expect(made).toMatchObject({ status: "connected" });
    expect(await connect(BASE)).toMatchObject({ status: "unchanged" });
    expect(await connect("https://portal2.example.test/api")).toEqual({ status: "has_connector" });
    const replaced = await connect("https://portal2.example.test/api", true);
    expect(replaced).toMatchObject({ status: "replaced" });
    expect(await showConnector(urls.admin, slug)).toMatchObject({
      status: "ok",
      source: {
        baseUrl: "https://portal2.example.test/api",
        enabled: true,
        connector: "demo_portal",
      },
    });
    expect(await switchOffConnector(urls.admin, slug)).toEqual({ status: "switched_off" });
    expect(await switchOffConnector(urls.admin, slug)).toEqual({ status: "none" });
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'firm.settings_changed' order by id",
      [f.firmId],
    );
    expect(rows.map((r) => r.data.change)).toEqual(["connected", "replaced", "switched_off"]);
    expect(rows.every((r) => JSON.stringify(r.data.keys) === '["roster_source.connector"]')).toBe(
      true,
    );
  });

  it("refuses a bad address, a firm with a sheet on or a live planner key, and (live database) no agreement", async () => {
    const f = await bookingFirm(su, withFirm);
    const slug = await slugOf(f.firmId);
    const connect = (o: { baseUrl?: string; localDatabase?: boolean } = {}) =>
      connectConnector(urls.admin, slug, {
        connector: "demo_portal",
        baseUrl: o.baseUrl ?? BASE,
        replace: true,
        localDatabase: o.localDatabase ?? true,
      });
    for (const baseUrl of ["http://portal.example.test", "https://127.0.0.1", "https://web:3000"]) {
      expect(await connect({ baseUrl }), baseUrl).toEqual({ status: "bad_address" });
    }
    expect(await connect({ localDatabase: false })).toEqual({ status: "agreement_needed" });
    await f.sheetSource(null);
    expect(await connect()).toEqual({ status: "has_sheet" });
    await su.query("update roster_sources set enabled = false where firm_id = $1", [f.firmId]);
    await plannerKey(su, f.firmId, await f.office("admin"));
    expect(await connect()).toEqual({ status: "has_api_key" });
    expect(
      await count("select count(*) from roster_sources where firm_id = $1 and kind = 'connector'", [
        f.firmId,
      ]),
    ).toBe(0);
  });
});

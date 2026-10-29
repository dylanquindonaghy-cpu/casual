import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR, MINUTE } from "@/lib/auth/clock";
import type { ConnectorApplyDeps } from "@/lib/connector/apply";
import { demoPortal } from "@/lib/connector/demo-portal";
import { runConnectorPull, runConnectorPullTick } from "@/lib/connector/pull";
import { fakeConnectorTransport } from "@/lib/connector/transport";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { fakeGeocoder } from "@/lib/travel/geocoder";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { plannerKey } from "../helpers/planner-api";

// The reconcile pull (P5.4; src/lib/connector/pull.ts) on the real database as the app role,
// against the made-up portal in memory: what the webhooks missed, read in full on a schedule and
// applied as a webhook's records are. NOW is Monday 2 November 2026, 09:00 London (GMT). Made-up
// people and addresses only.

const API_KEY = "made-up-portal-key-0002";

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

const iso = (ms: number) => new Date(ms).toISOString();
const session = (ref: string, startsIn: number, o: Record<string, unknown> = {}) => ({
  ref,
  site: { name: "Riverside Arena" },
  role_name: "Steward",
  starts_at: iso(NOW.getTime() + startsIn),
  ends_at: iso(NOW.getTime() + startsIn + 8 * HOUR),
  places: 2,
  status: "open",
  ...o,
});

async function pullFirm() {
  const f = await bookingFirm(su, withFirm);
  seq += 1;
  const baseUrl = `https://pull-${seq}-${randomBytes(4).toString("hex")}.example.test/api`;
  const { rows } = await su.query<{ id: string }>(
    `insert into roster_sources (firm_id, kind, connector, base_url, mapping)
     values ($1, 'connector', 'demo_portal', $2, '{}') returning id::text as id`,
    [f.firmId, baseUrl],
  );
  const sourceId = rows[0]?.id ?? "";
  const system = demoPortal.system(baseUrl, API_KEY);
  let now = NOW;
  const deps = (): ConnectorApplyDeps => ({
    transport: fakeConnectorTransport,
    readSecret: async () => API_KEY,
    clock: { now: () => now },
    geocoder: fakeGeocoder,
    localDatabase: true,
  });
  const pull = (kind: "near" | "full") =>
    runConnectorPull(
      { firmId: f.firmId, idempotencyKey: "connector-pull:1", sourceId, kind },
      withFirm,
      deps(),
    );
  const source = async () =>
    (
      await su.query(
        `select last_synced_at, last_near_synced_at, last_error_code, sync_started_at
           from roster_sources where id = $1`,
        [sourceId],
      )
    ).rows[0];
  const shiftsNow = async () =>
    (
      await su.query(
        `select external_ref, headcount, showing_to_casuals from shifts
          where firm_id = $1 order by external_ref`,
        [f.firmId],
      )
    ).rows;
  return {
    f,
    sourceId,
    system,
    pull,
    source,
    shiftsNow,
    at: (when: Date) => {
      now = when;
    },
  };
}

const eventCount = async (firmId: string) =>
  Number(
    (await su.query("select count(*) from events where firm_id = $1", [firmId])).rows[0]?.count,
  );

describe("the reconcile pull", () => {
  it("catches what the webhooks missed: the next 48 hours, then everything; hidden from casuals; only changes logged", async () => {
    const t = await pullFirm();
    t.system.sessions.set("PORTAL-SOON", session("PORTAL-SOON", 24 * HOUR));
    t.system.sessions.set("PORTAL-LATER", session("PORTAL-LATER", 5 * 24 * HOUR));
    t.system.sessions.set("PORTAL-PAST", session("PORTAL-PAST", -48 * HOUR));
    t.system.staff.set("PORTAL-W1", {
      ref: "PORTAL-W1",
      first_name: "Cara",
      last_name: "Example",
      mobile: "+447700900331",
      role_names: ["steward"],
      status: "active",
    });

    const near = await t.pull("near");
    expect(near).toEqual({ status: "pulled", kind: "near", counts: { "applied:created": 1 } });
    // Only the next 48 hours; a connector's new session comes in hidden (the shadow cycle).
    expect(await t.shiftsNow()).toEqual([
      { external_ref: "PORTAL-SOON", headcount: 2, showing_to_casuals: false },
    ]);
    expect(await t.source()).toMatchObject({
      last_synced_at: null,
      last_near_synced_at: NOW,
      last_error_code: null,
      sync_started_at: null,
    });

    const full = await t.pull("full");
    expect(full).toMatchObject({
      status: "pulled",
      kind: "full",
      counts: { "applied:added": 1, "applied:created": 1, "applied:unchanged": 1 },
    });
    expect((await t.shiftsNow()).map((s) => s.external_ref)).toEqual([
      "PORTAL-LATER",
      "PORTAL-SOON",
    ]);
    expect(
      Number(
        (
          await su.query(
            "select count(*) from workers where firm_id = $1 and external_ref = 'PORTAL-W1'",
            [t.f.firmId],
          )
        ).rows[0]?.count,
      ),
    ).toBe(1);
    expect(await t.source()).toMatchObject({ last_synced_at: NOW, last_near_synced_at: NOW });

    // Nothing changed at the source: nothing changed here, nothing logged.
    const before = await eventCount(t.f.firmId);
    expect(await t.pull("full")).toMatchObject({
      counts: { "applied:unchanged": 3 },
    });
    expect(await eventCount(t.f.firmId)).toBe(before);

    // A change the webhook never sent: caught by the next pull.
    t.system.sessions.set("PORTAL-SOON", session("PORTAL-SOON", 24 * HOUR, { places: 4 }));
    expect((await t.pull("near")).status).toBe("pulled");
    expect((await t.shiftsNow()).find((s) => s.external_ref === "PORTAL-SOON")?.headcount).toBe(4);
  });

  it("two pulls of one source at once: one runs, the other finds it busy", async () => {
    const t = await pullFirm();
    t.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 24 * HOUR));
    const [a, b] = await Promise.all([t.pull("near"), t.pull("near")]);
    expect([a.status, b.status].sort()).toEqual(["busy", "pulled"]);
    expect(t.system.lists).toBe(1);
    expect((await t.shiftsNow()).length).toBe(1);
  });

  it("a source that doesn't answer: the error saved, its times kept, and the next pulls back off", async () => {
    const t = await pullFirm();
    t.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 24 * HOUR));
    expect((await t.pull("full")).status).toBe("pulled");
    t.system.down = true;
    const later = new Date(NOW.getTime() + 15 * MINUTE);
    t.at(later);
    expect(await t.pull("near")).toEqual({ status: "failed", code: "unreachable" });
    expect(await t.source()).toMatchObject({
      last_synced_at: NOW,
      last_near_synced_at: NOW,
      last_error_code: "unreachable",
      sync_started_at: null,
    });
    // The tick: 15 minutes on, nothing (backing off); 30 minutes after the failed try, a pull.
    const tick = (when: Date) =>
      runConnectorPullTick({
        listFirmIds: async () => [t.f.firmId],
        run: withFirm,
        clock: { now: () => when },
      });
    expect(await tick(new Date(later.getTime() + 15 * MINUTE))).toEqual({ queued: 0 });
    expect(await tick(new Date(later.getTime() + 30 * MINUTE))).toEqual({ queued: 1 });
    // The same minute again: still one (a singleton for the minute).
    expect(await tick(new Date(later.getTime() + 30 * MINUTE))).toEqual({ queued: 0 });
    const { rows: jobs } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = 'connector-pull' and data ->> 'firmId' = $1",
      [t.f.firmId],
    );
    expect(jobs.map((j) => [j.data.sourceId, j.data.kind])).toEqual([[t.sourceId, "near"]]);
    // Back up: the next pull clears the error.
    t.system.down = false;
    t.at(new Date(later.getTime() + 30 * MINUTE));
    expect((await t.pull("near")).status).toBe("pulled");
    expect(await t.source()).toMatchObject({ last_error_code: null });
  });

  it("Gate B before anything is read: on a live database with no agreement, nothing read and the error saved", async () => {
    const t = await pullFirm();
    t.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 24 * HOUR));
    expect(
      await runConnectorPull(
        {
          firmId: t.f.firmId,
          idempotencyKey: "connector-pull:1",
          sourceId: t.sourceId,
          kind: "full",
        },
        withFirm,
        {
          transport: fakeConnectorTransport,
          readSecret: async () => API_KEY,
          clock: { now: () => NOW },
          localDatabase: false,
        },
      ),
    ).toEqual({ status: "failed", code: "agreement_not_recorded" });
    expect(t.system.lists).toBe(0);
    expect(await t.source()).toMatchObject({
      last_error_code: "agreement_not_recorded",
      sync_started_at: null,
    });
  });

  it("a switched-off source or a firm without one: nothing pulled or queued; a planner key made live stops it", async () => {
    const t = await pullFirm();
    t.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 24 * HOUR));
    await su.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
    expect(await t.pull("full")).toEqual({ status: "off" });
    expect(t.system.lists).toBe(0);
    const none = await bookingFirm(su, withFirm);
    expect(
      await runConnectorPullTick({
        listFirmIds: async () => [t.f.firmId, none.firmId],
        run: withFirm,
        clock: { now: () => NOW },
      }),
    ).toEqual({ queued: 0 });

    const k = await pullFirm();
    k.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 24 * HOUR));
    await plannerKey(su, k.f.firmId, await k.f.office("admin"));
    expect(await k.pull("near")).toEqual({ status: "failed", code: "not_allowed" });
    expect(await k.shiftsNow()).toEqual([]);
    expect(await k.source()).toMatchObject({
      last_error_code: "not_allowed",
      sync_started_at: null,
    });
  });
});

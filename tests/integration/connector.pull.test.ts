import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR, MINUTE } from "@/lib/auth/clock";
import type { ConnectorApplyDeps } from "@/lib/connector/apply";
import { demoPortal } from "@/lib/connector/demo-portal";
import { runConnectorPull, runConnectorPullTick } from "@/lib/connector/pull";
import { ConnectorFetchError, fakeConnectorTransport } from "@/lib/connector/transport";
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
  const pull = (kind: "near" | "full", over: Partial<ConnectorApplyDeps> = {}) =>
    runConnectorPull(
      { firmId: f.firmId, idempotencyKey: "connector-pull:1", sourceId, kind },
      withFirm,
      { ...deps(), ...over },
    );
  // A casual known to the firm's system by a staff ref.
  const casual = async (ref: string) => {
    const id = await f.worker({ first: ref });
    await su.query("update workers set external_ref = $2 where id = $1", [id, ref]);
    return id;
  };
  // A webhook's event about a record, as stored (job.ts), at the times given.
  const event = (
    type: "session.changed" | "staff.changed",
    ref: string,
    o: { createdAt: Date; processedAt?: Date },
  ) =>
    su.query(
      `insert into connector_events
         (firm_id, source_id, event_id, type, ref, status, outcome_code, processed_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        f.firmId,
        sourceId,
        `evt-${randomBytes(4).toString("hex")}`,
        type,
        ref,
        o.processedAt ? "applied" : "queued",
        o.processedAt ? "updated" : null,
        o.processedAt ?? null,
        o.createdAt,
      ],
    );
  const tick = (when: Date) =>
    runConnectorPullTick({
      listFirmIds: async () => [f.firmId],
      run: withFirm,
      clock: { now: () => when },
    });
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
    casual,
    event,
    tick,
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
    // Checked before anything is read from the firm's system.
    expect(k.system.lists).toBe(0);
    expect(await k.shiftsNow()).toEqual([]);
    expect(await k.source()).toMatchObject({
      last_error_code: "not_allowed",
      sync_started_at: null,
    });
  });

  it("a change the rules refuse, pulled again and again: logged once", async () => {
    const t = await pullFirm();
    await t.casual("PORTAL-W1");
    const booked = { bookings: [{ staff_ref: "PORTAL-W1", status: "booked" }] };
    t.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 24 * HOUR, booked));
    expect(await t.pull("near")).toMatchObject({ status: "pulled" });
    // The system gives the booked session a new role: refused here (they were booked for the old).
    t.system.sessions.set(
      "PORTAL-S1",
      session("PORTAL-S1", 24 * HOUR, { ...booked, role_name: "Door Supervisor" }),
    );
    const refusals = async () =>
      Number(
        (
          await su.query(
            "select count(*) from events where firm_id = $1 and action = 'api.change_refused'",
            [t.f.firmId],
          )
        ).rows[0]?.count,
      );
    for (const minutes of [15, 30, 45]) {
      t.at(new Date(NOW.getTime() + minutes * MINUTE));
      expect(await t.pull("near")).toMatchObject({
        counts: { "refused:session_has_bookings": 1 },
      });
    }
    expect(await refusals()).toBe(1);
    // A different refusal is logged: moved an hour later with no reason given.
    t.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 25 * HOUR, booked));
    t.at(new Date(NOW.getTime() + 60 * MINUTE));
    expect(await t.pull("near")).toMatchObject({
      counts: { "refused:change_reason_required": 1 },
    });
    expect(await refusals()).toBe(2);
  });

  it("a record a webhook's event is newer than, or about to apply, is skipped: the event's own read wins", async () => {
    const t = await pullFirm();
    for (const ref of ["PORTAL-QUEUED", "PORTAL-SINCE", "PORTAL-BEFORE", "PORTAL-OTHER"]) {
      t.system.sessions.set(ref, session(ref, 24 * HOUR));
    }
    const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);
    // Still queued: its job reads the record later.
    await t.event("session.changed", "PORTAL-QUEUED", { createdAt: ago(60) });
    // Applied since this pull read the source: the event read it after.
    await t.event("session.changed", "PORTAL-SINCE", { createdAt: ago(5), processedAt: NOW });
    // Applied before: this read is the newer.
    await t.event("session.changed", "PORTAL-BEFORE", { createdAt: ago(60), processedAt: ago(59) });
    // About a staff record of that ref, not the session.
    await t.event("staff.changed", "PORTAL-OTHER", { createdAt: ago(1), processedAt: NOW });
    expect(await t.pull("near")).toMatchObject({
      status: "pulled",
      counts: { "ignored:event_newer": 2, "applied:created": 2 },
    });
    expect((await t.shiftsNow()).map((r) => r.external_ref)).toEqual([
      "PORTAL-BEFORE",
      "PORTAL-OTHER",
    ]);
  });

  it("the tick queues no pull beside one still holding its lease", async () => {
    const t = await pullFirm();
    // Never read in full: due at once, but a pull took the lease 5 minutes ago.
    await su.query("update roster_sources set sync_started_at = $2 where id = $1", [
      t.sourceId,
      new Date(NOW.getTime() - 5 * MINUTE),
    ]);
    expect(await t.tick(NOW)).toEqual({ queued: 0 });
    // Its lease (10 minutes) has run out: the next is queued.
    expect(await t.tick(new Date(NOW.getTime() + 6 * MINUTE))).toEqual({ queued: 1 });
  });

  it("a full pull whose staff list fails still applies its sessions: the near time moves on, the error saved", async () => {
    const t = await pullFirm();
    t.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 5 * 24 * HOUR));
    const staffDown = {
      ...fakeConnectorTransport,
      list: (r: Parameters<typeof fakeConnectorTransport.list>[0]) =>
        r.type === "staff.changed"
          ? Promise.reject(new ConnectorFetchError("unreachable"))
          : fakeConnectorTransport.list(r),
    };
    expect(await t.pull("full", { transport: staffDown })).toEqual({
      status: "failed",
      code: "unreachable",
    });
    expect((await t.shiftsNow()).map((r) => r.external_ref)).toEqual(["PORTAL-S1"]);
    expect(await t.source()).toMatchObject({
      last_synced_at: null,
      last_near_synced_at: NOW,
      last_error_code: "unreachable",
      sync_started_at: null,
    });
  });

  it("past its budget a pull stops: the rest wait, each record at its own time", async () => {
    const t = await pullFirm();
    await t.casual("PORTAL-W1");
    for (const ref of ["PORTAL-S1", "PORTAL-S2", "PORTAL-S3"]) {
      t.system.sessions.set(
        ref,
        session(ref, 24 * HOUR + Number(ref.slice(-1)) * HOUR, {
          bookings: [{ staff_ref: "PORTAL-W1", status: "booked" }],
        }),
      );
    }
    // Three minutes pass at every look at the clock: the lease, the list read, the first record
    // (6 minutes in), the second (9: past the 8-minute budget).
    let looks = 0;
    const clock = { now: () => new Date(NOW.getTime() + looks++ * 3 * MINUTE) };
    expect(await t.pull("near", { clock })).toEqual({ status: "failed", code: "out_of_time" });
    expect((await t.shiftsNow()).map((r) => r.external_ref)).toEqual(["PORTAL-S1"]);
    expect(await t.source()).toMatchObject({
      last_near_synced_at: null,
      last_error_code: "out_of_time",
      sync_started_at: null,
    });
    // The record applied at its own time, not the lease's: booked 6 minutes in, 24 hours and 54
    // minutes before it starts.
    const { rows } = await su.query<{ notice: number }>(
      `select (data ->> 'noticeHours')::float8 as notice from events
        where firm_id = $1 and action = 'shift.assigned'`,
      [t.f.firmId],
    );
    expect(rows).toEqual([{ notice: 24.9 }]);
  });

  it("every record failing is the pull failing; anything unexpected lets the lease go with its code", async () => {
    const t = await pullFirm();
    // New sites, looked up by something that breaks.
    for (const ref of ["PORTAL-S1", "PORTAL-S2"]) {
      t.system.sessions.set(
        ref,
        session(ref, 24 * HOUR, { site: { name: `Arena ${ref}`, postcode: "ZZ9 9ZZ" } }),
      );
    }
    const broken = { locate: () => Promise.reject(new TypeError("a bug")) };
    expect(await t.pull("near", { geocoder: broken })).toEqual({
      status: "failed",
      code: "records_failed",
    });
    expect(await t.source()).toMatchObject({
      last_near_synced_at: null,
      last_error_code: "records_failed",
      sync_started_at: null,
    });

    const u = await pullFirm();
    u.system.sessions.set("PORTAL-S1", session("PORTAL-S1", 24 * HOUR));
    const logger = {
      info: () => {
        throw new TypeError("a broken log");
      },
      warn: () => undefined,
      error: () => undefined,
      child: () => logger,
    };
    await expect(u.pull("near", { logger })).rejects.toThrow("a broken log");
    expect(await u.source()).toMatchObject({
      last_near_synced_at: null,
      last_error_code: "error_typeerror",
      sync_started_at: null,
    });
  });
});

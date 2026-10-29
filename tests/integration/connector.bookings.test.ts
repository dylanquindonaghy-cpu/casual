import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { applyConnectorEvent, type ConnectorApplyDeps } from "@/lib/connector/apply";
import { demoPortal } from "@/lib/connector/demo-portal";
import { receiveConnectorEvent } from "@/lib/connector/job";
import { fakeConnectorTransport } from "@/lib/connector/transport";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { fakeGeocoder } from "@/lib/travel/geocoder";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Who's booked on a connector's session, mirrored from the firm's own system (P5.5;
// src/lib/connector/bookings.ts), on the real database as the app role against the made-up
// portal: a booking made there runs the rules as an office placement; a confirmed booking is
// never cancelled because the system stopped listing it, only when it says it's cancelled, with
// the notice hours' evidence; and people can't book or cancel those sessions in ShiftDesk. NOW is
// Monday 2 November 2026, 09:00 London. Made-up people only.

const API_KEY = "made-up-portal-key-0003";
const START = new Date(NOW.getTime() + 5 * 24 * HOUR); // Saturday 7 November, 09:00

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

async function bookingsFirm() {
  const f = await bookingFirm(su, withFirm);
  seq += 1;
  const baseUrl = `https://book-${seq}-${randomBytes(4).toString("hex")}.example.test/api`;
  const { rows } = await su.query<{ id: string }>(
    `insert into roster_sources (firm_id, kind, connector, base_url, mapping)
     values ($1, 'connector', 'demo_portal', $2, '{}') returning id::text as id`,
    [f.firmId, baseUrl],
  );
  const sourceId = rows[0]?.id ?? "";
  const system = demoPortal.system(baseUrl, API_KEY);
  const deps = (now = NOW): ConnectorApplyDeps => ({
    transport: fakeConnectorTransport,
    readSecret: async () => API_KEY,
    clock: { now: () => now },
    geocoder: fakeGeocoder,
    localDatabase: true,
  });
  let n = 0;
  // The session's record changed: stored as its webhook would, then its job run.
  const changed = async (record: Record<string, unknown>, now = NOW) => {
    system.sessions.set("PORTAL-S1", record);
    n += 1;
    const eventId = `evt-${n}-${randomBytes(3).toString("hex")}`;
    await receiveConnectorEvent(
      f.firmId,
      { sourceId, eventId, type: "session.changed", ref: "PORTAL-S1" },
      { run: withFirm },
    );
    const { rows: row } = await su.query<{ id: string }>(
      "select id::text as id from connector_events where firm_id = $1 and event_id = $2",
      [f.firmId, eventId],
    );
    return applyConnectorEvent(
      {
        firmId: f.firmId,
        idempotencyKey: `connector-event:${row[0]?.id}`,
        eventId: row[0]?.id ?? "",
      },
      withFirm,
      deps(now),
      { retryCount: 0, retryLimit: 5 },
    );
  };
  // A casual known to the firm's system by a staff ref (licensed for steward unless told).
  const casual = async (ref: string, o: { licensed?: boolean } = {}) => {
    const id = await f.worker({
      first: ref,
      ...(o.licensed === false ? { credentials: [] } : {}),
    });
    await su.query("update workers set external_ref = $2 where id = $1", [id, ref]);
    return id;
  };
  const booked = async () =>
    (
      await su.query<{ ref: string; status: string; booked_via: string | null }>(
        `select w.external_ref as ref, a.status, a.booked_via
           from assignments a join workers w on w.id = a.worker_id
           join shifts s on s.id = a.shift_id
          where s.firm_id = $1 and s.external_ref = 'PORTAL-S1'
          order by a.slot`,
        [f.firmId],
      )
    ).rows;
  const shiftId = async () =>
    (
      await su.query<{ id: string }>(
        "select id::text as id from shifts where firm_id = $1 and external_ref = 'PORTAL-S1'",
        [f.firmId],
      )
    ).rows[0]?.id ?? "";
  return { f, sourceId, system, changed, casual, booked, shiftId };
}

const session = (bookings: unknown[], o: Record<string, unknown> = {}) => ({
  ref: "PORTAL-S1",
  site: { name: "Riverside Arena" },
  role_name: "Steward",
  starts_at: START.toISOString(),
  ends_at: new Date(START.getTime() + 8 * HOUR).toISOString(),
  places: 2,
  status: "open",
  bookings,
  ...o,
});
const isBooked = (staff_ref: string) => ({ staff_ref, status: "booked" });

const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows.map((r) => r.data);

describe("bookings made in the firm's system", () => {
  it("are booked here through the rules as the office's placement; refused ones logged once; no place, not booked", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    const ben = await t.casual("STAFF-BEN", { licensed: false });
    const cat = await t.casual("STAFF-CAT");
    const dan = await t.casual("STAFF-DAN");
    const bookings = [isBooked("STAFF-ANN"), isBooked("STAFF-BEN"), isBooked("STAFF-CAT")];
    expect(await t.changed(session(bookings))).toEqual({ status: "applied", code: "created" });
    // Ben has no licence: not booked; his place goes to Cat.
    expect(await t.booked()).toEqual([
      { ref: "STAFF-ANN", status: "confirmed", booked_via: "api" },
      { ref: "STAFF-CAT", status: "confirmed", booked_via: "api" },
    ]);
    const assigned = await eventsOf(t.f.firmId, "shift.assigned");
    expect(assigned.map((d) => [d.workerId, d.by, d.via, d.sourceId])).toEqual([
      [ann, "firm", "api", t.sourceId],
      [cat, "firm", "api", t.sourceId],
    ]);
    // Read again, and with Dan added past the places: Ben's refusal isn't said twice; Dan's is new.
    expect(await t.changed(session([...bookings, isBooked("STAFF-DAN")]))).toMatchObject({
      status: "applied",
    });
    const refused = await eventsOf(t.f.firmId, "shift.booking_refused");
    expect(refused.map((d) => [d.workerId, d.codes, d.via])).toEqual([
      [ben, ["credential_missing"], "api"],
      [dan, ["no_place"], "api"],
    ]);
    // No message to the casual: the firm's system booked them.
    expect(
      Number(
        (
          await su.query(
            "select count(*) from pgboss.job where name = 'shift-confirmed' and data ->> 'firmId' = $1",
            [t.f.firmId],
          )
        ).rows[0]?.count,
      ),
    ).toBe(0);
  });

  it("two reads of the same booking at once book the casual once (first yes wins)", async () => {
    const t = await bookingsFirm();
    await t.casual("STAFF-ANN");
    await t.changed(session([]));
    await Promise.all([
      t.changed(session([isBooked("STAFF-ANN")])),
      t.changed(session([isBooked("STAFF-ANN")])),
    ]);
    expect(await t.booked()).toEqual([
      { ref: "STAFF-ANN", status: "confirmed", booked_via: "api" },
    ]);
  });
});

describe("a booking the firm's system stops listing, or cancels", () => {
  it("not listed any more: never cancelled on its own; a record that sends no bookings touches none", async () => {
    const t = await bookingsFirm();
    await t.casual("STAFF-ANN");
    await t.changed(session([isBooked("STAFF-ANN")]));
    await t.changed(session([]));
    await t.changed(session([], { bookings: undefined }));
    expect(await t.booked()).toEqual([
      { ref: "STAFF-ANN", status: "confirmed", booked_via: "api" },
    ]);
  });

  it("cancelled there: cancelled here, never a strike, notice from the system's own time when it's since the last read, else from now", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    const ben = await t.casual("STAFF-BEN");
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-BEN")]));
    // Read in full at NOW; the system cancels Ann an hour later (her own time is since that read),
    // and reports Ben's with a time before the read (it can't be his: the reading that favours him).
    await su.query("update roster_sources set last_near_synced_at = $2 where id = $1", [
      t.sourceId,
      NOW,
    ]);
    const later = new Date(NOW.getTime() + 2 * HOUR);
    const result = await t.changed(
      session([
        {
          staff_ref: "STAFF-ANN",
          status: "cancelled",
          cancelled_at: new Date(NOW.getTime() + HOUR).toISOString(),
          change_reason: "weather",
        },
        {
          staff_ref: "STAFF-BEN",
          status: "cancelled",
          cancelled_at: new Date(NOW.getTime() - HOUR).toISOString(),
        },
      ]),
      later,
    );
    expect(result).toMatchObject({ status: "applied" });
    const { rows } = await su.query(
      `select w.external_ref as ref, a.status, a.cancel_via, a.cancel_asked_by,
              a.notice_hours::float8 as notice_hours
         from assignments a join workers w on w.id = a.worker_id
        where a.firm_id = $1 order by w.external_ref`,
      [t.f.firmId],
    );
    const hoursTo = (from: Date) => (START.getTime() - from.getTime()) / HOUR;
    expect(rows).toEqual([
      {
        ref: "STAFF-ANN",
        status: "cancelled_firm",
        cancel_via: "api",
        cancel_asked_by: "unknown",
        notice_hours: Math.floor(hoursTo(new Date(NOW.getTime() + HOUR))),
      },
      {
        ref: "STAFF-BEN",
        status: "cancelled_firm",
        cancel_via: "api",
        cancel_asked_by: "unknown",
        notice_hours: Math.floor(hoursTo(later)),
      },
    ]);
    const cancelled = await eventsOf(t.f.firmId, "shift.cancelled");
    expect(
      cancelled.map((d) => [d.workerId, d.reason, d.noticeFrom, d.strike, d.sourceId]),
    ).toEqual([
      [ann, "Weather or safety", "source", "by_firm", t.sourceId],
      [ben, "Another reason", "read", "by_firm", t.sourceId],
    ]);
    expect(cancelled[1]?.sourceCancelledAt).toBe(new Date(NOW.getTime() - HOUR).toISOString());
    expect(
      Number(
        (await su.query("select count(*) from strikes where firm_id = $1", [t.f.firmId])).rows[0]
          ?.count,
      ),
    ).toBe(0);
  });
});

describe("people and a connector's sessions", () => {
  it("can't book or cancel them in ShiftDesk: the firm's system holds who's booked", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    const cat = await t.casual("STAFF-CAT");
    await t.changed(session([isBooked("STAFF-ANN")]));
    const shiftId = await t.shiftId();
    const admin = await t.f.office("admin");
    const at = { clock: { now: () => NOW } };
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId, workerId: cat, by: { type: "office", id: admin, overrides: [] } },
        at,
      ),
    ).toEqual({ status: "needs_approval" });
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId, workerId: cat, by: { type: "worker", id: cat } },
        at,
      ),
    ).toEqual({ status: "needs_approval" });
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        { shiftId, workerId: ann, reason: "Unwell", by: { type: "worker", id: ann } },
        at,
      ),
    ).toEqual({ status: "needs_approval" });
    expect(await t.booked()).toEqual([
      { ref: "STAFF-ANN", status: "confirmed", booked_via: "api" },
    ]);
    // Switched off, its sessions are ShiftDesk's again.
    await su.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId, workerId: cat, by: { type: "office", id: admin, overrides: [] } },
        at,
      ),
    ).toMatchObject({ status: "booked" });
  });
});

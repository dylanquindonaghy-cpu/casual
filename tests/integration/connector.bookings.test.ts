import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR, MINUTE } from "@/lib/auth/clock";
import { applyConnectorEvent, type ConnectorApplyDeps } from "@/lib/connector/apply";
import { mirrorBookings, mirrorCancellations } from "@/lib/connector/bookings";
import { demoPortal } from "@/lib/connector/demo-portal";
import { receiveConnectorEvent } from "@/lib/connector/job";
import { fakeConnectorTransport } from "@/lib/connector/transport";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { FIRM_CHANGE_REASONS } from "@/lib/roster/firm-reasons";
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

  it("cancelled there: cancelled here, never a strike, notice from the system's own time when it's since the last read, else from the read", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    const ben = await t.casual("STAFF-BEN");
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-BEN")]));
    // Read at NOW; the system cancels Ann an hour later (her own time is since that read), and
    // reports Ben's with a time before the read (it can't be his: the reading that favours him) and
    // a reason that isn't one of ours.
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
          change_reason: "constructor",
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
    // Hidden from casuals (a connector's sessions come in hidden): gone, as any hidden session.
    const workerBooks = () =>
      bookShift(
        withFirm,
        t.f.firmId,
        { shiftId, workerId: cat, by: { type: "worker", id: cat } },
        at,
      );
    expect(await workerBooks()).toEqual({ status: "not_found" });
    await su.query("update shifts set showing_to_casuals = true where id = $1", [shiftId]);
    expect(await workerBooks()).toEqual({ status: "needs_approval" });
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

describe("reads of a session, and changes the planner's rules refuse", () => {
  it("a cancellation lands even when the change beside it is refused, and before it: places lowered past a cancelled casual's place", async () => {
    const t = await bookingsFirm();
    for (const ref of ["STAFF-ANN", "STAFF-BEN", "STAFF-CAT"]) await t.casual(ref);
    const three = [isBooked("STAFF-ANN"), isBooked("STAFF-BEN"), isBooked("STAFF-CAT")];
    await t.changed(session(three, { places: 3 }));
    // Cat (in the third place) cancelled there, and the places lowered to 2, in one read.
    const result = await t.changed(
      session(
        [
          isBooked("STAFF-ANN"),
          isBooked("STAFF-BEN"),
          {
            staff_ref: "STAFF-CAT",
            status: "cancelled",
            cancelled_at: new Date(NOW.getTime() + 30 * MINUTE).toISOString(),
          },
        ],
        { places: 2 },
      ),
      new Date(NOW.getTime() + HOUR),
    );
    expect(result).toEqual({ status: "applied", code: "updated" });
    expect(await t.booked()).toEqual([
      { ref: "STAFF-ANN", status: "confirmed", booked_via: "api" },
      { ref: "STAFF-BEN", status: "confirmed", booked_via: "api" },
      { ref: "STAFF-CAT", status: "cancelled_firm", booked_via: "api" },
    ]);
    const { rows } = await su.query("select headcount from shifts where id = $1", [
      await t.shiftId(),
    ]);
    expect(rows[0]?.headcount).toBe(2);
  });

  it("a read older than the session's last changes nothing: no booking or cancellation that never happened", async () => {
    const t = await bookingsFirm();
    await t.casual("STAFF-ANN");
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
    await t.changed(session([isBooked("STAFF-ANN")]), NOW);
    // Read at 11:00: cancelled there at 10:00.
    const cancelledThere = {
      staff_ref: "STAFF-ANN",
      status: "cancelled",
      cancelled_at: at(60).toISOString(),
    };
    await t.changed(session([cancelledThere], { places: 3 }), at(120));
    // Then a read taken at 09:30 (a pull's list, applied late) arrives: she's booked there.
    expect(await t.changed(session([isBooked("STAFF-ANN")], { places: 2 }), at(30))).toEqual({
      status: "ignored",
      code: "older_read",
    });
    expect(await t.booked()).toEqual([
      { ref: "STAFF-ANN", status: "cancelled_firm", booked_via: "api" },
    ]);
    expect((await eventsOf(t.f.firmId, "shift.assigned")).length).toBe(1);
    expect((await eventsOf(t.f.firmId, "shift.cancelled")).length).toBe(1);
    const { rows } = await su.query("select headcount, source_read_at from shifts where id = $1", [
      await t.shiftId(),
    ]);
    expect(rows[0]).toEqual({ headcount: 3, source_read_at: at(120) });
    // A late read that sends no bookings: its session change isn't applied either.
    expect(await t.changed(session([], { places: 2, bookings: undefined }), at(30))).toEqual({
      status: "ignored",
      code: "older_read",
    });

    // The other way round: booked again there (newer), then a late read saying she's cancelled.
    const u = await bookingsFirm();
    await u.casual("STAFF-ANN");
    await u.changed(session([isBooked("STAFF-ANN")]), NOW);
    await u.changed(session([isBooked("STAFF-ANN")]), at(120));
    expect(await u.changed(session([cancelledThere], { places: 4 }), at(90))).toEqual({
      status: "ignored",
      code: "older_read",
    });
    expect(await u.booked()).toEqual([
      { ref: "STAFF-ANN", status: "confirmed", booked_via: "api" },
    ]);
    const after = await su.query("select headcount from shifts where id = $1", [await u.shiftId()]);
    expect(after.rows[0]?.headcount).toBe(2);
  });

  it("a session cancelled there is the planner's whole-session cancel: its casuals told, its reason on each", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    const ben = await t.casual("STAFF-BEN");
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-BEN")]), NOW);
    const off = (bookings: unknown[], o: Record<string, unknown> = {}) =>
      session(bookings, { status: "cancelled", ...o });
    const theirs = [
      { staff_ref: "STAFF-ANN", status: "cancelled" },
      { staff_ref: "STAFF-BEN", status: "cancelled" },
    ];
    // With no reason: refused, logged for the office, and nobody's booking touched.
    expect(await t.changed(off(theirs), new Date(NOW.getTime() + HOUR))).toEqual({
      status: "refused",
      code: "change_reason_required",
    });
    expect((await t.booked()).map((b) => b.status)).toEqual(["confirmed", "confirmed"]);
    expect((await eventsOf(t.f.firmId, "api.change_refused")).length).toBe(1);

    // With one: the whole session, each casual's cancellation with the session's reason, told.
    expect(
      await t.changed(
        off(theirs, { change_reason: "weather" }),
        new Date(NOW.getTime() + 2 * HOUR),
      ),
    ).toEqual({ status: "applied", code: "cancelled" });
    const cancelled = await eventsOf(t.f.firmId, "shift.cancelled");
    expect(cancelled.map((d) => [d.workerId, d.reason, d.place])).toEqual([
      [ann, "Weather or safety", "session_cancelled"],
      [ben, "Weather or safety", "session_cancelled"],
    ]);
    expect((await eventsOf(t.f.firmId, "shift.cancelled_by_firm"))[0]?.bookings).toBe(2);
    expect(
      Number(
        (
          await su.query(
            "select count(*) from pgboss.job where name = 'firm-change-notice' and data ->> 'firmId' = $1",
            [t.f.firmId],
          )
        ).rows[0]?.count,
      ),
    ).toBe(2);
  });

  it("the system's own time counts only after the booking here; the latest of its cancellations; a time without its zone reads as none", async () => {
    const t = await bookingsFirm();
    await t.casual("STAFF-ANN");
    await t.casual("STAFF-BEN");
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-BEN")]), NOW);
    // A session with no read on record (one from before reads were kept).
    await su.query("update shifts set source_read_at = null where id = $1", [await t.shiftId()]);
    const read = new Date(NOW.getTime() + 4 * HOUR);
    expect(
      await t.changed(
        session([
          // Before Ann was booked here: not hers.
          {
            staff_ref: "STAFF-ANN",
            status: "cancelled",
            cancelled_at: new Date(NOW.getTime() - HOUR).toISOString(),
          },
          // Ben cancelled twice there: the later one is his (listed first here).
          {
            staff_ref: "STAFF-BEN",
            status: "cancelled",
            cancelled_at: new Date(NOW.getTime() + 3 * HOUR).toISOString(),
            change_reason: "weather",
          },
          {
            staff_ref: "STAFF-BEN",
            status: "cancelled",
            cancelled_at: new Date(NOW.getTime() + HOUR).toISOString(),
          },
        ]),
        read,
      ),
    ).toMatchObject({ status: "applied" });
    const cancelled = await eventsOf(t.f.firmId, "shift.cancelled");
    expect(cancelled.map((d) => [d.noticeFrom, d.sourceCancelledAt, d.reason])).toEqual([
      ["read", new Date(NOW.getTime() - HOUR).toISOString(), "Another reason"],
      ["source", new Date(NOW.getTime() + 3 * HOUR).toISOString(), "Weather or safety"],
    ]);

    const u = await bookingsFirm();
    await u.casual("STAFF-CAT");
    await u.changed(session([isBooked("STAFF-CAT")]), NOW);
    await u.changed(
      session([
        { staff_ref: "STAFF-CAT", status: "cancelled", cancelled_at: "2026-11-02T10:00:00" },
      ]),
      read,
    );
    const [cat] = await eventsOf(u.f.firmId, "shift.cancelled");
    expect(cat?.noticeFrom).toBe("read");
    expect(cat?.sourceCancelledAt).toBeUndefined();
  });

  it("a booking cancelled here while the system still lists it isn't booked again", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    await t.changed(session([isBooked("STAFF-ANN")]), NOW);
    // Switched off, Ann cancels in the app; switched back on, the system still lists her.
    await su.query("update roster_sources set enabled = false where id = $1", [t.sourceId]);
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: await t.shiftId(),
          workerId: ann,
          reason: "Unwell",
          by: { type: "worker", id: ann },
        },
        { clock: { now: () => NOW } },
      ),
    ).toMatchObject({ status: "cancelled" });
    await su.query("update roster_sources set enabled = true where id = $1", [t.sourceId]);
    for (const hours of [1, 2]) {
      await t.changed(session([isBooked("STAFF-ANN")]), new Date(NOW.getTime() + hours * HOUR));
    }
    expect(await t.booked()).toEqual([
      { ref: "STAFF-ANN", status: "cancelled_worker", booked_via: "api" },
    ]);
  });

  it("a refusal is said again once something about that casual on the session happened since", async () => {
    const t = await bookingsFirm();
    const dan = await t.casual("STAFF-DAN");
    await t.casual("STAFF-ANN");
    const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
    const cancelledAt = (ref: string, hours: number) => ({
      staff_ref: ref,
      status: "cancelled",
      cancelled_at: at(hours).toISOString(),
    });
    // One place: Ann has it, Dan refused (no place), twice over.
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-DAN")], { places: 1 }), at(0));
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-DAN")], { places: 1 }), at(1));
    // Ann cancelled there: Dan gets the place; then Dan cancelled and Ann booked again.
    await t.changed(
      session([cancelledAt("STAFF-ANN", 1.5), isBooked("STAFF-DAN")], { places: 1 }),
      at(2),
    );
    await t.changed(
      session([isBooked("STAFF-ANN"), cancelledAt("STAFF-DAN", 2.5)], { places: 1 }),
      at(3),
    );
    // Dan booked there again with no place: said again (he was booked and cancelled since).
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-DAN")], { places: 1 }), at(4));
    const refused = (await eventsOf(t.f.firmId, "shift.booking_refused")).filter(
      (d) => d.workerId === dan,
    );
    expect(refused.map((d) => d.codes)).toEqual([["no_place"], ["no_place"]]);
  });
});

describe("the office and a connector's bookings", () => {
  it("a session cancelled there with no reason: refused, and the office can still end each booking here", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    await t.changed(session([isBooked("STAFF-ANN")]), NOW);
    expect(
      await t.changed(
        session([{ staff_ref: "STAFF-ANN", status: "cancelled" }], { status: "cancelled" }),
        new Date(NOW.getTime() + HOUR),
      ),
    ).toEqual({ status: "refused", code: "change_reason_required" });
    const admin = await t.f.office("admin");
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: await t.shiftId(),
          workerId: ann,
          reason: FIRM_CHANGE_REASONS.other,
          by: { type: "office", id: admin },
        },
        { clock: { now: () => NOW } },
      ),
    ).toMatchObject({ status: "cancelled" });
  });

  it("a booking the system lists again is the system's again, even while the session's change is refused", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    await t.casual("STAFF-BEN");
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-BEN")]), NOW);
    await t.changed(session([isBooked("STAFF-BEN")]), new Date(NOW.getTime() + HOUR));
    // Booked there again, beside a new role the planner's rules refuse (they're booked).
    expect(
      await t.changed(
        session([isBooked("STAFF-ANN"), isBooked("STAFF-BEN")], { role_name: "Door Supervisor" }),
        new Date(NOW.getTime() + 2 * HOUR),
      ),
    ).toEqual({ status: "refused", code: "session_has_bookings" });
    const admin = await t.f.office("admin");
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: await t.shiftId(),
          workerId: ann,
          reason: FIRM_CHANGE_REASONS.other,
          by: { type: "office", id: admin },
        },
        { clock: { now: () => NOW } },
      ),
    ).toEqual({ status: "needs_approval" });
  });

  it("Gate B inside each step: no agreement recorded on a live database, nothing mirrored", async () => {
    const t = await bookingsFirm();
    await t.casual("STAFF-ANN");
    await t.changed(session([isBooked("STAFF-ANN")]), NOW);
    const input = {
      run: withFirm,
      firmId: t.f.firmId,
      by: { type: "connector" as const, sourceId: t.sourceId },
      ref: "PORTAL-S1",
      bookings: { booked: [], cancelled: [{ ref: "STAFF-ANN", at: null, reason: null }] },
      readAt: new Date(NOW.getTime() + HOUR),
      now: new Date(NOW.getTime() + HOUR),
      localDatabase: false,
    };
    expect(await mirrorCancellations(input)).toBe("agreement_not_recorded");
    expect(await mirrorBookings(input)).toBe("agreement_not_recorded");
    expect((await t.booked()).map((b) => b.status)).toEqual(["confirmed"]);
  });

  it("may cancel here a booking the system no longer lists, never one it lists; a casual can't", async () => {
    const t = await bookingsFirm();
    const ann = await t.casual("STAFF-ANN");
    const ben = await t.casual("STAFF-BEN");
    await t.changed(session([isBooked("STAFF-ANN"), isBooked("STAFF-BEN")]), NOW);
    // The system stops listing Ann: kept here, as ever.
    await t.changed(session([isBooked("STAFF-BEN")]), new Date(NOW.getTime() + HOUR));
    const shiftId = await t.shiftId();
    const admin = await t.f.office("admin");
    const cancel = (
      workerId: string,
      by: { type: "office"; id: string } | { type: "worker"; id: string },
    ) =>
      cancelBooking(
        withFirm,
        t.f.firmId,
        { shiftId, workerId, reason: FIRM_CHANGE_REASONS.other, by },
        { clock: { now: () => NOW } },
      );
    expect(await cancel(ann, { type: "worker", id: ann })).toEqual({ status: "needs_approval" });
    expect(await cancel(ben, { type: "office", id: admin })).toEqual({ status: "needs_approval" });
    expect(await cancel(ann, { type: "office", id: admin })).toMatchObject({ status: "cancelled" });
    expect(await t.booked()).toEqual([
      { ref: "STAFF-ANN", status: "cancelled_firm", booked_via: "api" },
      { ref: "STAFF-BEN", status: "confirmed", booked_via: "api" },
    ]);
  });

  it("a session a planner key made, which the connector never reads, is the office's to book", async () => {
    const t = await bookingsFirm();
    const cat = await t.casual("STAFF-CAT");
    const keyShift = await t.f.shift({ startsAt: START });
    await su.query("update shifts set source = 'api', external_ref = 'KEY-S1' where id = $1", [
      keyShift,
    ]);
    const admin = await t.f.office("admin");
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: keyShift, workerId: cat, by: { type: "office", id: admin, overrides: [] } },
        { clock: { now: () => NOW } },
      ),
    ).toMatchObject({ status: "booked" });
  });
});

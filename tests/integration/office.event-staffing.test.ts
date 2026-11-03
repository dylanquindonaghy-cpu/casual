import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { offerOnePlace, offerOpenPlaces } from "@/lib/office/event-offers";
import { officeEventBasics, officeEventPage } from "@/lib/office/events";
import { createShifts } from "@/lib/office/shift-editor";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// An event's page, round 8 (Phase 26.5; the spec page's evt-1 to evt-6) on the real database, as the
// app role: every place of its sessions to come laid out by slot (booked with who, open, urgent),
// booked of needed per role, the open places (urgent first) with offers and the cancellation that
// opened each, the event's cancellations and history; "Offer N open places" marking each open
// session urgent through the office's own "Mark urgent" (never one full, started or already
// urgent; never for payroll); and "Add shifts" joining this event, never another firm's. NOW is
// Monday 2 November 2026, 09:00 London.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const clock = { now: () => NOW };

async function arenaDay() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const payroll = await f.office("payroll");
  const { rows } = await su.query<{ id: string }>(
    `insert into sites (firm_id, name, town, postcode) values ($1, 'Arena', 'Exampleton', 'ZZ1 1AA')
     returning id::text as id`,
    [f.firmId],
  );
  const site = rows[0]?.id ?? "";
  const ev = await f.event({ name: "Arena Day" });
  await su.query("update shift_events set site_id = $2 where id = $1", [ev, site]);
  const [ann, ben, cal, dee, eve] = [
    await f.worker({ first: "Ann" }),
    await f.worker({ first: "Ben" }),
    await f.worker({ first: "Cal" }),
    await f.worker({ first: "Dee" }),
    await f.worker({ first: "Eve" }),
  ];
  // Door supervisors tomorrow, 3 places: Ann in place 1, Ben in place 3; Cal had place 2 and
  // cancelled; marked urgent.
  const door = await f.shift({ eventId: ev, startsAt: hoursFromNow(24), headcount: 3 });
  await f.booking(ann, door, "confirmed", 1);
  await f.booking(ben, door, "confirmed", 3);
  await f.booking(cal, door, "cancelled_worker", 2);
  await su.query("update shifts set is_urgent = true where id = $1", [door]);
  // Stewards: 2 places, Dee booked, one offer out; and a full one; and one that has ended.
  const steward = await f.shift({
    eventId: ev,
    role: "steward",
    startsAt: hoursFromNow(20),
    headcount: 2,
  });
  await f.booking(dee, steward, "confirmed", 1);
  await su.query(
    `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
     values ($1, $2, $3, 1, 'whatsapp', $4)`,
    [f.firmId, steward, eve, hoursFromNow(-1)],
  );
  const full = await f.shift({ eventId: ev, role: "steward", startsAt: hoursFromNow(30) });
  await f.booking(eve, full, "confirmed", 1);
  const ended = await f.shift({ eventId: ev, startsAt: hoursFromNow(-30) });
  const token = async (officeUserId: string) =>
    (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
      )
    ).token;
  const ctx = (officeUserId: string) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock,
  });
  return {
    f,
    resourcer,
    payroll,
    ev,
    door,
    steward,
    full,
    ended,
    ann,
    ben,
    cal,
    dee,
    eve,
    token,
    ctx,
  };
}

const pageOf = async (t: Awaited<ReturnType<typeof arenaDay>>) => {
  const page = await officeEventPage(
    { firm: { id: t.f.firmId }, run: withFirm, clock },
    await t.token(t.resourcer),
    t.ev,
  );
  if (!page) throw new Error("no page");
  return page.staffing;
};

// The Interested tab (Phase 26.6, evt-2): who asked for the event's sessions still to come, one
// group per session, soonest first, those waiting before those told "Not this time"; a session
// that has ended, or a casual since booked or whose ask closed, isn't listed. The tab's count is
// those waiting.
describe("the Interested tab", () => {
  it("who asked, by session soonest first, waiting before not this time", async () => {
    const t = await arenaDay();
    const ask = (shiftId: string, workerId: string, status: string, hoursAgo: number) =>
      su.query(
        `insert into session_asks (firm_id, shift_id, worker_id, status, asked_at, answered_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          t.f.firmId,
          shiftId,
          workerId,
          status,
          hoursFromNow(-hoursAgo),
          status === "asked" ? null : hoursFromNow(-1),
        ],
      );
    const fay = await t.f.worker({ first: "Fay" });
    const gus = await t.f.worker({ first: "Gus" });
    // Stewards (in 20 hours): Gus asked first but was told "Not this time"; Fay asked after.
    await ask(t.steward, gus, "not_this_time", 5);
    await ask(t.steward, fay, "asked", 3);
    // Door supervisors (in 24 hours): Fay waiting; Gus's ask closed when it filled (not listed).
    await ask(t.door, fay, "asked", 2);
    await ask(t.door, gus, "closed", 4);
    // The session that has ended: not listed.
    await ask(t.ended, gus, "asked", 40);
    const page = await officeEventPage(
      { firm: { id: t.f.firmId }, run: withFirm, clock },
      await t.token(t.resourcer),
      t.ev,
    );
    expect(page?.casualsAsk).toBe(false);
    expect(page?.interested.map((a) => [a.shiftId, a.name, a.waiting])).toEqual([
      [t.steward, "Fay Booker", true],
      [t.steward, "Gus Booker", false],
      [t.door, "Fay Booker", true],
    ]);
    // The tab's count: those waiting.
    expect(page?.interested.filter((a) => a.waiting)).toHaveLength(2);
  });
});

describe("the staffing layout and the open places", () => {
  it("every place of the sessions to come, by slot; booked of needed per role", async () => {
    const t = await arenaDay();
    const st = await pageOf(t);
    expect(st.venue).toEqual({ name: "Arena", town: "Exampleton", postcode: "ZZ1 1AA" });
    // The ended session isn't laid out; the rest in time order.
    expect(st.sessions.map((s) => s.shiftId)).toEqual([t.steward, t.door, t.full]);
    expect(st.sessions[1]?.places).toEqual([
      { slot: 1, state: "booked", worker: { id: t.ann, name: "Ann Booker" } },
      { slot: 2, state: "urgent", worker: null },
      { slot: 3, state: "booked", worker: { id: t.ben, name: "Ben Booker" } },
    ]);
    expect(st.sessions[0]?.places.map((p) => p.state)).toEqual(["booked", "open"]);
    // Roles in the order their first sessions start.
    expect(st.roles.map((r) => [r.role, r.booked, r.needed])).toEqual([
      ["steward", 2, 3],
      ["door_supervisor", 2, 3],
    ]);
    expect(st.roles[1]?.requirements.join()).toMatch(/door supervisor/i);
    expect([st.booked, st.needed]).toEqual([4, 6]);
  });

  it("the open places: urgent first, its offers, and the cancellation that opened it", async () => {
    const t = await arenaDay();
    const st = await pageOf(t);
    expect(st.open.map((o) => [o.shiftId, o.urgent, o.placesFree, o.offers])).toEqual([
      [t.door, true, 1, 0],
      [t.steward, false, 1, 1],
    ]);
    expect(st.open[0]?.lastCancel).toEqual({
      worker: "Cal Booker",
      at: hoursFromNow(-50),
      noticeHours: 20,
      byCasual: true,
      strike: null,
    });
    expect(st.open[1]?.lastCancel).toBeNull();
    expect(st.cancellations.map((c) => [c.worker, c.byCasual, c.role])).toEqual([
      ["Cal Booker", true, "door_supervisor"],
    ]);
  });
});

describe("Offer N open places", () => {
  it("marks each open session urgent (not one full, ended or already urgent), logged; again: nothing", async () => {
    const t = await arenaDay();
    expect(await offerOpenPlaces(t.ctx(t.resourcer), t.ev)).toEqual({
      status: "offered",
      sessions: 1,
      hidden: 0,
    });
    const { rows } = await su.query<{ id: string; is_urgent: boolean }>(
      "select id::text, is_urgent from shifts where event_id = $1 order by starts_at",
      [t.ev],
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.is_urgent]))).toEqual({
      [t.ended]: false,
      [t.door]: true,
      [t.steward]: true,
      [t.full]: false,
    });
    const { rows: logged } = await su.query(
      "select 1 from events where firm_id = $1 and action = 'shift.marked_urgent' and entity_id = $2",
      [t.f.firmId, t.steward],
    );
    expect(logged).toHaveLength(1);
    expect((await pageOf(t)).history.length).toBeGreaterThan(0);
    expect(await offerOpenPlaces(t.ctx(t.resourcer), t.ev)).toEqual({ status: "none" });
  });

  it("payroll can't; an event that isn't there (or another firm's) is not found", async () => {
    const t = await arenaDay();
    const other = await arenaDay();
    expect(await offerOpenPlaces(t.ctx(t.payroll), t.ev)).toEqual({ status: "not_allowed" });
    expect(await offerOpenPlaces(t.ctx(t.resourcer), other.ev)).toEqual({ status: "not_found" });
    expect(await offerOpenPlaces(t.ctx(t.resourcer), "not-a-uuid")).toEqual({
      status: "not_found",
    });
  });
});

describe("offering one open place (Phase 26.5's guardrails review)", () => {
  it("while its offers are going out there's nothing to do; once they stopped, they start again (logged)", async () => {
    const t = await arenaDay();
    // The door session is urgent with no stop: its offers are going out.
    expect((await pageOf(t)).open.find((o) => o.shiftId === t.door)?.offering).toBe(true);
    expect(await offerOnePlace(t.ctx(t.resourcer), t.door)).toEqual({
      status: "already_offering",
    });
    // Its waves stopped at wave 1 (nobody left to offer it to, say).
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'system', 'offer.waves_stopped', 'shift', $2, '{"reason":"no_candidates","wave":1}')`,
      [t.f.firmId, t.door],
    );
    expect((await pageOf(t)).open.find((o) => o.shiftId === t.door)?.offering).toBe(false);
    expect(await offerOnePlace(t.ctx(t.resourcer), t.door)).toEqual({ status: "offering" });
    const { rows: logged } = await su.query(
      "select 1 from events where firm_id = $1 and action = 'shift.offers_restarted' and entity_id = $2",
      [t.f.firmId, t.door],
    );
    expect(logged).toHaveLength(1);
    const { rows: waves } = await su.query(
      "select data from pgboss.job where name = 'offer-wave' and data ->> 'shiftId' = $1",
      [t.door],
    );
    expect(waves.length).toBeGreaterThan(0);
    // A full session, or one that has ended: nothing to offer.
    expect(await offerOnePlace(t.ctx(t.resourcer), t.full)).toEqual({ status: "full" });
    expect(await offerOnePlace(t.ctx(t.resourcer), t.ended)).toEqual({ status: "full" });
    expect(await offerOnePlace(t.ctx(t.payroll), t.steward)).toEqual({ status: "not_allowed" });
  });

  it("Offer N open places covers only the firm's urgent window (24 hours by default)", async () => {
    const t = await arenaDay();
    const later = await t.f.shift({
      eventId: t.ev,
      role: "steward",
      startsAt: hoursFromNow(72),
      headcount: 2,
    });
    const st = await pageOf(t);
    // The steward session's 1 free place (20 hours away); not the one 3 days away, nor the door
    // session's (its offers are going out).
    expect(st.offerNow).toBe(1);
    await offerOpenPlaces(t.ctx(t.resourcer), t.ev);
    const { rows } = await su.query<{ is_urgent: boolean }>(
      "select is_urgent from shifts where id = $1",
      [later],
    );
    expect(rows[0]?.is_urgent).toBe(false);
  });
});

describe("Add shifts (to this event)", () => {
  const add = (t: Awaited<ReturnType<typeof arenaDay>>, extra: Record<string, unknown>) =>
    createShifts(t.ctx(t.resourcer), {
      date: "2026-11-07",
      siteId: "",
      instructions: "",
      lines: [{ role: "steward", start: "10:00", end: "18:00", headcount: "2" }],
      ...extra,
    });

  it("joins this event", async () => {
    const t = await arenaDay();
    const r = await add(t, { eventId: t.ev });
    if (r.status !== "created") throw new Error(r.status);
    const { rows } = await su.query<{ event_id: string }>(
      "select event_id::text from shifts where id = $1",
      [r.shiftIds[0]],
    );
    expect(rows[0]?.event_id).toBe(t.ev);
  });

  it("never another firm's event, one that isn't there, or with a new event's name", async (ctx) => {
    void ctx;
    const t = await arenaDay();
    const other: BookingFirm = (await arenaDay()).f;
    const theirs = await other.event({ name: "Theirs" });
    // A site and day's automatic event, and a planner's: they own their events.
    const auto = (
      await su.query<{ id: string }>(
        `insert into shift_events (firm_id, name, planner_ref) values ($1, 'Arena · Sat 7 Nov', 'auto:none:2026-11-07')
         returning id::text as id`,
        [t.f.firmId],
      )
    ).rows[0]?.id;
    const planners = (
      await su.query<{ id: string }>(
        `insert into shift_events (firm_id, name, source, planner_ref) values ($1, 'Their Day', 'api', 'EV-1')
         returning id::text as id`,
        [t.f.firmId],
      )
    ).rows[0]?.id;
    for (const extra of [
      { eventId: auto },
      { eventId: planners },
      { eventId: theirs },
      { eventId: "11111111-1111-4111-8111-111111111111" },
      { eventId: "not-a-uuid" },
      { eventId: t.ev, eventName: "A new one" },
    ]) {
      expect(await add(t, extra)).toEqual({
        status: "invalid",
        problems: [{ line: null, problem: "bad_event" }],
      });
    }
  });

  it("the page offers it only for an event the office named, never at a firm whose rota is a sheet", async () => {
    const t = await arenaDay();
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock };
    const token = await t.token(t.resourcer);
    expect(await officeEventBasics(ctx, token, t.ev)).toMatchObject({
      id: t.ev,
      name: "Arena Day",
    });
    expect((await officeEventPage(ctx, token, t.ev))?.canAddShifts).toBe(true);
    await su.query(
      `insert into roster_sources (firm_id, kind, enabled, spreadsheet_id, mapping)
       values ($1, 'sheets', true, $2, '{}')`,
      [t.f.firmId, `test_sheet_${Date.now()}`],
    );
    expect(await officeEventBasics(ctx, token, t.ev)).toBeNull();
    expect((await officeEventPage(ctx, token, t.ev))?.canAddShifts).toBe(false);
  });
});

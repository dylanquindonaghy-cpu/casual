import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadComingUp } from "@/lib/office/coming-up";
import { loadExpiredOnBookings } from "@/lib/office/dashboard";
import { loadBoard } from "@/lib/office/dashboard-board";
import { loadWatchList } from "@/lib/office/dashboard-cards-data";
import { saveContract, saveMyDashboard } from "@/lib/office/contracts";
import { loadCasualRecords } from "@/lib/office/reliability";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The dashboard's Coming up (Phase 27.9; src/lib/office/coming-up.ts) on the real database, as the
// app role: who's working on the person's contracts today and tomorrow, by session, each person by
// name, with their licence flag (the credential rule's own: dashboard.ts outOfDateBookings) and
// their asked flag (a time change or swap waiting for an answer). Only confirmed bookings, only the
// person's contracts' venues, nothing after tomorrow or already ended, the first 6 sessions, and
// another firm's rows never in it. Since Phase 27.10: each session's places to offer (To offer's
// own count), and each person's first shift (nothing marked as worked with the firm before it) and
// watch list (the Watch list card's own rule) flags, another firm's record never counting. NOW is
// Monday 2 November 2026, 09:00 London (GMT): today is Mon 2 Nov, tomorrow Tue 3 Nov, and tomorrow
// ends at 00:00 on Wed 4 Nov (39 hours from now).

const TZ = "Europe/London";
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

const set = (table: string, id: string, cells: Record<string, unknown>) =>
  su.query(
    `update ${table} set ${Object.keys(cells)
      .map((k, i) => `${k} = $${i + 2}`)
      .join(", ")} where id = $1`,
    [id, ...Object.values(cells)],
  );

async function site(f: BookingFirm, name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, $2) returning id::text as id",
    [f.firmId, name],
  );
  return rows[0]?.id ?? "";
}

// A request from the app on a session: open unless said otherwise; an answered one (`by` an office
// user) answered 10 minutes ago.
async function request(
  f: BookingFirm,
  o: {
    worker: string;
    shift: string;
    type: string;
    status?: "open" | "escalated" | "declined";
    by?: string;
    minutesAgo?: number;
  },
): Promise<string> {
  const answered = o.status === "declined";
  const { rows } = await su.query<{ id: string }>(
    `insert into requests (firm_id, worker_id, shift_id, type, payload, status, created_at,
                           resolved_at, resolved_by)
     values ($1, $2, $3, $4, '{}', $5, $6, $7, $8) returning id::text as id`,
    [
      f.firmId,
      o.worker,
      o.shift,
      o.type,
      o.status ?? "open",
      new Date(NOW.getTime() - (o.minutesAgo ?? 30) * 60_000),
      answered ? new Date(NOW.getTime() - 10 * 60_000) : null,
      answered ? (o.by ?? null) : null,
    ],
  );
  return rows[0]?.id ?? "";
}

const load = (f: BookingFirm, mine: string[] | null = null, now = NOW) =>
  withFirm(f.firmId, (tx) => loadComingUp(tx, now, TZ, mine));

// A firm on Monday 2 Nov, 09:00:
// - At the arena (the Raceday event's venue: its sessions have none of their own): door
//   supervisors tonight 19:00 to 03:00 (3 places: Ann and Ben booked, Zed only offered, Yan
//   cancelled), one under way since 07:00 (Cal), and one tomorrow at 23:00 (Eve and Ben again).
// - At the depot (its own venue): a door supervisor tomorrow at 05:00 (Gus).
// - Not in Coming up: one that ended at 07:00 today (Dee), one at 00:00 on Wednesday (Fay), one
//   tonight with nobody confirmed (Hal only offered), a cancelled one with Ivy still on it, and a
//   draft tonight with Jo confirmed (a sheet can draft a booked session: the credential rule and
//   Needs attention read only open and filled ones, so it isn't listed unchecked).
async function scene() {
  const f = await bookingFirm(su, withFirm);
  const arena = await site(f, "Acme Arena");
  const depot = await site(f, "Acme Depot");
  const raceday = await f.event({ name: "Raceday" });
  await set("shift_events", raceday, { site_id: arena });
  const at = (hours: number, o: { headcount?: number; site?: string } = {}) =>
    f
      .shift({ eventId: raceday, startsAt: hoursFromNow(hours), headcount: o.headcount ?? 1 })
      .then(async (id) => {
        if (o.site) await set("shifts", id, { site_id: o.site });
        return id;
      });
  const tonight = await at(10, { headcount: 3 });
  const underway = await at(-2);
  const late = await at(38, { headcount: 2 });
  const depotEarly = await at(20, { site: depot });
  const ended = await at(-10);
  const wednesday = await at(39);
  const offeredOnly = await at(11);
  const cancelled = await at(12);
  await set("shifts", cancelled, { status: "cancelled" });
  const draft = await at(13);
  await set("shifts", draft, { status: "draft" });

  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const cal = await f.worker({ first: "Cal" });
  const dee = await f.worker({ first: "Dee" });
  const eve = await f.worker({ first: "Eve" });
  const fay = await f.worker({ first: "Fay" });
  const gus = await f.worker({ first: "Gus" });
  const hal = await f.worker({ first: "Hal" });
  const ivy = await f.worker({ first: "Ivy" });
  const jo = await f.worker({ first: "Jo" });
  const yan = await f.worker({ first: "Yan" });
  const zed = await f.worker({ first: "Zed" });
  // Ben books before Ann (A to Z is by name, not by when).
  const benTonight = await f.booking(ben, tonight, "confirmed", 2);
  const annTonight = await f.booking(ann, tonight, "confirmed", 1);
  await f.booking(zed, tonight, "offered", 3);
  await f.booking(yan, tonight, "cancelled_worker", 3);
  await f.booking(cal, underway);
  await f.booking(eve, late, "confirmed", 1);
  await f.booking(ben, late, "confirmed", 2);
  await f.booking(gus, depotEarly);
  await f.booking(dee, ended);
  await f.booking(fay, wednesday);
  await f.booking(hal, offeredOnly, "offered");
  await f.booking(ivy, cancelled);
  await f.booking(jo, draft);
  return {
    f,
    arena,
    depot,
    tonight,
    underway,
    late,
    depotEarly,
    ended,
    wednesday,
    offeredOnly,
    cancelled,
    draft,
    ann,
    ben,
    cal,
    eve,
    gus,
    annTonight,
    benTonight,
  };
}

describe("Coming up: which sessions", () => {
  it("not ended, starting before the end of tomorrow, open or filled (not cancelled, not a draft), with a confirmed booking; soonest first", async () => {
    const t = await scene();
    const c = await load(t.f);
    expect(c.sessions.map((s) => s.shiftId)).toEqual([t.underway, t.tonight, t.depotEarly, t.late]);
    expect(c.sessions.map((s) => s.shiftId)).not.toContain(t.draft);
    expect(c.total).toBe(4);
    // Ann, Ben (on two), Cal, Eve and Gus: each counted once.
    expect(c.people).toBe(5);
    expect(c.more).toBe(false);
    // Each with its facts: the arena's from its event, the depot's its own.
    const tonight = c.sessions[1]!;
    expect({ ...tonight, people: undefined }).toEqual({
      shiftId: t.tonight,
      role: "door_supervisor",
      site: "Acme Arena",
      eventName: "Raceday",
      startsAt: hoursFromNow(10),
      endsAt: hoursFromNow(18),
      headcount: 3,
      booked: 2,
      // Zed's offer holds its third place (as the offer page counts it): nothing to offer.
      placesToOffer: 0,
      people: undefined,
    });
    expect(c.sessions[2]?.site).toBe("Acme Depot");
  });

  it("only confirmed bookings: the people listed and the number booked agree, A to Z", async () => {
    const t = await scene();
    const c = await load(t.f);
    const byId = new Map(c.sessions.map((s) => [s.shiftId, s]));
    // Zed only offered, Yan cancelled: neither listed nor counted.
    expect(byId.get(t.tonight)?.people.map((p) => [p.name, p.workerId])).toEqual([
      ["Ann Booker", t.ann],
      ["Ben Booker", t.ben],
    ]);
    expect(byId.get(t.tonight)?.booked).toBe(2);
    expect(byId.get(t.late)?.people.map((p) => p.name)).toEqual(["Ben Booker", "Eve Booker"]);
    // Nothing for one with nobody confirmed, nor for a cancelled one.
    expect(byId.has(t.offeredOnly)).toBe(false);
    expect(byId.has(t.cancelled)).toBe(false);
  });

  it("not after tomorrow, and not once ended: the window moves with the firm's midnight", async () => {
    const t = await scene();
    const ids = async (now: Date) => (await load(t.f, null, now)).sessions.map((s) => s.shiftId);
    expect(await ids(NOW)).not.toContain(t.wednesday);
    expect(await ids(NOW)).not.toContain(t.ended);
    // At 23:59 on Tuesday, Wednesday is tomorrow: its 00:00 session is in. Monday morning's, under
    // way at 09:00 on Monday, has ended: out.
    const tuesdayNight = new Date("2026-11-03T23:59:00Z");
    expect(await ids(tuesdayNight)).toContain(t.wednesday);
    expect(await ids(tuesdayNight)).not.toContain(t.underway);
    // A minute before 07:00 the morning's ended session was still under way.
    expect(await ids(hoursFromNow(-2.1))).toContain(t.ended);
  });

  it("only the person's contracts' venues: a session's own venue, else its event's", async () => {
    const t = await scene();
    expect((await load(t.f, [t.arena])).sessions.map((s) => s.shiftId)).toEqual([
      t.underway,
      t.tonight,
      t.late,
    ]);
    const depot = await load(t.f, [t.depot]);
    expect(depot.sessions.map((s) => s.shiftId)).toEqual([t.depotEarly]);
    expect([depot.total, depot.people]).toEqual([1, 1]);
    // Contracts with no venues yet: nothing.
    expect(await load(t.f, [])).toEqual({ sessions: [], total: 0, people: 0, more: false });
  });

  it("the dashboard loads it for the person's contracts, and only while the card is on", async () => {
    const t = await scene();
    const admin = await t.f.office("admin");
    const resourcer = await t.f.office("resourcer");
    const ctx = (officeUserId: string) => ({
      firm: { id: t.f.firmId },
      officeUserId,
      run: withFirm,
      clock: { now: () => NOW },
    });
    const c = await saveContract(ctx(admin), { clientId: null, name: "Depot", siteIds: [t.depot] });
    const depot = c.status === "saved" ? c.clientId : "";
    const board = (officeUserId: string, everything = false) =>
      withFirm(t.f.firmId, (tx) => loadBoard(tx, NOW, { officeUserId, everything }));
    // The defaults (Coming up on): everything for the admin with no contracts.
    const all = await board(admin);
    expect(all.comingUp?.ok && all.comingUp.data.total).toBe(4);
    // Narrowed to the depot's contract (Coming up and the map, as saved): only the depot's.
    await saveMyDashboard(ctx(resourcer), { clientIds: [depot], cards: ["map", "comingUp"] });
    const mine = await board(resourcer);
    expect(mine.mine).toBe(true);
    expect(mine.comingUp?.ok && mine.comingUp.data.sessions.map((s) => s.shiftId)).toEqual([
      t.depotEarly,
    ]);
    // Show everything: every venue again.
    const everything = await board(resourcer, true);
    expect(everything.comingUp?.ok && everything.comingUp.data.total).toBe(4);
    // A choice saved without it: not loaded.
    await saveMyDashboard(ctx(resourcer), { clientIds: [], cards: ["map", "whoWorked"] });
    expect((await board(resourcer)).comingUp).toBeNull();
  });
});

describe("Coming up: each person's flags", () => {
  it("a licence that won't be in date for the session, from the credential rule (under way too)", async () => {
    const t = await scene();
    // Ann's door supervisor licence runs out today, during tonight's session (it ends Tuesday).
    await su.query(
      `update credentials set expires_on = '2026-11-02' where worker_id = $1 and type = 'SIA_DS'`,
      [t.ann],
    );
    // Cal's ran out last month, and he's working now: the session under way counts.
    await su.query(
      `update credentials set status = 'expired', expires_on = '2026-10-01'
        where worker_id = $1 and type = 'SIA_DS'`,
      [t.cal],
    );
    // Eve's is marked expired by the office, with no date.
    await su.query(
      `update credentials set status = 'expired', expires_on = null
        where worker_id = $1 and type = 'SIA_DS'`,
      [t.eve],
    );
    const c = await load(t.f);
    const flags = c.sessions.flatMap((s) =>
      s.people.map((p) => [s.shiftId, p.name, p.licence] as const),
    );
    expect(flags).toEqual([
      [
        t.underway,
        "Cal Booker",
        { credential: "SIA door supervisor licence", expiresOn: "2026-10-01" },
      ],
      [
        t.tonight,
        "Ann Booker",
        { credential: "SIA door supervisor licence", expiresOn: "2026-11-02" },
      ],
      [t.tonight, "Ben Booker", null],
      [t.depotEarly, "Gus Booker", null],
      [t.late, "Ben Booker", null],
      [t.late, "Eve Booker", { credential: "SIA door supervisor licence", expiresOn: null }],
    ]);
    // Needs attention reads the same rule for sessions to come (not the one under way).
    const { loadExpiredOnBookings } = await import("@/lib/office/dashboard");
    const needs = await withFirm(t.f.firmId, (tx) => loadExpiredOnBookings(tx, NOW, TZ));
    expect(needs.items.map((e) => e.assignmentId)).toContain(t.annTonight);
    expect(needs.items.map((e) => e.shiftId)).not.toContain(t.underway);
  });

  it("asked: an open time change or swap on that session, the first asked; never an answered one or another kind", async () => {
    const t = await scene();
    // Ben: a time change on tonight's (the one shown), then a later one; a swap on tomorrow's.
    const first = await request(t.f, { worker: t.ben, shift: t.tonight, type: "time_change" });
    await request(t.f, { worker: t.ben, shift: t.tonight, type: "time_change", minutesAgo: 5 });
    const swap = await request(t.f, { worker: t.ben, shift: t.late, type: "swap" });
    // Ann: a time change already declined, and a general question about tonight's: no flag.
    await request(t.f, {
      worker: t.ann,
      shift: t.tonight,
      type: "time_change",
      status: "declined",
      by: await t.f.office("resourcer"),
    });
    await request(t.f, { worker: t.ann, shift: t.tonight, type: "general" });
    // Cal: an escalated time change still waits for an answer (as Enquiries counts it).
    const escalated = await request(t.f, {
      worker: t.cal,
      shift: t.underway,
      type: "time_change",
      status: "escalated",
    });
    // Gus: a time change on a session he isn't on here (Ann's tonight): no flag on his own.
    await request(t.f, { worker: t.gus, shift: t.tonight, type: "time_change" });
    const c = await load(t.f);
    const asked = c.sessions.flatMap((s) =>
      s.people.map((p) => [s.shiftId, p.name, p.asked] as const),
    );
    expect(asked).toEqual([
      [t.underway, "Cal Booker", { requestId: escalated, type: "time_change" }],
      [t.tonight, "Ann Booker", null],
      [t.tonight, "Ben Booker", { requestId: first, type: "time_change" }],
      [t.depotEarly, "Gus Booker", null],
      [t.late, "Ben Booker", { requestId: swap, type: "swap" }],
      [t.late, "Eve Booker", null],
    ]);
  });
});

// Phase 27.10 (Dylan, 2026-11-05: "more ctas and data here on the dash but keep it simple").
describe("Coming up: places to offer (Phase 27.10)", () => {
  it("open, not started, a place free under its bookings: To offer's own count, else none", async () => {
    const t = await scene();
    // Tomorrow night's: 4 places, Eve and Ben booked: 2 to offer.
    await set("shifts", t.late, { headcount: 4 });
    // The depot's: 2 places, Gus booked, but marked as filled by the office: none.
    await set("shifts", t.depotEarly, { headcount: 2, status: "filled" });
    // The one under way: 3 places, Cal booked, but it has started: none.
    await set("shifts", t.underway, { headcount: 3 });
    const c = await load(t.f);
    expect(c.sessions.map((s) => [s.shiftId, s.booked, s.headcount, s.placesToOffer])).toEqual([
      [t.underway, 1, 3, 0],
      // 2 of 3 confirmed, but Zed's offer holds the third (as the offer page counts it).
      [t.tonight, 2, 3, 0],
      [t.depotEarly, 1, 2, 0],
      [t.late, 2, 4, 2],
    ]);
    // To offer counts the same: tomorrow night's 2 places, and none of the others is listed.
    const board = await withFirm(t.f.firmId, (tx) => loadBoard(tx, NOW));
    const listed = board.gaps.ok
      ? [...board.gaps.data.toOffer.sessions, ...board.gaps.data.offered.sessions]
      : [];
    expect(board.gaps.ok).toBe(true);
    expect(listed.find((s) => s.shiftId === t.late)?.placesFree).toBe(2);
    const ids = listed.map((s) => s.shiftId);
    for (const id of [t.underway, t.tonight, t.depotEarly]) expect(ids).not.toContain(id);
  });
});

describe("Coming up: first shift and the watch list (Phase 27.10)", () => {
  // A record: `noShows` sessions marked as not attended (the newest), then `worked` marked as
  // worked, each a week before the last (the newest a day ago), as the Watch list's own tests make
  // one (tests/integration/casuals.follow-up.test.ts).
  async function record(f: BookingFirm, workerId: string, worked: number, noShows = 0) {
    for (let i = 0; i < worked + noShows; i++) {
      const s = await f.shift({ role: "steward", startsAt: hoursFromNow(-(i * 7 + 1) * 24) });
      await f.booking(workerId, s, i < noShows ? "no_show" : "completed");
    }
  }
  const flags = (c: Awaited<ReturnType<typeof load>>) =>
    c.sessions.flatMap((s) =>
      s.people.map((p) => [s.shiftId, p.name, p.firstShift, p.watch] as const),
    );

  it("first shift: nothing of theirs marked as worked with the firm before this session", async () => {
    const t = await scene();
    // Ann worked one last week: not her first. Ben didn't turn up to one and cancelled another:
    // neither is worked, so still his first (on both his sessions). Gus worked one that started
    // an hour ago, before his tomorrow morning: not his first. Cal and Eve: nothing at all.
    await record(t.f, t.ann, 1);
    await record(t.f, t.ben, 0, 1);
    await t.f.booking(t.ben, await t.f.shift({ startsAt: hoursFromNow(-200) }), "cancelled_worker");
    await t.f.booking(t.gus, await t.f.shift({ startsAt: hoursFromNow(-1) }), "completed");
    const c = await load(t.f);
    expect(flags(c).map(([id, name, first]) => [id, name, first])).toEqual([
      [t.underway, "Cal Booker", true],
      [t.tonight, "Ann Booker", false],
      [t.tonight, "Ben Booker", true],
      [t.depotEarly, "Gus Booker", false],
      [t.late, "Ben Booker", true],
      [t.late, "Eve Booker", true],
    ]);
  });

  it("first shift: one worked only after this session started doesn't count for it", async () => {
    const t = await scene();
    // Cal's session under way started 2 hours ago; another of his, marked as worked, started an
    // hour ago (the office marked it early). It isn't before the one under way, so that's still
    // his first; and it's before nothing else he's booked on.
    await t.f.booking(t.cal, await t.f.shift({ startsAt: hoursFromNow(-1) }), "completed");
    // Eve's, marked as worked, started 3 hours ago: before her tomorrow night, so not her first.
    await t.f.booking(t.eve, await t.f.shift({ startsAt: hoursFromNow(-3) }), "completed");
    const c = await load(t.f);
    const first = new Map(flags(c).map(([id, name, f]) => [`${id} ${name}`, f]));
    expect(first.get(`${t.underway} Cal Booker`)).toBe(true);
    expect(first.get(`${t.late} Eve Booker`)).toBe(false);
  });

  it("first shift: the same person's work for another firm never counts", async () => {
    const mine = await scene();
    const theirs = await scene();
    // Ann on both firms' books (one phone number: one person), with three shifts worked for theirs.
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [mine.ann],
    );
    await set("workers", theirs.ann, { mobile_e164: rows[0]?.mobile });
    await record(theirs.f, theirs.ann, 3);
    const ann = (c: Awaited<ReturnType<typeof load>>) =>
      flags(c).find(([, name]) => name === "Ann Booker")?.[2];
    // With us it's still her first; with them it isn't (so this isn't true by accident).
    expect(ann(await load(mine.f))).toBe(true);
    expect(ann(await load(theirs.f))).toBe(false);
  });

  it("the watch list: the Watch list card's own rule (a figure under 90%); new casuals never", async () => {
    const t = await scene();
    // Ann: 4 worked, 2 not attended: 66%, on it. Gus: 9 worked, 1 not: 90%, not on it (the card's
    // line is under 90%). Ben: 5 worked: 100%. Eve: 2 not attended, but under 5 counted: new, no
    // figure, never on it. Cal: nothing.
    await record(t.f, t.ann, 4, 2);
    await record(t.f, t.gus, 9, 1);
    await record(t.f, t.ben, 5);
    await record(t.f, t.eve, 0, 2);
    const c = await load(t.f);
    expect(flags(c).map(([id, name, , watch]) => [id, name, watch])).toEqual([
      [t.underway, "Cal Booker", false],
      [t.tonight, "Ann Booker", true],
      [t.tonight, "Ben Booker", false],
      [t.depotEarly, "Gus Booker", false],
      [t.late, "Ben Booker", false],
      [t.late, "Eve Booker", false],
    ]);
    // The Watch list card holds the same people (everyone here is booked in its 14 days).
    const card = await withFirm(t.f.firmId, (tx) => loadWatchList(tx, NOW, TZ, null));
    expect(card.map((w) => w.workerId)).toEqual([t.ann]);
    // And the record behind it is the casual pages' own.
    const records = await withFirm(t.f.firmId, (tx) =>
      loadCasualRecords(tx, NOW, [t.ann, t.gus, t.eve]),
    );
    expect(records.get(t.ann)?.reliability).toMatchObject({ kind: "figure", percent: 66 });
    expect(records.get(t.gus)?.reliability).toMatchObject({ kind: "figure", percent: 90 });
    expect(records.get(t.eve)?.reliability).toMatchObject({ kind: "new" });
  });

  it("the watch list: another firm's record for the same person never counts", async () => {
    const mine = await scene();
    const theirs = await scene();
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [mine.ben],
    );
    await set("workers", theirs.ben, { mobile_e164: rows[0]?.mobile });
    // Ben didn't turn up to 5 of theirs; with us he's worked 5.
    await record(theirs.f, theirs.ben, 0, 5);
    await record(mine.f, mine.ben, 5);
    const ben = (c: Awaited<ReturnType<typeof load>>) =>
      flags(c).filter(([, name]) => name === "Ben Booker");
    // With us he's 100%; with them he's on it (so this isn't false by accident).
    expect(ben(await load(mine.f)).map(([, , , w]) => w)).toEqual([false, false]);
    expect(ben(await load(theirs.f)).map(([, , , w]) => w)).toEqual([true, true]);
  });
});

describe("Coming up: the first 6", () => {
  it("the first 6 sessions, soonest first, with how many in all and that there are more", async () => {
    const f = await bookingFirm(su, withFirm);
    const made: string[] = [];
    for (let i = 0; i < 8; i++) {
      const s = await f.shift({ startsAt: hoursFromNow(2 + i * 4) });
      await f.booking(await f.worker({ first: `P${i}` }), s);
      made.push(s);
    }
    const c = await load(f);
    expect(c.sessions.map((s) => s.shiftId)).toEqual(made.slice(0, 6));
    expect([c.total, c.people, c.more]).toEqual([8, 8, true]);
    // Exactly 6: none more.
    const six = await bookingFirm(su, withFirm);
    for (let i = 0; i < 6; i++)
      await six.booking(
        await six.worker({ first: `Q${i}` }),
        await six.shift({ startsAt: hoursFromNow(2 + i) }),
      );
    expect((await load(six)).more).toBe(false);
  });
});

describe("Coming up: isolation", () => {
  it("another firm's sessions, people and requests are never in it, even with its venue asked for", async () => {
    const mine = await scene();
    const theirs = await scene();
    await request(theirs.f, { worker: theirs.ben, shift: theirs.tonight, type: "time_change" });
    // Theirs shows on their own (so mine's checks below aren't empty by accident).
    const their = await load(theirs.f);
    expect(their.total).toBe(4);
    expect(their.sessions.flatMap((s) => s.people).some((p) => p.asked)).toBe(true);
    const c = await load(mine.f);
    const theirIds = new Set([theirs.tonight, theirs.underway, theirs.late, theirs.depotEarly]);
    const theirPeople = new Set([theirs.ann, theirs.ben, theirs.cal, theirs.eve, theirs.gus]);
    expect(c.total).toBe(4);
    for (const s of c.sessions) {
      expect(theirIds.has(s.shiftId)).toBe(false);
      for (const p of s.people) {
        expect(theirPeople.has(p.workerId)).toBe(false);
        expect(p.asked).toBeNull();
      }
    }
    // Their venues as "my contracts": nothing (RLS keeps their sessions out of my reads).
    expect(await load(mine.f, [theirs.arena, theirs.depot])).toEqual({
      sessions: [],
      total: 0,
      people: 0,
      more: false,
    });
    // The credential rule asked about their sessions by id, with one of their booked casuals'
    // licences out of date: nothing from my firm's side (and theirs finds it, so this isn't empty
    // by accident).
    await su.query(
      `update credentials set status = 'expired', expires_on = $3
        where firm_id = $1 and worker_id = $2 and type = 'SIA_DS'`,
      [theirs.f.firmId, theirs.ann, "2026-10-20"],
    );
    const theirShifts = [theirs.tonight, theirs.underway, theirs.late, theirs.depotEarly];
    const fromMine = await withFirm(mine.f.firmId, (tx) =>
      loadExpiredOnBookings(tx, NOW, TZ, theirShifts),
    );
    expect(fromMine).toEqual({ items: [], total: 0 });
    const fromTheirs = await withFirm(theirs.f.firmId, (tx) =>
      loadExpiredOnBookings(tx, NOW, TZ, theirShifts),
    );
    expect(fromTheirs.items.map((e) => e.workerId)).toContain(theirs.ann);
  });
});

import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  attentionCount,
  loadDashboard,
  loadExpiredOnBookings,
  officeDashboard,
  type Dashboard,
  type Part,
} from "@/lib/office/dashboard";
import type { OfferState, OfferWhy } from "@/lib/office/dashboard-chart-types";
import {
  loadDays,
  offerState,
  offerStateSql,
  offerWhySql,
} from "@/lib/office/dashboard-charts-load";
import { loadEnquiries } from "@/lib/office/enquiries";
import { eventViewCounts, openPlaces } from "@/lib/office/events";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { localDateOf, mondayOf } from "@/lib/time/zoned";

// The dashboard's six charts (Phase 23, 23.4) on the real database, as the app role (RLS on): each
// chart's counts against the loader the rest of the office uses (Events' "Need people", the urgent
// count, Needs attention's count, the Cancellations count), what each leaves out, and the firm's
// calendar days either side of the clocks going back on Sun 25 Oct 2026. NOW is Monday 2 November
// 2026, 09:00 London (GMT); FRI is Friday 23 October 2026, 10:00 London (BST).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const FRI = new Date("2026-10-23T09:00:00Z");
const SUMMER = new Date("2026-07-15T09:00:00Z"); // Wednesday 10:00 in London (BST)
const at = (iso: string) => new Date(iso);

const ok = <T>(p: Part<T>): T => {
  if (!p.ok) throw new Error("a part couldn't be read");
  return p.data;
};

async function chartFirm(settings?: Record<string, unknown>) {
  const f = await bookingFirm(su, withFirm, settings ? { settings } : {});
  const load = (now = NOW, opts: { pay?: boolean } = {}) =>
    withFirm(f.firmId, (tx) => loadDashboard(tx, now, opts));
  const set = (table: string, id: string, cells: Record<string, unknown>) =>
    su.query(
      `update ${table} set ${Object.keys(cells)
        .map((k, i) => `${k} = $${i + 2}`)
        .join(", ")} where id = $1`,
      [id, ...Object.values(cells)],
    );
  // An offer as the senders write it: in a wave (`wave`) or by the office (`by`), with its answer.
  const offer = async (
    shiftId: string,
    workerId: string,
    o: {
      sentAt: Date;
      response?: string | null;
      respondedAt?: Date;
      wave?: number;
      by?: string;
    },
  ) => {
    const { rows } = await su.query<{ id: string }>(
      `insert into offers (firm_id, shift_id, worker_id, wave, offered_by, channel, sent_at,
                           response, responded_at)
       values ($1, $2, $3, $4, $5, 'sms', $6, $7, $8) returning id::text as id`,
      [
        f.firmId,
        shiftId,
        workerId,
        o.by ? null : (o.wave ?? 1),
        o.by ?? null,
        o.sentAt,
        o.response ?? null,
        o.response ? (o.respondedAt ?? o.sentAt) : null,
      ],
    );
    return rows[0]?.id ?? "";
  };
  const upload = (workerId: string, createdAt: Date, type: string | null = null) =>
    su.query(
      `insert into uploads (firm_id, worker_id, kind, credential_type, content_type, size, sha256,
                            data, created_at)
       values ($1, $2, $3, $4, 'image/jpeg', 3, $5, '\\xffd8ff'::bytea, $6)`,
      [
        f.firmId,
        workerId,
        type ? "certificate" : "photo",
        type,
        randomBytes(32).toString("hex"),
        createdAt,
      ],
    );
  // A message to the shifts line that needs a person: from an unknown number on WhatsApp unless
  // `o` says who sent it (a casual's `workerId`, or `from: null`, a withheld voicemail).
  const enquiry = async (
    createdAt: Date,
    o: {
      workerId?: string | null;
      from?: string | null;
      channel?: "whatsapp" | "sms" | "voice";
      body?: string;
    } = {},
  ) => {
    const { rows } = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, worker_id, handled_at, handled_as, intent, created_at)
       values ($1, 'in', $2, $3, $4, '+447700900962', $5, $6, $7, 'office', 'office', $7)
       returning id::text as id`,
      [
        f.firmId,
        o.channel ?? "whatsapp",
        `SM${randomBytes(16).toString("hex")}`,
        o.from === undefined ? "+447700900961" : o.from,
        o.body ?? "please call me",
        o.workerId ?? null,
        createdAt,
      ],
    );
    return rows[0]?.id ?? "";
  };
  // A booking cancelled at `at` with `notice` hours' notice.
  const cancelled = async (cancelledAt: Date, notice: number, status = "cancelled_worker") => {
    const id = await f.booking(await f.worker(), await f.shift({ startsAt: hoursFromNow(200) }));
    await set("assignments", id, {
      status,
      cancelled_at: cancelledAt,
      cancel_reason: "Unwell",
      notice_hours: notice,
    });
    return id;
  };
  return { ...f, load, set, offer, upload, enquiry, cancelled };
}

describe("places to fill, the next 14 days", () => {
  it("each London day's places and gaps; the gap rows add up to the days' open and urgent places", async () => {
    const t = await chartFirm();
    const other = await chartFirm();
    // Today: one started at 06:00 (2 places, 1 booked: its other place can't be filled now), one
    // urgent at 14:00 (3 places, 1 booked), one plain at 16:00.
    const started = await t.shift({ startsAt: hoursFromNow(-3), headcount: 2 });
    await t.booking(await t.worker(), started);
    const urgent = await t.shift({ startsAt: hoursFromNow(5), headcount: 3 });
    await t.set("shifts", urgent, { is_urgent: true });
    await t.booking(await t.worker(), urgent);
    const plain = await t.shift({ startsAt: hoursFromNow(7) });
    // Its offers: two waiting, one said no, one that couldn't be sent (not offered).
    for (const response of [null, null, "declined", "failed"]) {
      await t.offer(plain, await t.worker(), { sentAt: hoursFromNow(-1), response });
    }
    // Tomorrow: a draft and a cancelled session, in nothing.
    await t.shift({ startsAt: hoursFromNow(24), headcount: 4, status: "draft" });
    await t.shift({ startsAt: hoursFromNow(25), headcount: 4, status: "cancelled" });
    // Wednesday: one marked filled with nobody booked, one booked to its place: full, no gap.
    await t.shift({ startsAt: hoursFromNow(48), headcount: 2, status: "filled" });
    const full = await t.shift({ startsAt: hoursFromNow(50) });
    await t.booking(await t.worker(), full);
    // Thursday: a session switched off, one in an event switched off, and one from the sheet.
    const hiddenSession = await t.shift({ startsAt: hoursFromNow(72) });
    await t.set("shifts", hiddenSession, { showing_to_casuals: false });
    const hiddenEvent = await t.event({ name: "Hidden gala", showing: false });
    const inHidden = await t.shift({ startsAt: hoursFromNow(73), eventId: hiddenEvent });
    const fromSheet = await t.shift({ startsAt: hoursFromNow(74), source: "sheets" });
    // The 14th day (Sun 15 Nov) ends at its midnight: 23:30 is in, Mon 16 Nov 00:30 isn't.
    const last = await t.shift({ startsAt: at("2026-11-15T23:30:00Z") });
    await t.shift({ startsAt: at("2026-11-16T00:30:00Z") });
    // Another firm's gap: never here.
    await other.shift({ startsAt: hoursFromNow(5), headcount: 9 });

    const fill = ok((await t.load()).fill);
    const zero = (date: string) => ({
      date,
      places: 0,
      filled: 0,
      open: 0,
      urgent: 0,
      gapSessions: 0,
      hidden: 0,
    });
    expect(fill.first).toBe("2026-11-02");
    expect(fill.days).toEqual([
      { date: "2026-11-02", places: 6, filled: 2, open: 3, urgent: 2, gapSessions: 2, hidden: 0 },
      zero("2026-11-03"),
      { date: "2026-11-04", places: 3, filled: 3, open: 0, urgent: 0, gapSessions: 0, hidden: 0 },
      // Thursday's two hidden places: the session switched off, and the one in "Hidden gala".
      { date: "2026-11-05", places: 3, filled: 0, open: 3, urgent: 0, gapSessions: 3, hidden: 2 },
      ...[6, 7, 8, 9, 10, 11, 12, 13, 14].map((d) => zero(`2026-11-${String(d).padStart(2, "0")}`)),
      { date: "2026-11-15", places: 1, filled: 0, open: 1, urgent: 0, gapSessions: 1, hidden: 0 },
    ]);
    expect(fill.days).toHaveLength(14);
    expect(fill.more).toBe(false);
    expect(fill.gaps.map((g) => [g.shiftId, g.date])).toEqual([
      [urgent, "2026-11-02"],
      [plain, "2026-11-02"],
      [hiddenSession, "2026-11-05"],
      [inHidden, "2026-11-05"],
      [fromSheet, "2026-11-05"],
      [last, "2026-11-15"],
    ]);
    // The rows add up to each day's bars, and to its hidden places (the rows' own rule).
    for (const day of fill.days) {
      const gaps = fill.gaps.filter((g) => g.date === day.date);
      expect(gaps.reduce((n, g) => n + g.placesFree, 0)).toBe(day.open);
      expect(gaps.filter((g) => g.urgentGap).reduce((n, g) => n + g.placesFree, 0)).toBe(
        day.urgent,
      );
      expect(gaps.filter((g) => g.hidden).reduce((n, g) => n + g.placesFree, 0)).toBe(day.hidden);
      expect(gaps).toHaveLength(day.gapSessions);
    }
    const byId = new Map(fill.gaps.map((g) => [g.shiftId, g]));
    expect(byId.get(urgent)).toMatchObject({
      role: "door_supervisor",
      eventName: "Fixture event",
      headcount: 3,
      booked: 1,
      placesFree: 2,
      urgentGap: true,
      hidden: false,
      startsAt: hoursFromNow(5),
      endsAt: hoursFromNow(13),
      offers: { offered: 0, waiting: 0, declined: 0, accepted: 0, stopped: null },
    });
    expect(byId.get(plain)?.offers).toEqual({
      offered: 3,
      waiting: 2,
      declined: 1,
      accepted: 0,
      stopped: null,
    });
    expect(byId.get(hiddenSession)).toMatchObject({
      hidden: true,
      showing: false,
      eventShowing: true,
    });
    expect(byId.get(inHidden)).toMatchObject({
      hidden: true,
      showing: true,
      eventShowing: false,
      eventName: "Hidden gala",
      eventId: hiddenEvent,
    });
    expect(byId.get(fromSheet)).toMatchObject({ fromSheet: true, fromPlanner: false });
    // The days the chart shares with this week (Phase 18's strip, as it read them: loadDays from
    // this week's Monday for 7) have the same places, and the same sessions to fill.
    const week = await withFirm(t.firmId, (tx) =>
      loadDays(tx, NOW, "Europe/London", mondayOf(localDateOf(NOW, "Europe/London")), 7),
    );
    const shared = week.filter((d) => fill.days.some((f) => f.date === d.date));
    expect(shared).toHaveLength(7);
    for (const d of shared) {
      expect(d).toEqual(fill.days.find((f) => f.date === d.date));
    }
  });

  it("the days either side of the clocks going back (Sun 25 Oct 2026) are London's", async () => {
    const t = await chartFirm();
    const on = async (iso: string) => t.shift({ startsAt: at(iso) });
    await on("2026-10-22T23:30:00Z"); // Fri 23 Oct 00:30 BST: today, started
    const sat = await on("2026-10-24T22:30:00Z"); // Sat 24 Oct 23:30 BST
    const sunEarly = await on("2026-10-24T23:30:00Z"); // Sun 25 Oct 00:30 BST
    const sunLate = await on("2026-10-25T23:30:00Z"); // Sun 25 Oct 23:30 GMT
    const mon = await on("2026-10-26T00:30:00Z"); // Mon 26 Oct 00:30 GMT
    const lastDay = await on("2026-11-05T23:30:00Z"); // Thu 5 Nov 23:30: the 14th day
    await on("2026-11-06T00:30:00Z"); // Fri 6 Nov: the 15th day, out
    const fill = ok((await t.load(FRI)).fill);
    expect(fill.days.map((d) => d.date)).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    const open = Object.fromEntries(
      fill.days.filter((d) => d.places > 0).map((d) => [d.date, [d.places, d.open]]),
    );
    expect(open).toEqual({
      "2026-10-23": [1, 0],
      "2026-10-24": [1, 1],
      "2026-10-25": [2, 2],
      "2026-10-26": [1, 1],
      "2026-11-05": [1, 1],
    });
    expect(fill.gaps.map((g) => [g.shiftId, g.date])).toEqual([
      [sat, "2026-10-24"],
      [sunEarly, "2026-10-25"],
      [sunLate, "2026-10-25"],
      [mon, "2026-10-26"],
      [lastDay, "2026-11-05"],
    ]);
  });

  it("each day's places hidden from casuals count every session, past the 50 rows the chart names", async () => {
    const t = await chartFirm();
    const other = await chartFirm();
    // Tuesday: 50 sessions casuals can see, a place free in each: the chart's 50 rows.
    for (let i = 0; i < 50; i += 1) await t.shift({ startsAt: hoursFromNow(24 + i * 0.1) });
    // Wednesday, after them: a session switched off (3 places, 1 booked), one in an event switched
    // off (2 places), one in it and switched off too (1 place: counted once), and one casuals can
    // see (2 places).
    const off = await t.shift({ startsAt: hoursFromNow(48), headcount: 3 });
    await t.set("shifts", off, { showing_to_casuals: false });
    await t.booking(await t.worker(), off);
    const hiddenFair = await t.event({ name: "Hidden fair", showing: false });
    await t.shift({ startsAt: hoursFromNow(49), headcount: 2, eventId: hiddenFair });
    const both = await t.shift({ startsAt: hoursFromNow(50), eventId: hiddenFair });
    await t.set("shifts", both, { showing_to_casuals: false });
    await t.shift({ startsAt: hoursFromNow(51), headcount: 2 });
    // Hidden, with no place to fill: booked to its places, marked filled, a draft.
    const full = await t.shift({ startsAt: hoursFromNow(52), eventId: hiddenFair });
    await t.booking(await t.worker(), full);
    await t.shift({
      startsAt: hoursFromNow(53),
      headcount: 2,
      eventId: hiddenFair,
      status: "filled",
    });
    await t.shift({
      startsAt: hoursFromNow(54),
      headcount: 2,
      eventId: hiddenFair,
      status: "draft",
    });
    // Today: a session switched off that has started (its place can't be filled now).
    const started = await t.shift({ startsAt: hoursFromNow(-2) });
    await t.set("shifts", started, { showing_to_casuals: false });
    // Another firm's hidden places on Wednesday: never here.
    const theirFair = await other.event({ name: "Their fair", showing: false });
    await other.shift({ startsAt: hoursFromNow(48), headcount: 9, eventId: theirFair });

    const fill = ok((await t.load()).fill);
    // The 50 rows are all Tuesday's, none hidden: Wednesday's hidden sessions are past them.
    expect(fill.gaps).toHaveLength(50);
    expect(fill.more).toBe(true);
    expect(fill.gaps.filter((g) => g.date === "2026-11-03" && !g.hidden)).toHaveLength(50);
    const day = (date: string) => fill.days.find((d) => d.date === date);
    expect(day("2026-11-02")).toEqual({
      date: "2026-11-02",
      places: 1,
      filled: 0,
      open: 0,
      urgent: 0,
      gapSessions: 0,
      hidden: 0,
    });
    // Only places casuals can see.
    expect(day("2026-11-03")).toEqual({
      date: "2026-11-03",
      places: 50,
      filled: 0,
      open: 50,
      urgent: 0,
      gapSessions: 50,
      hidden: 0,
    });
    // 2 + 2 + 1 hidden of the 7 to fill.
    expect(day("2026-11-04")).toEqual({
      date: "2026-11-04",
      places: 11,
      filled: 4,
      open: 7,
      urgent: 0,
      gapSessions: 4,
      hidden: 5,
    });
    expect(fill.days.reduce((n, d) => n + d.hidden, 0)).toBe(5);
    // The other firm's own chart has its 9.
    const theirs = ok((await other.load()).fill);
    expect(theirs.days.find((d) => d.date === "2026-11-04")).toMatchObject({ open: 9, hidden: 9 });
  });
});

describe("which events need people", () => {
  it("every event with a place free, most urgent first, as Events & sessions counts them; full ones named", async () => {
    const t = await chartFirm();
    const alpha = await t.event({ name: "Alpha" });
    const a1 = await t.shift({ startsAt: hoursFromNow(5), headcount: 3, eventId: alpha });
    await t.set("shifts", a1, { is_urgent: true });
    await t.booking(await t.worker(), a1);
    const a2 = await t.shift({ startsAt: hoursFromNow(30), eventId: alpha });
    const bravo = await t.event({ name: "Bravo", showing: false });
    const b1 = await t.shift({ startsAt: hoursFromNow(20), headcount: 3, eventId: bravo });
    const charlie = await t.event({ name: "Charlie" });
    const c1 = await t.shift({ startsAt: hoursFromNow(40), eventId: charlie });
    await t.set("shifts", c1, { showing_to_casuals: false });
    const cFull = await t.shift({ startsAt: hoursFromNow(41), eventId: charlie });
    await t.booking(await t.worker(), cFull);
    const delta = await t.event({ name: "Delta" });
    await t.booking(
      await t.worker(),
      await t.shift({ startsAt: hoursFromNow(10), eventId: delta }),
    );
    await t.shift({ startsAt: hoursFromNow(11), eventId: delta, status: "filled" });
    // Echo: only a session that has started, with a place free: neither needs people nor full.
    const echo = await t.event({ name: "Echo" });
    await t.shift({ startsAt: hoursFromNow(-1), eventId: echo });
    // Foxtrot: called off.
    const foxtrot = await t.event({ name: "Foxtrot" });
    await t.shift({ startsAt: hoursFromNow(15), eventId: foxtrot, status: "cancelled" });
    const golf = await t.event({ name: "Golf" });
    const g1 = await t.shift({ startsAt: hoursFromNow(50), eventId: golf });
    await t.set("shifts", g1, { is_urgent: true });

    const d = await t.load();
    const chart = ok(d.eventsNeed);
    expect(
      chart.events.map((e) => [e.name, e.places, e.urgent, e.gapSessions, e.showing, e.hidden]),
    ).toEqual([
      ["Alpha", 3, 2, 2, true, false],
      ["Golf", 1, 1, 1, true, false],
      ["Bravo", 3, 0, 1, false, true],
      ["Charlie", 1, 0, 1, true, true],
    ]);
    expect(chart.events.find((e) => e.name === "Charlie")?.hiddenSessions).toBe(true);
    expect(chart.events.find((e) => e.name === "Alpha")).toMatchObject({
      eventId: alpha,
      firstGap: hoursFromNow(5),
      moreSessions: false,
    });
    // Each event's rows: its sessions with a place free, soonest first.
    expect(chart.events.map((e) => e.sessions.map((s) => s.shiftId))).toEqual([
      [a1, a2],
      [g1],
      [b1],
      [c1],
    ]);
    for (const e of chart.events) {
      expect(e.sessions.reduce((n, s) => n + s.placesFree, 0)).toBe(e.places);
    }
    expect(chart.more).toBe(0);
    // Bravo (switched off) and Charlie (a session with a place free switched off).
    expect(chart.hiddenEvents).toBe(2);
    expect(chart.full).toEqual(["Delta"]);
    expect(chart.fullMore).toBe(0);
    // The same numbers as Events & sessions' "Need people", its open places and the urgent count.
    const counts = await withFirm(t.firmId, async (tx) => ({
      views: await eventViewCounts(tx, NOW),
      open: await openPlaces(tx, NOW),
    }));
    expect(chart.total).toEqual({
      events: counts.views.need,
      places: counts.open.places,
      urgent: ok(d.counts.urgent).places,
    });
    expect(chart.total).toEqual({ events: 4, places: 8, urgent: 3 });
  });

  it("at most 8 events, the rest counted; the order holds", async () => {
    const t = await chartFirm();
    for (let n = 1; n <= 10; n += 1) {
      const eventId = await t.event({ name: `Fair ${n}` });
      // Fair 10 has the most places; the others one each, soonest first.
      await t.shift({ startsAt: hoursFromNow(10 + n), headcount: n === 10 ? 4 : 1, eventId });
    }
    const chart = ok((await t.load()).eventsNeed);
    expect(chart.events.map((e) => e.name)).toEqual([
      "Fair 10",
      "Fair 1",
      "Fair 2",
      "Fair 3",
      "Fair 4",
      "Fair 5",
      "Fair 6",
      "Fair 7",
    ]);
    expect(chart.more).toBe(2);
    expect(chart.total).toEqual({ events: 10, places: 13, urgent: 0 });
    expect(chart.hiddenEvents).toBe(0);
    const need = await withFirm(t.firmId, (tx) => eventViewCounts(tx, NOW));
    expect(chart.total.events).toBe(need.need);
  });

  it("events with gaps casuals can't see are counted over every event that needs people, past the 8 bars", async () => {
    const t = await chartFirm();
    const other = await chartFirm();
    // Fair 1 to Fair 10, one place each, soonest first: the bars are Fair 1 to Fair 8.
    const fair: string[] = [];
    const first: string[] = [];
    for (let n = 1; n <= 10; n += 1) {
      const eventId = await t.event({ name: `Fair ${n}`, showing: n !== 2 && n !== 10 });
      fair.push(eventId);
      first.push(await t.shift({ startsAt: hoursFromNow(10 + n), eventId }));
    }
    // Hidden: Fair 2 (switched off), Fair 5 and Fair 9 (the session with the place free switched
    // off), Fair 10 (both: counted once). Fair 9 and Fair 10 are past the bars.
    for (const n of [5, 9, 10]) {
      await t.set("shifts", first[n - 1] ?? "", { showing_to_casuals: false });
    }
    // Not hidden: Fair 3's switched-off session is booked to its place (no gap in it).
    const full = await t.shift({ startsAt: hoursFromNow(40), eventId: fair[2] });
    await t.set("shifts", full, { showing_to_casuals: false });
    await t.booking(await t.worker(), full);
    // Not needing people at all: an event switched off whose session is booked, and one whose
    // only session has started.
    const quiet = await t.event({ name: "Quiet gala", showing: false });
    await t.booking(
      await t.worker(),
      await t.shift({ startsAt: hoursFromNow(30), eventId: quiet }),
    );
    const begun = await t.event({ name: "Begun gala", showing: false });
    await t.shift({ startsAt: hoursFromNow(-1), eventId: begun });
    // Another firm's event switched off, with a place free: never counted here.
    const theirs = await other.event({ name: "Their fair", showing: false });
    await other.shift({ startsAt: hoursFromNow(12), eventId: theirs });

    const chart = ok((await t.load()).eventsNeed);
    expect(chart.events.map((e) => e.name)).toEqual([
      "Fair 1",
      "Fair 2",
      "Fair 3",
      "Fair 4",
      "Fair 5",
      "Fair 6",
      "Fair 7",
      "Fair 8",
    ]);
    expect(chart.events.filter((e) => e.hidden).map((e) => e.name)).toEqual(["Fair 2", "Fair 5"]);
    expect(chart.more).toBe(2);
    expect(chart.total).toEqual({ events: 10, places: 10, urgent: 0 });
    expect(chart.hiddenEvents).toBe(4);
    // The other firm's chart has its own one.
    const their = ok((await other.load()).eventsNeed);
    expect(their.total.events).toBe(1);
    expect(their.hiddenEvents).toBe(1);
  });
});

describe("offers this week", () => {
  it("the pay week's offers by state, each closed one with why; failed ones and last week's left out", async () => {
    const t = await chartFirm();
    const office = await t.office("resourcer");
    const open = await t.shift({ startsAt: at("2026-10-24T10:00:00Z") });
    const started = await t.shift({ startsAt: at("2026-10-23T06:00:00Z") });
    const gone = await t.shift({ startsAt: at("2026-10-25T10:00:00Z"), status: "cancelled" });
    const full = await t.shift({ startsAt: at("2026-10-26T10:00:00Z"), status: "filled" });
    const w = async (first: string) => t.worker({ first });
    // Monday 19 Oct 00:30 BST is this week; Sunday 18 Oct 23:59 BST isn't.
    const waitingWave = await t.offer(open, await w("Ada"), {
      sentAt: at("2026-10-21T10:00:00Z"),
    });
    const waitingOffice = await t.offer(open, await w("Bo"), {
      sentAt: at("2026-10-18T23:30:00Z"),
      by: office,
    });
    const no = await t.offer(open, await w("Cy"), {
      sentAt: at("2026-10-20T10:00:00Z"),
      response: "declined",
      respondedAt: at("2026-10-20T11:00:00Z"),
    });
    const elsewhere = await t.offer(open, await w("Di"), {
      sentAt: at("2026-10-20T12:00:00Z"),
      response: "filled_elsewhere",
    });
    const yes = await t.offer(full, await w("Ed"), {
      sentAt: at("2026-10-22T09:00:00Z"),
      response: "accepted",
      respondedAt: at("2026-10-22T10:00:00Z"),
    });
    const expired = await t.offer(gone, await w("Flo"), {
      sentAt: at("2026-10-21T08:00:00Z"),
      response: "expired",
    });
    const noReply = await t.offer(started, await w("Gil"), { sentAt: at("2026-10-19T12:00:00Z") });
    const onCancelled = await t.offer(gone, await w("Hal"), {
      sentAt: at("2026-10-21T09:00:00Z"),
    });
    await t.offer(open, await w("Ike"), { sentAt: at("2026-10-21T10:00:00Z"), response: "failed" });
    await t.offer(open, await w("Jo"), { sentAt: at("2026-10-18T22:59:00Z") });

    const chart = ok((await t.load(FRI)).offersWeek);
    expect(chart.week).toEqual({ monday: "2026-10-19", sunday: "2026-10-25" });
    expect(chart.counts).toEqual({ yes: 1, waiting: 2, closed: 5 });
    expect(chart.closedWhy).toEqual({
      said_no: 1,
      filled_elsewhere: 1,
      changed: 2,
      no_reply: 1,
    });
    expect(chart.rows.waiting.map((r) => [r.offerId, r.byOffice])).toEqual([
      [waitingWave, false],
      [waitingOffice, true],
    ]);
    expect(chart.rows.yes).toEqual([
      {
        offerId: yes,
        shiftId: full,
        workerId: expect.any(String),
        casual: "Ed Booker",
        role: "door_supervisor",
        eventName: "Fixture event",
        startsAt: at("2026-10-26T10:00:00Z"),
        sentAt: at("2026-10-22T09:00:00Z"),
        answeredAt: at("2026-10-22T10:00:00Z"),
        byOffice: false,
        state: "yes",
        why: null,
      },
    ]);
    expect(chart.rows.closed.map((r) => [r.offerId, r.why])).toEqual([
      [onCancelled, "changed"],
      [expired, "changed"],
      [elsewhere, "filled_elsewhere"],
      [no, "said_no"],
      [noReply, "no_reply"],
    ]);
    expect(chart.more).toEqual({ yes: false, waiting: false, closed: false });
    // The sessions still waiting: last week's offer isn't one of this one's.
    expect(chart.waitingSessions).toEqual([
      {
        shiftId: open,
        role: "door_supervisor",
        eventName: "Fixture event",
        startsAt: at("2026-10-24T10:00:00Z"),
        endsAt: at("2026-10-24T18:00:00Z"),
        waiting: 2,
      },
    ]);
    expect(chart.waitingSessionsMore).toBe(false);
  });

  it("the week ends at London's midnight after the 25-hour Sunday", async () => {
    const t = await chartFirm();
    const open = await t.shift({ startsAt: at("2026-10-28T10:00:00Z") });
    // Sunday 25 Oct 23:30 GMT: 7 × 24 hours from Monday's midnight (BST) would have ended at 23:00.
    const sunday = await t.offer(open, await t.worker(), { sentAt: at("2026-10-25T23:30:00Z") });
    const monday = await t.offer(open, await t.worker(), { sentAt: at("2026-10-26T00:10:00Z") });
    const late = ok((await t.load(at("2026-10-25T23:50:00Z"))).offersWeek);
    expect(late.week).toEqual({ monday: "2026-10-19", sunday: "2026-10-25" });
    expect(late.rows.waiting.map((r) => r.offerId)).toEqual([sunday]);
    const next = ok((await t.load(at("2026-10-26T00:30:00Z"))).offersWeek);
    expect(next.week).toEqual({ monday: "2026-10-26", sunday: "2026-11-01" });
    expect(next.rows.waiting.map((r) => r.offerId)).toEqual([monday]);
  });

  it("the SQL rule and its TypeScript twin agree for every answer, session state and start", async () => {
    const t = await chartFirm();
    const ann = await t.worker({ first: "Ann" });
    const RESPONSES = [null, "accepted", "declined", "expired", "filled_elsewhere", "failed"];
    const cases: { shiftId: string; status: string; startsAt: Date }[] = [];
    for (const status of ["draft", "open", "filled", "cancelled"] as const) {
      for (const startsAt of [hoursFromNow(48), hoursFromNow(-0.5)]) {
        const shiftId = await t.shift({ startsAt, status });
        cases.push({ shiftId, status, startsAt });
        for (const [i, response] of RESPONSES.entries()) {
          await t.offer(shiftId, ann, { sentAt: hoursFromNow(-1), response, wave: i + 1 });
        }
      }
    }
    const { rows } = await withFirm(t.firmId, (tx) =>
      tx.execute<{
        response: "accepted" | "declined" | "expired" | "filled_elsewhere" | "failed" | null;
        status: "draft" | "open" | "filled" | "cancelled";
        starts_at: string | Date;
        state: OfferState | null;
        why: OfferWhy | null;
      }>(sql`
        select o.response, s.status, s.starts_at, ${offerStateSql(NOW)} as state,
               ${offerWhySql(NOW)} as why
          from offers o
          join shifts s on s.firm_id = o.firm_id and s.id = o.shift_id
      `),
    );
    expect(rows).toHaveLength(48);
    const tally: Record<OfferState, number> = { yes: 0, waiting: 0, closed: 0 };
    for (const r of rows) {
      const twin = offerState(
        { response: r.response, shiftStatus: r.status, startsAt: new Date(r.starts_at) },
        NOW,
      );
      expect(r.state === null ? null : { state: r.state, why: r.why }, JSON.stringify(r)).toEqual(
        twin,
      );
      if (twin) tally[twin.state] += 1;
    }
    // Only an open session to come waits; 'failed' is never counted.
    expect(tally).toEqual({ yes: 8, waiting: 1, closed: 31 });
    const chart = ok((await t.load()).offersWeek);
    expect(chart.counts).toEqual(tally);
  });
});

describe("how long things have waited", () => {
  it("each dated item on its London day; with the undated ones they add up to the menu's Needs attention count", async () => {
    const t = await chartFirm();
    // Undated: a booking to check (the casual made inactive), a licence out of date on a booking,
    // and the strikes team's address (not set).
    const lena = await t.worker({ first: "Lena" });
    await t.booking(lena, await t.shift({ startsAt: hoursFromNow(48) }));
    await t.set("workers", lena, { status: "inactive" });
    const ben = await t.worker({
      first: "Ben",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-01" }],
    });
    await t.booking(ben, await t.shift({ startsAt: hoursFromNow(60) }));
    // Dated: who worked (ended yesterday at 11:00), three uploads, two enquiries, a strike's
    // evidence email that failed (cancelled Sat 31 Oct).
    const ended = await t.shift({ startsAt: hoursFromNow(-30), headcount: 2 });
    await t.booking(await t.worker(), ended, "confirmed", 1);
    await t.booking(await t.worker(), ended, "confirmed", 2);
    await t.upload(await t.worker({ first: "Ula" }), at("2026-10-30T10:00:00Z"));
    await t.upload(await t.worker({ first: "Uma" }), at("2026-11-01T10:00:00Z"));
    await t.upload(await t.worker({ first: "Uri" }), at("2026-11-02T08:00:00Z"));
    await t.enquiry(at("2026-11-01T12:00:00Z"));
    await t.enquiry(at("2026-11-02T07:00:00Z"));
    const kit = await t.worker({ first: "Kit" });
    const struck = await t.booking(kit, await t.shift({ startsAt: hoursFromNow(-30) }));
    await t.set("assignments", struck, {
      status: "cancelled_worker",
      cancelled_at: at("2026-10-31T10:00:00Z"),
      cancel_reason: "Unwell",
      notice_hours: 10,
    });
    await su.query(
      `insert into strikes (firm_id, worker_id, assignment_id, shift_id, notice_hours,
                            threshold_hours, issued_at, expires_at, evidence_email_status)
       select a.firm_id, a.worker_id, a.id, a.shift_id, 10, 48, $2,
              $2::timestamptz + interval '90 days', 'failed'
         from assignments a where a.id = $1`,
      [struck, at("2026-10-31T10:01:00Z")],
    );

    const d = await t.load();
    const needs = ok(d.needs);
    const waited = ok(d.waited);
    const menu = attentionCount(needs, ok(d.counts.enquiries).needPerson);
    expect(menu).toEqual({ count: 10, more: false });
    expect(waited.needsYouTotal).toBe(menu.count);
    expect(waited.needsYouMore).toBe(menu.more);
    expect(waited.undated).toEqual({ toCheck: 1, fromSheet: 0, expired: 1, strikesAddress: 1 });
    const dated = waited.days.reduce(
      (n, day) => n + Object.values(day.needsYou).reduce((m, k) => m + k, 0),
      0,
    );
    expect(dated + 1 + 0 + 1 + 1).toBe(menu.count);
    const none = {
      "to-mark": 0,
      uploads: 0,
      enquiries: 0,
      evidence: 0,
      "planner-refused": 0,
      webhook: 0,
    };
    expect(waited.days).toEqual([
      { day: "2026-10-30", needsYou: { ...none, uploads: 1 } },
      { day: "2026-10-31", needsYou: { ...none, evidence: 1 } },
      { day: "2026-11-01", needsYou: { ...none, "to-mark": 1, uploads: 1, enquiries: 1 } },
      { day: "2026-11-02", needsYou: { ...none, uploads: 1, enquiries: 1 } },
    ]);
    expect(waited.items.map((i) => [i.kind, i.day])).toEqual([
      ["to-mark", "2026-11-01"],
      ["uploads", "2026-10-30"],
      ["uploads", "2026-11-01"],
      ["uploads", "2026-11-02"],
      ["enquiries", "2026-11-01"],
      ["enquiries", "2026-11-02"],
      ["evidence", "2026-10-31"],
    ]);
    expect(waited.items[0]).toMatchObject({
      kind: "to-mark",
      shiftId: ended,
      since: hoursFromNow(-22),
      unmarked: 2,
    });
    expect(waited.items.find((i) => i.kind === "evidence")).toMatchObject({
      assignmentId: struck,
      casual: "Kit Booker",
      since: at("2026-10-31T10:00:00Z"),
    });
    expect(waited.items.find((i) => i.kind === "uploads")).toMatchObject({
      casual: "Ula Booker",
      upload: "photo",
      since: at("2026-10-30T10:00:00Z"),
    });
    expect(Object.values(waited.more).every((m) => m === false)).toBe(true);
    // Without Pay (loadDashboard's default), no pay query is read.
    expect(waited.pay).toBeNull();
  });

  it("every waiting upload is counted, past the 50 Needs attention names", async () => {
    const t = await chartFirm();
    const { rows: people } = await su.query<{ id: string }>(
      `insert into workers (firm_id, first_name, last_name, mobile_e164, roles, status)
       select $1, 'Up' || n, 'Loader', '+447700900' || lpad((500 + n)::text, 3, '0'),
              array['steward'], 'active'
         from generate_series(1, 60) as n
       returning id::text as id`,
      [t.firmId],
    );
    for (const [i, p] of people.entries()) {
      await t.upload(p.id, i < 25 ? at("2026-10-29T12:00:00Z") : at("2026-11-02T08:00:00Z"));
    }
    const d = await t.load();
    const waited = ok(d.waited);
    expect(waited.days.map((x) => [x.day, x.needsYou.uploads])).toEqual([
      ["2026-10-29", 25],
      ["2026-11-02", 35],
    ]);
    expect(waited.items.filter((i) => i.kind === "uploads")).toHaveLength(50);
    expect(waited.more.uploads).toBe(true);
    const menu = attentionCount(ok(d.needs), ok(d.counts.enquiries).needPerson);
    expect(waited.needsYouTotal).toBe(menu.count);
    expect(menu.count).toBe(61); // the 60 uploads and the strikes team's address
  });

  it("its days start at London's midnight in summer", async () => {
    const t = await chartFirm();
    await t.upload(await t.worker({ first: "Early" }), at("2026-07-14T23:30:00Z")); // 00:30 BST
    await t.upload(await t.worker({ first: "Late" }), at("2026-07-14T22:59:00Z")); // 23:59 BST
    await t.enquiry(at("2026-07-14T23:30:00Z"));
    const waited = ok((await t.load(SUMMER)).waited);
    expect(waited.today).toBe("2026-07-15");
    expect(waited.days.map((x) => [x.day, x.needsYou.uploads, x.needsYou.enquiries])).toEqual([
      ["2026-07-14", 1, 0],
      ["2026-07-15", 1, 1],
    ]);
  });

  it("the enquiries it names are Enquiries' own, oldest first, with who sent them: never their words or their number", async () => {
    const t = await chartFirm();
    const kit = await t.worker({ first: "Kit" });
    const fromKit = await t.enquiry(at("2026-11-01T12:00:00Z"), {
      workerId: kit,
      from: "+447700900971",
      body: "Kit's own words about Saturday",
    });
    const fromNumber = await t.enquiry(at("2026-11-02T07:00:00Z"), {
      from: "+447700900972",
      channel: "sms",
      body: "A stranger's own words",
    });
    const withheld = await t.enquiry(at("2026-11-02T08:00:00Z"), {
      from: null,
      channel: "voice",
      body: "A voicemail's own words",
    });
    // Answered by keyword: needs nobody.
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, handled_at, handled_as, intent, created_at)
       values ($1, 'in', 'sms', $2, '+447700900973', '+447700900962', 'SHIFTS', $3, 'keyword',
               'shifts', $3)`,
      [t.firmId, `SM${randomBytes(16).toString("hex")}`, at("2026-11-02T08:30:00Z")],
    );

    const waited = ok((await t.load()).waited);
    const named = waited.items.filter((i) => i.kind === "enquiries");
    expect(named).toEqual([
      {
        kind: "enquiries",
        since: at("2026-11-01T12:00:00Z"),
        day: "2026-11-01",
        messageId: fromKit,
        channel: "whatsapp",
        who: { kind: "casual", workerId: kit, name: "Kit Booker" },
      },
      {
        kind: "enquiries",
        since: at("2026-11-02T07:00:00Z"),
        day: "2026-11-02",
        messageId: fromNumber,
        channel: "sms",
        who: { kind: "unknown" },
      },
      {
        kind: "enquiries",
        since: at("2026-11-02T08:00:00Z"),
        day: "2026-11-02",
        messageId: withheld,
        channel: "voice",
        who: { kind: "withheld" },
      },
    ]);
    for (const i of named) expect(Object.keys(i)).not.toContain("text");
    expect(waited.more.enquiries).toBe(false);
    // The same messages, in the same order and from the same people, as Enquiries' "Need a person".
    const page = await withFirm(t.firmId, (tx) => loadEnquiries(tx, "person", NOW));
    expect(page.rows.map((r) => [r.messageId, r.who.kind])).toEqual(
      named.map((i) => [i.messageId, i.who.kind]),
    );
    // Nothing they wrote, and no number they wrote from, is in the chart.
    const text = JSON.stringify(waited);
    for (const word of [
      "own words",
      "Saturday",
      "SHIFTS",
      "+447700900971",
      "+447700900972",
      "+447700900973",
    ]) {
      expect(text).not.toContain(word);
    }
  });

  it("every enquiry that needs a person is counted, past the 50 it names", async () => {
    const t = await chartFirm();
    const other = await chartFirm();
    for (let i = 0; i < 52; i += 1) {
      await t.enquiry(at(i < 20 ? "2026-10-30T10:00:00Z" : "2026-11-02T08:00:00Z"));
    }
    await other.enquiry(at("2026-11-02T08:00:00Z"));
    const d = await t.load();
    const waited = ok(d.waited);
    expect(waited.days.map((x) => [x.day, x.needsYou.enquiries])).toEqual([
      ["2026-10-30", 20],
      ["2026-11-02", 32],
    ]);
    const named = waited.items.filter((i) => i.kind === "enquiries");
    expect(named).toHaveLength(50);
    expect(named.filter((i) => i.day === "2026-10-30")).toHaveLength(20);
    expect(waited.more.enquiries).toBe(true);
    expect(waited.needsYouTotal).toBe(
      attentionCount(ok(d.needs), ok(d.counts.enquiries).needPerson).count,
    );
  });

  it("pay queries with payroll only for a role that can open Pay; never their details", async () => {
    const t = await chartFirm();
    const paulina = await t.worker({ first: "Paulina" });
    const raise = async (status: string, createdAt: Date, issue = "wrong_rate") => {
      const { rows } = await su.query<{ id: string }>(
        `insert into pay_queries (firm_id, worker_id, work_date, issue_type, details, status,
                                  resolved_at, resolution_note, created_at)
         values ($1, $2, '2026-10-24', $3, 'Not paid for the Saturday shift', $4, $5, $6, $7)
         returning id::text as id`,
        [
          t.firmId,
          paulina,
          issue,
          status,
          status === "resolved" ? NOW : null,
          status === "resolved" ? "Paid on Friday." : null,
          createdAt,
        ],
      );
      return rows[0]?.id ?? "";
    };
    const open = await raise("open", at("2026-10-30T10:00:00Z"));
    const digest = await raise("in_digest", at("2026-11-01T23:30:00Z"), "missing_hours");
    await raise("resolved", at("2026-10-28T10:00:00Z"), "late_pay");
    const ctx = (officeUserId: string) => ({
      firm: { id: t.firmId },
      officeUserId,
      run: withFirm,
      clock: { now: () => NOW },
    });
    const admin = await officeDashboard(ctx(await t.office("admin")));
    const pay = ok(admin?.waited ?? { ok: false }).pay;
    expect(pay).toEqual({
      total: 2,
      days: [
        { day: "2026-10-30", count: 1 },
        { day: "2026-11-01", count: 1 },
      ],
      rows: [
        {
          payQueryId: open,
          workerId: paulina,
          casual: "Paulina Booker",
          issue: "wrong_rate",
          workDate: "2026-10-24",
          since: at("2026-10-30T10:00:00Z"),
          day: "2026-10-30",
          inDigest: false,
        },
        expect.objectContaining({ payQueryId: digest, issue: "missing_hours", inDigest: true }),
      ],
      more: false,
    });
    expect(JSON.stringify(admin)).not.toContain("Not paid for the Saturday");
    // A resourcer's whole dashboard: no pay query, name, issue or word of payroll's.
    const resourcer = (await officeDashboard(ctx(await t.office("resourcer")))) as Dashboard;
    expect(ok(resourcer.waited).pay).toBeNull();
    const text = JSON.stringify(resourcer);
    for (const word of [
      open,
      digest,
      "Paulina",
      paulina,
      "wrong_rate",
      "missing_hours",
      "late_pay",
      "Not paid for",
      "Paid on Friday",
    ]) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toMatch(/payroll|pay_quer|payQuer/i);
  });
});

describe("cancellations, the last 14 days", () => {
  // The strike notice is 12 hours and the law's short-notice threshold 72: a 30-hour and a 20-hour
  // cancellation are short only by the wrong one (or by a fixed 24 hours, for the 20).
  const settings = { strikes: { notice_hours: 12 }, short_notice_threshold_hours: 72 };

  it("each London day's cancellations; short notice by the strike setting, as the Cancellations page has it", async () => {
    const t = await chartFirm(settings);
    const c1 = await t.cancelled(at("2026-11-02T08:00:00Z"), 30);
    const c2 = await t.cancelled(at("2026-11-02T07:00:00Z"), 20, "cancelled_firm");
    const c3 = await t.cancelled(at("2026-11-02T06:00:00Z"), 6);
    // Tue 20 Oct 00:30 BST is the first day's; Mon 19 Oct 23:59 BST is before it.
    const first = await t.cancelled(at("2026-10-19T23:30:00Z"), 40);
    await t.cancelled(at("2026-10-19T22:59:00Z"), 40);
    // Either side of the clocks going back.
    const sunEarly = await t.cancelled(at("2026-10-24T23:30:00Z"), 40); // Sun 25 Oct 00:30 BST
    const sunLate = await t.cancelled(at("2026-10-25T23:30:00Z"), 40); // Sun 25 Oct 23:30 GMT
    const mon = await t.cancelled(at("2026-10-26T00:30:00Z"), 40); // Mon 26 Oct 00:30 GMT
    await t.booking(await t.worker(), await t.shift({ startsAt: hoursFromNow(30) })); // booked

    const d = await t.load();
    const chart = ok(d.cancels14);
    expect(chart.first).toBe("2026-10-20");
    expect(chart.threshold).toBe(12);
    expect(chart.days).toHaveLength(14);
    expect(chart.days[0]?.date).toBe("2026-10-20");
    expect(chart.days.at(-1)?.date).toBe("2026-11-02");
    expect(
      Object.fromEntries(
        chart.days.filter((x) => x.total > 0).map((x) => [x.date, [x.total, x.short, x.byCasuals]]),
      ),
    ).toEqual({
      "2026-10-20": [1, 0, 1],
      "2026-10-25": [2, 0, 2],
      "2026-10-26": [1, 0, 1],
      "2026-11-02": [3, 1, 2],
    });
    // Today's bar is the dashboard's count.
    const today = chart.days.at(-1);
    expect(ok(d.counts.cancellations)).toMatchObject({
      total: today?.total,
      underNotice: today?.short,
      threshold: 12,
    });
    // The rows, as the Cancellations page has them, newest first.
    expect(chart.rows.map((r) => r.assignmentId)).toEqual([
      c1,
      c2,
      c3,
      mon,
      sunLate,
      sunEarly,
      first,
    ]);
    expect(chart.rows.map((r) => r.by)).toEqual([
      "casual",
      "office",
      "casual",
      "casual",
      "casual",
      "casual",
      "casual",
    ]);
    expect(chart.rows[2]).toMatchObject({
      noticeHours: 6,
      cancelledAt: at("2026-11-02T06:00:00Z"),
    });
    expect(chart.more).toBe(false);
  });
});

describe("licences running out, the next 8 weeks", () => {
  it("checked, valid, not renewed or suspended, of active casuals, today to day 55; the booked ones as Needs attention finds them", async () => {
    const t = await chartFirm();
    const sia = (expiresOn: string | null, status: "valid" | "suspended" = "valid") => ({
      type: "SIA_DS",
      expiresOn,
      status,
    });
    const ann = await t.worker({ first: "Ann", credentials: [sia("2026-11-02")] }); // day 0
    const bea = await t.worker({ first: "Bea", credentials: [sia("2026-12-27")] }); // day 55
    await t.worker({ first: "Cal", credentials: [sia("2026-12-28")] }); // day 56: out
    await t.worker({ first: "Dee", credentials: [sia("2026-11-01")] }); // yesterday: out
    // Renewed: a longer valid record of the type.
    await t.worker({ first: "Eve", credentials: [sia("2026-11-10"), sia("2029-01-01")] });
    // Suspended.
    await t.worker({ first: "Fay", credentials: [sia("2026-11-15"), sia(null, "suspended")] });
    // Not checked: an upload's record waits for the office (stored as expired).
    const gus = await t.worker({ first: "Gus", credentials: [{ type: "STEWARD_L2" }] });
    await t.upload(gus, hoursFromNow(-5), "FIRST_AID");
    await su.query(
      `insert into credentials (firm_id, worker_id, type, status, expires_on, check_state,
                                evidence_upload_id)
       select $1, $2, 'FIRST_AID', 'expired', '2026-11-20', 'waiting', u.id from uploads u
        where u.firm_id = $1 and u.worker_id = $2`,
      [t.firmId, gus],
    );
    // Not active, or erased.
    await t.worker({ first: "Hal", status: "inactive", credentials: [sia("2026-11-20")] });
    const ida = await t.worker({ first: "Ida", credentials: [sia("2026-11-21")] });
    await t.set("workers", ida, {
      status: "inactive",
      erased_at: NOW,
      first_name: "Deleted",
      last_name: "worker",
      mobile_e164: null,
      email: null,
      roles: [],
    });
    // A renewal waiting for a check.
    const ivy = await t.worker({ first: "Ivy", credentials: [sia("2026-11-12")] });
    await t.upload(ivy, hoursFromNow(-3), "SIA_DS");
    // Booked on Sat 7 Nov, after it runs out on Thu 5 Nov.
    const jo = await t.worker({ first: "Jo", credentials: [sia("2026-11-05")] });
    const sat = await t.shift({ startsAt: hoursFromNow(121) });
    const joBooking = await t.booking(jo, sat);
    // Day 30: still "soon".
    const kay = await t.worker({
      first: "Kay",
      credentials: [{ type: "STEWARD_L2" }, { type: "FIRST_AID", expiresOn: "2026-12-02" }],
    });

    const d = await t.load();
    const chart = ok(d.licences);
    expect(chart).toMatchObject({ today: "2026-11-02", windowDays: 56, soonDays: 30 });
    expect(chart.rows.map((r) => [r.casual, r.type, r.expiresOn, r.days, r.soon])).toEqual([
      ["Ann Booker", "SIA_DS", "2026-11-02", 0, true],
      ["Jo Booker", "SIA_DS", "2026-11-05", 3, true],
      ["Ivy Booker", "SIA_DS", "2026-11-12", 10, true],
      ["Kay Booker", "FIRST_AID", "2026-12-02", 30, true],
      ["Bea Booker", "SIA_DS", "2026-12-27", 55, false],
    ]);
    expect(chart.counts).toEqual({ total: 5, soon: 4, booked: 1 });
    expect(chart.more).toBe(false);
    const byName = new Map(chart.rows.map((r) => [r.casual, r]));
    expect(byName.get("Ann Booker")).toMatchObject({
      workerId: ann,
      name: "SIA door supervisor licence",
      renewalWaiting: false,
      booked: null,
    });
    expect(byName.get("Ivy Booker")?.renewalWaiting).toBe(true);
    expect(byName.get("Kay Booker")?.workerId).toBe(kay);
    expect(byName.get("Bea Booker")?.workerId).toBe(bea);
    // The booked flag is Needs attention's own finding.
    const expired = await withFirm(t.firmId, (tx) =>
      loadExpiredOnBookings(tx, NOW, "Europe/London"),
    );
    const found = expired.items.find((e) => e.workerId === jo);
    expect(found).toMatchObject({ assignmentId: joBooking, shiftId: sat, expiresOn: "2026-11-05" });
    expect(byName.get("Jo Booker")?.booked).toEqual({
      assignmentId: joBooking,
      shiftId: sat,
      role: "door_supervisor",
      startsAt: hoursFromNow(121),
      lastDay: "2026-11-07", // Sat 7 Nov, 10:00 to 18:00
    });
  });

  it("booked after it runs out is Needs attention's rule over every booking: past the 50 it lists, and past the chart's 50 rows", async () => {
    const t = await chartFirm();
    const other = await chartFirm();
    const sia = (expiresOn: string) => [{ type: "SIA_DS", expiresOn }];
    // Abe's licence ran out last week and he is still booked on 51 sessions from today: Needs
    // attention lists those first, and stops at 50.
    const abe = await t.worker({ first: "Abe", credentials: sia("2026-10-28") });
    for (let i = 0; i < 51; i += 1) {
      await t.booking(abe, await t.shift({ startsAt: hoursFromNow(10 + i) }));
    }
    // Bea's runs out on Thu 5 Nov: the chart's first row. Booked on Tue 3 Nov (in date), then on
    // Thu 12 Nov and Sun 15 Nov (after it runs out): both later than Abe's 51.
    const bea = await t.worker({ first: "Bea", credentials: sia("2026-11-05") });
    await t.booking(bea, await t.shift({ startsAt: hoursFromNow(24) }));
    const beaShift = await t.shift({ startsAt: hoursFromNow(240) });
    const beaBooking = await t.booking(bea, beaShift);
    await t.booking(bea, await t.shift({ startsAt: hoursFromNow(312) }));
    // 49 casuals whose first aid certificates run out on Fri 6 Nov, not booked: with Bea's, the
    // chart's 50 rows.
    for (let n = 1; n <= 49; n += 1) {
      await t.worker({
        first: `Rowan${n}`,
        credentials: [{ type: "STEWARD_L2" }, { type: "FIRST_AID", expiresOn: "2026-11-06" }],
      });
    }
    // Cy's runs out on Tue 1 Dec, the 51st licence: booked on Mon 7 Dec, after it runs out.
    const cy = await t.worker({ first: "Cy", credentials: sia("2026-12-01") });
    await t.booking(cy, await t.shift({ startsAt: hoursFromNow(24 * 35) }));
    // Another firm's casual, booked after hers runs out: never here.
    const oz = await other.worker({ first: "Oz", credentials: sia("2026-11-04") });
    const ozBooking = await other.booking(oz, await other.shift({ startsAt: hoursFromNow(120) }));

    const d = await t.load();
    // Needs attention's list is Abe's first 50 bookings; Bea's and Cy's are past it.
    const needs = ok(d.needs);
    expect(needs.expired).toHaveLength(50);
    expect(needs.expiredMore).toBe(true);
    expect(needs.expired.filter((e) => e.workerId === abe)).toHaveLength(50);
    const chart = ok(d.licences);
    expect(chart.rows).toHaveLength(50);
    expect(chart.more).toBe(true);
    expect(chart.rows[0]).toMatchObject({ workerId: bea, expiresOn: "2026-11-05", days: 3 });
    // Bea's: the soonest booking she won't be in date for, not her first booking.
    expect(chart.rows[0]?.booked).toEqual({
      assignmentId: beaBooking,
      shiftId: beaShift,
      role: "door_supervisor",
      startsAt: hoursFromNow(240),
      lastDay: "2026-11-12", // Thu 12 Nov, 09:00 to 17:00
    });
    expect(chart.rows.filter((r) => r.booked === null)).toHaveLength(49);
    expect(chart.rows.map((r) => r.workerId)).not.toContain(cy);
    // Every licence in the window: Bea's and Cy's booked after they run out (Abe's ran out before
    // today, so isn't one).
    expect(chart.counts).toEqual({ total: 51, soon: 51, booked: 2 });
    const text = JSON.stringify(chart);
    for (const id of [oz, ozBooking, other.firmId]) {
      expect(text).not.toContain(id);
    }
    // The other firm's chart has its own.
    const theirs = ok((await other.load()).licences);
    expect(theirs.counts).toEqual({ total: 1, soon: 1, booked: 1 });
    expect(theirs.rows.map((r) => [r.workerId, r.booked?.assignmentId])).toEqual([[oz, ozBooking]]);
  });

  it("a booking comes with its session's last day, the rule's: a night session that starts on the day the licence runs out ends the day after", async () => {
    const t = await chartFirm();
    const sia = [{ type: "SIA_DS", expiresOn: "2026-10-24" }]; // in date to the end of Sat 24 Oct
    // Jo: Sat 24 Oct 18:00 to midnight BST is in date (it ends as Saturday does). Sat 24 Oct 22:00
    // BST to Sun 25 Oct 06:00 GMT (9 hours: the clocks go back) runs into Sunday.
    const jo = await t.worker({ first: "Jo", credentials: sia });
    await t.booking(jo, await t.shift({ startsAt: at("2026-10-24T17:00:00Z"), hours: 6 }));
    const night = await t.shift({ startsAt: at("2026-10-24T21:00:00Z"), hours: 9 });
    const joNight = await t.booking(jo, night);
    // Kim: a day session on Mon 26 Oct, after it runs out.
    const kim = await t.worker({ first: "Kim", credentials: sia });
    const monday = await t.shift({ startsAt: at("2026-10-26T10:00:00Z") });
    const kimMonday = await t.booking(kim, monday);

    const chart = ok((await t.load(FRI)).licences);
    expect(chart.counts).toEqual({ total: 2, soon: 2, booked: 2 });
    const byName = new Map(chart.rows.map((r) => [r.casual, r]));
    expect(byName.get("Jo Booker")).toMatchObject({ expiresOn: "2026-10-24", days: 1 });
    expect(byName.get("Jo Booker")?.booked).toEqual({
      assignmentId: joNight,
      shiftId: night,
      role: "door_supervisor",
      startsAt: at("2026-10-24T21:00:00Z"),
      lastDay: "2026-10-25",
    });
    // It starts on the day the licence runs out; its last day is the day after.
    expect(localDateOf(at("2026-10-24T21:00:00Z"), "Europe/London")).toBe("2026-10-24");
    expect(byName.get("Kim Booker")?.booked).toEqual({
      assignmentId: kimMonday,
      shiftId: monday,
      role: "door_supervisor",
      startsAt: at("2026-10-26T10:00:00Z"),
      lastDay: "2026-10-26",
    });
    const booked = chart.rows.filter((r) => r.booked !== null);
    expect(booked).toHaveLength(2);
    // Always after the day it runs out (yyyy-mm-dd compares as text).
    for (const r of booked) expect((r.booked?.lastDay ?? "") > r.expiresOn).toBe(true);
    // Needs attention finds the same two bookings, and not Jo's evening one.
    const expired = await withFirm(t.firmId, (tx) =>
      loadExpiredOnBookings(tx, FRI, "Europe/London"),
    );
    expect(expired.items.map((e) => [e.assignmentId, e.expiresOn])).toEqual([
      [joNight, "2026-10-24"],
      [kimMonday, "2026-10-24"],
    ]);
  });

  it("today is London's: just after midnight in summer, a licence running out that day is day 0", async () => {
    const t = await chartFirm();
    await t.worker({ first: "Today", credentials: [{ type: "SIA_DS", expiresOn: "2026-07-15" }] });
    await t.worker({ first: "Gone", credentials: [{ type: "SIA_DS", expiresOn: "2026-07-14" }] });
    const chart = ok((await t.load(at("2026-07-14T23:30:00Z"))).licences);
    expect(chart.today).toBe("2026-07-15");
    expect(chart.rows.map((r) => [r.casual, r.days])).toEqual([["Today Booker", 0]]);
  });
});

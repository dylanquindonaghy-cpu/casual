import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  BOARD_ROWS,
  lastNight,
  loadBoard,
  officeDashboard,
  type Board,
  type BoardShow,
} from "@/lib/office/dashboard-board";
import { officeNeedsAttention } from "@/lib/office/dashboard";
import {
  offerState,
  offerStateSql,
  offerWhySql,
  type OfferState,
  type OfferWhy,
} from "@/lib/office/offer-state";
import { officeShellCounts } from "@/lib/office/shell-counts";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { plannerKey } from "../helpers/planner-api";

// The dashboard's board (Phase 24, 24.3; docs/screens.md `/office`) on the real database, as the
// app role: the sessions with places to fill in their two columns (an offer waiting for a reply or
// not) under each of the track's filters, the counts, the places chart over this pay week and
// next, "While you were out" and "Who worked?", when the planner last sent changes, the session
// the detail card shows, who may see it, and another firm's rows never in any of it. NOW is Monday
// 2 November 2026, 09:00 London (GMT); the clock change (Sun 25 Oct 2026) has tests of its own.

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

const TZ = "Europe/London";

async function offer(
  f: BookingFirm,
  shiftId: string,
  workerId: string,
  o: {
    response?: "accepted" | "declined" | "expired" | "failed" | "filled_elsewhere" | null;
    sentAt?: Date;
    answeredAt?: Date;
    channel?: "push" | "whatsapp" | "sms";
    wave?: number;
  } = {},
) {
  const response = o.response ?? null;
  await su.query(
    `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at, response, responded_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      f.firmId,
      shiftId,
      workerId,
      o.wave ?? 1,
      o.channel ?? "whatsapp",
      o.sentAt ?? hoursFromNow(-2),
      response,
      response ? (o.answeredAt ?? hoursFromNow(-1)) : null,
    ],
  );
}

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

const ok = <T>(p: { ok: true; data: T } | { ok: false }): T => {
  if (!p.ok) throw new Error("a part failed");
  return p.data;
};

// A firm on Monday 2 Nov (this pay week Mon 2 to Sun 8, next Mon 9 to Sun 15):
// - Raceday (at the Acme Arena): an urgent door supervisor session tomorrow at Gate A, 3 places
//   with 1 booked, offered to Ann (waiting) and Ben (said no); a steward session on Thursday,
//   2 places, offered to Cal and Dee (both said no), and one that failed to Ann.
// - Winter Fair: a steward session on Tue 10 Nov at its own site (the Depot), never offered; a
//   session on Mon 16 Nov (past next week), offered to Ann, waiting; a session hidden on its own.
// - Not on the board: a filled one, a draft, a cancelled one, one that started, one fully booked
//   but still open.
async function boardFirm() {
  const f = await bookingFirm(su, withFirm);
  const admin = await f.office("admin");
  const arena = await site(f, "Acme Arena");
  const depot = await site(f, "Acme Depot");
  const raceday = await f.event({ name: "Raceday" });
  await set("shift_events", raceday, { site_id: arena });
  const door = await f.shift({ eventId: raceday, startsAt: hoursFromNow(24), headcount: 3 });
  await set("shifts", door, { is_urgent: true, post: "Gate A" });
  const steward = await f.shift({
    eventId: raceday,
    role: "steward",
    startsAt: hoursFromNow(72),
    headcount: 2,
  });
  const winter = await f.event({ name: "Winter Fair" });
  const fair = await f.shift({ eventId: winter, role: "steward", startsAt: hoursFromNow(8 * 24) });
  await set("shifts", fair, { site_id: depot });
  const later = await f.shift({ eventId: winter, startsAt: hoursFromNow(14 * 24) });
  const hidden = await f.shift({ eventId: winter, startsAt: hoursFromNow(50) });
  await set("shifts", hidden, { showing_to_casuals: false });
  await f.shift({ eventId: winter, startsAt: hoursFromNow(30), status: "filled" });
  await f.shift({ eventId: winter, startsAt: hoursFromNow(30), status: "draft" });
  await f.shift({ eventId: winter, startsAt: hoursFromNow(30), status: "cancelled" });
  const started = await f.shift({ eventId: winter, startsAt: hoursFromNow(-1) });
  const full = await f.shift({ eventId: winter, startsAt: hoursFromNow(40) });
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const cal = await f.worker({ first: "Cal" });
  const dee = await f.worker({ first: "Dee" });
  await f.booking(ben, door);
  await f.booking(cal, full);
  await offer(f, door, ann, { sentAt: hoursFromNow(-3) });
  await offer(f, door, ben, { response: "declined" });
  await offer(f, steward, cal, { response: "declined" });
  await offer(f, steward, dee, { response: "declined" });
  await offer(f, steward, ann, { response: "failed", wave: 2 });
  await offer(f, later, ann);
  await offer(f, started, ann);
  const load = (show: BoardShow = "all", session: string | null = null, now = NOW) =>
    withFirm(f.firmId, (tx) => loadBoard(tx, now, { show, session }));
  return { f, admin, door, steward, fair, later, hidden, started, full, ann, ben, load };
}

const ids = (b: Board, col: "toOffer" | "offered") =>
  ok(b.gaps)[col].sessions.map((s) => s.shiftId);

describe("the board's columns", () => {
  it("every session to come with a place free, soonest first: Offered while an offer waits, To offer otherwise", async () => {
    const t = await boardFirm();
    const b = await t.load();
    // Offered: the door supervisor (Ann waiting) and the session on the 16th (Ann waiting).
    expect(ids(b, "offered")).toEqual([t.door, t.later]);
    // To offer: never offered, or every offer answered (the steward session: both said no, and
    // the failed one isn't an offer).
    expect(ids(b, "toOffer")).toEqual([t.hidden, t.steward, t.fair]);
    const g = ok(b.gaps);
    expect(g.offered).toMatchObject({ total: 2, places: 3, waiting: 2, more: false });
    expect(g.toOffer).toMatchObject({ total: 3, places: 4, waiting: 0, more: false });
  });

  it("each session's facts and offers: who hasn't replied and since when", async () => {
    const t = await boardFirm();
    const g = ok((await t.load()).gaps);
    const door = g.offered.sessions[0];
    expect(door).toMatchObject({
      shiftId: t.door,
      eventName: "Raceday",
      role: "door_supervisor",
      post: "Gate A",
      site: "Acme Arena", // the event's
      headcount: 3,
      placesFree: 2,
      urgent: true,
      hidden: false,
      fromSheet: false,
      fromPlanner: false,
      offers: {
        sent: 2,
        waiting: 1,
        saidNo: 1,
        tookIt: 0,
        closed: 0,
        failed: 0,
        waitingSince: hoursFromNow(-3),
        waitingNames: ["Ann Booker"],
      },
    });
    const steward = g.toOffer.sessions.find((s) => s.shiftId === t.steward);
    expect(steward?.offers).toMatchObject({ sent: 2, waiting: 0, saidNo: 2, failed: 1 });
    expect(steward?.offers.waitingSince).toBeNull();
    expect(g.toOffer.sessions.find((s) => s.shiftId === t.fair)?.site).toBe("Acme Depot");
    expect(g.toOffer.sessions.find((s) => s.shiftId === t.hidden)?.hidden).toBe(true);
  });

  it("who hasn't replied: the first two, oldest offer first", async () => {
    const t = await boardFirm();
    const cal = await t.f.worker({ first: "Cal" });
    const dee = await t.f.worker({ first: "Dee" });
    await offer(t.f, t.door, dee, { sentAt: hoursFromNow(-1) });
    await offer(t.f, t.door, cal, { sentAt: hoursFromNow(-2), wave: 2 });
    const door = ok((await t.load()).gaps).offered.sessions[0];
    expect(door?.offers.waiting).toBe(3);
    expect(door?.offers.waitingNames).toEqual(["Ann Booker", "Cal Booker"]);
    expect(door?.offers.waitingSince).toEqual(hoursFromNow(-3));
  });

  it("an event switched off hides its sessions from casuals", async () => {
    const t = await boardFirm();
    const { rows } = await su.query<{ event_id: string }>(
      "select event_id::text from shifts where id = $1",
      [t.steward],
    );
    await set("shift_events", rows[0]?.event_id ?? "", { showing_to_casuals: false });
    const g = ok((await t.load()).gaps);
    expect(g.toOffer.sessions.find((s) => s.shiftId === t.steward)?.hidden).toBe(true);
    expect(g.offered.sessions.find((s) => s.shiftId === t.door)?.hidden).toBe(true);
  });

  it("a column holds the first 50 and says there were more; its totals count every one", async () => {
    const f = await bookingFirm(su, withFirm);
    for (let i = 0; i < BOARD_ROWS + 2; i++) await f.shift({ startsAt: hoursFromNow(10 + i) });
    const g = ok((await withFirm(f.firmId, (tx) => loadBoard(tx, NOW))).gaps);
    expect(g.toOffer.sessions).toHaveLength(BOARD_ROWS);
    expect(g.toOffer).toMatchObject({ total: BOARD_ROWS + 2, places: BOARD_ROWS + 2, more: true });
    expect(g.toOffer.sessions[0]?.startsAt).toEqual(hoursFromNow(10));
  });
});

describe("the track's filters and counts", () => {
  it("urgent, this week and next week keep their sessions; each count is its columns' sessions", async () => {
    const t = await boardFirm();
    const all = await t.load();
    expect(ok(all.counts)).toEqual({ all: 5, urgent: 1, "this-week": 3, "next-week": 1 });
    const urgent = await t.load("urgent");
    expect([...ids(urgent, "toOffer"), ...ids(urgent, "offered")]).toEqual([t.door]);
    const thisWeek = await t.load("this-week");
    expect(ids(thisWeek, "offered")).toEqual([t.door]);
    expect(ids(thisWeek, "toOffer")).toEqual([t.hidden, t.steward]);
    const nextWeek = await t.load("next-week");
    expect(ids(nextWeek, "toOffer")).toEqual([t.fair]);
    expect(ids(nextWeek, "offered")).toEqual([]);
    for (const [show, b] of [
      ["all", all],
      ["urgent", urgent],
      ["this-week", thisWeek],
      ["next-week", nextWeek],
    ] as const) {
      const g = ok(b.gaps);
      expect(g.toOffer.total + g.offered.total, show).toBe(ok(all.counts)[show]);
      expect(b.show).toBe(show);
    }
  });

  it("adds up with the top bar: To fill is every place, Urgent the urgent places, Offers out the offers waiting", async () => {
    const t = await boardFirm();
    const g = ok((await t.load()).gaps);
    const urgent = ok((await t.load("urgent")).gaps);
    const shell = await officeShellCounts({
      firm: { id: t.f.firmId },
      officeUserId: t.admin,
      run: withFirm,
      clock: { now: () => NOW },
    });
    if (!shell?.ok) throw new Error("the top bar's counts failed");
    expect(g.toOffer.places + g.offered.places).toBe(shell.data.toFill);
    expect(urgent.toOffer.places + urgent.offered.places).toBe(shell.data.urgent);
    expect(g.offered.waiting).toBe(shell.data.offersOut);
  });
});

describe("an offer's state (the rule the board, the chart and the top bar count by)", () => {
  it("the SQL rule and its TypeScript twin agree for every answer, session state and start", async () => {
    const f = await bookingFirm(su, withFirm);
    const ann = await f.worker({ first: "Ann" });
    const RESPONSES = [
      null,
      "accepted",
      "declined",
      "expired",
      "filled_elsewhere",
      "failed",
    ] as const;
    for (const status of ["draft", "open", "filled", "cancelled"] as const) {
      for (const startsAt of [hoursFromNow(48), hoursFromNow(-0.5)]) {
        const shiftId = await f.shift({ startsAt, status });
        for (const [i, response] of RESPONSES.entries()) {
          await offer(f, shiftId, ann, { sentAt: hoursFromNow(-1), response, wave: i + 1 });
        }
      }
    }
    const { rows } = await withFirm(f.firmId, (tx) =>
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
    // The board's Offered column counts the one waiting (its session has its place free: the
    // fixture's "accepted" offer has no booking behind it).
    const g = ok((await withFirm(f.firmId, (tx) => loadBoard(tx, NOW))).gaps);
    expect(g.offered.waiting).toBe(tally.waiting);
    expect(g.offered.sessions[0]?.offers).toMatchObject({
      sent: 5,
      waiting: 1,
      saidNo: 1,
      tookIt: 1,
      closed: 2,
      failed: 1,
    });
  });
});

describe("the places chart", () => {
  it("this pay week and next, Monday to Sunday: each day's places, with an offer waiting and without", async () => {
    const t = await boardFirm();
    const c = ok((await t.load()).chart);
    expect(c.first).toBe("2026-11-02");
    expect(c.days.map((d) => d.date)).toEqual(
      Array.from({ length: 14 }, (_, i) => `2026-11-${String(2 + i).padStart(2, "0")}`),
    );
    const day = (d: string) => c.days.find((x) => x.date === d);
    expect(day("2026-11-03")).toEqual({ date: "2026-11-03", toOffer: 0, offered: 2 }); // the door
    expect(day("2026-11-04")).toEqual({ date: "2026-11-04", toOffer: 1, offered: 0 }); // hidden
    expect(day("2026-11-05")).toEqual({ date: "2026-11-05", toOffer: 2, offered: 0 }); // steward
    expect(day("2026-11-10")).toEqual({ date: "2026-11-10", toOffer: 1, offered: 0 }); // fair
    // The 16th is past next week: not on the chart.
    const sum = (k: "toOffer" | "offered") => c.days.reduce((n, d) => n + d[k], 0);
    expect(sum("toOffer") + sum("offered")).toBe(6);
    // The chart's places are this week's and next week's columns'.
    const weeks = [ok((await t.load("this-week")).gaps), ok((await t.load("next-week")).gaps)];
    expect(sum("toOffer")).toBe(weeks.reduce((n, g) => n + g.toOffer.places, 0));
    expect(sum("offered")).toBe(weeks.reduce((n, g) => n + g.offered.places, 0));
  });
});

describe("the clock change (the clocks go back at 02:00 on Sun 25 Oct 2026)", () => {
  // Thursday 22 Oct 2026, 12:00 BST: this pay week Mon 19 to Sun 25, next Mon 26 to Sun 1 Nov.
  const THURSDAY = new Date("2026-10-22T11:00:00Z");

  it("a session late on Sunday is this week's; one just after midnight is next week's", async () => {
    const f = await bookingFirm(su, withFirm);
    // Sun 25 Oct 23:30 GMT and Mon 26 Oct 00:30 GMT: 30 minutes either side of midnight, which
    // would swap weeks if a day were 24 hours from Monday's midnight in BST.
    const sunday = await f.shift({ startsAt: new Date("2026-10-25T23:30:00Z") });
    const monday = await f.shift({ startsAt: new Date("2026-10-26T00:30:00Z") });
    const load = (show: BoardShow) => withFirm(f.firmId, (tx) => loadBoard(tx, THURSDAY, { show }));
    expect(ids(await load("this-week"), "toOffer")).toEqual([sunday]);
    expect(ids(await load("next-week"), "toOffer")).toEqual([monday]);
    const c = ok((await load("all")).chart);
    expect(c.first).toBe("2026-10-19");
    expect(c.days.find((d) => d.date === "2026-10-25")?.toOffer).toBe(1);
    expect(c.days.find((d) => d.date === "2026-10-26")?.toOffer).toBe(1);
    expect(c.days.at(-1)?.date).toBe("2026-11-01");
  });

  it("the night the clocks go back is 15 hours long: Sat 18:00 BST to Sun 08:00 GMT", () => {
    const sunday = new Date("2026-10-25T10:00:00Z");
    expect(lastNight(sunday, TZ)).toEqual({
      from: new Date("2026-10-24T17:00:00Z"),
      to: new Date("2026-10-25T08:00:00Z"),
    });
  });

  it("While you were out that night: the takes inside it, by the firm's clock", async () => {
    const f = await bookingFirm(su, withFirm);
    const shift = await f.shift({ startsAt: new Date("2026-10-27T09:00:00Z"), headcount: 4 });
    const at = [
      ["early", "2026-10-24T16:30:00Z"], // 17:30 BST: before the night
      ["first", "2026-10-24T17:30:00Z"], // 18:30 BST
      ["last", "2026-10-25T07:59:00Z"], // 07:59 GMT
      ["late", "2026-10-25T08:01:00Z"], // 08:01 GMT: after it
    ] as const;
    for (const [first, when] of at) {
      const w = await f.worker({ first });
      await offer(f, shift, w, { response: "accepted", answeredAt: new Date(when) });
      await f.booking(w, shift, "confirmed", at.findIndex(([n]) => n === first) + 1);
    }
    const sunday = new Date("2026-10-25T10:00:00Z");
    const o = ok((await withFirm(f.firmId, (tx) => loadBoard(tx, sunday))).overnight);
    expect(o.takes.map((x) => x.worker)).toEqual(["last Booker", "first Booker"]);
  });
});

describe("While you were out", () => {
  it("the places casuals took from offers between 18:00 and 08:00, still booked, latest first, with how and when", async () => {
    const t = await boardFirm();
    // Monday 09:00: last night is Sun 1 Nov 18:00 to Mon 2 Nov 08:00 (GMT).
    const night = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 1, 18 + h, m));
    const shift = await t.f.shift({ startsAt: hoursFromNow(30), headcount: 5 });
    const take = async (
      first: string,
      answeredAt: Date,
      o: { channel?: "push" | "whatsapp" | "sms"; cancelled?: boolean; slot: number },
    ) => {
      const w = await t.f.worker({ first });
      await offer(t.f, shift, w, { response: "accepted", answeredAt, channel: o.channel });
      await t.f.booking(w, shift, o.cancelled ? "cancelled_worker" : "confirmed", o.slot);
    };
    await take("Eve", night(5, 12), { channel: "whatsapp", slot: 1 }); // 23:12
    await take("Fay", night(12, 40), { channel: "sms", slot: 2 }); // 06:40
    await take("Gus", night(2), { channel: "push", slot: 3 }); // 20:00
    await take("Hal", night(3), { cancelled: true, slot: 4 }); // took it, then cancelled
    await take("Ivy", night(-1), { slot: 5 }); // 17:00 Sunday: before the night
    const other = await t.f.worker({ first: "Jo" });
    await offer(t.f, shift, other, { response: "declined", answeredAt: night(4) });
    const o = ok((await t.load()).overnight);
    expect(o.from).toEqual(night(0));
    expect(o.to).toEqual(new Date("2026-11-02T08:00:00Z"));
    expect(o.takes.map((x) => [x.worker, x.channel, x.answeredAt])).toEqual([
      ["Fay Booker", "sms", night(12, 40)],
      ["Eve Booker", "whatsapp", night(5, 12)],
      ["Gus Booker", "push", night(2)],
    ]);
    expect(o.takes[0]).toMatchObject({ shiftId: shift, role: "door_supervisor" });
    expect(o.more).toBe(false);
  });

  it("which night: before 08:00 it is still going; after 18:00 it is tonight's", () => {
    const at = (iso: string) => lastNight(new Date(iso), TZ);
    expect(at("2026-11-02T06:30:00Z")).toEqual({
      from: new Date("2026-11-01T18:00:00Z"),
      to: new Date("2026-11-02T06:30:00Z"),
    });
    expect(at("2026-11-02T17:59:00Z")).toEqual({
      from: new Date("2026-11-01T18:00:00Z"),
      to: new Date("2026-11-02T08:00:00Z"),
    });
    expect(at("2026-11-02T19:15:00Z")).toEqual({
      from: new Date("2026-11-02T18:00:00Z"),
      to: new Date("2026-11-02T19:15:00Z"),
    });
    // In summer time, 18:00 and 08:00 are London's (17:00 and 07:00 UTC).
    expect(lastNight(new Date("2026-07-14T12:00:00Z"), TZ)).toEqual({
      from: new Date("2026-07-13T17:00:00Z"),
      to: new Date("2026-07-14T07:00:00Z"),
    });
  });
});

describe("Who worked?", () => {
  it("is Needs attention's sessions to mark, the same items", async () => {
    const t = await boardFirm();
    const done = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(t.ann, done);
    const b = await t.load();
    const n = await officeNeedsAttention({
      firm: { id: t.f.firmId },
      officeUserId: t.admin,
      run: withFirm,
      clock: { now: () => NOW },
    });
    if (!n?.needs.ok) throw new Error("Needs attention failed");
    expect(ok(b.toMark).items).toEqual(n.needs.data.toMark);
    expect(ok(b.toMark).items.map((x) => x.shiftId)).toEqual([done]);
  });
});

describe("when the planner or sheet last sent changes", () => {
  it("the planner's latest change while a key is live; else the sheet's last sync; else none", async () => {
    const t = await boardFirm();
    expect(ok((await t.load()).planner)).toEqual({ kind: "none" });
    await t.f.sheetSource(hoursFromNow(-1));
    expect(ok((await t.load()).planner)).toEqual({ kind: "sheet", syncedAt: hoursFromNow(-1) });
    const key = await plannerKey(su, t.f.firmId, t.admin);
    // A live key with no change logged yet: still the sheet.
    expect(ok((await t.load()).planner).kind).toBe("sheet");
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data, created_at)
       values ($1, 'system', 'shift.created', 'shift', $2, $3, $4)`,
      [
        t.f.firmId,
        t.door,
        JSON.stringify({ by: "firm", via: "api", keyId: key.id }),
        hoursFromNow(-0.5),
      ],
    );
    expect(ok((await t.load()).planner)).toEqual({
      kind: "api",
      lastChangeAt: hoursFromNow(-0.5),
    });
    await su.query("update api_keys set revoked_at = now(), revoked_by = $2 where id = $1", [
      key.id,
      t.admin,
    ]);
    expect(ok((await t.load()).planner).kind).toBe("sheet");
  });
});

describe("the detail card's session", () => {
  it("the soonest urgent one under the filter, else the soonest; the one asked for while it has a place free", async () => {
    const t = await boardFirm();
    expect(ok((await t.load()).gaps).chosen?.shiftId).toBe(t.door);
    expect(ok((await t.load("next-week")).gaps).chosen?.shiftId).toBe(t.fair);
    expect(ok((await t.load("all", t.steward)).gaps).chosen?.shiftId).toBe(t.steward);
    // Another filter's session, or one past the columns' first 50: still shown, with its offers.
    const later = ok((await t.load("this-week", t.later)).gaps).chosen;
    expect(later).toMatchObject({ shiftId: t.later, offers: { waiting: 1 } });
    // One with no place free, a started one, or a made-up id: the default.
    for (const asked of [t.full, t.started, "not-a-uuid", "00000000-0000-4000-8000-000000000000"]) {
      expect(ok((await t.load("all", asked)).gaps).chosen?.shiftId, asked).toBe(t.door);
    }
  });

  it("none when nothing has a place free", async () => {
    const f = await bookingFirm(su, withFirm);
    await f.shift({ status: "filled" });
    const g = ok((await withFirm(f.firmId, (tx) => loadBoard(tx, NOW))).gaps);
    expect(g).toMatchObject({ chosen: null, toOffer: { total: 0 }, offered: { total: 0 } });
  });
});

describe("who may see it", () => {
  it("admins and resourcers; not payroll, a disabled user, or another firm's", async () => {
    const t = await boardFirm();
    const other = await bookingFirm(su, withFirm);
    const as = (officeUserId: string, firmId = t.f.firmId) =>
      officeDashboard({
        firm: { id: firmId },
        officeUserId,
        run: withFirm,
        clock: { now: () => NOW },
      });
    expect(await as(t.admin)).not.toBeNull();
    expect(await as(await t.f.office("resourcer"))).not.toBeNull();
    expect(await as(await t.f.office("payroll"))).toBeNull();
    expect(await as(await t.f.office("resourcer", "disabled"))).toBeNull();
    expect(await as(await other.office("admin"), t.f.firmId)).toBeNull();
  });
});

describe("isolation", () => {
  it("one firm's board never counts or shows another firm's rows, and every part loads", async () => {
    const mine = await boardFirm();
    const theirs = await boardFirm();
    // Theirs: a take last night, a session to mark, a rota sheet, and a planner change through a
    // live key. Mine: a live key with no change logged (so only another firm's change could make
    // it "api") and no sheet.
    const w = await theirs.f.worker({ first: "Theirs" });
    const s = await theirs.f.shift({ startsAt: hoursFromNow(20), headcount: 2 });
    await offer(theirs.f, s, w, { response: "accepted", answeredAt: hoursFromNow(-3) });
    await theirs.f.booking(w, s);
    const done = await theirs.f.shift({ startsAt: hoursFromNow(-30) });
    await theirs.f.booking(w, done);
    await theirs.f.sheetSource(hoursFromNow(-1));
    const theirKey = await plannerKey(su, theirs.f.firmId, theirs.admin);
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data, created_at)
       values ($1, 'system', 'shift.created', 'shift', $2, $3, $4)`,
      [
        theirs.f.firmId,
        s,
        JSON.stringify({ by: "firm", via: "api", keyId: theirKey.id }),
        hoursFromNow(-0.5),
      ],
    );
    await plannerKey(su, mine.f.firmId, mine.admin);
    // Theirs shows on their own board (so mine's empty parts below aren't empty by accident).
    const their = await theirs.load();
    expect(ok(their.overnight).takes.map((x) => x.shiftId)).toEqual([s]);
    expect(ok(their.toMark).items.map((x) => x.shiftId)).toEqual([done]);
    expect(ok(their.planner)).toEqual({ kind: "api", lastChangeAt: hoursFromNow(-0.5) });
    expect(ok(their.counts).all).toBe(6);
    const b = await mine.load();
    for (const p of [b.planner, b.counts, b.chart, b.gaps, b.overnight, b.toMark]) {
      expect(p.ok).toBe(true);
    }
    const theirIds = new Set([
      theirs.door,
      theirs.steward,
      theirs.fair,
      theirs.later,
      theirs.hidden,
      s,
    ]);
    const g = ok(b.gaps);
    for (const x of [...g.toOffer.sessions, ...g.offered.sessions]) {
      expect(theirIds.has(x.shiftId)).toBe(false);
    }
    expect(ok(b.counts).all).toBe(5);
    expect(ok(b.chart).days.reduce((n, d) => n + d.toOffer + d.offered, 0)).toBe(6);
    expect(ok(b.overnight).takes).toEqual([]);
    expect(ok(b.toMark).items).toEqual([]);
    expect(ok(b.planner)).toEqual({ kind: "none" });
    // Their session asked for by id: not found here (RLS), so the default.
    expect(ok((await mine.load("all", theirs.door)).gaps).chosen?.shiftId).toBe(mine.door);
  });
});

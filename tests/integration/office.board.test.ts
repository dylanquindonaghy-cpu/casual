import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  BOARD_ROWS,
  loadBoard,
  officeDashboard,
  type Board,
  type BoardShow,
} from "@/lib/office/dashboard-board";
import { headLine } from "@/lib/office/board-copy";
import { toMarkGroups } from "@/lib/office/to-mark";
import {
  offerState,
  offerStateSql,
  offerWhySql,
  type OfferState,
  type OfferWhy,
} from "@/lib/office/offer-state";
import { loadOfficeFrame } from "@/lib/office/frame";
import { officeOfferCandidates } from "@/lib/offers/office-offer";
import { DEFAULT_PAY_CALENDAR } from "@/lib/pay/calendar";
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
  return {
    f,
    admin,
    arena,
    depot,
    door,
    steward,
    fair,
    later,
    hidden,
    started,
    full,
    ann,
    ben,
    load,
  };
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

  it("an urgent session whose waves offered it to 25 casuals for each free place is at the offer limit (Phase 25.3)", async () => {
    const t = await boardFirm();
    // The steward session (2 places, both offers said no): 47 more casuals said no too, 49 in all.
    const { rows: many } = await su.query<{ id: string }>(
      // Made-up numbers in Ofcom's drama range (07700 900000 to 900999) this firm doesn't use yet.
      `insert into workers (firm_id, first_name, last_name, mobile_e164)
       select $1, 'Many', 'Casual ' || x.n, x.m
         from (select n, '+447700900' || lpad(n::text, 3, '0') as m
                 from generate_series(0, 999) as n) x
        where not exists (select 1 from workers w where w.firm_id = $1 and w.mobile_e164 = x.m)
        order by x.n
        limit 48
       returning id::text as id`,
      [t.f.firmId],
    );
    for (const w of many.slice(0, 47)) {
      await offer(t.f, t.steward, w.id, { response: "declined" });
    }
    const steward = async () =>
      ok((await t.load()).gaps).toOffer.sessions.find((s) => s.shiftId === t.steward)?.offers;
    expect(await steward()).toMatchObject({ sent: 49, atLimit: false });
    // The 50th: the most for its 2 places, but it isn't urgent, so no waves ran.
    await offer(t.f, t.steward, many[47]?.id ?? "", { response: "declined" });
    expect(await steward()).toMatchObject({ sent: 50, atLimit: false });
    // Urgent: the waves stop there, and the card says so.
    await set("shifts", t.steward, { is_urgent: true });
    expect(await steward()).toMatchObject({ sent: 50, atLimit: true });
    // A third place: no longer at the limit.
    await set("shifts", t.steward, { headcount: 3 });
    expect(await steward()).toMatchObject({ sent: 50, atLimit: false });
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

describe("the head's pay period (Phase 25.2)", () => {
  it("the firm's own pay calendar, read with the board; none set: ISO weeks", async () => {
    const plain = await bookingFirm(su, withFirm);
    const weekly = await withFirm(plain.firmId, (tx) => loadBoard(tx, NOW));
    expect(weekly.payCalendar).toEqual(DEFAULT_PAY_CALENDAR);
    expect(headLine(weekly.today, null, NOW, weekly.timeZone, weekly.payCalendar)).toBe(
      "Monday 2 November · Week 45 · Pay Fri 13 Nov",
    );
    const f = await bookingFirm(su, withFirm, {
      settings: {
        pay_calendar: { days: 14, anchor: "2026-01-05", pay_day_after: 5, label: "cycle" },
      },
    });
    const board = await withFirm(f.firmId, (tx) => loadBoard(tx, NOW));
    expect(headLine(board.today, null, NOW, board.timeZone, board.payCalendar)).toBe(
      "Monday 2 November · Cycle 22 · Pay Fri 13 Nov",
    );
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
    const { shell } = await loadOfficeFrame({
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
  });
});

describe("Who worked?", () => {
  it("is Needs attention's sessions to mark, the same items", async () => {
    const t = await boardFirm();
    const done = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(t.ann, done);
    const b = await t.load();
    const n = (
      await loadOfficeFrame({
        firm: { id: t.f.firmId },
        officeUserId: t.admin,
        run: withFirm,
        clock: { now: () => NOW },
      })
    ).needs;
    if (!n?.needs.ok) throw new Error("Needs attention failed");
    expect(ok(b.toMark).items).toEqual(n.needs.data.toMark);
    expect(ok(b.toMark).total).toBe(n.needs.data.toMarkTotal);
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

  // Phase 25.4: a connector to the firm's own portal, by its quick read's time (headLine).
  it("a connector to the firm's own portal: its reads, never shown as a sheet", async () => {
    const t = await boardFirm();
    await su.query(
      `insert into roster_sources (firm_id, kind, enabled, connector, base_url, mapping,
                                   last_near_synced_at, last_synced_at)
       values ($1, 'connector', true, 'demo_portal', 'https://portal.example.test/api', '{}',
               $2, $3)`,
      [t.f.firmId, hoursFromNow(-0.25), hoursFromNow(-30)],
    );
    expect(ok((await t.load()).planner)).toEqual({
      kind: "connector",
      connector: "demo_portal",
      nearReadAt: hoursFromNow(-0.25),
      fullReadAt: hoursFromNow(-30),
      failing: null,
    });
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
    // Theirs: a place a casual took 3 hours ago (an update), in a role mine has no session in; a
    // session to mark (Who worked?); a rota sheet; and a planner change through a live key. Mine: a
    // live key with no change logged (so only another firm's change could make it "api") and no
    // sheet.
    const w = await theirs.f.worker({ first: "Theirs" });
    const s = await theirs.f.shift({
      role: "csas_officer",
      startsAt: hoursFromNow(20),
      headcount: 2,
    });
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
    expect(ok(their.updates).items.some((u) => u.kind === "took" && u.shiftId === s)).toBe(true);
    expect(ok(their.toMark).items.map((x) => x.shiftId)).toEqual([done]);
    expect(ok(their.whoWorked).map((g) => g.shiftIds)).toEqual([[done]]);
    expect(ok(their.whoWorked)[0]?.people.map((p) => p.workerId)).toEqual([w]);
    expect(ok(their.roles)).toContain("csas_officer");
    expect(
      ok(their.venues)
        .map((v) => v.siteId)
        .sort(),
    ).toEqual([theirs.arena, theirs.depot].sort());
    expect(ok(their.planner)).toEqual({ kind: "api", lastChangeAt: hoursFromNow(-0.5) });
    expect(ok(their.counts).all).toBe(6);
    const b = await mine.load();
    for (const p of [
      b.planner,
      b.counts,
      b.gaps,
      b.toMark,
      b.roles,
      b.venues,
      b.updates,
      b.whoWorked,
    ]) {
      expect(p.ok).toBe(true);
    }
    const theirIds = new Set([
      theirs.door,
      theirs.steward,
      theirs.fair,
      theirs.later,
      theirs.hidden,
      s,
      done,
    ]);
    const g = ok(b.gaps);
    for (const x of [...g.toOffer.sessions, ...g.offered.sessions]) {
      expect(theirIds.has(x.shiftId)).toBe(false);
    }
    expect(ok(b.counts).all).toBe(5);
    expect(ok(b.toMark).items).toEqual([]);
    expect(ok(b.planner)).toEqual({ kind: "none" });
    // Round 8's parts (Phase 26.2): only my roles, my venues, my updates, nobody of theirs to mark,
    // and who can take my chosen session counted from my casuals only.
    expect(ok(b.roles)).not.toContain("csas_officer");
    expect(
      ok(b.venues)
        .map((v) => v.siteId)
        .sort(),
    ).toEqual([mine.arena, mine.depot].sort());
    for (const u of ok(b.updates).items) {
      if (u.kind === "took" || u.kind === "cancelled") expect(theirIds.has(u.shiftId)).toBe(false);
      if (u.kind === "upload") expect(u.workerId).not.toBe(w);
    }
    expect(ok(b.updates).items.some((u) => u.kind === "took")).toBe(false);
    expect(ok(b.whoWorked)).toEqual([]);
    expect(g.chosen?.shiftId).toBe(mine.door);
    const takers = b.takers;
    if (!takers) throw new Error("no session chosen");
    const list = await withFirm(mine.f.firmId, (tx) => officeOfferCandidates(tx, mine.door, NOW));
    expect(ok(takers).count).toBe(list.length);
    expect(list.map((c) => c.workerId)).not.toContain(w);
    expect(ok(takers).only?.workerId).not.toBe(w);
    // Their session asked for by id: not found here (RLS), so the default.
    expect(ok((await mine.load("all", theirs.door)).gaps).chosen?.shiftId).toBe(mine.door);
  });
});

// Round 8's dashboard (Phase 26.2; src/lib/office/dashboard-map.ts): the venue map, who can take the
// chosen session, Updates and Who worked? by name, read from the firm's own rows.
describe("round 8: the venue map", () => {
  it("each venue with places to fill under the filter: its places, urgent, days, position and soonest session", async () => {
    const b = await boardFirm();
    const arena = (
      await su.query<{ site_id: string }>(
        "select site_id::text from shift_events where id = (select event_id from shifts where id = $1)",
        [b.door],
      )
    ).rows[0]!.site_id;
    await set("sites", arena, { lat: "53.800000", lng: "-1.550000", town: "Leeds" });
    const all = ok((await b.load()).venues);
    expect(
      all.map((v) => [v.name, v.places, v.urgent, v.hidden, v.days, v.firstShiftId, v.lat, v.lng]),
    ).toEqual([
      // The door supervisor (2 free) and the steward (2): the urgent one first, its pin's link.
      ["Acme Arena", 4, true, false, ["2026-11-03", "2026-11-05"], b.door, 53.8, -1.55],
      // The Depot's own session (Tue 10, inside next week); no position: listed, never placed.
      ["Acme Depot", 1, false, false, ["2026-11-10"], b.fair, null, null],
    ]);
    // Under Urgent, only the urgent session's places.
    expect(ok((await b.load("urgent")).venues).map((v) => [v.name, v.places])).toEqual([
      ["Acme Arena", 2],
    ]);
  });

  it("Show full venues: a venue whose sessions are all booked too, with nothing to fill", async () => {
    const b = await boardFirm();
    const hall = await site(b.f, "Acme Hall");
    await set("shifts", b.full, { site_id: hall });
    const shown = (full: boolean) =>
      withFirm(b.f.firmId, (tx) => loadBoard(tx, NOW, { full })).then((x) =>
        ok(x.venues).map((v) => [v.name, v.places, v.sessions]),
      );
    expect(await shown(false)).toEqual([
      ["Acme Arena", 4, 2],
      ["Acme Depot", 1, 1],
    ]);
    expect(await shown(true)).toEqual([
      ["Acme Arena", 4, 2],
      ["Acme Depot", 1, 1],
      ["Acme Hall", 0, 1],
    ]);
  });

  it("Filter: the roles with places to fill; one chosen narrows the counts, the columns and the map", async () => {
    const b = await boardFirm();
    const all = await b.load();
    expect(ok(all.roles)).toEqual(["door_supervisor", "steward"]);
    expect(all.role).toBeNull();
    const stewards = await withFirm(b.f.firmId, (tx) => loadBoard(tx, NOW, { role: "steward" }));
    expect(stewards.role).toBe("steward");
    const sessions = [...ids(stewards, "toOffer"), ...ids(stewards, "offered")];
    expect(sessions.sort()).toEqual([b.steward, b.fair].sort());
    expect(ok(stewards.counts).all).toBe(2);
    expect(ok(stewards.venues).map((v) => [v.name, v.places])).toEqual([
      ["Acme Arena", 2],
      ["Acme Depot", 1],
    ]);
    // A role with nothing to fill (or made up) is every role.
    const made = await withFirm(b.f.firmId, (tx) => loadBoard(tx, NOW, { role: "lifeguard" }));
    expect(made.role).toBeNull();
    expect(ok(made.counts).all).toBe(ok(all.counts).all);
  });

  it("who can take the chosen session: the rules' own list, as the offer page's", async () => {
    const b = await boardFirm();
    const board = await b.load();
    expect(ok(board.gaps).chosen?.shiftId).toBe(b.door);
    const list = await withFirm(b.f.firmId, (tx) => officeOfferCandidates(tx, b.door, NOW));
    const takers = board.takers?.ok ? board.takers.data : null;
    expect(takers?.count).toBe(list.length);
    expect(takers?.only?.name ?? null).toBe(list.length === 1 ? list[0]!.name : null);
  });
});

describe("round 8: Updates", () => {
  it("the last two days: places taken, casuals' cancellations, uploads to check, and offers with no reply as one line", async () => {
    const b = await boardFirm();
    const eve = await b.f.worker({ first: "Eve" });
    // Eve took the steward's place an hour ago (her offer said yes, and she's booked).
    await offer(b.f, b.steward, eve, {
      response: "accepted",
      sentAt: hoursFromNow(-2),
      answeredAt: hoursFromNow(-1),
    });
    await b.f.booking(eve, b.steward);
    // Cal cancelled the Depot's session 5 hours ago, with 20 hours' notice; one 3 days ago isn't
    // an update any more.
    const cal = await b.f.worker({ first: "Cal2" });
    const late = await b.f.booking(cal, b.fair, "cancelled_worker");
    await set("assignments", late, { cancelled_at: hoursFromNow(-5) });
    const old = await b.f.booking(cal, b.door, "cancelled_worker", 2);
    await set("assignments", old, { cancelled_at: hoursFromNow(-72) });
    // Ann's photo, waiting for a check, 3 hours ago.
    await su.query(
      `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data, created_at)
       values ($1, $2, 'photo', 'image/jpeg', 3, $3, '\\xffd8ff'::bytea, $4)`,
      [b.f.firmId, b.ann, randomBytes(32).toString("hex"), hoursFromNow(-3)],
    );
    const u = ok((await b.load()).updates);
    expect(u.more).toBe(false);
    expect(
      u.items.map((i) =>
        i.kind === "took"
          ? [i.kind, i.worker, i.shiftId, i.placesFree]
          : i.kind === "cancelled"
            ? [i.kind, i.worker, i.shiftId, i.noticeHours, i.strike, i.reopened]
            : i.kind === "upload"
              ? [i.kind, i.worker, i.what]
              : [i.kind, i.offers, i.sessions],
      ),
    ).toEqual([
      // Newest first: Eve's take (1 h ago, the steward session now 1 to fill), Ann's photo (3 h),
      // the offers waiting (Ann's on the door supervisor and the later one: the newest 2 h ago),
      // Cal's cancellation (5 h, no strike in this fixture, its place open again).
      ["took", "Eve Booker", b.steward, 1],
      ["no-reply", 2, 2],
      ["upload", "Ann Booker", "photo"],
      ["cancelled", "Cal2 Booker", b.fair, 20, null, true],
    ]);
  });
});

describe("round 8: Who worked? by name", () => {
  it("each session to mark with the people still booked on it, by name; alike sessions together; the first three groups", async () => {
    const b = await boardFirm();
    const ended = await b.f.shift({ startsAt: hoursFromNow(-10), hours: 8, headcount: 3 });
    const zed = await b.f.worker({ first: "Zed" });
    const amy = await b.f.worker({ first: "Amy" });
    const kim = await b.f.worker({ first: "Kim" });
    await b.f.booking(zed, ended, "confirmed", 1);
    await b.f.booking(amy, ended, "confirmed", 2);
    await b.f.booking(kim, ended, "completed", 3); // marked already: not listed
    // A session alike to it (same role, place and times: one group), with its own person.
    const twin = await b.f.shift({ startsAt: hoursFromNow(-10), hours: 8, headcount: 1 });
    const bo = await b.f.worker({ first: "Bo" });
    await b.f.booking(bo, twin, "confirmed", 4);
    const board = await b.load();
    const w = ok(board.whoWorked);
    const mine = w.find((g) => g.shiftIds.includes(ended));
    expect(mine?.shiftIds).toEqual(expect.arrayContaining([ended, twin]));
    // By name across the group, each with their own session.
    expect(mine?.people.map((p) => [p.name, p.shiftId])).toEqual([
      ["Amy Booker", ended],
      ["Bo Booker", twin],
      ["Zed Booker", ended],
    ]);
    expect(w.length).toBeLessThanOrEqual(3);
    // Needs attention's sessions, alike ones together, in its order.
    const items = ok(board.toMark).items;
    expect(w.map((g) => g.shiftIds)).toEqual(
      toMarkGroups(items)
        .slice(0, 3)
        .map((g) => g.sessions.map((s) => s.shiftId)),
    );
  });
});

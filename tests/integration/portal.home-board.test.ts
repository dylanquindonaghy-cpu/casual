import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  countPills,
  qualificationRows,
  recordFigures,
  toDoCount,
  updateRows,
} from "@/lib/portal/home-board";
import { needsCount, UPDATES_MAX } from "@/lib/portal/home-copy";
import { homeWeek } from "@/lib/portal/home-week";
import { unreadReplies } from "@/lib/portal/messages";
import { myHome, urgentCount } from "@/lib/portal/my-home";
import { myRecord } from "@/lib/portal/my-record";
import { myReachPrompts } from "@/lib/portal/reach-me";
import { myNeedsAndPhoto, myShifts } from "@/lib/portal/my-shifts";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { mySortedMark } from "@/lib/portal/profile";
import { tabCounts } from "@/lib/portal/tab-counts";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Home as the casual's dashboard (Phase 30.1; docs/screens.md "### 30.1") on the real database, as
// the app role: myHome() reads her qualifications, staff photo, right to work, reliability and
// strikes (Profile's loaders), her latest record entries (her shift record's) and her week (Booked's
// lists), and the page's counts equal what /shifts, /shifts/open, /urgent and /messages count. Her
// own rows only: never another casual's, never another firm's. NOW is Monday 2 November 2026, 09:00
// London (GMT).

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
const TZ = "Europe/London";
const ctxOf = (f: BookingFirm) => ({
  firm: { id: f.firmId, timezone: TZ },
  run: withFirm,
  clock,
});

// A booking of hers, logged as her own (shift.assigned with her id, as bookShift() logs it).
async function logBooked(f: BookingFirm, workerId: string, shiftId: string, assignmentId: string) {
  await su.query(
    `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data, created_at)
     values ($1, 'worker', $2, 'shift.assigned', 'assignment', $3, $4, $5)`,
    [
      f.firmId,
      workerId,
      assignmentId,
      JSON.stringify({ by: "worker", shiftId, workerId, slot: 1, noticeHours: 72 }),
      hoursFromNow(-2),
    ],
  );
}

async function scene() {
  const f = await bookingFirm(su, withFirm);
  const checker = await f.office("resourcer");
  // Sam: a steward and door supervisor, both qualifications held (the fixture's), a staff photo
  // approved on 22 November 2023 (renew by 22 November 2026: due soon), booked on Thursday.
  const sam = await f.worker({ first: "Sam" });
  await su.query(
    `insert into uploads (firm_id, worker_id, kind, content_type, size, sha256, data, status,
                          checked_by, checked_at, created_at)
     values ($1, $2, 'photo', 'image/jpeg', 3, $3, '\\xffd8ff'::bytea, 'approved', $4, $5, $5)`,
    [f.firmId, sam, randomBytes(32).toString("hex"), checker, new Date("2023-11-22T12:00:00Z")],
  );
  const thursday = await f.shift({ role: "steward", startsAt: hoursFromNow(72), headcount: 1 });
  await su.query("update shifts set status = 'filled' where id = $1", [thursday]);
  const booking = await f.booking(sam, thursday);
  await logBooked(f, sam, thursday, booking);
  // Open to her: one urgent door supervisor shift on Wednesday, one plain one on Saturday.
  const urgent = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(48) });
  await su.query("update shifts set is_urgent = true where id = $1", [urgent]);
  const saturday = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(5 * 24) });
  // An office reply she hasn't read.
  await su.query(
    `insert into messages (firm_id, direction, channel, provider_message_id, worker_id, body)
     values ($1, 'out', 'app', $2, $3, 'See you Thursday.')`,
    [f.firmId, `app:home-${randomUUID()}`, sam],
  );
  // Ann, in the same firm: a first aid certificate (on no role of Sam's), her own booking on
  // Friday, and its log entry.
  const ann = await f.worker({
    first: "Ann",
    credentials: [
      { type: "STEWARD_L2", expiresOn: null },
      { type: "SIA_DS", expiresOn: "2027-06-01" },
      { type: "FIRST_AID", expiresOn: "2027-01-01" },
    ],
  });
  const friday = await f.shift({ role: "steward", startsAt: hoursFromNow(96) });
  const annBooking = await f.booking(ann, friday);
  await logBooked(f, ann, friday, annBooking);
  return { f, sam, ann, thursday, urgent, saturday, friday };
}

describe("Home's board (30.1)", () => {
  it("her qualifications, photo, right to work, week, latest updates and record, from her own rows", async () => {
    const s = await scene();
    const ctx = ctxOf(s.f);
    const upcoming = await myShifts(ctx, s.sam, "upcoming");
    const home = await myHome(ctx, s.sam, upcoming);
    expect(home.profile).not.toBeNull();

    const quals = qualificationRows({
      qualifications: home.profile!.qualifications,
      others: home.profile!.others,
      photo: home.profile!.photo,
      rightToWork: home.profile!.rightToWork,
      today: "2026-11-02",
    });
    expect(quals.map((q) => [q.title, q.pill.words])).toEqual([
      ["Staff photo", "20 days left"],
      ["Right to work", "Not recorded"],
      ["SIA door supervisor licence", "Valid · 791 days"],
      ["Level 2 spectator safety qualification", "No expiry"],
    ]);
    expect(quals[0]).toMatchObject({ line: "Renew by 22 Nov", action: "Take a new photo" });
    // Ann's first aid certificate is hers alone.
    expect(JSON.stringify(quals)).not.toMatch(/first aid/i);

    // Her week: Thursday booked, Wednesday and Saturday open to her; Ann's Friday isn't hers.
    const open = await openShiftsFor(ctx, s.sam);
    const weeks = homeWeek(NOW, TZ, home.week, open.shifts);
    const tile = (day: string) => weeks.flatMap((w) => w.tiles).find((t) => t.day === day)!;
    expect(tile("2026-11-05")).toMatchObject({ booked: true, href: `/shifts/${s.thursday}` });
    expect(tile("2026-11-04")).toMatchObject({ booked: false, open: 1 });
    expect(tile("2026-11-07")).toMatchObject({ booked: false, open: 1 });
    expect(tile("2026-11-06")).toMatchObject({ booked: false, open: 0, href: null });
    expect(home.week.map((b) => b.shiftId)).toEqual([s.thursday]);

    // Her latest updates: her own booking only, never Ann's.
    const updates = updateRows(home.updates, NOW, TZ);
    expect(updates.map((u) => [u.title, u.href])).toEqual([
      ["Booked by you", `/shifts/${s.thursday}`],
    ]);
    expect(home.updates.some((u) => u.shift?.id === s.friday)).toBe(false);

    // Her record: Profile's figures.
    expect(recordFigures(home.profile!.reliability!, home.strikes)).toEqual(
      home.strikes.shown
        ? [
            { key: "worked", figure: "0", label: "shifts worked" },
            { key: "reliability", figure: "New", label: "score after 5 shifts" },
            { key: "strikes", figure: "0", label: `strikes in ${home.strikes.liveDays} days` },
          ]
        : [
            { key: "worked", figure: "0", label: "shifts worked" },
            { key: "reliability", figure: "New", label: "score after 5 shifts" },
          ],
    );
  });

  it("every count equals the page it opens: /shifts, /shifts/open, /urgent, Do this and /messages", async () => {
    const s = await scene();
    const ctx = ctxOf(s.f);
    const [upcoming, open, needs, mark, counts, reply] = await Promise.all([
      myShifts(ctx, s.sam, "upcoming"),
      openShiftsFor(ctx, s.sam),
      myNeedsAndPhoto(ctx, s.sam),
      mySortedMark(ctx, s.sam),
      tabCounts(ctx, s.sam),
      unreadReplies(ctx, s.sam),
    ]);
    const urgentBoard = await openShiftsFor(ctx, s.sam, { urgent: true });
    const pills = countPills({
      booked: upcoming.length,
      open: open.shifts.length,
      urgent: await urgentCount(ctx, s.sam, open),
      todo: needsCount(needs.needs, needs.photo, 2026, mark),
      messages: counts.replies,
    });
    const n = (key: string) => pills.find((p) => p.key === key)?.count;
    // /shifts: her upcoming bookings.
    expect(n("booked")).toBe(1);
    // /shifts/open: the shifts she can take (the urgent one and Saturday's).
    expect(n("open")).toBe(open.shifts.length);
    expect(open.shifts.map((o) => o.shiftId).sort()).toEqual([s.urgent, s.saturday].sort());
    // /urgent: the urgent board's own list.
    expect(n("urgent")).toBe(urgentBoard.shifts.length);
    expect(n("urgent")).toBe(1);
    // Do this: her photo, due soon.
    expect(n("todo")).toBe(1);
    // /messages: the office's reply she hasn't read.
    expect(n("messages")).toBe(reply);
    expect(n("messages")).toBe(1);
  });

  it("another casual's rows never show, and another firm never reads hers", async () => {
    const s = await scene();
    const annHome = await myHome(ctxOf(s.f), s.ann, await myShifts(ctxOf(s.f), s.ann, "upcoming"));
    expect(annHome.week.map((b) => b.shiftId)).toEqual([s.friday]);
    expect(annHome.updates.map((u) => u.shift?.id)).toEqual([s.friday]);
    expect(annHome.profile?.photo.status).toBe("missing");

    // In another firm, Sam's id finds nothing of his.
    const other = await bookingFirm(su, withFirm);
    const ctx = ctxOf(other);
    const upcoming = await myShifts(ctx, s.sam, "upcoming");
    const home = await myHome(ctx, s.sam, upcoming);
    expect(upcoming).toEqual([]);
    expect(home.profile).toBeNull();
    expect(home.updates).toEqual([]);
    expect(home.week).toEqual([]);
    expect(home.strikes.counting).toBe(0);
    expect(await unreadReplies(ctx, s.sam)).toBe(0);
  });

  it("To do counts the 'can we reach you' rows too, as 'Do this' shows them", async () => {
    const s = await scene();
    const ctx = ctxOf(s.f);
    // Sam turns "Tell me about open shifts" off: "Open-shift alerts are off" joins his photo.
    await su.query("update workers set offer_alerts = false where id = $1", [s.sam]);
    const upcoming = await myShifts(ctx, s.sam, "upcoming");
    const [home, reach, needs, mark] = await Promise.all([
      myHome(ctx, s.sam, upcoming),
      myReachPrompts(ctx, s.sam, true),
      myNeedsAndPhoto(ctx, s.sam),
      mySortedMark(ctx, s.sam),
    ]);
    expect(reach).toEqual(["alerts_off"]);
    // The page's own figure, from Profile's read (myHome): what needs doing and the office's mark
    // are myNeedsAndPhoto's and mySortedMark's, read once.
    expect(home.profile!.needs).toEqual(needs.needs);
    expect(home.profile!.photo).toEqual(needs.photo);
    expect(home.profile!.sortedMark).toEqual(mark);
    const todo = toDoCount({
      needs: home.profile!.needs!,
      photo: home.profile!.photo,
      year: 2026,
      sortedMark: home.profile!.sortedMark ?? null,
      reach,
    });
    expect(needsCount(needs.needs, needs.photo, 2026, mark)).toBe(1); // his photo, due soon
    expect(todo).toBe(2);
    const pills = countPills({ booked: upcoming.length, open: 0, urgent: 0, todo, messages: 0 });
    expect(pills.find((p) => p.key === "todo")).toMatchObject({ count: 2, onlineOnly: true });
    // And nothing can reach him (no phone, no email, and no text sender): both rows.
    expect(await myReachPrompts(ctx, s.sam, false)).toEqual(["unreachable", "alerts_off"]);
  });

  it("Updates reads only the rows it shows; a past day not attended is never booked", async () => {
    const s = await scene();
    const ctx = ctxOf(s.f);
    // Seven more entries of Sam's: offers of shifts this week.
    for (let i = 0; i < 7; i++) {
      const shift = await s.f.shift({ role: "steward", startsAt: hoursFromNow(100 + i * 24) });
      await su.query(
        `insert into events (firm_id, actor_type, action, entity_type, entity_id, data, created_at)
         values ($1, 'system', 'offer.sent', 'offer', $2, $3, $4)`,
        [
          s.f.firmId,
          randomUUID(),
          JSON.stringify({ shiftId: shift, workerId: s.sam, wave: 1, noticeHours: 100 }),
          hoursFromNow(-1 - i / 10),
        ],
      );
    }
    const all = await myRecord(ctx, s.sam);
    expect(all.rows.length).toBeGreaterThan(UPDATES_MAX);
    // The limit reads that many, newest first, and says there were more.
    const two = await myRecord(ctx, s.sam, { limit: 2 });
    expect(two.rows).toEqual(all.rows.slice(0, 2));
    expect(two.more).toBe(true);
    expect(all.more).toBe(false);
    // Home reads its five.
    const upcoming = await myShifts(ctx, s.sam, "upcoming");
    const home = await myHome(ctx, s.sam, upcoming);
    expect(home.updates).toEqual(all.rows.slice(0, UPDATES_MAX));

    // Earlier today (Monday 2 November, 01:00 to 05:00) Sam was marked as not attending.
    const early = await s.f.shift({ role: "steward", startsAt: hoursFromNow(-8), hours: 4 });
    await s.f.booking(s.sam, early, "no_show");
    const again = await myHome(ctx, s.sam, upcoming);
    expect(again.week.find((b) => b.shiftId === early)).toMatchObject({ noShow: true });
    const monday = homeWeek(NOW, TZ, again.week, [])[0]!.tiles[0]!;
    expect(monday).toMatchObject({ day: "2026-11-02", booked: false, missed: true });
    expect(monday.name).toBe("Monday 2 November, today: not attended, Steward 01:00 to 05:00");
  });
});

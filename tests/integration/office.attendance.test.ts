import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { markAttended, markTheRestWorked } from "@/lib/office/quick-actions";
import { loadToday } from "@/lib/office/today";
import { previewBooking } from "@/lib/roster/book";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office marking who worked a shift and who didn't attend (docs/screens.md, the shift's
// "Places"; golden rule 5). On the real database, as the app role. NOW is Monday 2 November 2026,
// 09:00 London (GMT).

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

// A shift that ran from 01:00 to 09:00 this morning, three places, Ann, Ben and Cal booked.
async function endedShift(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const shiftId = await f.shift({ startsAt: hoursFromNow(-8), headcount: 3 });
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const cal = await f.worker({ first: "Cal" });
  const bookings = {
    ann: await f.booking(ann, shiftId, "confirmed", 1),
    ben: await f.booking(ben, shiftId, "confirmed", 2),
    cal: await f.booking(cal, shiftId, "confirmed", 3),
  };
  const ctx = (officeUserId = resourcer, when = NOW) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: { now: () => when },
  });
  return { f, resourcer, shiftId, ann, ben, cal, bookings, ctx };
}

const statusOf = async (assignmentId: string) =>
  (
    await su.query<{ status: string }>("select status from assignments where id = $1", [
      assignmentId,
    ])
  ).rows[0]?.status;
const eventsOf = async (firmId: string) =>
  (
    await su.query<{
      action: string;
      actor_type: string;
      actor_id: string;
      entity_id: string;
      data: Record<string, unknown>;
    }>(
      `select action, actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action in ('shift.completed', 'shift.no_show') order by id`,
      [firmId],
    )
  ).rows;

describe("marking one person", () => {
  it("worked or didn't attend: the booking changes and the log says who, what and what it was", async () => {
    const t = await endedShift();
    expect(await markAttended(t.ctx(), t.shiftId, t.ann, "completed")).toEqual({
      status: "marked",
      outcome: "completed",
      from: "confirmed",
    });
    expect(await markAttended(t.ctx(), t.shiftId, t.ben, "no_show")).toEqual({
      status: "marked",
      outcome: "no_show",
      from: "confirmed",
    });
    expect(await statusOf(t.bookings.ann)).toBe("completed");
    expect(await statusOf(t.bookings.ben)).toBe("no_show");
    expect(await statusOf(t.bookings.cal)).toBe("confirmed");
    expect(await eventsOf(t.f.firmId)).toEqual([
      {
        action: "shift.completed",
        actor_type: "office",
        actor_id: t.resourcer,
        entity_id: t.bookings.ann,
        data: { by: "firm", shiftId: t.shiftId, workerId: t.ann, from: "confirmed" },
      },
      {
        action: "shift.no_show",
        actor_type: "office",
        actor_id: t.resourcer,
        entity_id: t.bookings.ben,
        data: { by: "firm", shiftId: t.shiftId, workerId: t.ben, from: "confirmed" },
      },
    ]);
  });

  it("a mistake can be put right, and the log keeps both", async () => {
    const t = await endedShift();
    await markAttended(t.ctx(), t.shiftId, t.ann, "no_show");
    expect(await markAttended(t.ctx(), t.shiftId, t.ann, "completed")).toEqual({
      status: "marked",
      outcome: "completed",
      from: "no_show",
    });
    expect(await markAttended(t.ctx(), t.shiftId, t.ann, "completed")).toEqual({
      status: "unchanged",
    });
    expect((await eventsOf(t.f.firmId)).map((e) => [e.action, e.data.from])).toEqual([
      ["shift.no_show", "confirmed"],
      ["shift.completed", "no_show"],
    ]);
  });

  it("once the shift has started (someone running late), not before", async () => {
    const t = await endedShift();
    const later = await t.f.shift({ startsAt: hoursFromNow(2) }); // 11:00 today
    const dee = await t.f.worker({ first: "Dee" });
    const deeBooking = await t.f.booking(dee, later, "confirmed");
    expect(await markAttended(t.ctx(), later, dee, "no_show")).toEqual({ status: "not_started" });
    expect(await statusOf(deeBooking)).toBe("confirmed");
    // 11:20: they haven't turned up.
    expect(
      await markAttended(t.ctx(t.resourcer, hoursFromNow(2.34)), later, dee, "no_show"),
    ).toEqual({
      status: "marked",
      outcome: "no_show",
      from: "confirmed",
    });
    // Days later, from the timesheets.
    expect(
      await markAttended(t.ctx(t.resourcer, hoursFromNow(24 * 9)), t.shiftId, t.cal, "completed"),
    ).toMatchObject({ status: "marked" });
  });

  it("only someone booked: not a cancelled booking, not someone who was never on it", async () => {
    const t = await endedShift();
    const eve = await t.f.worker({ first: "Eve" });
    expect(await markAttended(t.ctx(), t.shiftId, eve, "completed")).toEqual({
      status: "not_booked",
    });
    const fay = await t.f.worker({ first: "Fay" });
    const other = await t.f.shift({ startsAt: hoursFromNow(-8) });
    const cancelled = await t.f.booking(fay, other, "cancelled_worker");
    expect(await markAttended(t.ctx(), other, fay, "no_show")).toEqual({ status: "not_booked" });
    expect(await statusOf(cancelled)).toBe("cancelled_worker");
    expect(await eventsOf(t.f.firmId)).toEqual([]);
  });

  it("a Google Sheet's shift can be marked (the sheet has no attendance of its own)", async () => {
    const t = await endedShift();
    const sheetShift = await t.f.shift({ startsAt: hoursFromNow(-8), source: "sheets" });
    const gus = await t.f.worker({ first: "Gus" });
    const booking = await t.f.booking(gus, sheetShift, "confirmed");
    expect(await markAttended(t.ctx(), sheetShift, gus, "completed")).toMatchObject({
      status: "marked",
    });
    expect(await statusOf(booking)).toBe("completed");
  });

  it("admins and resourcers only; another firm's shift can't be found", async () => {
    const t = await endedShift();
    const payroll = await t.f.office("payroll");
    const gone = await t.f.office("resourcer", "disabled");
    expect(await markAttended(t.ctx(payroll), t.shiftId, t.ann, "completed")).toEqual({
      status: "not_allowed",
    });
    expect(await markAttended(t.ctx(gone), t.shiftId, t.ann, "completed")).toEqual({
      status: "not_allowed",
    });
    const admin = await t.f.office("admin");
    expect(await markAttended(t.ctx(admin), t.shiftId, t.ann, "completed")).toMatchObject({
      status: "marked",
    });

    const other = await endedShift();
    expect(await markAttended(t.ctx(), other.shiftId, other.ann, "no_show")).toEqual({
      status: "not_found",
    });
    expect(await markTheRestWorked(t.ctx(), other.shiftId)).toEqual({ status: "not_found" });
    expect(await statusOf(other.bookings.ann)).toBe("confirmed");
    expect(await eventsOf(other.f.firmId)).toEqual([]);
  });

  it("a no-show no longer counts towards their weekly hours", async () => {
    // A 10-hour weekly cap: this morning's 8 hours plus 8 on Wednesday would be 16.
    const t = await endedShift({ weekly_hours_cap: 10 });
    const wednesday = await t.f.shift({ startsAt: hoursFromNow(48) });
    const preview = () =>
      withFirm(t.f.firmId, (tx) =>
        previewBooking(tx, { shiftId: wednesday, workerId: t.ann, now: NOW }),
      );
    expect((await preview())?.codes).toContain("weekly_hours");
    await markAttended(t.ctx(), t.shiftId, t.ann, "completed");
    expect((await preview())?.codes).toContain("weekly_hours");
    await markAttended(t.ctx(), t.shiftId, t.ann, "no_show");
    expect(await preview()).toMatchObject({ ok: true });
  });
});

describe("marking the rest as worked", () => {
  it("after the end, everyone not marked yet becomes worked, one log line each", async () => {
    const t = await endedShift();
    await markAttended(t.ctx(), t.shiftId, t.ben, "no_show");
    expect(await markTheRestWorked(t.ctx(), t.shiftId)).toEqual({ status: "marked", count: 2 });
    expect(await statusOf(t.bookings.ann)).toBe("completed");
    expect(await statusOf(t.bookings.ben)).toBe("no_show");
    expect(await statusOf(t.bookings.cal)).toBe("completed");
    expect(
      (await eventsOf(t.f.firmId)).map((e) => [e.action, e.data.workerId, e.data.from]),
    ).toEqual([
      ["shift.no_show", t.ben, "confirmed"],
      ["shift.completed", t.ann, "confirmed"],
      ["shift.completed", t.cal, "confirmed"],
    ]);
    expect(await markTheRestWorked(t.ctx(), t.shiftId)).toEqual({ status: "marked", count: 0 });
  });

  it("not before the end, and not for payroll", async () => {
    const t = await endedShift();
    // 08:00: the shift runs until 09:00.
    expect(await markTheRestWorked(t.ctx(t.resourcer, hoursFromNow(-1)), t.shiftId)).toEqual({
      status: "not_ended",
    });
    expect(await markTheRestWorked(t.ctx(await t.f.office("payroll")), t.shiftId)).toEqual({
      status: "not_allowed",
    });
    expect(await statusOf(t.bookings.ann)).toBe("confirmed");
    expect(await eventsOf(t.f.firmId)).toEqual([]);
  });
});

describe("Today: who worked?", () => {
  it("lists shifts that ended in the last 7 days with people not marked yet", async () => {
    const t = await endedShift();
    // Ended 8 days ago: too old. Fully marked: nothing to do. Not ended yet: not listed.
    const old = await t.f.shift({ startsAt: hoursFromNow(-24 * 8) });
    await t.f.booking(await t.f.worker({ first: "Old" }), old, "confirmed");
    const marked = await t.f.shift({ startsAt: hoursFromNow(-30) });
    await t.f.booking(await t.f.worker({ first: "Hal" }), marked, "completed");
    const running = await t.f.shift({ startsAt: hoursFromNow(-2) });
    await t.f.booking(await t.f.worker({ first: "Ivy" }), running, "confirmed");

    const toMark = async () =>
      (await withFirm(t.f.firmId, (tx) => loadToday(tx, NOW))).toMark.map((m) => [
        m.shiftId,
        m.unmarked,
      ]);
    // Another firm's shift that ended with nobody marked never shows here.
    const other = await endedShift();
    expect(await toMark()).toEqual([[t.shiftId, 3]]);
    expect(
      (await withFirm(other.f.firmId, (tx) => loadToday(tx, NOW))).toMark.map((m) => m.shiftId),
    ).toEqual([other.shiftId]);
    await markAttended(t.ctx(), t.shiftId, t.ann, "no_show");
    expect(await toMark()).toEqual([[t.shiftId, 2]]);
    await markTheRestWorked(t.ctx(), t.shiftId);
    expect(await toMark()).toEqual([]);
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pastMark } from "@/app/shifts/booked-view";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { myMarkedShift, myShiftCounts, myShifts } from "@/lib/portal/my-shifts";
import { askAboutMark } from "@/lib/portal/requests";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Phase 28.13 (docs/screens.md "### 28.13") on the real database as the app role: Booked's Past
// covers the 90 days reliability counts (sessions that started within RELIABILITY_DAYS, by
// starts_at, and have ended), each with its hours and mark; the tabs' counts; and "Tell the office
// what happened": the form's gate (myMarkedShift) and what it sends (askAboutMark), which refuse an
// unmarked booking, one from 91 days ago, another casual's and a second open question, and create
// one request for the right booking, logged, never changing the mark. Her own rows only, across
// casuals and firms.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const DAY_H = 24;
const SIGN_OFF = "Booking Test Shift Team";

async function setup() {
  const f = await bookingFirm(su, withFirm);
  const sam = await f.worker();
  const jo = await f.worker({ first: "Jo" });
  const ctx = (now = NOW) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: SIGN_OFF },
    run: withFirm,
    clock: { now: () => now },
  });
  return { f, sam, jo, ctx };
}

describe("Booked's Past 90 days", () => {
  it("lists bookings on sessions that started within 90 days and have ended (89 days in, 91 out, by starts_at), with hours and marks", async () => {
    const { f, sam, jo, ctx } = await setup();
    const unmarked = await f.shift({ startsAt: hoursFromNow(-DAY_H) }); // ended 16 hours ago
    const worked = await f.shift({ startsAt: hoursFromNow(-DAY_H * 10), hours: 6.5 });
    const missed = await f.shift({ startsAt: hoursFromNow(-DAY_H * 40) });
    const day89 = await f.shift({ startsAt: hoursFromNow(-DAY_H * 89) });
    const day91 = await f.shift({ startsAt: hoursFromNow(-DAY_H * 91) });
    // Started 90 days and 2 hours ago, ended inside the window: counted by starts_at, so out.
    const endedInside = await f.shift({ startsAt: hoursFromNow(-DAY_H * 90 - 2) });
    const onNow = await f.shift({ startsAt: hoursFromNow(-2) }); // still on: Upcoming
    const later = await f.shift({ startsAt: hoursFromNow(48) });
    const cancelled = await f.shift({ startsAt: hoursFromNow(-DAY_H * 5) });
    const jos = await f.shift({ startsAt: hoursFromNow(-DAY_H * 3) });
    await f.booking(sam, unmarked);
    await f.booking(sam, worked, "completed");
    await f.booking(sam, missed, "no_show");
    await f.booking(sam, day89, "completed");
    await f.booking(sam, day91, "completed");
    await f.booking(sam, endedInside, "no_show");
    await f.booking(sam, onNow);
    await f.booking(sam, later);
    await f.booking(sam, cancelled, "cancelled_worker");
    await f.booking(jo, jos, "completed");

    const past = await myShifts(ctx(), sam, "past");
    expect(past.map((s) => [s.shiftId, s.status])).toEqual([
      [unmarked, "confirmed"],
      [worked, "completed"],
      [missed, "no_show"],
      [day89, "completed"],
    ]);
    // Hours from the session's own times; marks from her booking row.
    const hours = past.map((s) => (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000);
    expect(hours).toEqual([8, 6.5, 8, 8]);
    expect(past.map((s) => pastMark(s.status)[0])).toEqual([
      "Not marked yet",
      "Worked",
      "Marked as not attended",
      "Worked",
    ]);
    expect(pastMark("confirmed")).toEqual(["Not marked yet", "quiet"]);
    // No travel line on a past shift (the trip is done).
    expect(past.every((s) => s.travel === undefined)).toBe(true);
    // The tabs' counts, by the same rules.
    expect(await myShiftCounts(ctx(), sam)).toEqual({ upcoming: 2, past: 4 });
    expect(await myShiftCounts(ctx(), jo)).toEqual({ upcoming: 0, past: 1 });
    // Jo sees only her own.
    expect((await myShifts(ctx(), jo, "past")).map((s) => s.shiftId)).toEqual([jos]);
  });

  it("never shows or counts another firm's bookings, even for its casual's id", async () => {
    const mine = await setup();
    const theirs = await setup();
    await theirs.f.booking(
      theirs.sam,
      await theirs.f.shift({ startsAt: hoursFromNow(-DAY_H * 2) }),
      "completed",
    );
    expect(await myShifts(mine.ctx(), theirs.sam, "past")).toEqual([]);
    expect(await myShiftCounts(mine.ctx(), theirs.sam)).toEqual({ upcoming: 0, past: 0 });
    expect(await myShifts(theirs.ctx(), theirs.sam, "past")).toHaveLength(1);
  });
});

describe("Tell the office what happened", () => {
  it("opens only for her own session marked in the last 90 days (89 in, 91 out), never another casual's or firm's", async () => {
    const { f, sam, jo, ctx } = await setup();
    const marked = await f.shift({ startsAt: hoursFromNow(-DAY_H * 89) });
    const unmarked = await f.shift({ startsAt: hoursFromNow(-DAY_H * 2) });
    const old = await f.shift({ startsAt: hoursFromNow(-DAY_H * 91) });
    const jos = await f.shift({ startsAt: hoursFromNow(-DAY_H * 2) });
    await f.booking(sam, marked, "no_show");
    await f.booking(sam, unmarked);
    await f.booking(sam, old, "completed");
    await f.booking(jo, jos, "completed");

    expect(await myMarkedShift(ctx(), sam, marked)).toMatchObject({
      shiftId: marked,
      role: "door_supervisor",
      mark: "no_show",
      siteName: null,
    });
    expect(await myMarkedShift(ctx(), sam, unmarked)).toBeNull();
    expect(await myMarkedShift(ctx(), sam, old)).toBeNull();
    expect(await myMarkedShift(ctx(), sam, jos)).toBeNull();
    expect(await myMarkedShift(ctx(), sam, "not-a-uuid")).toBeNull();
    const other = await setup();
    expect(await myMarkedShift(other.ctx(), sam, marked)).toBeNull();
  });

  it("refuses an unmarked booking, one from 91 days ago, another casual's and a second open question; creates one request for the right booking, logged, the mark unchanged", async () => {
    const { f, sam, jo, ctx } = await setup();
    const right = await f.shift({ startsAt: hoursFromNow(-DAY_H * 89) });
    const unmarked = await f.shift({ startsAt: hoursFromNow(-DAY_H * 2) });
    const old = await f.shift({ startsAt: hoursFromNow(-DAY_H * 91) });
    const booking = await f.booking(sam, right, "no_show");
    await f.booking(sam, unmarked);
    await f.booking(sam, old, "no_show");
    await f.booking(jo, await f.shift({ startsAt: hoursFromNow(-DAY_H * 3) }), "completed");
    const ask = (workerId: string, shiftId: string) =>
      askAboutMark(ctx(), workerId, { shiftId, payload: { said: "worked", note: "" } });

    expect(await ask(sam, unmarked)).toEqual({ status: "not_yours" });
    expect(await ask(sam, old)).toEqual({ status: "not_yours" });
    expect(await ask(jo, right)).toEqual({ status: "not_yours" });
    const created = await ask(sam, right);
    expect(created).toMatchObject({ status: "created", signOff: SIGN_OFF });
    const ref = created.status === "created" ? created.ref : "";
    expect(await ask(sam, right)).toEqual({ status: "already_open", ref });

    const { rows } = await su.query<{ id: string; worker_id: string; shift_id: string }>(
      `select id::text as id, worker_id::text as worker_id, shift_id::text as shift_id
         from requests where firm_id = $1 and type = 'attendance'`,
      [f.firmId],
    );
    expect(rows).toEqual([{ id: expect.any(String), worker_id: sam, shift_id: right }]);
    expect(rows[0]?.id.slice(0, 8).toUpperCase()).toBe(ref);
    const { rows: logged } = await su.query<{ n: number }>(
      `select count(*)::int as n from events
        where firm_id = $1 and action = 'request.created' and entity_id = $2`,
      [f.firmId, rows[0]?.id],
    );
    expect(logged[0]?.n).toBe(1);
    const { rows: mark } = await su.query<{ status: string }>(
      "select status from assignments where id = $1",
      [booking],
    );
    expect(mark[0]?.status).toBe("no_show");
  });
});

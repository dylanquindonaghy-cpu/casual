import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { cancelMyShift } from "@/lib/portal/cancel-shift";
import { myShifts } from "@/lib/portal/my-shifts";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// "Cancel this shift" for the logged-in worker, on the real database as the app role: recorded
// through cancelBooking() (reason and notice on the booking, one event), confirmed with the shift,
// the notice given and the booking's reference.

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

const ctxFor = (f: BookingFirm, now = NOW) => ({
  firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
  run: withFirm,
  clock: { now: () => now },
});

describe("cancelMyShift", () => {
  it("records the cancellation and confirms it: the shift, the notice given, the booking's reference", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(53) }); // Wed 14:00
    const { rows: sites } = await su.query<{ id: string }>(
      "insert into sites (firm_id, name) values ($1, 'Demo Arena') returning id::text as id",
      [f.firmId],
    );
    await su.query("update shifts set site_id = $1 where id = $2", [sites[0]?.id, shiftId]);
    const assignmentId = await f.booking(sam, shiftId);

    const outcome = await cancelMyShift(ctxFor(f), sam, shiftId, "Travel problem");
    expect(outcome).toEqual({
      status: "cancelled",
      ref: assignmentId.slice(0, 8).toUpperCase(),
      noticeHours: 53,
      recordedAt: "09:00 on Mon 2 Nov",
      when: "Wed 4 Nov, 14:00 to 22:00",
      role: "Door supervisor",
      siteName: "Demo Arena",
      signOff: "Booking Test Shift Team",
    });
    const { rows } = await su.query(
      `select status, cancel_reason, notice_hours::float as notice from assignments where id = $1`,
      [assignmentId],
    );
    expect(rows[0]).toEqual({
      status: "cancelled_worker",
      cancel_reason: "Travel problem",
      notice: 53,
    });
    const { rows: events } = await su.query(
      "select count(*)::int as n from events where firm_id = $1 and action = 'shift.cancelled'",
      [f.firmId],
    );
    expect(events[0]?.n).toBe(1);
    // Gone from My shifts.
    expect(await myShifts(ctxFor(f), sam, "upcoming")).toEqual([]);
  });

  it("is too late once the shift has started, and says so if they aren't booked", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(2) });
    await f.booking(sam, shiftId);
    const started = new Date(NOW.getTime() + 3 * HOUR);
    expect(await cancelMyShift(ctxFor(f, started), sam, shiftId, "I'm unwell")).toEqual({
      status: "started",
    });
    // Jo isn't booked on it; an unknown shift isn't there.
    expect(await cancelMyShift(ctxFor(f), jo, shiftId, "I'm unwell")).toEqual({
      status: "not_booked",
    });
    expect(
      await cancelMyShift(ctxFor(f), sam, "00000000-0000-4000-8000-000000000000", "I'm unwell"),
    ).toEqual({ status: "not_booked" });
    // Sam's booking is still there.
    expect((await myShifts(ctxFor(f), sam, "upcoming")).map((s) => s.shiftId)).toEqual([shiftId]);
  });

  it("never reaches another firm's booking", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const kit = await theirs.worker();
    const theirShift = await theirs.shift();
    await theirs.booking(kit, theirShift);
    expect(await cancelMyShift(ctxFor(mine), kit, theirShift, "I'm unwell")).toEqual({
      status: "not_booked",
    });
    const { rows } = await su.query<{ status: string }>(
      "select status from assignments where shift_id = $1",
      [theirShift],
    );
    expect(rows.map((r) => r.status)).toEqual(["confirmed"]);
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Allocation mode on the real database, as the app role. Fair rotation holds a newly opened place
// for the workers with the fewest hours that week (here the 2 fewest) for the first-wave minutes
// (here 15), then it's anyone's; first come, first served never holds. NOW is Mon 2 Nov, 09:00.

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

const at = (d: Date) => ({ now: () => d });
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
const book = (f: BookingFirm, shiftId: string, workerId: string, when = NOW) =>
  bookShift(
    withFirm,
    f.firmId,
    { shiftId, workerId, by: { type: "worker", id: workerId } },
    {
      clock: at(when),
    },
  );

// Four workers with 0, 8, 16 and 24 hours booked this week (Thu, Fri, Sat shifts), and a target
// shift on Wednesday with three places that opened 5 minutes ago.
async function fairFirm(mode = "fair_rotation") {
  const f = await bookingFirm(su, withFirm, {
    settings: { allocation_mode: mode, wave_size: 2, wave_minutes: 15 },
  });
  const [ann, ben, cal, dee] = await Promise.all(
    ["Ann", "Ben", "Cal", "Dee"].map((first) => f.worker({ first })),
  );
  const days = [
    await f.shift({ startsAt: hoursFromNow(72) }),
    await f.shift({ startsAt: hoursFromNow(96) }),
    await f.shift({ startsAt: hoursFromNow(120) }),
  ];
  const workers = { ann: ann ?? "", ben: ben ?? "", cal: cal ?? "", dee: dee ?? "" };
  let slot = 1;
  for (const [who, count] of [
    ["ben", 1],
    ["cal", 2],
    ["dee", 3],
  ] as const) {
    for (const day of days.slice(0, count)) await f.booking(workers[who], day, "confirmed", slot);
    slot += 1;
  }
  const target = await f.shift({ startsAt: hoursFromNow(48), headcount: 3 });
  await su.query("update shifts set created_at = $1 where id = $2", [later(-5), target]);
  return { f, target, ...workers };
}

describe("fair rotation", () => {
  it("holds a new place for the fewest hours; the rest can take it when the window ends", async () => {
    const { f, target, ann, ben, cal } = await fairFirm();
    // Cal (16 hours) is held until 09:10 (opened 08:55, plus 15 minutes), and the hold is logged.
    expect(await book(f, target, cal)).toEqual({ status: "not_yet", opensAt: later(10) });
    const { rows: held } = await su.query(
      "select actor_id::text, entity_id::text, data from events where firm_id = $1 and action = 'shift.booking_held'",
      [f.firmId],
    );
    expect(held).toEqual([
      {
        actor_id: cal,
        entity_id: target,
        data: { by: "worker", workerId: cal, opensAt: later(10).toISOString() },
      },
    ]);
    // Ann (0) and Ben (8) are the two fewest: they can take it now.
    expect((await book(f, target, ann)).status).toBe("booked");
    expect((await book(f, target, ben)).status).toBe("booked");
    // Once the window is over, anyone eligible can.
    expect((await book(f, target, cal, later(10))).status).toBe("booked");
  });

  it("shows a held shift in the list with its time, and a free one without", async () => {
    const { f, target, ann, dee } = await fairFirm();
    const ctx = {
      firm: { id: f.firmId, timezone: "Europe/London", signOff: "x" },
      run: withFirm,
      clock: at(NOW),
    };
    const forDee = (await openShiftsFor(ctx, dee)).shifts.find((s) => s.shiftId === target);
    expect(forDee?.opensAt).toEqual(later(10));
    const forAnn = (await openShiftsFor(ctx, ann)).shifts.find((s) => s.shiftId === target);
    expect(forAnn?.opensAt).toBeNull();
  });

  it("opens the window again when someone cancels, and never holds the office", async () => {
    const { f, target, ann, cal, dee } = await fairFirm();
    // The target opened long ago: nobody's held any more.
    await su.query("update shifts set created_at = $1 where id = $2", [
      later(-2 * 24 * 60),
      target,
    ]);
    expect((await book(f, target, ann, later(-10))).status).toBe("booked");
    // Ann drops out a minute ago: the place is new again, held for the fewest hours.
    await cancelBooking(
      withFirm,
      f.firmId,
      { shiftId: target, workerId: ann, reason: "Unwell", by: { type: "worker", id: ann } },
      { clock: at(later(-1)) },
    );
    expect(await book(f, target, cal)).toEqual({ status: "not_yet", opensAt: later(14) });
    // The office places whoever it chooses.
    const resourcer = await f.office("resourcer");
    expect(
      (
        await bookShift(
          withFirm,
          f.firmId,
          { shiftId: target, workerId: dee, by: { type: "office", id: resourcer } },
          { clock: at(NOW) },
        )
      ).status,
    ).toBe("booked");
  });
});

describe("fair rotation: what it never holds", () => {
  it("an urgent shift (offered out by the waves) is never held", async () => {
    const { f, target, dee } = await fairFirm();
    await su.query("update shifts set is_urgent = true where id = $1", [target]);
    expect((await book(f, target, dee)).status).toBe("booked");
  });

  it("a shift starting within the urgent window (default 24 hours) fills at once", async () => {
    const { f, dee } = await fairFirm();
    const soon = await f.shift({ startsAt: hoursFromNow(10), headcount: 2 });
    await su.query("update shifts set created_at = $1 where id = $2", [later(-1), soon]);
    expect((await book(f, soon, dee)).status).toBe("booked");
  });

  it("never holds a place past its shift's start, even with no urgent window", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "fair_rotation", wave_size: 1, urgent_window_hours: 0 },
    });
    const busy = await f.worker({ first: "Bea" });
    await f.worker({ first: "Nil" }); // 0 hours: the group of one
    // Two hours booked later this week (Friday), so Bea isn't in the group of one.
    await f.booking(busy, await f.shift({ startsAt: hoursFromNow(96), hours: 2 }));
    const soon = await f.shift({ startsAt: later(10), headcount: 2 }); // starts 09:10
    await su.query("update shifts set created_at = $1 where id = $2", [later(-1), soon]);
    // The window would end 09:14, after the start: not held.
    expect((await book(f, soon, busy)).status).toBe("booked");
  });

  it("gives the booking's own answer first: filled, not open, already booked", async () => {
    const { f, ann, cal, dee } = await fairFirm();
    const opened = async (o: Parameters<typeof f.shift>[0]) => {
      const id = await f.shift({ startsAt: hoursFromNow(52), ...o });
      await su.query("update shifts set created_at = $1 where id = $2", [later(-1), id]);
      return id;
    };
    const full = await opened({ headcount: 1, status: "filled" });
    await f.booking(ann, full);
    expect(await book(f, full, cal)).toEqual({ status: "filled" });
    const draft = await opened({ status: "draft" });
    expect(await book(f, draft, cal)).toEqual({ status: "not_open" });
    const mine = await opened({ headcount: 2 });
    await f.booking(dee, mine);
    expect(await book(f, mine, dee)).toEqual({ status: "already_assigned" });
  });
});

describe("the hours counted for fair rotation", () => {
  it("counts confirmed and completed hours that week only, among active workers with the role", async () => {
    const { weeklyHours } = await import("@/lib/roster/allocation-input");
    const { weekOf } = await import("@/lib/rules/eligibility");
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const target = await f.shift({ startsAt: hoursFromNow(48) }); // Wed 4 Nov: week Mon 2 - Mon 9
    const counted = await f.worker({ first: "Tia" });
    await f.booking(counted, await f.shift({ startsAt: hoursFromNow(72), hours: 8 }), "completed");
    await f.booking(counted, await f.shift({ startsAt: hoursFromNow(96), hours: 4 }));
    const lastWeek = await f.worker({ first: "Lou" });
    await f.booking(lastWeek, await f.shift({ startsAt: hoursFromNow(-24) })); // Sun 1 Nov
    const cancelledBooking = await f.worker({ first: "Cy" });
    await f.booking(
      cancelledBooking,
      await f.shift({ startsAt: hoursFromNow(72) }),
      "cancelled_worker",
    );
    const cancelledShift = await f.worker({ first: "Cass" });
    await f.booking(
      cancelledShift,
      await f.shift({ startsAt: hoursFromNow(72), status: "cancelled" }),
    );
    const noShow = await f.worker({ first: "Nia" });
    await f.booking(noShow, await f.shift({ startsAt: hoursFromNow(4) }), "no_show");
    const inactive = await f.worker({ first: "Ina", status: "inactive" });
    const otherRole = await f.worker({ first: "Ola", roles: ["steward"] });
    const onIt = await f.worker({ first: "Oni" });
    await f.booking(onIt, target);
    const theirs = await other.worker({ first: "Kit" });

    const hours = await withFirm(f.firmId, (tx) =>
      weeklyHours(tx, {
        shiftId: target,
        role: "door_supervisor",
        week: weekOf("2026-11-04", "Europe/London"),
        workerId: counted,
      }),
    );
    expect(hours.get(counted)).toBe(12);
    for (const zero of [lastWeek, cancelledBooking, cancelledShift, noShow]) {
      expect(hours.get(zero)).toBe(0);
    }
    for (const left of [inactive, otherRole, onIt, theirs]) expect(hours.has(left)).toBe(false);
  });
});

describe("first come, first served, and bad settings", () => {
  it("fair-rotation numbers that make no sense don't touch a first come, first served firm", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "first_come_first_served", wave_size: 100 },
    });
    const sam = await f.worker();
    expect((await book(f, await f.shift(), sam)).status).toBe("booked");
  });

  it("first come, first served holds nobody", async () => {
    const { f, target, dee } = await fairFirm("first_come_first_served");
    expect((await book(f, target, dee)).status).toBe("booked");
  });

  it("a mode that isn't one of the two stops the booking rather than guessing", async () => {
    const { f, target, dee } = await fairFirm("lottery");
    await expect(book(f, target, dee)).rejects.toThrow(/allocation settings are invalid/);
  });
});

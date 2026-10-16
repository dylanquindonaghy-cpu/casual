import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { LIMITS } from "@/lib/auth/throttle";
import { takeShift } from "@/lib/portal/take-shift";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Open shifts and "Take shift" on the real database, as the app role: only shifts the rules let
// this worker take are listed, and taking one books it through bookShift() with a confirmation.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const clock = { now: () => NOW };

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const ctxFor = (f: BookingFirm) => ({
  firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
  run: withFirm,
  clock,
});

async function siteFor(f: BookingFirm, shiftId: string, name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into sites (firm_id, name, postcode) values ($1, $2, 'LS1 1AA')
     on conflict (firm_id, name) do update set postcode = excluded.postcode
     returning id::text as id`,
    [f.firmId, name],
  );
  const id = rows[0]?.id ?? "";
  await su.query("update shifts set site_id = $1 where id = $2", [id, shiftId]);
  return id;
}

describe("openShiftsFor", () => {
  it("each shift carries what it needs (the role's, then its extras) and the event as the app names it (12H.2)", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker({ roles: ["steward"] });
    const named = await f.shift({ role: "steward", startsAt: hoursFromNow(24) });
    await su.query("update shifts set required_credentials = '{FIRST_AID}' where id = $1", [named]);
    const auto = await su.query<{ id: string }>(
      `insert into shift_events (firm_id, name, planner_ref) values ($1, 'Arena · Tue 3 Nov', $2)
       returning id::text as id`,
      [f.firmId, `auto:none:2026-11-03:${Math.random().toString(36).slice(2, 8)}`],
    );
    const automatic = await f.shift({
      role: "steward",
      startsAt: hoursFromNow(30),
      eventId: auto.rows[0]?.id,
    });
    // She holds first aid, so the session needing it is listed too.
    await su.query(
      `insert into credentials (firm_id, worker_id, type, status) values ($1, $2, 'FIRST_AID', 'valid')`,
      [f.firmId, sam],
    );
    const list = await openShiftsFor(ctxFor(f), sam);
    const byId = new Map(list.shifts.map((s) => [s.shiftId, s]));
    expect(byId.get(named)).toMatchObject({
      eventName: "Fixture event",
      casualEvent: "Fixture event",
      requirements: [
        { code: "STEWARD_L2", name: expect.any(String) },
        { code: "FIRST_AID", name: "first aid at work certificate" },
      ],
    });
    // The shifts line keeps the stored name; the app leaves out an automatic one.
    expect(byId.get(automatic)).toMatchObject({
      eventName: "Arena · Tue 3 Nov",
      casualEvent: null,
      requirements: [{ code: "STEWARD_L2", name: expect.any(String) }],
    });
  });

  it("lists only the open shifts this worker could take, soonest first", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker({ roles: ["steward", "door_supervisor"] });
    const jo = await f.worker({ first: "Jo" });

    const door = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(24) });
    const steward = await f.shift({ role: "steward", startsAt: hoursFromNow(48) });
    const pair = await f.shift({ startsAt: hoursFromNow(72), headcount: 2 });
    await f.booking(jo, pair); // one place left
    // Not listed, each for its own reason:
    const full = await f.shift({ startsAt: hoursFromNow(80), status: "filled" });
    await f.booking(jo, full);
    // Sam's own booking: far enough from the others to leave the 11 hours' rest.
    const mine = await f.shift({ startsAt: hoursFromNow(100) });
    await f.booking(sam, mine);
    const clash = await f.shift({ startsAt: hoursFromNow(102) }); // overlaps Sam's booking
    await f.shift({ role: "close_protection_officer", startsAt: hoursFromNow(30) }); // not Sam's role
    await f.shift({ status: "draft", startsAt: hoursFromNow(31) });
    await f.shift({ status: "cancelled", startsAt: hoursFromNow(32) });
    await f.shift({ startsAt: hoursFromNow(-1) }); // started
    await f.shift({ startsAt: hoursFromNow(29 * 24) }); // beyond 28 days
    await other.shift({ startsAt: hoursFromNow(25) }); // another firm's

    const list = await openShiftsFor(ctxFor(f), sam);
    expect(list.shifts.map((s) => s.shiftId)).toEqual([door, steward, pair]);
    expect(list.shifts.find((s) => s.shiftId === pair)?.placesLeft).toBe(1);
    expect(list.shifts.map((s) => s.shiftId)).not.toContain(clash);
  });

  it("says whether the worker wants open shift messages (their profile setting)", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    expect((await openShiftsFor(ctxFor(f), sam)).offerAlerts).toBe(true);
    await su.query("update workers set offer_alerts = false where id = $1", [sam]);
    expect((await openShiftsFor(ctxFor(f), sam)).offerAlerts).toBe(false);
    // A worker with no roles gets the same answer.
    const noRoles = await f.worker({ first: "Nora", roles: [] });
    await su.query("update workers set offer_alerts = false where id = $1", [noRoles]);
    expect(await openShiftsFor(ctxFor(f), noRoles)).toMatchObject({
      shifts: [],
      offerAlerts: false,
    });
  });

  it("leaves out a shift the rules refuse, e.g. for a licence out of date by then", async () => {
    const f = await bookingFirm(su, withFirm);
    const expiring = await f.worker({
      credentials: [
        { type: "SIA_DS", expiresOn: "2026-11-04" }, // NOW is 2 Nov
        { type: "STEWARD_L2", expiresOn: null },
      ],
    });
    const soon = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(24) });
    await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(24 * 5) }); // after expiry
    const stewarding = await f.shift({ role: "steward", startsAt: hoursFromNow(24 * 5) });
    const list = await openShiftsFor(ctxFor(f), expiring);
    expect(list.shifts.map((s) => s.shiftId)).toEqual([soon, stewarding]);
  });

  it("filters by day, site and role, offering choices from the whole list", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const tue = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(24 + 1) }); // Tue 3 Nov 10:00
    const wed = await f.shift({ role: "steward", startsAt: hoursFromNow(48 + 1) }); // Wed 4 Nov
    const arena = await siteFor(f, tue, "Demo Arena");
    await siteFor(f, wed, "Demo Racecourse");

    const all = await openShiftsFor(ctxFor(f), sam);
    expect(all.choices).toEqual({
      days: ["2026-11-03", "2026-11-04"],
      sites: [
        { id: arena, name: "Demo Arena" },
        { id: expect.any(String), name: "Demo Racecourse" },
      ],
      roles: ["door_supervisor", "steward"],
    });
    const ids = async (filters: Parameters<typeof openShiftsFor>[2]) =>
      (await openShiftsFor(ctxFor(f), sam, filters)).shifts.map((s) => s.shiftId);
    expect(await ids({ day: "2026-11-04" })).toEqual([wed]);
    expect(await ids({ siteId: arena })).toEqual([tue]);
    expect(await ids({ role: "steward" })).toEqual([wed]);
    expect(await ids({ role: "steward", siteId: arena })).toEqual([]);
    // The choices stay whole while a filter is on.
    expect((await openShiftsFor(ctxFor(f), sam, { role: "steward" })).choices.roles).toHaveLength(
      2,
    );
  });
});

describe("openShiftsFor: the urgent board (urgent: true)", () => {
  it("lists only urgent shifts this worker could take, soonest first", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker({ roles: ["door_supervisor"] });
    const jo = await f.worker({ first: "Jo" });
    const urgent = (id: string) =>
      su.query("update shifts set is_urgent = true where id = $1", [id]);

    const later = await f.shift({ startsAt: hoursFromNow(20) });
    const sooner = await f.shift({ startsAt: hoursFromNow(6) });
    await Promise.all([urgent(later), urgent(sooner)]);
    // Not listed, each for its own reason:
    await f.shift({ startsAt: hoursFromNow(8) }); // not urgent
    const full = await f.shift({ startsAt: hoursFromNow(9), status: "filled" });
    await f.booking(jo, full);
    const steward = await f.shift({ role: "steward", startsAt: hoursFromNow(10) }); // not Sam's role
    const started = await f.shift({ startsAt: hoursFromNow(-1) });
    const theirs = await other.shift({ startsAt: hoursFromNow(7) });
    for (const id of [full, steward, started]) await urgent(id);
    await su.query("update shifts set is_urgent = true where id = $1", [theirs]);

    const list = await openShiftsFor(ctxFor(f), sam, { urgent: true });
    expect(list.shifts.map((s) => s.shiftId)).toEqual([sooner, later]);
    expect(list.shifts.every((s) => s.isUrgent)).toBe(true);
    // The rules still decide: without a licence, nothing is listed.
    const noLicence = await f.worker({ first: "Nia", roles: ["door_supervisor"], credentials: [] });
    expect((await openShiftsFor(ctxFor(f), noLicence, { urgent: true })).shifts).toEqual([]);
    // And Open shifts marks them.
    const all = await openShiftsFor(ctxFor(f), sam);
    expect(all.shifts.filter((s) => s.isUrgent).map((s) => s.shiftId)).toEqual([sooner, later]);
    expect(all.shifts.length).toBeGreaterThan(2);
  });
});

describe("openShiftsFor: long lists", () => {
  it("checks the first 50, says there were more, and a filter reaches the later ones", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const ids: string[] = [];
    // 52 short shifts, 12 hours apart: all open to Sam (no bookings, so no rest or hours limits).
    for (let i = 0; i < 52; i++) {
      ids.push(await f.shift({ startsAt: hoursFromNow(2 + i * 12), hours: 1 }));
    }
    const first = await openShiftsFor(ctxFor(f), sam);
    expect(first.shifts).toHaveLength(50);
    expect(first.truncated).toBe(true);
    expect(first.choices.days).toContain("2026-11-27"); // the last shift's day is still offered
    // The 52nd shift starts 2 + 51*12 = 614 hours after NOW: Friday 27 Nov, 23:00.
    const lastDay = await openShiftsFor(ctxFor(f), sam, { day: "2026-11-27" });
    expect(lastDay.shifts.map((s) => s.shiftId)).toContain(ids[51]);
    expect(lastDay.truncated).toBe(false);
  });
});

describe("takeShift", () => {
  it("books it and returns a confirmation: what, when, a reference and the sign-off", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(24 + 5) }); // Tue 14:00
    await siteFor(f, shiftId, "Demo Arena");
    const outcome = await takeShift(ctxFor(f), sam, shiftId);
    expect(outcome).toEqual({
      status: "booked",
      ref: expect.stringMatching(/^[0-9A-F]{8}$/),
      when: "Tue 3 Nov, 14:00 to 22:00",
      role: "Door supervisor",
      siteName: "Demo Arena",
      signOff: "Booking Test Shift Team",
    });
    const { rows } = await su.query<{ id: string }>(
      "select id::text from assignments where shift_id = $1 and worker_id = $2 and status = 'confirmed'",
      [shiftId, sam],
    );
    expect(outcome.status === "booked" && rows[0]?.id.toUpperCase().startsWith(outcome.ref)).toBe(
      true,
    );
    // It's gone from Sam's open list, and shows in My shifts' data.
    expect((await openShiftsFor(ctxFor(f), sam)).shifts).toEqual([]);
  });

  it("still says booked, with the reference, if reading the details afterwards fails", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    // Call 1 counts the tap (13.5), call 2 is the booking itself; call 3 reads the confirmation's
    // details.
    let calls = 0;
    const flaky: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 3) return Promise.reject(new Error("connection lost"));
      return withFirm(firmId, fn);
    };
    const outcome = await takeShift({ ...ctxFor(f), run: flaky }, sam, shiftId);
    expect(outcome).toEqual({
      status: "booked",
      ref: expect.stringMatching(/^[0-9A-F]{8}$/),
      when: null,
      role: null,
      siteName: null,
      signOff: "Booking Test Shift Team",
    });
  });

  it("answers plainly when it's filled, refused, not open, or the sheet copy is stale", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const noLicence = await f.worker({ first: "Kit", credentials: [] });
    const shiftId = await f.shift({ role: "door_supervisor" });
    expect((await takeShift(ctxFor(f), sam, shiftId)).status).toBe("booked");
    expect(await takeShift(ctxFor(f), jo, shiftId)).toEqual({ status: "filled" });
    expect(await takeShift(ctxFor(f), sam, shiftId)).toEqual({ status: "already_assigned" });
    expect(await takeShift(ctxFor(f), noLicence, await f.shift())).toEqual({
      status: "not_eligible",
      reasons: [
        "This shift needs a valid SIA door supervisor licence. Send it to the office to be checked.",
      ],
    });
    expect(await takeShift(ctxFor(f), jo, await f.shift({ status: "draft" }))).toEqual({
      status: "gone",
    });
    expect(await takeShift(ctxFor(f), jo, "00000000-0000-4000-8000-000000000000")).toEqual({
      status: "gone",
    });

    const sheetFirm = await bookingFirm(su, withFirm);
    await sheetFirm.sheetSource(null);
    const ann = await sheetFirm.worker();
    expect(
      await takeShift(ctxFor(sheetFirm), ann, await sheetFirm.shift({ source: "sheets" })),
    ).toEqual({
      status: "try_again",
    });
  });

  it("20 taps per casual every 15 minutes, refused ones too; the 21st waits, logged once (13.5)", async () => {
    const f = await bookingFirm(su, withFirm);
    const kit = await f.worker({ first: "Kit", credentials: [] }); // every tap refused
    const sam = await f.worker();
    const shiftId = await f.shift();
    expect(LIMITS.takePerWorker).toMatchObject({ max: 20, windowMs: 15 * 60_000 });
    for (let i = 0; i < LIMITS.takePerWorker.max; i++) {
      expect((await takeShift(ctxFor(f), kit, shiftId)).status).toBe("not_eligible");
    }
    // NOW is 09:00, a window's start: 15 minutes to wait.
    expect(await takeShift(ctxFor(f), kit, shiftId)).toEqual({
      status: "rate_limited",
      retryAfterMinutes: 15,
    });
    expect(await takeShift(ctxFor(f), kit, shiftId)).toMatchObject({ status: "rate_limited" });
    const logged = async (action: string) =>
      (
        await su.query<{ entity_id: string; data: Record<string, unknown> }>(
          "select entity_id::text, data from events where firm_id = $1 and action = $2",
          [f.firmId, action],
        )
      ).rows;
    // The refused taps logged as before, the limit once; nothing more once it's reached.
    expect(await logged("shift.booking_refused")).toHaveLength(LIMITS.takePerWorker.max);
    expect(await logged("auth.rate_limited")).toEqual([
      { entity_id: kit, data: { limit: "take:worker" } },
    ]);
    // Another casual isn't held back, and the next window starts again.
    expect((await takeShift(ctxFor(f), sam, shiftId)).status).toBe("booked");
    const later = { ...ctxFor(f), clock: { now: () => new Date(NOW.getTime() + 15 * 60_000) } };
    expect((await takeShift(later, kit, shiftId)).status).not.toBe("rate_limited");
  });
});

describe("previewBooking", () => {
  it("gives the rules' answer but never a pass, and ignores ids that aren't ids", async () => {
    const { previewBooking } = await import("@/lib/roster/book");
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    const verdict = await withFirm(f.firmId, (tx) =>
      previewBooking(tx, { shiftId, workerId: sam, now: NOW }),
    );
    // The rules' answer and every check they ran (12D.2), all passed; never a pass.
    expect(verdict).toEqual({ ok: true, reasons: [], codes: [], checks: expect.any(Array) });
    expect(verdict?.checks.length).toBeGreaterThan(0);
    expect(verdict?.checks.every((c) => c.passed)).toBe(true);
    expect(verdict && "pass" in verdict).toBe(false);
    expect(
      await withFirm(f.firmId, (tx) =>
        previewBooking(tx, { shiftId: "not-an-id", workerId: sam, now: NOW }),
      ),
    ).toBeNull();
  });
});

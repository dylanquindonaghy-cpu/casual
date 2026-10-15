import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { myProfile, setNotificationSettings, setUnavailable } from "@/lib/portal/profile";
import { MAX_UNAVAILABLE_DAYS, UNAVAILABLE_AHEAD_DAYS } from "@/lib/portal/profile-kinds";
import { bookShift } from "@/lib/roster/book";
import { addDays } from "@/lib/time/zoned";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The profile page on the real database, as the app role: what the worker sees about themselves,
// the days they mark unavailable (and the rules refusing a booking on one), and how we reach them.
// NOW is Monday 2 November 2026, 09:00 London, so "today" is 2026-11-02.

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

const TODAY = "2026-11-02";
const ctxFor = (f: BookingFirm) => ({
  firm: { id: f.firmId, timezone: "Europe/London" },
  run: withFirm,
  clock: { now: () => NOW },
});
const mark = (f: BookingFirm, workerId: string, day: string, on = true) =>
  setUnavailable(ctxFor(f), workerId, day, on);
const workerEvents = async (firmId: string) =>
  (
    await su.query(
      `select actor_type, actor_id::text, action, entity_id::text, data from events
        where firm_id = $1 and action like 'worker.%' order by id`,
      [firmId],
    )
  ).rows;

describe("myProfile", () => {
  it("shows the worker's details, qualifications as they stand, marked days and settings", async () => {
    const f = await bookingFirm(su, withFirm);
    // Every security role, so every type the pack's rules need is listed (12F.1).
    const sam = await f.worker({
      roles: ["door_supervisor", "steward", "security_officer", "close_protection_officer"],
      credentials: [
        { type: "SIA_DS", expiresOn: "2029-01-01" },
        { type: "STEWARD_L2", expiresOn: null },
        { type: "SIA_CP", expiresOn: "2026-11-01" }, // "valid", but its date went yesterday
        { type: "SIA_SG", status: "applied" },
        { type: "FIRST_AID", status: "expired", expiresOn: "2026-06-01" }, // no role needs it
        { type: "OWN_CARD" }, // a type nothing needs
      ],
    });
    await su.query("update workers set email = 'sam.booker@example.com' where id = $1", [sam]);
    // Booked on Wednesday; days marked yesterday (not shown), Wednesday and Saturday.
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(48) }));
    await su.query(
      `insert into worker_unavailable_days (firm_id, worker_id, day)
       values ($1, $2, '2026-11-01'), ($1, $2, '2026-11-07'), ($1, $2, '2026-11-04')`,
      [f.firmId, sam],
    );

    const profile = await myProfile(ctxFor(f), sam);
    expect(profile).toMatchObject({
      firstName: "Sam",
      lastName: "Booker",
      email: "sam.booker@example.com",
      notifyChannel: "whatsapp",
      offerAlerts: true,
      textsOff: false,
      today: TODAY,
      unavailable: [
        { day: "2026-11-04", booked: true },
        { day: "2026-11-07", booked: false },
      ],
      rightToWork: { checked: false, checkedOn: null, expired: false },
      rolesWithoutRule: [],
    });
    expect(profile?.mobile).toMatch(/^\+447700900\d{3}$/);
    // Worst first; only the types her roles need.
    expect(profile?.qualifications).toEqual([
      {
        type: "SIA_CP",
        name: "SIA close protection licence",
        status: "expired",
        expiresOn: "2026-11-01",
        neededFor: ["close_protection_officer"],
        appliedCounts: false,
        renewing: false,
        uploadable: true,
        evidenceUploadId: null,
        waiting: null,
        rejected: null,
      },
      {
        type: "SIA_SG",
        name: "SIA security guard licence",
        status: "applied",
        expiresOn: null,
        neededFor: ["security_officer"],
        appliedCounts: false,
        renewing: false,
        uploadable: true,
        evidenceUploadId: null,
        waiting: null,
        rejected: null,
      },
      {
        type: "STEWARD_L2",
        name: "Level 2 spectator safety qualification",
        status: "valid",
        expiresOn: null,
        neededFor: ["steward"],
        appliedCounts: false,
        renewing: false,
        uploadable: true,
        evidenceUploadId: null,
        waiting: null,
        rejected: null,
      },
      {
        type: "SIA_DS",
        name: "SIA door supervisor licence",
        status: "valid",
        expiresOn: "2029-01-01",
        neededFor: ["door_supervisor"],
        appliedCounts: false,
        renewing: false,
        uploadable: true,
        evidenceUploadId: null,
        waiting: null,
        rejected: null,
      },
    ]);
  });

  it("an expired one the worker has replaced or is renewing counts as the newer one", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker({
      roles: ["door_supervisor", "steward", "security_officer"],
      credentials: [
        { type: "SIA_DS", status: "expired", expiresOn: "2026-06-01" },
        { type: "SIA_DS", expiresOn: "2029-06-01" }, // the renewed licence
        { type: "SIA_SG", expiresOn: "2026-10-01" }, // out of date...
        { type: "SIA_SG", status: "applied" }, // ...and being renewed
        { type: "STEWARD_L2", status: "expired", expiresOn: "2026-06-01" }, // nothing newer
      ],
    });
    const shown = (await myProfile(ctxFor(f), sam))?.qualifications.map((q) => [q.type, q.status]);
    expect(shown).toEqual([
      ["STEWARD_L2", "expired"],
      ["SIA_SG", "applied"],
      ["SIA_DS", "valid"],
    ]);
  });

  it("right to work: a status only, with the date the office checked it", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const kit = await f.worker({ first: "Kit" });
    await su.query(
      `insert into credentials (firm_id, worker_id, type, status, verified_at)
       values ($1, $2, 'RTW', 'valid', '2026-01-12T10:00:00Z')`,
      [f.firmId, sam],
    );
    const profile = await myProfile(ctxFor(f), sam);
    expect(profile?.rightToWork).toEqual({
      checked: true,
      checkedOn: "2026-01-12",
      expired: false,
    });
    expect(profile?.qualifications.map((q) => q.type)).not.toContain("RTW");
    expect((await myProfile(ctxFor(f), kit))?.rightToWork).toEqual({
      checked: false,
      checkedOn: null,
      expired: false,
    });
  });

  it("never shows a worker from another firm", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const kit = await theirs.worker({ first: "Kit" });
    expect(await myProfile(ctxFor(mine), kit)).toBeNull();
    expect((await myProfile(ctxFor(theirs), kit))?.firstName).toBe("Kit");
  });
});

describe("marking days unavailable", () => {
  it("marks and clears a day, logging each change with the date only", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    expect(await mark(f, sam, "2026-11-10")).toEqual({
      status: "added",
      day: "2026-11-10",
      bookedThatDay: false,
    });
    expect(await mark(f, sam, "2026-11-10")).toEqual({ status: "already" });
    expect(await mark(f, sam, "2026-11-10", false)).toEqual({
      status: "removed",
      day: "2026-11-10",
    });
    expect(await mark(f, sam, "2026-11-10", false)).toEqual({ status: "not_marked" });
    expect(await workerEvents(f.firmId)).toEqual([
      {
        actor_type: "worker",
        actor_id: sam,
        action: "worker.unavailable_added",
        entity_id: sam,
        data: { day: "2026-11-10" },
      },
      {
        actor_type: "worker",
        actor_id: sam,
        action: "worker.unavailable_removed",
        entity_id: sam,
        data: { day: "2026-11-10" },
      },
    ]);
  });

  it("takes today up to 180 days ahead, and only real dates", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    expect((await mark(f, sam, TODAY)).status).toBe("added");
    expect(await mark(f, sam, "2026-11-01")).toEqual({ status: "past" });
    const last = addDays(TODAY, UNAVAILABLE_AHEAD_DAYS);
    expect((await mark(f, sam, last)).status).toBe("added");
    expect(await mark(f, sam, addDays(last, 1))).toEqual({ status: "too_far" });
    for (const bad of ["2026-02-30", "2026-13-01", "next friday", "2026-11-2", ""]) {
      expect(await mark(f, sam, bad)).toEqual({ status: "invalid" });
    }
    const { rows } = await su.query(
      "select day::text from worker_unavailable_days where worker_id = $1 order by day",
      [sam],
    );
    expect(rows.map((r) => r.day)).toEqual([TODAY, last]);
  });

  it("allows at most 60 upcoming days; past ones don't count", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    // One from last week and 59 upcoming, straight into the table.
    await su.query(
      `insert into worker_unavailable_days (firm_id, worker_id, day)
       select $1::uuid, $2::uuid, d::date from generate_series('2026-10-26'::date, '2026-10-26'::date, '1 day') d
       union all
       select $1::uuid, $2::uuid, d::date from generate_series('2026-11-03'::date, '2026-12-31'::date, '1 day') d`,
      [f.firmId, sam],
    );
    expect(MAX_UNAVAILABLE_DAYS).toBe(60);
    expect((await mark(f, sam, "2027-01-05")).status).toBe("added"); // the 60th
    expect(await mark(f, sam, "2027-01-06")).toEqual({ status: "too_many" });
    // Clearing one makes room again.
    expect((await mark(f, sam, "2026-11-03", false)).status).toBe("removed");
    expect((await mark(f, sam, "2027-01-06")).status).toBe("added");
  });

  it("says when a booking falls on the day, and leaves the booking alone", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const assignment = await f.booking(sam, await f.shift({ startsAt: hoursFromNow(48) })); // Wed 4 Nov
    expect(await mark(f, sam, "2026-11-04")).toEqual({
      status: "added",
      day: "2026-11-04",
      bookedThatDay: true,
    });
    const { rows } = await su.query("select status from assignments where id = $1", [assignment]);
    expect(rows).toEqual([{ status: "confirmed" }]);
  });

  it("counts a booking on the days its shift touches, London time", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    // Thursday 5 Nov 16:00 to midnight: Thursday only. Saturday 7 Nov 22:00 to 06:00: both days.
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(3 * 24 + 7) }));
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(5 * 24 + 13) }));
    const booked = async (day: string) => {
      const result = await mark(f, sam, day);
      return result.status === "added" && result.bookedThatDay;
    };
    expect(await booked("2026-11-04")).toBe(false);
    expect(await booked("2026-11-05")).toBe(true);
    expect(await booked("2026-11-06")).toBe(false);
    expect(await booked("2026-11-07")).toBe(true);
    expect(await booked("2026-11-08")).toBe(true);
    expect(await booked("2026-11-09")).toBe(false);
    // The page shows the same, from one query.
    expect((await myProfile(ctxFor(f), sam))?.unavailable).toEqual([
      { day: "2026-11-04", booked: false },
      { day: "2026-11-05", booked: true },
      { day: "2026-11-06", booked: false },
      { day: "2026-11-07", booked: true },
      { day: "2026-11-08", booked: true },
      { day: "2026-11-09", booked: false },
    ]);
  });

  it("can't touch another firm's worker", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const kit = await theirs.worker({ first: "Kit" });
    expect(await mark(mine, kit, "2026-11-10")).toEqual({ status: "invalid" });
    const { rows } = await su.query(
      "select count(*)::int as n from worker_unavailable_days where worker_id = $1",
      [kit],
    );
    expect(rows).toEqual([{ n: 0 }]);
  });
});

describe("the rules use the marked days (check 8)", () => {
  it("refuses a booking touching a marked day; the office can override with a reason", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    // A night shift: Thursday 5 Nov 22:00 to Friday 6 Nov 06:00, two places.
    const night = await f.shift({ startsAt: hoursFromNow(3 * 24 + 13), headcount: 2 });
    const asWorker = (workerId: string) =>
      bookShift(
        withFirm,
        f.firmId,
        { shiftId: night, workerId, by: { type: "worker", id: workerId } },
        { clock: { now: () => NOW } },
      );

    // Sam marked Friday, the day the shift ends on: refused, with the reason in plain words.
    await mark(f, sam, "2026-11-06");
    const refused = await asWorker(sam);
    expect(refused).toMatchObject({ status: "not_eligible", codes: ["unavailable"] });
    expect(refused.status === "not_eligible" && refused.reasons).toHaveLength(1);

    // Jo marked the days either side (Wednesday and Saturday): the shift doesn't touch them.
    await mark(f, jo, "2026-11-04");
    await mark(f, jo, "2026-11-07");
    expect((await asWorker(jo)).status).toBe("booked");

    // Sam clears Friday but marks Thursday, the day it starts: still refused.
    await mark(f, sam, "2026-11-06", false);
    await mark(f, sam, "2026-11-05");
    expect(await asWorker(sam)).toMatchObject({ status: "not_eligible", codes: ["unavailable"] });

    // The office can place Sam anyway, with a reason (logged like any override).
    const resourcer = await f.office("resourcer");
    const byOffice = await bookShift(
      withFirm,
      f.firmId,
      {
        shiftId: night,
        workerId: sam,
        by: {
          type: "office",
          id: resourcer,
          overrides: ["unavailable"],
          reason: "Agreed with the worker by phone",
        },
      },
      { clock: { now: () => NOW } },
    );
    expect(byOffice).toMatchObject({ status: "booked", overridden: ["unavailable"] });
  });
});

describe("notification settings", () => {
  it("saves the channel and open-shift alerts, logging only real changes", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const save = (notifyChannel: string, offerAlerts: boolean) =>
      setNotificationSettings(ctxFor(f), sam, { notifyChannel, offerAlerts });

    expect(await save("sms", false)).toEqual({ status: "saved" });
    expect(await save("sms", false)).toEqual({ status: "saved" }); // no change: not logged again
    expect(await save("whatsapp", false)).toEqual({ status: "saved" });
    expect(await save("email", true)).toEqual({ status: "invalid" });
    const { rows } = await su.query(
      "select notify_channel, offer_alerts from workers where id = $1",
      [sam],
    );
    expect(rows).toEqual([{ notify_channel: "whatsapp", offer_alerts: false }]);
    expect((await workerEvents(f.firmId)).map((e) => [e.action, e.data])).toEqual([
      ["worker.notification_settings_changed", { notifyChannel: "sms", offerAlerts: false }],
      ["worker.notification_settings_changed", { notifyChannel: "whatsapp", offerAlerts: false }],
    ]);
  });

  it("can't change another firm's worker", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const kit = await theirs.worker({ first: "Kit" });
    expect(
      await setNotificationSettings(ctxFor(mine), kit, {
        notifyChannel: "sms",
        offerAlerts: false,
      }),
    ).toEqual({ status: "invalid" });
    const { rows } = await su.query(
      "select notify_channel, offer_alerts from workers where id = $1",
      [kit],
    );
    expect(rows).toEqual([{ notify_channel: "whatsapp", offer_alerts: true }]);
  });

  it("the database refuses a channel that isn't one of the two", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    await expect(
      su.query("update workers set notify_channel = 'pigeon' where id = $1", [sam]),
    ).rejects.toThrow(/workers_notify_channel_check/);
  });
});

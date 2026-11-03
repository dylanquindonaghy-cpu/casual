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
      notifyChannel: "sms", // the default (Phase 26.9; WhatsApp until then)
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
      // No security guard licence: a security officer needs one of it or a door supervisor
      // licence (P3.3), and her door supervisor licence is valid, so her application for the
      // other isn't one her roles need.
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
        neededFor: ["door_supervisor", "security_officer"],
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
    // The renewed door supervisor licence covers her security officer shifts too (P3.3), so the
    // security guard licence being renewed isn't listed.
    expect(shown).toEqual([
      ["STEWARD_L2", "expired"],
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

  // Phase 27.2 (C5): a certificate she holds that a shift of hers needs on top of its role, though
  // none of her roles does, is listed under "Other qualifications on file": only for a shift she's
  // booked on (still to finish) or offered (waiting for her answer), only one she has a record
  // of, never right to work or one her roles already list; read as every qualification is.
  it("lists what her booked or offered shifts need on top of her roles, that she holds", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker({
      roles: ["steward"],
      credentials: [
        { type: "STEWARD_L2", expiresOn: null }, // her role's: in the main list only
        { type: "FIRST_AID", expiresOn: "2026-11-20" }, // expiring soon
        { type: "CSAS", status: "expired", expiresOn: "2026-10-01" },
        { type: "SIA_DS", expiresOn: "2029-01-01" }, // only an answered offer's shift needs it
        { type: "MANUAL_HANDLING", expiresOn: "2029-01-01" }, // only a finished shift's
        { type: "RTW" },
      ],
    });
    const extras = async (shift: string, codes: string) =>
      su.query("update shifts set required_credentials = $2::text[] where id = $1", [shift, codes]);
    const offer = (shift: string, response: string | null) =>
      su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, response, responded_at)
         values ($1, $2, $3, 1, 'sms', $4, $5)`,
        [f.firmId, shift, sam, response, response ? hoursFromNow(-1) : null],
      );
    // Booked on Wednesday: first aid, right to work and her own role's qualification on top.
    const booked = await f.shift({ role: "steward", startsAt: hoursFromNow(48) });
    await extras(booked, "{FIRST_AID,RTW,STEWARD_L2}");
    await f.booking(sam, booked);
    // Offered Thursday's, still waiting for her answer: CSAS, and a PTS card she doesn't hold.
    const offered = await f.shift({ role: "steward", startsAt: hoursFromNow(72) });
    await extras(offered, "{CSAS,PTS}");
    await offer(offered, null);
    // Not listed: an offer she declined; a booking that has finished; a later shift needing first
    // aid again (named by the soonest).
    const declined = await f.shift({ role: "steward", startsAt: hoursFromNow(96) });
    await extras(declined, "{SIA_DS}");
    await offer(declined, "declined");
    const done = await f.shift({ role: "steward", startsAt: hoursFromNow(-30) });
    await extras(done, "{MANUAL_HANDLING}");
    await f.booking(sam, done);
    const later = await f.shift({ role: "steward", startsAt: hoursFromNow(120) });
    await extras(later, "{FIRST_AID}");
    await f.booking(sam, later);

    const profile = await myProfile(ctxFor(f), sam);
    expect(profile?.qualifications.map((q) => q.type)).toEqual(["STEWARD_L2"]);
    // Worst first, as her main list; each with the soonest shift that needs it.
    expect(profile?.others).toEqual([
      {
        type: "CSAS",
        name: "CSAS accreditation",
        status: "expired",
        expiresOn: "2026-10-01",
        neededFor: [],
        appliedCounts: false,
        renewing: false,
        uploadable: false,
        evidenceUploadId: null,
        waiting: null,
        rejected: null,
        shift: { role: "steward", day: "2026-11-05", booked: false },
      },
      {
        type: "FIRST_AID",
        name: "first aid at work certificate",
        status: "expiring_soon",
        expiresOn: "2026-11-20",
        neededFor: [],
        appliedCounts: false,
        renewing: false,
        uploadable: false,
        evidenceUploadId: null,
        waiting: null,
        rejected: null,
        shift: { role: "steward", day: "2026-11-04", booked: true },
      },
    ]);
    // Another worker of the firm, with none of those bookings or offers: nothing.
    const kit = await f.worker({ first: "Kit", roles: ["steward"] });
    expect((await myProfile(ctxFor(f), kit))?.others).toEqual([]);
    // Only her own records (the guardrails review of 27.2, M2): Kit booked on a shift needing first
    // aid, which only Sam holds, sees none of Sam's; Lee holds CSAS but has no booking or offer of
    // her own, while Sam is offered a CSAS shift, and sees nothing either.
    const kits = await f.shift({ role: "steward", startsAt: hoursFromNow(60) });
    await extras(kits, "{FIRST_AID}");
    await f.booking(kit, kits);
    expect((await myProfile(ctxFor(f), kit))?.others).toEqual([]);
    const lee = await f.worker({
      first: "Lee",
      roles: ["steward"],
      credentials: [{ type: "CSAS", expiresOn: "2029-01-01" }],
    });
    expect((await myProfile(ctxFor(f), lee))?.others).toEqual([]);
  });
});

describe("their own reliability (Phase 26.7, cas-6)", () => {
  it("the same figure and counts the office sees, over the last 90 days; New below 5", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker({ first: "Sam" });
    const ann = await f.worker({ first: "Ann" });
    // Sam: 5 worked and 1 not attended in the last weeks (5 of 6: 83%); one worked 100 days ago
    // doesn't count.
    for (let i = 1; i <= 6; i++) {
      await f.booking(
        sam,
        await f.shift({ role: "steward", startsAt: hoursFromNow(-i * 48) }),
        i === 3 ? "no_show" : "completed",
      );
    }
    await f.booking(
      sam,
      await f.shift({ role: "steward", startsAt: hoursFromNow(-100 * 24) }),
      "completed",
    );
    // Ann: one worked, so far.
    await f.booking(
      ann,
      await f.shift({ role: "steward", startsAt: hoursFromNow(-30) }),
      "completed",
    );

    expect((await myProfile(ctxFor(f), sam))?.reliability).toEqual({
      kind: "figure",
      percent: 83,
      band: "amber",
      counts: { worked: 5, noShows: 1, lateCancels: 0 },
    });
    expect((await myProfile(ctxFor(f), ann))?.reliability).toEqual({
      kind: "new",
      counted: 1,
      counts: { worked: 1, noShows: 0, lateCancels: 0 },
    });
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
    // Phase 26.9: no WhatsApp to choose; email only while the firm holds their address.
    expect(await save("whatsapp", false)).toEqual({ status: "invalid" });
    expect(await save("email", true)).toEqual({ status: "invalid" });
    await su.query("update workers set email = 'sam@example.test' where id = $1", [sam]);
    expect(await save("email", false)).toEqual({ status: "saved" });
    const { rows } = await su.query(
      "select notify_channel, offer_alerts from workers where id = $1",
      [sam],
    );
    expect(rows).toEqual([{ notify_channel: "email", offer_alerts: false }]);
    // The address gone since: keeping email (only alerts change) isn't refused; the page shows
    // and sends a text meanwhile (src/lib/notify/send.ts).
    await su.query("update workers set email = null where id = $1", [sam]);
    expect(await save("email", true)).toEqual({ status: "saved" });
    expect((await workerEvents(f.firmId)).map((e) => [e.action, e.data])).toEqual([
      ["worker.notification_settings_changed", { notifyChannel: "sms", offerAlerts: false }],
      ["worker.notification_settings_changed", { notifyChannel: "email", offerAlerts: false }],
      ["worker.notification_settings_changed", { notifyChannel: "email", offerAlerts: true }],
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
    expect(rows).toEqual([{ notify_channel: "sms", offer_alerts: true }]);
  });

  it("the database refuses a channel that isn't one of the two", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    await expect(
      su.query("update workers set notify_channel = 'pigeon' where id = $1", [sam]),
    ).rejects.toThrow(/workers_notify_channel_check/);
    // Not WhatsApp either, since migration 0070 (Phase 26.9): a text or an email.
    await expect(
      su.query("update workers set notify_channel = 'whatsapp' where id = $1", [sam]),
    ).rejects.toThrow(/workers_notify_channel_check/);
    await su.query("update workers set notify_channel = 'email' where id = $1", [sam]);
  });
});

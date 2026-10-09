import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadEligibilityInput } from "@/lib/roster/eligibility-input";
import { checkEligibility } from "@/lib/rules/eligibility";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The rules engine's input, built from the database for one worker and one shift, as the app role:
// what the rules are told must be exactly the firm's current rows.

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

const load = (firmId: string, shiftId: string, workerId: string) =>
  withFirm(firmId, (tx) => loadEligibilityInput(tx, { shiftId, workerId, now: NOW }));

describe("loadEligibilityInput", () => {
  it("reads the worker, their credentials, the role's rule, the firm's names and settings", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { credential_applied_allowance_pct: 15, sign_off: "Anything else is ignored" },
    });
    const sam = await f.worker({
      roles: ["door_supervisor"],
      credentials: [
        { type: "SIA_DS", expiresOn: "2027-03-01" },
        { type: "FIRST_AID", status: "expired", expiresOn: "2026-01-01" },
      ],
    });
    const shiftId = await f.shift({ role: "door_supervisor", startsAt: hoursFromNow(30) });
    const input = await load(f.firmId, shiftId, sam);
    expect(input).toMatchObject({
      now: NOW,
      timeZone: "Europe/London",
      worker: { id: sam, status: "active", roles: ["door_supervisor"] },
      shift: {
        id: shiftId,
        role: "door_supervisor",
        siteId: null,
        requiredTypes: ["SIA_DS"],
        extraTypes: [],
        startsAt: hoursFromNow(30),
        endsAt: hoursFromNow(38),
      },
      otherAssignments: [],
      unavailableDates: [],
      settings: {
        minRestHours: 11,
        weeklyHoursCap: 48,
        travelBufferMinutes: 0,
        appliedAllowancePct: 15,
        appliedInUseCount: 0,
        deployedCount: 0,
        blockedSites: [],
      },
    });
    expect(input?.credentials).toEqual(
      expect.arrayContaining([
        { type: "SIA_DS", status: "valid", expiresOn: "2027-03-01" },
        { type: "FIRST_AID", status: "expired", expiresOn: "2026-01-01" },
      ]),
    );
    expect(input?.settings.appliedAllowedTypes.sort()).toEqual(["SIA_CP", "SIA_DS", "SIA_SG"]);
    expect(input?.names).toMatchObject({ SIA_DS: "SIA door supervisor licence" });
    // And the rules can use it as it is.
    expect(input && checkEligibility(input).ok).toBe(true);
  });

  it("reads the worker's marked days from the day before the shift to the day after", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    // Thursday 5 Nov 22:00 to Friday 6 Nov 06:00: it touches the 5th and 6th.
    const shiftId = await f.shift({ startsAt: hoursFromNow(3 * 24 + 13) });
    const days = async (firmId: string, workerId: string, list: string[]) => {
      for (const day of list) {
        await su.query(
          "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, $3)",
          [firmId, workerId, day],
        );
      }
    };
    await days(f.firmId, sam, [
      "2026-11-03",
      "2026-11-04",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    await days(f.firmId, jo, ["2026-11-05"]);
    const kit = await other.worker({ first: "Kit" });
    await days(other.firmId, kit, ["2026-11-05"]);
    const input = await load(f.firmId, shiftId, sam);
    expect(input?.unavailableDates.sort()).toEqual(["2026-11-04", "2026-11-06", "2026-11-07"]);
    expect(input && checkEligibility(input).codes).toEqual(["unavailable"]);
  });

  it("gives null for a role with no credential rule, so the rules fail closed", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker({ roles: ["bouncer"] });
    const shiftId = await f.shift({ role: "bouncer" });
    const input = await load(f.firmId, shiftId, sam);
    expect(input?.shift.requiredTypes).toBeNull();
    expect(input && checkEligibility(input).codes).toContain("no_rule");
  });

  it("uses the firm's rules settings, and refuses settings that make no sense", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { min_rest_hours: 12, weekly_hours_cap: 40, travel_buffer_minutes: 30 },
    });
    const sam = await f.worker();
    const shiftId = await f.shift();
    expect((await load(f.firmId, shiftId, sam))?.settings).toMatchObject({
      minRestHours: 12,
      weeklyHoursCap: 40,
      travelBufferMinutes: 30,
      appliedAllowancePct: 0,
    });
    for (const bad of [
      { weekly_hours_cap: -1 },
      { min_rest_hours: "eleven" },
      { credential_applied_allowance_pct: 150 },
    ]) {
      await su.query("update firms set settings = $1 where id = $2", [
        JSON.stringify(bad),
        f.firmId,
      ]);
      await expect(load(f.firmId, shiftId, sam)).rejects.toThrow(/settings are invalid/);
    }
  });

  it("lists the worker's confirmed and completed bookings nearby, never this shift or others' rows", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const target = await f.shift({ startsAt: hoursFromNow(48) });
    const confirmed = await f.shift({ startsAt: hoursFromNow(24) });
    const completed = await f.shift({ startsAt: hoursFromNow(-100) }); // 4 days before
    const offered = await f.shift({ startsAt: hoursFromNow(72) });
    const cancelledBooking = await f.shift({ startsAt: hoursFromNow(96) });
    const cancelledShift = await f.shift({ startsAt: hoursFromNow(120), status: "cancelled" });
    const farAway = await f.shift({ startsAt: hoursFromNow(48 + 10 * 24) });
    const josShift = await f.shift({ startsAt: hoursFromNow(60) });
    await f.booking(sam, target); // already on it: must not count against itself
    await f.booking(sam, confirmed);
    await f.booking(sam, completed, "completed");
    await f.booking(sam, offered, "offered");
    await f.booking(sam, cancelledBooking, "cancelled_worker");
    await f.booking(sam, cancelledShift);
    await f.booking(sam, farAway);
    await f.booking(jo, josShift);

    const input = await load(f.firmId, target, sam);
    const others = (input?.otherAssignments ?? []) as { shiftId?: string }[];
    expect(others.map((o) => o.shiftId).sort()).toEqual([confirmed, completed].sort());
    expect(input?.otherAssignments).toContainEqual({
      shiftId: confirmed,
      startsAt: hoursFromNow(24),
      endsAt: hoursFromNow(32),
    });
  });

  it("counts who else is deployed that local day, and how many on an application in progress", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { credential_applied_allowance_pct: 15 },
    });
    const day = (h: number) => hoursFromNow(h); // NOW is 09:00 on Mon 2 Nov (GMT)
    const target = await f.shift({ startsAt: day(24 + 3) }); // Tue 12:00
    const me = await f.worker();
    const applied = await f.worker({
      credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
    });
    const appliedButValidToo = await f.worker({
      credentials: [
        { type: "SIA_DS", status: "applied", expiresOn: null },
        { type: "SIA_DS", status: "valid", expiresOn: "2028-01-01" },
      ],
    });
    const plain = await f.worker();
    const otherDay = await f.worker({
      credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
    });
    const steward = await f.worker({
      credentials: [
        { type: "SIA_DS", status: "applied", expiresOn: null },
        { type: "STEWARD_L2", expiresOn: null },
      ],
    });
    // Tuesday: early morning (00:30), midday and late (23:30) all count; Wednesday 00:30 doesn't.
    await f.booking(applied, await f.shift({ startsAt: day(15.5), hours: 4 }));
    await f.booking(appliedButValidToo, await f.shift({ startsAt: day(27) }));
    await f.booking(plain, await f.shift({ startsAt: day(38.5), hours: 4 }));
    await f.booking(otherDay, await f.shift({ startsAt: day(39.5), hours: 4 }));
    // Applied SIA, but working as a steward: the steward role doesn't need the licence.
    await f.booking(steward, await f.shift({ role: "steward", startsAt: day(28) }));
    await f.booking(me, await f.shift({ startsAt: day(30) })); // never counts itself

    const input = await load(f.firmId, target, me);
    expect(input?.settings).toMatchObject({ deployedCount: 4, appliedInUseCount: 1 });
  });

  it("finds nothing for a missing worker or shift, or another firm's", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const sam = await mine.worker();
    const myShift = await mine.shift();
    const theirShift = await theirs.shift();
    const theirWorker = await theirs.worker();
    expect(await load(mine.firmId, theirShift, sam)).toBeNull();
    expect(await load(mine.firmId, myShift, theirWorker)).toBeNull();
    expect(await load(mine.firmId, "00000000-0000-4000-8000-000000000000", sam)).toBeNull();
  });
});

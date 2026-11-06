import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { helpFacts } from "@/lib/portal/help-facts";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The numbers /help states (12H.3): each firm's own strike notice, how long a strike counts and how
// often a staff photo is renewed, read inside that firm's transaction as the app role; and how its
// login links go (P2.7); and (28.12) whether it has phone notifications, and its rules for taking
// shifts, each from the rules' own parsers (a setting that doesn't parse leaves its fact out).

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

// The defaults' rules: first come, first served (its waves 15 minutes apart), 11 hours' rest, 48
// hours a week, a 24-hour urgent window, quiet 22:00 to 07:00 with urgent ones let through.
const DEFAULT_RULES = {
  allocation: { mode: "first_come_first_served", waveMinutes: 15 },
  rest: { minRestHours: 11, weeklyHoursCap: 48 },
  urgentWindowHours: 24,
  quiet: { start: "22:00", end: "07:00", urgentOverride: true },
};

describe("helpFacts", () => {
  it("uses the defaults when the firm hasn't set them, and each firm's own otherwise", async () => {
    const plain = await bookingFirm(su, withFirm);
    const own = await bookingFirm(su, withFirm, {
      settings: {
        strikes: { notice_hours: 24, live_days: 30, enabled: false },
        photo: { renewal_months: 24 },
        travel: { enabled: true },
        allocation_mode: "fair_rotation",
        wave_minutes: 20,
        urgent_window_hours: 12,
        min_rest_hours: 10,
        weekly_hours_cap: 40,
        quiet_hours: { start: "23:00", end: "06:00", urgent_override: false },
      },
    });
    // Travel areas off unless the firm switched them on (13.4).
    expect(await helpFacts(plain.firmId, withFirm, true, true)).toEqual({
      noticeHours: 48,
      liveDays: 90,
      photoRenewalMonths: 36,
      travelOn: false,
      strikesOn: true, // on unless the firm switches strikes off (P3.4)
      loginWay: "message", // the tests' console sender is a text sender
      pushOn: true,
      rules: DEFAULT_RULES,
    });
    expect(await helpFacts(own.firmId, withFirm, true, false)).toEqual({
      noticeHours: 24,
      liveDays: 30,
      photoRenewalMonths: 24,
      travelOn: true,
      strikesOn: false, // switched off: Help leaves its strikes section out (Phase 25.2)
      loginWay: "message",
      pushOn: false,
      rules: {
        allocation: { mode: "fair_rotation", priorityMinutes: 20, urgentWindowHours: 12 },
        rest: { minRestHours: 10, weeklyHoursCap: 40 },
        urgentWindowHours: 12,
        quiet: { start: "23:00", end: "06:00", urgentOverride: false },
      },
    });
  });

  it("settings the rules' parsers refuse: those facts are left out, and nothing throws (28.12)", async () => {
    const broken = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "lottery", weekly_hours_cap: -1 },
    });
    const facts = await helpFacts(broken.firmId, withFirm, true, true);
    expect(facts.rules.allocation).toBeNull();
    expect(facts.rules.rest).toBeNull();
    expect(facts.rules.urgentWindowHours).toBe(24);
  });

  it("with no text sender, how login links go: by email only where the firm switched it on (P2.7)", async () => {
    const off = await bookingFirm(su, withFirm);
    const on = await bookingFirm(su, withFirm, { settings: { login_by_email: true } });
    expect((await helpFacts(off.firmId, withFirm, false)).loginWay).toBe("off");
    expect((await helpFacts(on.firmId, withFirm, false)).loginWay).toBe("email");
    expect((await helpFacts(on.firmId, withFirm, true)).loginWay).toBe("message");
  });
});

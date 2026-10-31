import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { helpFacts } from "@/lib/portal/help-facts";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The numbers /help states (12H.3): each firm's own strike notice, how long a strike counts and how
// often a staff photo is renewed, read inside that firm's transaction as the app role; and how its
// login links go (P2.7).

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

describe("helpFacts", () => {
  it("uses the defaults when the firm hasn't set them, and each firm's own otherwise", async () => {
    const plain = await bookingFirm(su, withFirm);
    const own = await bookingFirm(su, withFirm, {
      settings: {
        strikes: { notice_hours: 24, live_days: 30, enabled: false },
        photo: { renewal_months: 24 },
        travel: { enabled: true },
      },
    });
    // Travel areas off unless the firm switched them on (13.4).
    expect(await helpFacts(plain.firmId, withFirm)).toEqual({
      noticeHours: 48,
      liveDays: 90,
      photoRenewalMonths: 36,
      travelOn: false,
      strikesOn: true, // on unless the firm switches strikes off (P3.4)
      loginWay: "message", // the tests' console sender is a text sender
    });
    expect(await helpFacts(own.firmId, withFirm)).toEqual({
      noticeHours: 24,
      liveDays: 30,
      photoRenewalMonths: 24,
      travelOn: true,
      strikesOn: false, // switched off: Help leaves its strikes section out (Phase 25.2)
      loginWay: "message",
    });
  });

  it("with no text sender, how login links go: by email only where the firm switched it on (P2.7)", async () => {
    const off = await bookingFirm(su, withFirm);
    const on = await bookingFirm(su, withFirm, { settings: { login_by_email: true } });
    expect((await helpFacts(off.firmId, withFirm, false)).loginWay).toBe("off");
    expect((await helpFacts(on.firmId, withFirm, false)).loginWay).toBe("email");
    expect((await helpFacts(on.firmId, withFirm, true)).loginWay).toBe("message");
  });
});

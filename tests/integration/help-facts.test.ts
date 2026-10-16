import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { helpFacts } from "@/lib/portal/help-facts";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The numbers /help states (12H.3): each firm's own strike notice, how long a strike counts and how
// often a staff photo is renewed, read inside that firm's transaction as the app role.

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
        strikes: { notice_hours: 24, live_days: 30 },
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
    });
    expect(await helpFacts(own.firmId, withFirm)).toEqual({
      noticeHours: 24,
      liveDays: 30,
      photoRenewalMonths: 24,
      travelOn: true,
    });
  });
});

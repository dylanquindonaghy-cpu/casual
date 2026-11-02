import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadCasualRecords } from "@/lib/office/reliability";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Each casual's record for reliability (Phase 26.7; decision 3) on the real database, as the app
// role: sessions marked worked and not attended in the last 90 days (by start), their own
// cancellations under 48 hours' notice (by when), weeks worked of the last 8, the last worked; an
// unmarked session counts for nothing; another firm's casuals never read. NOW is Monday 2 November
// 2026, 09:00 London.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const DAY = 24;

describe("a casual's record", () => {
  it("counts what was marked and their late cancellations; New under 5; another firm's never", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker({ first: "Sam" });
    const ned = await f.worker({ first: "Ned" });
    const theirs = await other.worker({ first: "Tia" });
    // Sam: worked one a week for 7 weeks, didn't attend one, and one marked so long ago it's out.
    for (let week = 0; week < 7; week++) {
      const s = await f.shift({ startsAt: hoursFromNow(-(week * 7 + 1) * DAY) });
      await f.booking(sam, s, "completed");
    }
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(-3 * DAY) }), "no_show");
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(-120 * DAY) }), "completed");
    // One booked yesterday, never marked: counts for nothing.
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(-30) }), "confirmed");
    // Ned: worked twice, cancelled one with 20 hours' notice (the fixture's) 50 hours ago.
    for (const d of [10, 20]) {
      await f.booking(ned, await f.shift({ startsAt: hoursFromNow(-d * DAY) }), "completed");
    }
    await f.booking(ned, await f.shift({ startsAt: hoursFromNow(48) }), "cancelled_worker");

    const records = await withFirm(f.firmId, (tx) => loadCasualRecords(tx, NOW, null));
    const s = records.get(sam);
    expect(s?.reliability).toMatchObject({
      kind: "figure",
      percent: 87,
      counts: { worked: 7, noShows: 1, lateCancels: 0 },
    });
    expect(s?.weeksWorked).toBeGreaterThanOrEqual(7);
    expect(s?.standing).toMatchObject({ regular: true, reliable: false, notWorkedLately: false });
    expect(s?.lastWorked).toEqual(hoursFromNow(-DAY));
    expect(records.get(ned)?.reliability).toMatchObject({
      kind: "new",
      counted: 3,
      counts: { worked: 2, noShows: 0, lateCancels: 1 },
    });
    expect(records.has(theirs)).toBe(false);
    // Just some: only those asked for.
    const one = await withFirm(f.firmId, (tx) => loadCasualRecords(tx, NOW, [ned]));
    expect([...one.keys()]).toEqual([ned]);
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { myPayDay } from "@/lib/portal/pay-day";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Home's pay day (P3; Phase 25.2): on the firm's pay calendar, or payroll's own date when it has
// imported one for her for exactly this period. On the real database as the app role, inside the firm's
// transaction: another firm's pay records, or another casual's, are never read.

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

// Friday 30 October 2026, midday in London.
const clock = { now: () => new Date("2026-10-30T12:00:00Z") };
const fortnight = { days: 14, anchor: "2026-01-05", pay_day_after: 5 };

async function payRecord(
  firmId: string,
  workerId: string,
  o: { start: string; end: string; payDate: string | null },
) {
  await su.query(
    `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence, pay_date)
     values ($1, $2, $3, $4, 8, 1250, $5)`,
    [firmId, workerId, o.start, o.end, o.payDate],
  );
}

describe("myPayDay", () => {
  it("with no pay calendar, the week she's in, paid the Friday after it (as before)", async () => {
    const f = await bookingFirm(su, withFirm);
    const worker = await f.worker();
    expect(await myPayDay({ firm: { id: f.firmId }, clock, run: withFirm }, worker)).toEqual({
      payDay: "2026-11-06",
      days: 7,
      start: "2026-10-26",
      end: "2026-11-01",
    });
  });

  it("on a fortnight's cycle, that cycle's dates and its own pay day", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { pay_calendar: fortnight } });
    const worker = await f.worker();
    expect(await myPayDay({ firm: { id: f.firmId }, clock, run: withFirm }, worker)).toEqual({
      payDay: "2026-11-13",
      days: 14,
      start: "2026-10-26",
      end: "2026-11-08",
    });
  });

  it("payroll's own date for exactly this period wins; one for other dates, or none, doesn't", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { pay_calendar: fortnight } });
    const worker = await f.worker();
    // Last period's record, and a week inside this fortnight (its day would be shown against
    // shifts it doesn't cover): neither moves the day.
    await payRecord(f.firmId, worker, {
      start: "2026-10-12",
      end: "2026-10-25",
      payDate: "2026-10-30",
    });
    await payRecord(f.firmId, worker, {
      start: "2026-10-26",
      end: "2026-11-01",
      payDate: "2026-11-05",
    });
    const ctx = { firm: { id: f.firmId }, clock, run: withFirm };
    expect((await myPayDay(ctx, worker)).payDay).toBe("2026-11-13");
    // This fortnight's own record, with no date yet: still the calendar's.
    await payRecord(f.firmId, worker, { start: "2026-10-26", end: "2026-11-08", payDate: null });
    expect((await myPayDay(ctx, worker)).payDay).toBe("2026-11-13");
    // Payroll pays this fortnight a day early: Home says what payroll says.
    await su.query(
      `update pay_records set pay_date = '2026-11-12'
       where worker_id = $1 and period_start = '2026-10-26' and period_end = '2026-11-08'`,
      [worker],
    );
    expect(await myPayDay(ctx, worker)).toEqual({
      payDay: "2026-11-12",
      days: 14,
      start: "2026-10-26",
      end: "2026-11-08",
    });
  });

  it("never reads another casual's pay records, or another firm's (tenant isolation)", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const me = await mine.worker();
    const colleague = await mine.worker({ first: "Alex" });
    const stranger = await theirs.worker();
    await payRecord(mine.firmId, colleague, {
      start: "2026-10-26",
      end: "2026-11-01",
      payDate: "2026-11-03",
    });
    await payRecord(theirs.firmId, stranger, {
      start: "2026-10-26",
      end: "2026-11-01",
      payDate: "2026-11-04",
    });
    expect((await myPayDay({ firm: { id: mine.firmId }, clock, run: withFirm }, me)).payDay).toBe(
      "2026-11-06",
    );
    // Asked inside my firm for their casual: their record isn't seen.
    expect(
      (await myPayDay({ firm: { id: mine.firmId }, clock, run: withFirm }, stranger)).payDay,
    ).toBe("2026-11-06");
    expect(
      (await myPayDay({ firm: { id: theirs.firmId }, clock, run: withFirm }, stranger)).payDay,
    ).toBe("2026-11-04");
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { myPayDay } from "@/lib/portal/pay-day";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The casual's next pay day (P3; Phase 25.2; Phase 37.1): the office's rule (src/lib/pay/next-pay.ts),
// the first pay day not yet past, last period's while it's still to come, on the firm's pay
// calendar, or payroll's own date where her own whole-period records give one. On the real
// database as the app role, inside the firm's transaction: another firm's pay records, or another
// casual's, are never read.
//
// Phase 37.1 changed the rule (it used to be this period's day, whatever was still to come), so
// the expected days below changed with it; each case keeps its intent.

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

// Midday in London on a given day (winter time: UTC).
const at = (day: string) => ({ now: () => new Date(`${day}T12:00:00Z`) });
const FRI_30_OCT = at("2026-10-30");
const WED_11_NOV = at("2026-11-11");
const SAT_14_NOV = at("2026-11-14");
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
  it("with no pay calendar: last week's Friday while it's still to come, then this week's", async () => {
    const f = await bookingFirm(su, withFirm);
    const worker = await f.worker();
    const ask = (clock: { now: () => Date }) =>
      myPayDay({ firm: { id: f.firmId }, clock, run: withFirm }, worker);
    // Friday 30 Oct: last week's pay day is today.
    expect(await ask(FRI_30_OCT)).toEqual({
      payDay: "2026-10-30",
      days: 7,
      start: "2026-10-19",
      end: "2026-10-25",
      thisPeriodPaid: "2026-11-06",
    });
    // Wednesday 11 Nov: Fri 13 Nov pays Mon 2 to Sun 8 Nov; this week's are paid Fri 20 Nov.
    expect(await ask(WED_11_NOV)).toEqual({
      payDay: "2026-11-13",
      days: 7,
      start: "2026-11-02",
      end: "2026-11-08",
      thisPeriodPaid: "2026-11-20",
    });
    // Saturday 14 Nov: last week's is past, so this week's, with no second day.
    expect(await ask(SAT_14_NOV)).toEqual({
      payDay: "2026-11-20",
      days: 7,
      start: "2026-11-09",
      end: "2026-11-15",
      thisPeriodPaid: null,
    });
  });

  it("on a fortnight's cycle, the last cycle's pay day while it's still to come", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { pay_calendar: fortnight } });
    const worker = await f.worker();
    expect(
      await myPayDay({ firm: { id: f.firmId }, clock: FRI_30_OCT, run: withFirm }, worker),
    ).toEqual({
      payDay: "2026-10-30",
      days: 14,
      start: "2026-10-12",
      end: "2026-10-25",
      thisPeriodPaid: "2026-11-13",
    });
  });

  it("her own whole-period record's date wins; one for other dates, or none, doesn't", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { pay_calendar: fortnight } });
    const worker = await f.worker();
    // Last cycle's record, paid Fri 30 Oct, and a week inside this fortnight (its day would be
    // shown against shifts it doesn't cover).
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
    // Saturday 31 Oct: last cycle's is paid; the week inside the fortnight doesn't move the day.
    const ctx = { firm: { id: f.firmId }, clock: at("2026-10-31"), run: withFirm };
    expect((await myPayDay(ctx, worker)).payDay).toBe("2026-11-13");
    // This fortnight's own record, with no date yet: still the calendar's.
    await payRecord(f.firmId, worker, { start: "2026-10-26", end: "2026-11-08", payDate: null });
    expect((await myPayDay(ctx, worker)).payDay).toBe("2026-11-13");
    // Payroll pays this fortnight a day early: she sees what payroll says.
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
      thisPeriodPaid: null,
    });
  });

  it("a week: her record dates last week; once it's paid, this week's day counts", async () => {
    const f = await bookingFirm(su, withFirm);
    const worker = await f.worker();
    const ctx = { firm: { id: f.firmId }, clock: WED_11_NOV, run: withFirm };
    await payRecord(f.firmId, worker, {
      start: "2026-11-02",
      end: "2026-11-08",
      payDate: "2026-11-12",
    });
    expect(await myPayDay(ctx, worker)).toEqual({
      payDay: "2026-11-12",
      days: 7,
      start: "2026-11-02",
      end: "2026-11-08",
      thisPeriodPaid: "2026-11-20",
    });
    // Paid early, on Tuesday 10 Nov: last week is done, so this week's Fri 20 Nov.
    await su.query(
      `update pay_records set pay_date = '2026-11-10' where worker_id = $1 and period_start = '2026-11-02'`,
      [worker],
    );
    expect(await myPayDay(ctx, worker)).toEqual({
      payDay: "2026-11-20",
      days: 7,
      start: "2026-11-09",
      end: "2026-11-15",
      thisPeriodPaid: null,
    });
  });

  it("never reads another casual's pay records, or another firm's (tenant isolation)", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const me = await mine.worker();
    const colleague = await mine.worker({ first: "Alex" });
    const stranger = await theirs.worker();
    await payRecord(mine.firmId, colleague, {
      start: "2026-11-02",
      end: "2026-11-08",
      payDate: "2026-11-12",
    });
    await payRecord(theirs.firmId, stranger, {
      start: "2026-11-02",
      end: "2026-11-08",
      payDate: "2026-11-11",
    });
    const clock = WED_11_NOV;
    expect((await myPayDay({ firm: { id: mine.firmId }, clock, run: withFirm }, me)).payDay).toBe(
      "2026-11-13",
    );
    // Asked inside my firm for their casual: their record isn't seen.
    expect(
      (await myPayDay({ firm: { id: mine.firmId }, clock, run: withFirm }, stranger)).payDay,
    ).toBe("2026-11-13");
    expect(
      (await myPayDay({ firm: { id: theirs.firmId }, clock, run: withFirm }, stranger)).payDay,
    ).toBe("2026-11-11");
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadPayDashboard } from "@/lib/office/pay-dashboard";
import { myPayDay } from "@/lib/portal/pay-day";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// One pay day everywhere (Phase 37.1): the office's pay dashboard and the casual's own pay day
// (Home, Pay and the shifts line's "Pay day" answer all read myPayDay) give the same day and the
// same shifts, start and end, when they read the same pay records: a firm whose only records are
// this casual's whole-period ones, or none. On the real database as the app role.

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

const at = (day: string) => new Date(`${day}T12:00:00Z`);

async function agree(firmId: string, workerId: string, now: Date) {
  const office = await withFirm(firmId, (tx) => loadPayDashboard(tx, now));
  const casual = await myPayDay(
    { firm: { id: firmId }, clock: { now: () => now }, run: withFirm },
    workerId,
  );
  expect({
    day: casual.payDay,
    start: casual.start,
    end: casual.end,
    thisPeriodPaid: casual.thisPeriodPaid,
  }).toEqual({
    day: office.nextPay.day,
    start: office.nextPay.periodStart,
    end: office.nextPay.periodEnd,
    thisPeriodPaid: office.nextPay.thisPeriodPaid,
  });
  return casual;
}

describe("the office and the casual give the same next pay day", () => {
  it("a weekly firm with no pay records: Wed 11 Nov and Sat 14 Nov", async () => {
    const f = await bookingFirm(su, withFirm);
    const worker = await f.worker();
    expect((await agree(f.firmId, worker, at("2026-11-11"))).payDay).toBe("2026-11-13");
    expect((await agree(f.firmId, worker, at("2026-11-14"))).payDay).toBe("2026-11-20");
  });

  it("a weekly firm whose only records are hers, whole weeks dated by payroll", async () => {
    const f = await bookingFirm(su, withFirm);
    const worker = await f.worker();
    await su.query(
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence, pay_date)
       values ($1, $2, '2026-11-02', '2026-11-08', 8, 1250, '2026-11-12'),
              ($1, $2, '2026-11-09', '2026-11-15', 8, 1250, '2026-11-19')`,
      [f.firmId, worker],
    );
    expect((await agree(f.firmId, worker, at("2026-11-11"))).payDay).toBe("2026-11-12");
    expect((await agree(f.firmId, worker, at("2026-11-14"))).payDay).toBe("2026-11-19");
  });

  it("a record for part of a week moves neither side: both read whole periods only", async () => {
    const f = await bookingFirm(su, withFirm);
    const worker = await f.worker();
    const colleague = await f.worker();
    // Mon 2 to Wed 4 Nov, paid Thu 12 Nov: not a whole week, for her and for a colleague.
    await su.query(
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence, pay_date)
       values ($1, $2, '2026-11-02', '2026-11-04', 8, 1250, '2026-11-12'),
              ($1, $3, '2026-11-02', '2026-11-04', 8, 1250, '2026-11-12')`,
      [f.firmId, worker, colleague],
    );
    expect((await agree(f.firmId, worker, at("2026-11-11"))).payDay).toBe("2026-11-13");
  });

  // The documented exception (docs/screens.md `/office/pay`, Phase 37.1): the office's tile is the
  // firm's, from every casual's records; hers reads only her own (a colleague's never moves her
  // day). When payroll dates one period to two different days, the office shows the colleague's.
  it("a colleague's whole-week record dated differently: the office shows it, her day doesn't move", async () => {
    const f = await bookingFirm(su, withFirm);
    const worker = await f.worker();
    const colleague = await f.worker();
    await su.query(
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence, pay_date)
       values ($1, $2, '2026-11-02', '2026-11-08', 8, 1250, '2026-11-12')`,
      [f.firmId, colleague],
    );
    const now = at("2026-11-11");
    const office = await withFirm(f.firmId, (tx) => loadPayDashboard(tx, now));
    const casual = await myPayDay(
      { firm: { id: f.firmId }, clock: { now: () => now }, run: withFirm },
      worker,
    );
    expect(office.nextPay).toMatchObject({ day: "2026-11-12", from: "pay records" });
    expect(casual.payDay).toBe("2026-11-13");
    // Same shifts on both: last week's.
    expect([casual.start, casual.end]).toEqual([
      office.nextPay.periodStart,
      office.nextPay.periodEnd,
    ]);
    // The colleague herself agrees with the office.
    expect((await agree(f.firmId, colleague, now)).payDay).toBe("2026-11-12");
  });

  it("a fortnight firm, in each week of the cycle", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { pay_calendar: { days: 14, anchor: "2026-01-05", pay_day_after: 5 } },
    });
    const worker = await f.worker();
    expect((await agree(f.firmId, worker, at("2026-10-27"))).payDay).toBe("2026-10-30");
    expect((await agree(f.firmId, worker, at("2026-11-11"))).payDay).toBe("2026-11-13");
    expect((await agree(f.firmId, worker, at("2026-11-14"))).payDay).toBe("2026-11-27");
  });
});

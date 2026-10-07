import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  loadPayDashboard,
  officePayDashboard,
  officePayQueriesWaiting,
} from "@/lib/office/pay-dashboard";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Payroll's dashboard (src/lib/office/pay-dashboard.ts; docs/office-v2.md 3.8), on the real
// database as the app role. NOW is Monday 2 November 2026, 09:00 UTC (09:00 in London, winter
// time): this pay week began at midnight; the digest's 09:00 is due now, so the next is Tuesday's.

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

const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

async function payFirm() {
  const f = await bookingFirm(su, withFirm);
  const ann = await f.worker({ first: "Ann" });
  const payroll = await f.office("payroll");
  const query = (o: {
    day: string;
    issue?: string;
    status: "open" | "in_digest" | "resolved";
    created: string;
    resolved?: { by: string; at: string; note: string };
  }) =>
    su.query(
      `insert into pay_queries (firm_id, worker_id, work_date, issue_type, status, created_at,
                                resolved_by, resolved_at, resolution_note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        f.firmId,
        ann,
        o.day,
        o.issue ?? "wrong_rate",
        o.status,
        o.created,
        o.resolved?.by ?? null,
        o.resolved?.at ?? null,
        o.resolved?.note ?? null,
      ],
    );
  const payLine = (payDate: string, start: string) =>
    su.query(
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence,
                                gross_pence, pay_date)
       values ($1, $2, $3, $3, 8, 1250, 10000, $4)`,
      [f.firmId, ann, start, payDate],
    );
  return { f, ann, payroll, query, payLine };
}

describe("the pay dashboard's data", () => {
  it("counts, the next digest and pay date, the groups, and what was sorted lately", async () => {
    const t = await payFirm();
    await t.query({ day: "2026-10-26", status: "open", created: ago(120) }); // the oldest
    await t.query({ day: "2026-10-27", status: "in_digest", created: ago(48), issue: "late_pay" });
    const today = { by: t.payroll, at: ago(1), note: "Paid on Friday with the rest." };
    await t.query({ day: "2026-10-26", status: "resolved", created: ago(200), resolved: today });
    await t.query({ day: "2026-10-27", status: "resolved", created: ago(190), resolved: today });
    // Last week (Saturday): recently sorted, but not this week.
    const saturday = { by: t.payroll, at: ago(40), note: "Corrected." };
    await t.query({ day: "2026-10-20", status: "resolved", created: ago(300), resolved: saturday });
    // Ten days ago: neither.
    const old = { by: t.payroll, at: ago(240), note: "Old." };
    await t.query({ day: "2026-10-12", status: "resolved", created: ago(400), resolved: old });
    // A pay date already gone, and the next one.
    await t.payLine("2026-10-30", "2026-10-19");
    await t.payLine("2026-11-06", "2026-10-26");

    const d = await withFirm(t.f.firmId, (tx) => loadPayDashboard(tx, NOW));
    expect(d.waiting).toEqual({ count: 2, oldest: new Date(ago(120)) });
    expect(d.digest.next?.toISOString()).toBe("2026-11-03T09:00:00.000Z");
    expect(d.digest.status.lastSent).toBeNull();
    expect(d.sortedThisWeek).toBe(2);
    expect(d.weekStart).toBe("2026-11-02");
    expect([d.nextPayDate, d.nextPayDateFrom]).toEqual(["2026-11-06", "pay records"]);
    expect(d.groups.map((g) => g.queries.length)).toEqual([1, 1]);
    expect(d.moreGroups).toBe(0);
    expect(d.recentlySorted).toEqual([
      {
        by: "Office Person",
        at: new Date(ago(1)),
        note: "Paid on Friday with the rest.",
        count: 2,
        issue: "wrong_rate",
        firstDay: "2026-10-26",
      },
      {
        by: "Office Person",
        at: new Date(ago(40)),
        note: "Corrected.",
        count: 1,
        issue: "wrong_rate",
        firstDay: "2026-10-20",
      },
    ]);
  });

  it("with nothing imported, the pay date is the Friday after this week; nothing waiting", async () => {
    const t = await payFirm();
    const d = await withFirm(t.f.firmId, (tx) => loadPayDashboard(tx, NOW));
    expect(d.waiting).toEqual({ count: 0, oldest: null });
    expect([d.nextPayDate, d.nextPayDateFrom]).toEqual(["2026-11-13", "pay week"]);
    expect(d.sortedThisWeek).toBe(0);
    expect(d.groups).toEqual([]);
    expect(d.recentlySorted).toEqual([]);
  });

  it("only this firm's queries; payroll and admins get it, resourcers don't", async () => {
    const t = await payFirm();
    const other = await payFirm();
    await other.query({ day: "2026-10-26", status: "open", created: ago(10) });
    const d = await withFirm(t.f.firmId, (tx) => loadPayDashboard(tx, NOW));
    expect(d.waiting.count).toBe(0);

    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const sessionFor = async (officeUserId: string) =>
      (
        await withFirm(t.f.firmId, (tx) =>
          createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
        )
      ).token;
    expect(await officePayDashboard(ctx, await sessionFor(t.payroll), NOW)).not.toBeNull();
    expect(
      await officePayDashboard(ctx, await sessionFor(await t.f.office("admin")), NOW),
    ).not.toBeNull();
    expect(
      await officePayDashboard(ctx, await sessionFor(await t.f.office("resourcer")), NOW),
    ).toBeNull();
    expect(await officePayDashboard(ctx, "", NOW)).toBeNull();
  });

  it("the menu badge: the waiting count for a role with pay, nothing for others", async () => {
    const t = await payFirm();
    await t.query({ day: "2026-10-26", status: "open", created: ago(5) });
    await t.query({ day: "2026-10-26", status: "in_digest", created: ago(4) });
    await t.query({
      day: "2026-10-26",
      status: "resolved",
      created: ago(6),
      resolved: { by: t.payroll, at: ago(2), note: "Done." },
    });
    const ctx = { firm: { id: t.f.firmId }, run: withFirm };
    expect(await officePayQueriesWaiting(ctx, "payroll")).toBe(2);
    expect(await officePayQueriesWaiting(ctx, "admin")).toBe(2);
    expect(await officePayQueriesWaiting(ctx, "resourcer")).toBeNull();
  });
});

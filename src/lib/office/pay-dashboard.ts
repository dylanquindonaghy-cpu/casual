import { eq, sql } from "drizzle-orm";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess, type OfficeRole } from "../auth/roles";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { loadDigestStatus, type DigestStatus } from "../pay/digest";
import { digestSchedule, nextDigestAt, type DigestSchedule } from "../pay/digest-schedule";
import { payCalendar, payPeriod, payPeriodName, payPeriodNow } from "../pay/calendar";
import type { PayIssue } from "../portal/pay-query-kinds";
import { localDateOf, zonedToUtc } from "../time/zoned";
import { loadPayQueryGroups, type PayQueryGroup } from "./pay-query-groups";

// Payroll's home (docs/office-v2.md 3.8; docs/screens.md `/office/pay`): four counts, the waiting
// queries grouped by likely cause, and what was sorted in the last 7 days. Admins and payroll:
// checked here as well as on the page. No strike is read here, and no pay figure is shown (the
// next pay date only).

// How many groups the dashboard shows (the rest are on /office/pay-queries).
export const DASHBOARD_GROUPS = 5;
// How many sortings "Recently sorted" lists.
export const RECENTLY_SORTED_ROWS = 20;

export interface PaySorting {
  by: string | null; // the office user's name (null if they've been removed)
  at: Date;
  note: string;
  count: number; // queries sorted together
  issue: PayIssue;
  firstDay: string; // the earliest work date among them, yyyy-mm-dd
  periodStart: string; // the first day of the pay period it's in (Phase 25.2)
}

export interface PayDashboard {
  timeZone: string;
  waiting: { count: number; oldest: Date | null };
  digest: { schedule: DigestSchedule; status: DigestStatus; next: Date | null };
  sortedThisWeek: number;
  weekStart: string; // this pay period's first day, firm-local (yyyy-mm-dd): "sorted" since then
  nextPayDate: string; // yyyy-mm-dd
  nextPayDateFrom: "pay records" | "pay week"; // imported pay dates, or this period's pay day
  // The firm's pay period now (P3.1; Phase 25.2): "Week 44" or "Cycle 22", its dates and pay day.
  period: { name: string; label: "week" | "cycle"; start: string; end: string; payDay: string };
  groups: PayQueryGroup[]; // the biggest few
  moreGroups: number; // groups beyond those
  recentlySorted: PaySorting[];
}

export async function loadPayDashboard(tx: FirmTx, now: Date = new Date()): Promise<PayDashboard> {
  const [firm] = await tx
    .select({ timezone: firms.timezone, settings: firms.settings })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const timeZone = firm?.timezone ?? "Europe/London";
  const schedule = digestSchedule(firm?.settings ?? {});
  const today = localDateOf(now, timeZone);
  // The firm's pay week or cycle (P3.1; Phase 25.2).
  const calendar = payCalendar(firm?.settings ?? {});
  const period = payPeriodNow(now, timeZone, calendar);
  const [y = 2000, m = 1, d = 1] = period.start.split("-").map(Number);
  const weekStart = zonedToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, timeZone);

  const { rows: counts } = await tx.execute<{
    waiting: number;
    oldest: string | null;
    sorted: number;
    pay_date: string | null;
  }>(sql`
    select
      (select count(*)::int from pay_queries where status in ('open', 'in_digest')) as waiting,
      (select min(created_at)::text from pay_queries where status in ('open', 'in_digest')) as oldest,
      (select count(*)::int from pay_queries
        where status = 'resolved' and resolved_at >= ${weekStart.toISOString()}::timestamptz) as sorted,
      (select min(pay_date)::text from pay_records where pay_date >= ${today}::date) as pay_date`);
  const c = counts[0];

  const { rows: sortings } = await tx.execute<{
    by_name: string | null;
    resolved_at: string;
    note: string | null;
    n: number;
    issue: PayIssue;
    first_day: string;
  }>(sql`
    select u.name as by_name, q.resolved_at::text as resolved_at, q.resolution_note as note,
           count(*)::int as n, min(q.issue_type) as issue, min(q.work_date)::text as first_day
      from pay_queries q
      left join office_users u on u.firm_id = q.firm_id and u.id = q.resolved_by
     where q.status = 'resolved' and q.resolved_at >= ${now.toISOString()}::timestamptz - interval '7 days'
     group by u.name, q.resolved_by, q.resolved_at, q.resolution_note
     order by q.resolved_at desc
     limit ${RECENTLY_SORTED_ROWS}`);

  const { groups } = await loadPayQueryGroups(tx);
  return {
    timeZone,
    waiting: { count: c?.waiting ?? 0, oldest: c?.oldest ? new Date(c.oldest) : null },
    digest: {
      schedule,
      status: await loadDigestStatus(tx, now),
      next: nextDigestAt(now, timeZone, schedule),
    },
    sortedThisWeek: c?.sorted ?? 0,
    weekStart: period.start,
    nextPayDate: c?.pay_date ?? period.payDay,
    nextPayDateFrom: c?.pay_date ? "pay records" : "pay week",
    period: {
      name: payPeriodName(period),
      label: period.label,
      start: period.start,
      end: period.end,
      payDay: period.payDay,
    },
    groups: groups.slice(0, DASHBOARD_GROUPS),
    moreGroups: Math.max(0, groups.length - DASHBOARD_GROUPS),
    recentlySorted: sortings.map((r) => ({
      by: r.by_name,
      at: new Date(r.resolved_at),
      note: r.note ?? "",
      count: r.n,
      issue: r.issue,
      firstDay: r.first_day,
      periodStart: payPeriod(r.first_day, calendar).start,
    })),
  };
}

// The page's data for the logged-in office user, or null (logged out, or a role without pay).
export async function officePayDashboard(
  ctx: AuthContext,
  token: string,
  now: Date = new Date(),
): Promise<PayDashboard | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "pay")) return null;
  const { run } = authParts(ctx);
  return run(ctx.firm.id, (tx) => loadPayDashboard(tx, now));
}

// The Pay queries menu badge: how many are waiting (open, or in a digest). The office layout asks
// once it has the session, so the role is the session's; any role without pay gets null.
export async function officePayQueriesWaiting(
  ctx: AuthContext,
  role: OfficeRole,
): Promise<number | null> {
  if (!canAccess(role, "pay")) return null;
  const { run } = authParts(ctx);
  return run(ctx.firm.id, async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from pay_queries where status in ('open', 'in_digest')`,
    );
    return rows[0]?.n ?? 0;
  });
}

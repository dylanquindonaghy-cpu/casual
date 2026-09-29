import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi } from "@/lib/ai/client";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  loadPayQueryGroups,
  officePayQueryGroups,
  summariseGroups,
} from "@/lib/office/pay-query-groups";
import { regroupPayQueries } from "@/lib/pay/grouping";
import { raisePayQuery } from "@/lib/portal/pay-queries";
import type { PayQueryInput } from "@/lib/portal/pay-query-kinds";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Pay queries grouped by likely cause (src/lib/pay/grouping.ts, src/lib/office/pay-query-groups.ts):
// keys set by code when a query is raised, recomputed when facts arrive later, and payroll's
// grouped view. On the real database, as the app role. NOW is Monday 2 November 2026 (the week of
// Mon 26 Oct is last week).

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

const stepped = (workerId: string) => ({
  worker: { id: workerId },
  session: {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "worker",
    subjectId: workerId,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    rotatedAt: NOW,
    steppedUpUntil: new Date(NOW.getTime() + 600_000),
    rotationDue: false,
  } as ActiveSession,
});

async function groupFirm() {
  const f = await bookingFirm(su, withFirm);
  const [ann, ben, cal] = [
    await f.worker({ first: "Ann" }),
    await f.worker({ first: "Ben" }),
    await f.worker({ first: "Cal" }),
  ];
  const { rows: siteRows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena'), ($1, 'Other Stadium') returning id::text as id",
    [f.firmId],
  );
  const [arena = "", stadium = ""] = siteRows.map((r) => r.id);
  // Last week's shifts: Thursday at the arena (Ann, Ben), Friday at the stadium (Cal).
  const thursday = await f.shift({ startsAt: new Date("2026-10-29T08:00:00Z"), headcount: 2 });
  await su.query("update shifts set site_id = $2 where id = $1", [thursday, arena]);
  const friday = await f.shift({ startsAt: new Date("2026-10-30T08:00:00Z") });
  await su.query("update shifts set site_id = $2 where id = $1", [friday, stadium]);
  await f.booking(ann, thursday, "completed", 1);
  await f.booking(ben, thursday, "completed", 2);
  await f.booking(cal, friday, "completed", 1);
  const payLine = (workerId: string, ratePence: number) =>
    su.query(
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
       values ($1, $2, '2026-10-26', '2026-11-01', 8, $3)`,
      [f.firmId, workerId, ratePence],
    );
  const ctx = {
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Shift Team" },
    run: withFirm,
    clock: { now: () => NOW },
  };
  const raise = (workerId: string, input: Partial<PayQueryInput>) =>
    raisePayQuery(ctx, stepped(workerId), {
      shiftId: null,
      day: null,
      issue: "missing_hours",
      details: null,
      ...input,
    });
  const keys = async () =>
    (
      await su.query<{ worker_id: string; issue_type: string; group_key: string }>(
        `select worker_id::text as worker_id, issue_type, group_key from pay_queries
          where firm_id = $1 order by created_at, id`,
        [f.firmId],
      )
    ).rows.map((r) => r.group_key);
  return { f, ann, ben, cal, arena, stadium, thursday, friday, payLine, raise, keys };
}

describe("grouping pay queries", () => {
  it("keys set by code when raised: one cause per group", async () => {
    const t = await groupFirm();
    await t.payLine(t.ann, 1250);
    await t.payLine(t.ben, 1250);
    await t.payLine(t.cal, 1300);
    await t.raise(t.ann, { shiftId: t.thursday, issue: "wrong_rate" });
    await t.raise(t.ben, { shiftId: t.thursday, issue: "wrong_rate" });
    await t.raise(t.cal, { shiftId: t.friday, issue: "wrong_rate" });
    await t.raise(t.ann, { shiftId: t.thursday, issue: "missing_hours" });
    await t.raise(t.cal, { shiftId: t.friday, issue: "missing_hours" });
    await t.raise(t.ben, { day: "2026-10-31", issue: "late_pay" });
    await t.raise(t.cal, { day: "2026-10-27", issue: "late_pay" });
    expect(await t.keys()).toEqual([
      "pay1:wrong_rate:2026-10-26:rate:1250",
      "pay1:wrong_rate:2026-10-26:rate:1250",
      "pay1:wrong_rate:2026-10-26:rate:1300",
      `pay1:missing_hours:2026-10-26:site:${t.arena}`,
      `pay1:missing_hours:2026-10-26:site:${t.stadium}`,
      "pay1:late_pay:2026-10-26",
      "pay1:late_pay:2026-10-26",
    ]);
  });

  it("a pay line imported after the query changes its key when regrouped; sorted ones are left alone", async () => {
    const t = await groupFirm();
    await t.raise(t.ann, { shiftId: t.thursday, issue: "wrong_rate" });
    await t.raise(t.ben, { shiftId: t.thursday, issue: "wrong_rate" });
    await su.query(
      "update pay_queries set status = 'resolved' where firm_id = $1 and worker_id = $2",
      [t.f.firmId, t.ben],
    );
    expect(await t.keys()).toEqual([
      "pay1:wrong_rate:2026-10-26:rate:none",
      "pay1:wrong_rate:2026-10-26:rate:none",
    ]);
    await t.payLine(t.ann, 1250);
    await t.payLine(t.ben, 1250);
    expect(await withFirm(t.f.firmId, (tx) => regroupPayQueries(tx))).toEqual({ changed: 1 });
    expect(await t.keys()).toEqual([
      "pay1:wrong_rate:2026-10-26:rate:1250",
      "pay1:wrong_rate:2026-10-26:rate:none",
    ]);
    // Running it again changes nothing.
    expect(await withFirm(t.f.firmId, (tx) => regroupPayQueries(tx))).toEqual({ changed: 0 });
  });

  it("payroll's view: groups biggest first, each with its line and its queries (details included)", async () => {
    const t = await groupFirm();
    await t.payLine(t.ann, 1250);
    await t.payLine(t.ben, 1250);
    await t.raise(t.ann, {
      shiftId: t.thursday,
      issue: "wrong_rate",
      details: "Paid £12.50, should be £13",
    });
    await t.raise(t.ben, { shiftId: t.thursday, issue: "wrong_rate" });
    await t.raise(t.cal, { shiftId: t.friday, issue: "missing_hours" });
    const { groups, more } = await withFirm(t.f.firmId, (tx) => loadPayQueryGroups(tx));
    expect(more).toBe(false);
    expect(groups.map((g) => [g.heading, g.aiLine, g.queries.map((q) => q.worker)])).toEqual([
      [
        "2 queries: wrong rate, the week of Mon 26 Oct, paid at £12.50.",
        null,
        ["Ann Booker", "Ben Booker"],
      ],
      ["1 query: hours missing, the week of Mon 26 Oct, at Other Stadium.", null, ["Cal Booker"]],
    ]);
    expect(groups[0]?.queries[0]).toMatchObject({
      day: "2026-10-29",
      shift: "Thu 29 Oct, 08:00 to 16:00",
      details: "Paid £12.50, should be £13",
      status: "open",
    });
    // With an AI client (the digest job, once Bedrock is connected), after the transaction: its
    // checked line beneath the code's heading; a line that fails the check adds nothing.
    let n = 0;
    const ai = createFakeAi(() =>
      n++ === 0 ? "2 queries: last week still paid at £12.50." : "You should pay them £99.",
    );
    const withAi = await summariseGroups(groups, ai);
    expect(withAi.map((g) => [g.heading, g.aiLine])).toEqual([
      [
        "2 queries: wrong rate, the week of Mon 26 Oct, paid at £12.50.",
        "2 queries: last week still paid at £12.50.",
      ],
      ["1 query: hours missing, the week of Mon 26 Oct, at Other Stadium.", null],
    ]);
    // Sorted queries aren't in it.
    await su.query("update pay_queries set status = 'resolved' where firm_id = $1", [t.f.firmId]);
    expect((await withFirm(t.f.firmId, (tx) => loadPayQueryGroups(tx))).groups).toEqual([]);
  });

  it("only this firm's queries; payroll and admins see them, resourcers don't", async () => {
    const t = await groupFirm();
    const other = await groupFirm();
    await other.raise(other.ann, { day: "2026-10-31", issue: "late_pay" });
    expect((await withFirm(t.f.firmId, (tx) => loadPayQueryGroups(tx))).groups).toEqual([]);
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const sessionFor = async (officeUserId: string) =>
      (
        await withFirm(t.f.firmId, (tx) =>
          createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
        )
      ).token;
    expect(
      await officePayQueryGroups(ctx, await sessionFor(await t.f.office("payroll"))),
    ).not.toBeNull();
    expect(
      await officePayQueryGroups(ctx, await sessionFor(await t.f.office("admin"))),
    ).not.toBeNull();
    expect(
      await officePayQueryGroups(ctx, await sessionFor(await t.f.office("resourcer"))),
    ).toBeNull();
    expect(await officePayQueryGroups(ctx, "")).toBeNull();
  });
});

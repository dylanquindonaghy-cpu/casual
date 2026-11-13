import { sql, type SQL } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type FirmTx, type WithFirm } from "@/lib/db/scoped";
import { weekHoursQuery, weeklyHours } from "@/lib/roster/allocation-input";
import { weekOf } from "@/lib/rules/eligibility";
import { localDateOf } from "@/lib/time/zoned";
import { bookingFirm, hoursFromNow } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The week's hours for fair rotation and the offer list's order (weeklyHours, used by "who can take
// it" on the dashboard's card) are added up once, however the planner joins them to the workers.
//
// Why (the CI failure on PR #56, streets.spec.ts): on a database just seeded, its tables not yet
// analysed, the planner expects one row everywhere and joins the hours subquery to the workers
// with a nested loop, adding the whole week up again for each worker: 120 stewards, 40,243 index
// scans, 7.6 seconds for "who can take it" (1 ms once analysed). The dashboard's pick of a session
// (router.replace) waits for the page, so its address stayed /office for that long.
//
// A test can't take a table's statistics away (only a superuser can, and autovacuum puts them
// back when it likes), so this forces the plan they led to: no hash or merge joins and no
// Material node, leaving the planner the same nested loop. The hours must then be added up
// once, not once per worker.

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

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  Alias?: string;
  "Actual Loops"?: number;
  Plans?: PlanNode[];
}

function nodes(n: PlanNode): PlanNode[] {
  return [n, ...(n.Plans ?? []).flatMap(nodes)];
}

// The plan of every query `load` runs, with the nested-loop plan forced, and what it returned.
async function plansOf<T>(
  firmId: string,
  load: (tx: FirmTx) => Promise<T>,
): Promise<{ plans: PlanNode[]; result: T }> {
  const plans: PlanNode[] = [];
  const result = await withFirm(firmId, async (tx) => {
    await tx.execute(sql`set local enable_hashjoin = off`);
    await tx.execute(sql`set local enable_mergejoin = off`);
    await tx.execute(sql`set local enable_material = off`);
    const explaining = Object.create(tx) as FirmTx;
    explaining.execute = (async (query: SQL) => {
      const { rows } = await tx.execute<{ "QUERY PLAN": [{ Plan: PlanNode }] }>(
        sql`explain (analyze, format json) ${query}`,
      );
      plans.push(rows[0]!["QUERY PLAN"][0].Plan);
      return tx.execute(query);
    }) as FirmTx["execute"];
    return load(explaining);
  });
  return { plans, result };
}

const HOUR = 3_600_000;

// A firm with `n` stewards, each booked on its own shift in the week, and the shift being offered.
async function stewards(n: number) {
  const f = await bookingFirm(su, withFirm);
  // Every shift in the middle of next week (London), so no run falls across a week's edge: from
  // its Wednesday 00:00, one an hour, and the one offered at its Wednesday 06:00.
  const week = weekOf(localDateOf(hoursFromNow(24 * 7), "Europe/London"), "Europe/London");
  const at = (h: number) => new Date(week.from + (48 + h) * HOUR);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const worker = await f.worker({ first: `W${i}`, roles: ["steward"] });
    const shift = await f.shift({ role: "steward", startsAt: at(i), hours: 4 });
    await f.booking(worker, shift, "confirmed");
    ids.push(worker);
  }
  const target = await f.shift({ role: "steward", startsAt: at(6), hours: 6 });
  return { f, ids, target, week };
}

// How many times the plan added up the hours: the loops of each Aggregate whose input scans the
// bookings (assignments, alias `a`). Once, whatever join the planner picks inside it (it may read
// the bookings once per shift there, which is fine); the old correlated subquery ran it once per
// worker. Measuring the scans of assignments instead depended on that inner join (CI on #56).
const hoursScans = (plan: PlanNode) =>
  nodes(plan)
    .filter(
      (n) =>
        n["Node Type"] === "Aggregate" &&
        nodes(n).some((m) => m["Relation Name"] === "assignments" && m.Alias === "a"),
    )
    .map((n) => n["Actual Loops"]);

describe("the week's hours, added up once", () => {
  it("weeklyHours: one scan of the bookings whatever the join, with every steward's hours", async () => {
    const { f, ids, target, week } = await stewards(12);
    const { plans, result } = await plansOf(f.firmId, (tx) =>
      weeklyHours(tx, { shiftId: target, role: "steward", week, workerId: ids[0]! }),
    );
    expect(plans).toHaveLength(1);
    expect(hoursScans(plans[0]!)).toEqual([1]);
    // The answer is the same: 4 hours each.
    expect([...result.keys()].sort()).toEqual([...ids].sort());
    expect(new Set(result.values())).toEqual(new Set([4]));
  });

  it("the batch gate's form (no shift to leave out): one scan too", async () => {
    const { f, ids, week } = await stewards(12);
    const { plans, result } = await plansOf(f.firmId, async (tx) => {
      const { rows } = await tx.execute<{ worker_id: string; hours: string | number }>(
        weekHoursQuery({ role: "steward", week, workerId: ids[0]! }),
      );
      return rows;
    });
    expect(hoursScans(plans[0]!)).toEqual([1]);
    expect(result.map((r) => Number(r.hours))).toEqual(ids.map(() => 4));
  });
});

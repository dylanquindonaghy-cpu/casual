import { sql, type SQL } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type FirmTx, type WithFirm } from "@/lib/db/scoped";
import { loadCasualRecords } from "@/lib/office/reliability";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Each casual's record (loadCasualRecords: the Casuals list, the casual's page, the dashboard's card
// and Coming up) is added up over the bookings once, however the planner joins them to the casuals.
//
// Why (casual.app.spec.ts in verify.sh: after "Need updating" on Casuals the address stayed
// /office/casuals for over 5 seconds): on a database just seeded, its tables not yet analysed, the
// planner expects one row everywhere and ran the casuals, bookings and sessions join as nested
// loops, reading every booking once per casual and every session once per booking: 143 casuals,
// 81,367 scans of the sessions, 7.9 seconds for the Casuals list (1.7 ms once analysed). A tab's
// link waits for the page, so the address didn't change in time.
//
// A test can't take a table's statistics away (only a superuser can, and autovacuum puts them back
// when it likes), so this forces the plan they led to, as tests/integration/
// allocation.week-hours-plan.test.ts does: no hash or merge joins and no Material node, leaving the
// planner nested loops. The bookings must then still be read once, not once per casual.

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

const DAY = 24;
const CASUALS = 12;

// A firm with CASUALS stewards, all of whom worked the same two sessions (10 days and 2 days ago);
// every third didn't attend the later one.
async function crew() {
  const f = await bookingFirm(su, withFirm);
  const earlier = await f.shift({
    role: "steward",
    startsAt: hoursFromNow(-10 * DAY),
    headcount: CASUALS,
  });
  const later = await f.shift({
    role: "steward",
    startsAt: hoursFromNow(-2 * DAY),
    headcount: CASUALS,
  });
  const ids: string[] = [];
  for (let i = 0; i < CASUALS; i++) {
    const worker = await f.worker({ first: `W${i}`, roles: ["steward"] });
    await f.booking(worker, earlier, "completed", i + 1);
    await f.booking(worker, later, i % 3 === 0 ? "no_show" : "completed", i + 1);
    ids.push(worker);
  }
  return { f, ids };
}

// How many times the plan read the bookings (scans of assignments, alias `a`), all told.
const bookingReads = (plan: PlanNode) =>
  nodes(plan)
    .filter((n) => n["Relation Name"] === "assignments" && n.Alias === "a")
    .reduce((sum, n) => sum + (n["Actual Loops"] ?? 0), 0);

describe("each casual's record, added up once", () => {
  it("reads the bookings once (not once per casual) whatever the join, with the same records", async () => {
    const { f, ids } = await crew();
    const { plans, result } = await plansOf(f.firmId, (tx) => loadCasualRecords(tx, NOW, null));
    expect(plans).toHaveLength(1);
    // Before: a nested loop over the casuals read the bookings once for each of the 12 casuals.
    // Now at most once per session (2), whichever side of their join the planner puts them.
    expect(bookingReads(plans[0]!)).toBeLessThanOrEqual(2);

    // The records themselves, as before.
    expect([...result.keys()].sort()).toEqual([...ids].sort());
    ids.forEach((id, i) => {
      const r = result.get(id)!;
      const missed = i % 3 === 0;
      expect(r.reliability.counts).toEqual({
        worked: missed ? 1 : 2,
        noShows: missed ? 1 : 0,
        lateCancels: 0,
      });
      expect(r.lastWorked).toEqual(hoursFromNow((missed ? -10 : -2) * DAY));
    });
  });

  it("some casuals only (a casual's page, Coming up): once too, and only theirs", async () => {
    const { f, ids } = await crew();
    const some = ids.slice(0, 3);
    const { plans, result } = await plansOf(f.firmId, (tx) => loadCasualRecords(tx, NOW, some));
    expect(bookingReads(plans[0]!)).toBeLessThanOrEqual(2);
    expect([...result.keys()].sort()).toEqual([...some].sort());
    expect(result.get(ids[1]!)?.reliability.counts).toEqual({
      worked: 2,
      noShows: 0,
      lateCancels: 0,
    });
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { automaticEventId } from "@/lib/roster/shift-events";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// automaticEventId() (src/lib/roster/shift-events.ts) when two transactions make the same automatic
// event at once, as two imports or a sync and an import can: one event, both shifts in it. The
// unique index makes the second wait for the first; if the first is rolled back, the second makes
// it. On the real database as the app role.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const SHIFT = {
  siteId: null,
  startsAt: new Date("2026-11-07T09:00:00Z"),
  source: "csv" as const,
  timeZone: "Europe/London",
};

// A transaction that makes the event and then waits, holding it uncommitted, until released.
function holdOpen(firmId: string, end: "commit" | "rollback") {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let made: (id: string) => void = () => undefined;
  const madeId = new Promise<string>((resolve) => (made = resolve));
  const done = withFirm(firmId, async (tx) => {
    const id = await automaticEventId(tx, SHIFT);
    made(id);
    await gate;
    if (end === "rollback") throw new Error("rolled back on purpose");
    return id;
  }).catch((err: Error) => err.message);
  return { madeId, release, done };
}

const eventsOf = async (firmId: string) =>
  (
    await su.query<{ id: string }>(
      "select id::text as id from shift_events where firm_id = $1 and planner_ref = 'auto:none:2026-11-07'",
      [firmId],
    )
  ).rows.map((r) => r.id);

describe("two transactions making the same automatic event", () => {
  it("the second waits for the first and gets the same event", async () => {
    const f = await bookingFirm(su, withFirm);
    const first = holdOpen(f.firmId, "commit");
    const firstId = await first.madeId;
    let settled = false;
    const second = withFirm(f.firmId, (tx) => automaticEventId(tx, SHIFT)).finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false); // waiting on the first's uncommitted row
    first.release();
    expect(await first.done).toBe(firstId);
    expect(await second).toBe(firstId);
    expect(await eventsOf(f.firmId)).toEqual([firstId]);
  });

  it("if the first is rolled back, the second makes it", async () => {
    const f = await bookingFirm(su, withFirm);
    const first = holdOpen(f.firmId, "rollback");
    const firstId = await first.madeId;
    const second = withFirm(f.firmId, (tx) => automaticEventId(tx, SHIFT));
    await new Promise((r) => setTimeout(r, 300));
    first.release();
    expect(await first.done).toBe("rolled back on purpose");
    const secondId = await second;
    expect(secondId).not.toBe(firstId);
    expect(await eventsOf(f.firmId)).toEqual([secondId]);
  });
});

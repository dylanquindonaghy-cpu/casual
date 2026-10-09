import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { nativeRosterPlug } from "@/lib/roster/native";
import type { RosterPlug } from "@/lib/roster/plug";
import { appRolePool, superuserPool, testEvent, uniqueSlug } from "../helpers/db";
import { fulfilled, race } from "../helpers/race";
import { Rollback } from "../helpers/rls-probe";
import {
  book,
  describeRosterContract,
  NOW,
  SCENARIO,
  type CancellationRecord,
  type RosterFixture,
} from "../helpers/roster-contract";

// The native roster plug on the real database, as the restricted app role. First the shared
// RosterPlug contract (every adapter passes the same checks), each call in its own withFirm
// transaction like one web request. Then what only the native adapter can show: a real race
// between connections, slot rows made on demand, and what it stores.

const clock = { now: () => NOW };
const BOOKED_AT = new Date(NOW.getTime() - 7 * 24 * 3_600_000); // seeded bookings: a week before NOW
let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(12);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function insertId(text: string, values: unknown[]): Promise<string> {
  const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = rows[0]?.id;
  if (!id) throw new Error(`insert returned no id: ${text}`);
  return id;
}

async function newFirm(): Promise<string> {
  const slug = uniqueSlug("n");
  return insertId("insert into firms (name, slug, sector) values ($1, $2, 'security')", [
    `Native Test ${slug}`,
    slug,
  ]);
}

// SCENARIO in our tables for a fresh firm (as the superuser, like a seed). Every shift gets its
// open slot rows except "pair", which the plug must create on demand.
async function seedScenario(): Promise<{ firmId: string; ids: RosterFixture["ids"] }> {
  const firmId = await newFirm();
  const siteId = await insertId("insert into sites (firm_id, name) values ($1, $2)", [
    firmId,
    "Acme Demo Arena",
  ]);
  const ids = { staff: {}, shifts: {} } as RosterFixture["ids"];
  for (const s of SCENARIO.staff) {
    ids.staff[s.key] = await insertId(
      `insert into workers (firm_id, first_name, last_name, mobile_e164, roles, status)
       values ($1, $2, $3, $4, $5, $6)`,
      [firmId, s.firstName, s.lastName, s.mobileE164, s.roles, s.status],
    );
  }
  for (const s of SCENARIO.shifts) {
    const shiftId = await insertId(
      `insert into shifts (firm_id, event_id, site_id, role, starts_at, ends_at, headcount, status, instructions)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        firmId,
        await testEvent(su, firmId),
        s.siteName ? siteId : null,
        s.role,
        s.startsAt,
        s.endsAt,
        s.headcount,
        s.status,
        s.instructions,
      ],
    );
    ids.shifts[s.key] = shiftId;
    if (s.key === "pair") continue;
    for (let slot = 1; slot <= s.headcount; slot++) {
      const holder = s.holders[slot - 1];
      await su.query(
        `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
         values ($1, $2, $3, $4, $5, $6)`,
        holder
          ? [firmId, shiftId, slot, ids.staff[holder], "confirmed", BOOKED_AT]
          : [firmId, shiftId, slot, null, "open", null],
      );
    }
  }
  return { firmId, ids };
}

// A plug whose every call runs in its own withFirm transaction on the app role's pool.
async function perCallPlug(firmId: string): Promise<RosterPlug> {
  const call = <T>(fn: (plug: RosterPlug) => Promise<T>) =>
    withFirm(firmId, (tx) => fn(nativeRosterPlug(tx, { clock })));
  const { source, canWrite } = await call(async (p) => ({
    source: p.source,
    canWrite: p.canWrite,
  }));
  return {
    source,
    canWrite,
    listStaff: () => call((p) => p.listStaff()),
    getShifts: (from, to) => call((p) => p.getShifts(from, to)),
    assign: (shiftId, workerId, pass) => call((p) => p.assign(shiftId, workerId, pass)),
    markCancelled: (shiftId, workerId, cancel) =>
      call((p) => p.markCancelled(shiftId, workerId, cancel)),
  };
}

// What the database holds for each cancellation, read as the app role inside the firm.
function cancellationsOf(firmId: string): () => Promise<CancellationRecord[]> {
  return () =>
    withFirm(firmId, async (tx) => {
      const { rows } = await tx.execute<{
        id: string;
        worker_id: string;
        status: string;
        cancel_reason: string;
        notice_hours: string;
      }>(sql`
        select id, worker_id, status, cancel_reason, notice_hours::text from assignments
         where status in ('cancelled_worker', 'cancelled_firm') order by cancelled_at, id
      `);
      return rows.map((r) => ({
        assignmentId: r.id,
        staffRef: r.worker_id,
        by: r.status === "cancelled_firm" ? ("firm" as const) : ("worker" as const),
        reason: r.cancel_reason,
        noticeHours: Number(r.notice_hours),
      }));
    });
}

async function nativeFixture(): Promise<RosterFixture> {
  const { firmId, ids } = await seedScenario();
  // Native refs are our own ids.
  return {
    plug: await perCallPlug(firmId),
    ids,
    refs: ids,
    cancellations: cancellationsOf(firmId),
  };
}

describeRosterContract("native adapter (our tables, real database, app role)", {
  writable: nativeFixture,
  twoFirms: async () => ({ mine: await nativeFixture(), theirs: await nativeFixture() }),
});

describe("native adapter only", () => {
  const worker = { reason: "Unwell", by: "worker" as const, at: NOW };

  async function addWorkers(firmId: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        await insertId(
          `insert into workers (firm_id, first_name, last_name, mobile_e164, roles)
           values ($1, 'Racer', $2, $3, '{steward}')`,
          [firmId, `No${i}`, `+4477009008${String(i).padStart(2, "0")}`],
        ),
      );
    }
    return ids;
  }

  async function addShift(firmId: string, headcount: number, slotRows: number): Promise<string> {
    const shiftId = await insertId(
      `insert into shifts (firm_id, event_id, role, starts_at, ends_at, headcount)
       values ($1, $2, 'steward', $3, $4, $5)`,
      [
        firmId,
        await testEvent(su, firmId),
        new Date(NOW.getTime() + 48 * 3_600_000),
        new Date(NOW.getTime() + 56 * 3_600_000),
        headcount,
      ],
    );
    for (let slot = 1; slot <= slotRows; slot++) {
      await su.query("insert into assignments (firm_id, shift_id, slot) values ($1, $2, $3)", [
        firmId,
        shiftId,
        slot,
      ]);
    }
    return shiftId;
  }

  const liveRows = async (shiftId: string) =>
    (
      await su.query<{ slot: number; worker_id: string | null; status: string }>(
        `select slot, worker_id::text, status from assignments
          where shift_id = $1 and status not in ('cancelled_worker', 'cancelled_firm')
          order by slot`,
        [shiftId],
      )
    ).rows;

  const shiftStatus = async (shiftId: string) =>
    (await su.query<{ status: string }>("select status from shifts where id = $1", [shiftId]))
      .rows[0]?.status;

  it.each([
    [1, 1, 1],
    [3, 3, 3],
    [2, 2, 0], // no slot rows yet: made on demand while racing
  ])(
    "10 people asking at once for a shift with %i slot(s): exactly %i get one, on different slots (%i slot rows made beforehand)",
    async (headcount, winners, slotRows) => {
      const firmId = await newFirm();
      const workers = await addWorkers(firmId, 10);
      const shiftId = await addShift(firmId, headcount, slotRows);
      let next = 0;
      const results = fulfilled(
        await race(10, firmId, (tx) => {
          const workerId = workers[next++] ?? "";
          return book(nativeRosterPlug(tx, { clock }), shiftId, workerId);
        }),
      );
      expect(results).toHaveLength(10);
      const assigned = results.filter((r) => r.status === "assigned");
      expect(assigned).toHaveLength(winners);
      expect(results.filter((r) => r.status === "filled")).toHaveLength(10 - winners);
      expect(assigned.map((r) => (r.status === "assigned" ? r.slot : 0)).sort()).toEqual(
        Array.from({ length: winners }, (_, i) => i + 1),
      );
      const rows = await liveRows(shiftId);
      expect(rows).toHaveLength(headcount);
      expect(new Set(rows.map((r) => r.worker_id)).size).toBe(headcount);
      expect(rows.every((r) => r.status === "confirmed")).toBe(true);
      expect(await shiftStatus(shiftId)).toBe("filled");
    },
  );

  it("a shift made without slot rows can be taken; rows are made up to the headcount only", async () => {
    const firmId = await newFirm();
    const [a, b, c] = await addWorkers(firmId, 3);
    const shiftId = await addShift(firmId, 2, 0);
    const plug = await perCallPlug(firmId);
    expect(await book(plug, shiftId, a ?? "")).toMatchObject({ status: "assigned", slot: 1 });
    expect(await liveRows(shiftId)).toEqual([
      { slot: 1, worker_id: a, status: "confirmed" },
      { slot: 2, worker_id: null, status: "open" },
    ]);
    expect(await book(plug, shiftId, b ?? "")).toMatchObject({ status: "assigned", slot: 2 });
    expect(await book(plug, shiftId, c ?? "")).toEqual({ status: "filled" });
    expect(await liveRows(shiftId)).toHaveLength(2);
  });

  it("a slot above a lowered headcount is never handed out", async () => {
    const firmId = await newFirm();
    const [a, b] = await addWorkers(firmId, 2);
    const shiftId = await addShift(firmId, 2, 2);
    await su.query("update shifts set headcount = 1 where id = $1", [shiftId]);
    const plug = await perCallPlug(firmId);
    expect(await book(plug, shiftId, a ?? "")).toMatchObject({ status: "assigned", slot: 1 });
    expect(await book(plug, shiftId, b ?? "")).toEqual({ status: "filled" });
    expect(await shiftStatus(shiftId)).toBe("filled");
  });

  it("a cancel keeps the row as evidence (when asked, why, notice) and a new open row reopens the slot", async () => {
    const { firmId, ids } = await seedScenario();
    const plug = await perCallPlug(firmId);
    const asked = new Date(NOW.getTime() - 30 * 60_000); // asked 30 minutes before NOW
    const result = await plug.markCancelled(ids.shifts.booked, ids.staff.bob, {
      reason: "  Venue closed early ",
      by: "firm",
      at: asked,
    });
    expect(result).toMatchObject({ status: "cancelled", noticeHours: 26.5 });
    const { rows } = await su.query(
      `select slot, worker_id::text, status, cancelled_at, cancel_reason, notice_hours::text,
              confirmed_at
         from assignments where shift_id = $1 order by created_at, status`,
      [ids.shifts.booked],
    );
    expect(rows).toEqual([
      {
        slot: 1,
        worker_id: ids.staff.bob,
        status: "cancelled_firm",
        cancelled_at: asked,
        cancel_reason: "Venue closed early",
        notice_hours: "26.50",
        confirmed_at: BOOKED_AT,
      },
      {
        slot: 1,
        worker_id: null,
        status: "open",
        cancelled_at: null,
        cancel_reason: null,
        notice_hours: null,
        confirmed_at: null,
      },
    ]);
    expect(await shiftStatus(ids.shifts.booked)).toBe("open");
  });

  it("a cancellation can't be dated before the booking it cancels, and changes nothing", async () => {
    const { firmId, ids } = await seedScenario();
    const plug = await perCallPlug(firmId);
    const beforeBooking = new Date(BOOKED_AT.getTime() - 60_000);
    await expect(
      plug.markCancelled(ids.shifts.booked, ids.staff.bob, { ...worker, at: beforeBooking }),
    ).rejects.toThrow(/before the booking/);
    // A booking made at NOW can't be cancelled "an hour ago" either.
    await book(plug, ids.shifts.open, ids.staff.alice);
    await expect(
      plug.markCancelled(ids.shifts.open, ids.staff.alice, {
        ...worker,
        at: new Date(NOW.getTime() - 3_600_000),
      }),
    ).rejects.toThrow(/before the booking/);
    expect(await liveRows(ids.shifts.booked)).toEqual([
      { slot: 1, worker_id: ids.staff.bob, status: "confirmed" },
    ]);
    expect(await liveRows(ids.shifts.open)).toEqual([
      { slot: 1, worker_id: ids.staff.alice, status: "confirmed" },
    ]);
  });

  it("an offer held for someone isn't a booking, so it can't be cancelled", async () => {
    const { firmId, ids } = await seedScenario();
    await su.query(
      `update assignments set worker_id = $1, status = 'offered', offered_at = $2
        where shift_id = $3 and slot = 1`,
      [ids.staff.alice, BOOKED_AT, ids.shifts.open],
    );
    const plug = await perCallPlug(firmId);
    expect(await plug.markCancelled(ids.shifts.open, ids.staff.alice, worker)).toEqual({
      status: "not_assigned",
    });
    expect(await liveRows(ids.shifts.open)).toEqual([
      { slot: 1, worker_id: ids.staff.alice, status: "offered" },
    ]);
  });

  it("cancelling a slot above a lowered headcount doesn't reopen the slot or the full shift", async () => {
    const firmId = await newFirm();
    const [a, b] = await addWorkers(firmId, 2);
    const shiftId = await addShift(firmId, 2, 2);
    const plug = await perCallPlug(firmId);
    await book(plug, shiftId, a ?? "");
    await book(plug, shiftId, b ?? "");
    await su.query("update shifts set headcount = 1 where id = $1", [shiftId]);
    expect(await plug.markCancelled(shiftId, b ?? "", worker)).toMatchObject({
      status: "cancelled",
    });
    expect(await liveRows(shiftId)).toEqual([{ slot: 1, worker_id: a, status: "confirmed" }]);
    expect(await shiftStatus(shiftId)).toBe("filled");
  });

  it("a worked or missed slot can't be cancelled", async () => {
    const { firmId, ids } = await seedScenario();
    const plug = await perCallPlug(firmId);
    for (const status of ["completed", "no_show"]) {
      await su.query("update assignments set status = $1 where shift_id = $2 and slot = 1", [
        status,
        ids.shifts.booked,
      ]);
      expect(await plug.markCancelled(ids.shifts.booked, ids.staff.bob, worker)).toEqual({
        status: "not_assigned",
      });
    }
    expect(await liveRows(ids.shifts.booked)).toEqual([
      { slot: 1, worker_id: ids.staff.bob, status: "no_show" },
    ]);
  });

  it("writes only inside the caller's transaction: rolling it back undoes the assign", async () => {
    const { firmId, ids } = await seedScenario();
    await expect(
      withFirm(firmId, async (tx) => {
        const result = await book(
          nativeRosterPlug(tx, { clock }),
          ids.shifts.open,
          ids.staff.alice,
        );
        expect(result.status).toBe("assigned");
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(await liveRows(ids.shifts.open)).toEqual([{ slot: 1, worker_id: null, status: "open" }]);
    expect(await shiftStatus(ids.shifts.open)).toBe("open");
  });

  it("ids that aren't UUIDs are not_found, not a database error", async () => {
    const { firmId, ids } = await seedScenario();
    const plug = await perCallPlug(firmId);
    expect(await book(plug, "not-a-uuid", ids.staff.alice)).toEqual({ status: "not_found" });
    expect(await book(plug, ids.shifts.open, "1; drop table shifts")).toEqual({
      status: "not_found",
    });
    expect(await plug.markCancelled("", ids.staff.bob, worker)).toEqual({ status: "not_found" });
  });
});

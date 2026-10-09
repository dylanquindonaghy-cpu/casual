import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookShift, type BookingResult } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { barrier } from "../helpers/race";

// Double-assign is impossible (PLAN.md Phase 2 "Done when"; golden rule 4): bookShift() raced for
// real, many transactions on their own connections at the same moment. Each transaction opens,
// sets its firm and waits at a barrier; only when all are inside do they book, so a read-then-write
// bug can't hide behind a pool that happens to run them one after another.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const clock = { now: () => NOW };

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

// n bookings started together, each in its own transaction, released together.
async function raceBookings(
  firmId: string,
  bookings: { shiftId: string; workerId: string }[],
): Promise<BookingResult[]> {
  const pool = new Pool({ connectionString: urls.app, max: bookings.length });
  try {
    const run = createWithFirm(pool);
    const together = barrier(bookings.length);
    const gated: WithFirm = (id, fn) =>
      run(id, async (tx) => {
        await tx.execute(sql`select 1`); // the connection is open and the firm set
        await together();
        return fn(tx);
      });
    const settled = await Promise.allSettled(
      bookings.map(({ shiftId, workerId }) =>
        bookShift(
          gated,
          firmId,
          { shiftId, workerId, by: { type: "worker", id: workerId } },
          {
            clock,
          },
        ),
      ),
    );
    const failed = settled.filter((s) => s.status === "rejected");
    expect(failed).toEqual([]);
    return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  } finally {
    await pool.end();
  }
}

const holders = async (shiftId: string) =>
  (
    await su.query<{ slot: number; worker_id: string }>(
      `select slot, worker_id::text from assignments
        where shift_id = $1 and worker_id is not null
          and status not in ('cancelled_worker', 'cancelled_firm')
        order by slot`,
      [shiftId],
    )
  ).rows;
const assignedEvents = async (firmId: string) =>
  (
    await su.query<{ n: number }>(
      "select count(*)::int as n from events where firm_id = $1 and action = 'shift.assigned'",
      [firmId],
    )
  ).rows[0]?.n;

describe("assign.race: first yes wins under real concurrency", () => {
  it.each([
    [1, 10],
    [3, 10],
  ])(
    "%i place(s), %i eligible workers at once: exactly that many booked, the rest told it's filled",
    async (places, people) => {
      const f = await bookingFirm(su, withFirm);
      const workers = await Promise.all(
        Array.from({ length: people }, (_, i) => f.worker({ first: `Racer${i}` })),
      );
      const shiftId = await f.shift({ headcount: places });
      const results = await raceBookings(
        f.firmId,
        workers.map((workerId) => ({ shiftId, workerId })),
      );
      const booked = results.filter((r) => r.status === "booked");
      expect(booked).toHaveLength(places);
      expect(results.filter((r) => r.status === "filled")).toHaveLength(people - places);
      const rows = await holders(shiftId);
      expect(rows.map((r) => r.slot)).toEqual(Array.from({ length: places }, (_, i) => i + 1));
      expect(new Set(rows.map((r) => r.worker_id)).size).toBe(places);
      expect(await assignedEvents(f.firmId)).toBe(places);
      const { rows: shift } = await su.query("select status from shifts where id = $1", [shiftId]);
      expect(shift[0]?.status).toBe("filled");
    },
  );

  it("one worker in two tabs taking two overlapping shifts at once: one booked, the other refused", async () => {
    const f = await bookingFirm(su, withFirm);
    for (let round = 0; round < 5; round++) {
      const sam = await f.worker();
      const a = await f.shift({ startsAt: hoursFromNow(48 + round * 24) });
      const b = await f.shift({ startsAt: hoursFromNow(50 + round * 24) });
      const results = await raceBookings(f.firmId, [
        { shiftId: a, workerId: sam },
        { shiftId: b, workerId: sam },
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["booked", "not_eligible"]);
      expect(results.find((r) => r.status === "not_eligible")).toMatchObject({
        codes: ["overlap"],
      });
      const { rows } = await su.query<{ n: number }>(
        `select count(*)::int as n from assignments where worker_id = $1 and status = 'confirmed'`,
        [sam],
      );
      expect(rows[0]?.n).toBe(1);
    }
  });

  it("one worker in two tabs taking the same shift at once: booked once, then told they're on it", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ headcount: 2 });
    const results = await raceBookings(f.firmId, [
      { shiftId, workerId: sam },
      { shiftId, workerId: sam },
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["already_assigned", "booked"]);
    expect(await holders(shiftId)).toEqual([{ slot: 1, worker_id: sam }]);
  });

  it("a weekly cap two tabs could each pass alone: only one gets through", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { weekly_hours_cap: 12 } });
    const sam = await f.worker();
    // Two 8-hour shifts in the same week, far apart: either fits the 12-hour cap, not both.
    const a = await f.shift({ startsAt: hoursFromNow(24) });
    const b = await f.shift({ startsAt: hoursFromNow(72) });
    const results = await raceBookings(f.firmId, [
      { shiftId: a, workerId: sam },
      { shiftId: b, workerId: sam },
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["booked", "not_eligible"]);
    expect(results.find((r) => r.status === "not_eligible")).toMatchObject({
      codes: ["weekly_hours"],
    });
  });

  it("two workers on applications in progress racing for the day's last allowed place: only one", async () => {
    // Half the day's staff may be working on an SIA application in progress. One person with a
    // licence is already on; either applicant alone fits (1 of 2), both together don't (2 of 3).
    const f = await bookingFirm(su, withFirm, {
      settings: { credential_applied_allowance_pct: 50 },
    });
    for (let round = 0; round < 3; round++) {
      const day = round * 24;
      const licensed = await f.worker();
      await f.booking(licensed, await f.shift({ startsAt: hoursFromNow(24 + day) }));
      const applicant = () =>
        f.worker({ credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }] });
      const [a, b] = [await applicant(), await applicant()];
      const results = await raceBookings(f.firmId, [
        { shiftId: await f.shift({ startsAt: hoursFromNow(25 + day) }), workerId: a },
        { shiftId: await f.shift({ startsAt: hoursFromNow(26 + day) }), workerId: b },
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["booked", "not_eligible"]);
      expect(results.find((r) => r.status === "not_eligible")).toMatchObject({
        codes: ["applied_over_allowance"],
      });
    }
  });

  it("the same race when the application in progress is a session's extra requirement (12B.3)", async () => {
    // Stewards with their own qualification, applying for an SIA security guard licence that two
    // steward sessions ask for on top of the role's: the day's allowance still holds.
    const f = await bookingFirm(su, withFirm, {
      settings: { credential_applied_allowance_pct: 50 },
    });
    for (let round = 0; round < 3; round++) {
      const day = round * 24;
      const licensed = await f.worker();
      await f.booking(licensed, await f.shift({ startsAt: hoursFromNow(24 + day) }));
      const applicant = () =>
        f.worker({
          credentials: [
            { type: "STEWARD_L2", expiresOn: null },
            { type: "SIA_SG", status: "applied", expiresOn: null },
          ],
        });
      const session = async (h: number) => {
        const id = await f.shift({ role: "steward", startsAt: hoursFromNow(h + day) });
        await su.query("update shifts set required_credentials = '{SIA_SG}' where id = $1", [id]);
        return id;
      };
      const [a, b] = [await applicant(), await applicant()];
      const results = await raceBookings(f.firmId, [
        { shiftId: await session(25), workerId: a },
        { shiftId: await session(26), workerId: b },
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["booked", "not_eligible"]);
      expect(results.find((r) => r.status === "not_eligible")).toMatchObject({
        codes: ["applied_over_allowance"],
      });
    }
  });

  it("a double tap on cancel: cancelled once, one event, the place reopened once", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    await f.booking(sam, shiftId);
    const pool = new Pool({ connectionString: urls.app, max: 4 });
    try {
      const run = createWithFirm(pool);
      const together = barrier(4);
      const gated: WithFirm = (id, fn) =>
        run(id, async (tx) => {
          await tx.execute(sql`select 1`);
          await together();
          return fn(tx);
        });
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          cancelBooking(
            gated,
            f.firmId,
            { shiftId, workerId: sam, reason: "Unwell", by: { type: "worker", id: sam } },
            { clock },
          ),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        "cancelled",
        "not_assigned",
        "not_assigned",
        "not_assigned",
      ]);
    } finally {
      await pool.end();
    }
    const { rows } = await su.query<{ status: string }>(
      "select status from assignments where shift_id = $1 order by created_at",
      [shiftId],
    );
    expect(rows.map((r) => r.status)).toEqual(["cancelled_worker", "open"]);
    const { rows: logged } = await su.query<{ n: number }>(
      "select count(*)::int as n from events where firm_id = $1 and action = 'shift.cancelled'",
      [f.firmId],
    );
    expect(logged[0]?.n).toBe(1);
  });
});

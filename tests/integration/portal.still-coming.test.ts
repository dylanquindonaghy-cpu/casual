import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { myShifts } from "@/lib/portal/my-shifts";
import { confirmStillComing, STILL_COMING_HOURS } from "@/lib/portal/still-coming";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { race } from "../helpers/race";
import { appRolePool, superuserPool } from "../helpers/db";

// "Still coming?" (Phase 28.2; src/lib/portal/still-coming.ts) on the real database as the app
// role: one conditional UPDATE on her own confirmed booking of a session starting within a day,
// once; zero rows otherwise, and exactly one shift.still_coming, with ids only.

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

const at = (now: Date) => ({ run: withFirm, clock: { now: () => now } });

async function setup() {
  const f = await bookingFirm(su, withFirm);
  const sam = await f.worker();
  const ctx = (now = NOW) => ({ firm: { id: f.firmId }, ...at(now) });
  const said = async (assignmentId: string) =>
    (
      await su.query<{ at: Date | null }>(
        "select still_coming_at as at from assignments where id = $1",
        [assignmentId],
      )
    ).rows[0]?.at ?? null;
  const logged = async () =>
    (
      await su.query<{
        action: string;
        actor_type: string;
        actor_id: string;
        entity_type: string;
        entity_id: string;
        data: Record<string, unknown>;
      }>(
        `select action, actor_type, actor_id::text as actor_id, entity_type,
                entity_id::text as entity_id, data
           from events where firm_id = $1 and action = 'shift.still_coming' order by id`,
        [f.firmId],
      )
    ).rows;
  return { f, sam, ctx, said, logged };
}

describe("confirmStillComing", () => {
  it("sets the time once; a second tap says already; exactly one shift.still_coming, ids only", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(20) });
    const booking = await t.f.booking(t.sam, shift);

    expect(await confirmStillComing(t.ctx(), t.sam, shift)).toEqual({
      status: "confirmed",
      at: NOW,
    });
    expect(await t.said(booking)).toEqual(NOW);

    const later = hoursFromNow(1);
    expect(await confirmStillComing(t.ctx(later), t.sam, shift)).toEqual({
      status: "already",
      at: NOW,
    });
    expect(await t.said(booking)).toEqual(NOW); // unchanged

    expect(await t.logged()).toEqual([
      {
        action: "shift.still_coming",
        actor_type: "worker",
        actor_id: t.sam,
        entity_type: "assignment",
        entity_id: booking,
        data: { assignmentId: booking, shiftId: shift, workerId: t.sam },
      },
    ]);
  });

  it("myShifts carries it on the booking", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(10) });
    await t.f.booking(t.sam, shift);
    const [before] = await myShifts(t.ctx(), t.sam, "upcoming");
    expect(before?.stillComingAt).toBeNull();
    await confirmStillComing(t.ctx(), t.sam, shift);
    const [after] = await myShifts(t.ctx(), t.sam, "upcoming");
    expect(after?.stillComingAt).toEqual(NOW);
  });

  it("changes nothing more than a day before, after the start, on a cancelled booking or session, or on someone else's", async () => {
    const t = await setup();
    const jo = await t.f.worker({ first: "Jo" });
    const tooEarly = await t.f.shift({ startsAt: hoursFromNow(STILL_COMING_HOURS + 1) });
    const started = await t.f.shift({ startsAt: hoursFromNow(-1) });
    const cancelledBooking = await t.f.shift({ startsAt: hoursFromNow(5) });
    const cancelledSession = await t.f.shift({ startsAt: hoursFromNow(6), status: "cancelled" });
    const offered = await t.f.shift({ startsAt: hoursFromNow(7) });
    const jos = await t.f.shift({ startsAt: hoursFromNow(8) });
    const bookings = [
      await t.f.booking(t.sam, tooEarly),
      await t.f.booking(t.sam, started),
      await t.f.booking(t.sam, cancelledBooking, "cancelled_worker"),
      await t.f.booking(t.sam, cancelledSession),
      await t.f.booking(t.sam, offered, "offered"),
      await t.f.booking(jo, jos),
    ];
    for (const shift of [tooEarly, started, cancelledBooking, cancelledSession, offered, jos]) {
      expect(await confirmStillComing(t.ctx(), t.sam, shift)).toEqual({ status: "not_now" });
    }
    // Exactly at the edge: a session starting in exactly a day is within it.
    const edge = await t.f.shift({ startsAt: hoursFromNow(STILL_COMING_HOURS) });
    await t.f.booking(t.sam, edge);
    expect(await confirmStillComing(t.ctx(), t.sam, edge)).toMatchObject({ status: "confirmed" });

    for (const b of bookings) expect(await t.said(b)).toBeNull();
    expect(await t.logged()).toHaveLength(1);
    // Not an id at all: nothing to look up.
    expect(await confirmStillComing(t.ctx(), t.sam, "not-an-id")).toEqual({ status: "not_now" });
  });

  it("two taps at once: one confirmed, one already, one event", async () => {
    const t = await setup();
    const shift = await t.f.shift({ startsAt: hoursFromNow(3) });
    const booking = await t.f.booking(t.sam, shift);
    const results = await race(2, t.f.firmId, (tx) =>
      confirmStillComing(
        { firm: { id: t.f.firmId }, ...at(NOW), run: (_f, fn) => fn(tx) },
        t.sam,
        shift,
      ),
    );
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : "failed"));
    expect(statuses.sort()).toEqual(["already", "confirmed"]);
    expect(await t.said(booking)).toEqual(NOW);
    expect(await t.logged()).toHaveLength(1);
  });

  it("another firm's casual or session changes nothing", async () => {
    const a = await setup();
    const b = await setup();
    const theirs = await b.f.shift({ startsAt: hoursFromNow(4) });
    const booking = await b.f.booking(b.sam, theirs);
    // Firm A's session, firm B's casual and session ids: RLS hides them.
    expect(await confirmStillComing(a.ctx(), b.sam, theirs)).toEqual({ status: "not_now" });
    expect(await b.said(booking)).toBeNull();
    expect(await a.logged()).toEqual([]);
    expect(await b.logged()).toEqual([]);
  });
});

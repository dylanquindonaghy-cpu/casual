import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking, type CancelRequest } from "@/lib/roster/cancel";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// cancelBooking(), the one path for people cancelling a booking, on the real database as the app
// role: who may cancel whom, the evidence stored on the row (golden rule 12) and the
// shift.cancelled event with the notice hours (golden rule 5).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const at = (d: Date) => ({ now: () => d });

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const cancel = (f: BookingFirm, request: CancelRequest, when = NOW, run: WithFirm = withFirm) =>
  cancelBooking(run, f.firmId, request, { clock: at(when) });
const byWorker = (shiftId: string, workerId: string, reason = "Unwell"): CancelRequest => ({
  shiftId,
  workerId,
  reason,
  by: { type: "worker", id: workerId },
});

const rowsOf = async (shiftId: string) =>
  (
    await su.query(
      `select slot, worker_id::text as "workerId", status, cancel_reason as reason,
              notice_hours::float as "noticeHours", cancelled_at as "cancelledAt"
         from assignments where shift_id = $1 order by created_at, slot`,
      [shiftId],
    )
  ).rows;
const cancelledEvents = async (firmId: string) =>
  (
    await su.query(
      `select actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action = 'shift.cancelled' order by id`,
      [firmId],
    )
  ).rows;
const shiftStatus = async (shiftId: string) =>
  (await su.query("select status from shifts where id = $1", [shiftId])).rows[0]?.status;

describe("cancelBooking: a worker cancelling", () => {
  it("frees the place, keeps the evidence on the row and logs the notice hours", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    const assignmentId = await f.booking(sam, shiftId);
    await su.query("update shifts set status = 'filled' where id = $1", [shiftId]);

    expect(await cancel(f, byWorker(shiftId, sam, "Car broke down"))).toEqual({
      status: "cancelled",
      assignmentId,
      noticeHours: 48,
    });
    expect(await rowsOf(shiftId)).toEqual([
      {
        slot: 1,
        workerId: sam,
        status: "cancelled_worker",
        reason: "Car broke down",
        noticeHours: 48,
        cancelledAt: NOW,
      },
      // The place is open again for someone else.
      {
        slot: 1,
        workerId: null,
        status: "open",
        reason: null,
        noticeHours: null,
        cancelledAt: null,
      },
    ]);
    expect(await shiftStatus(shiftId)).toBe("open");
    expect(await cancelledEvents(f.firmId)).toEqual([
      {
        actor_type: "worker",
        actor_id: sam,
        entity_id: assignmentId,
        // The reason is on the row above; the append-only log never holds typed text.
        data: { by: "worker", shiftId, workerId: sam, noticeHours: 48 },
      },
    ]);

    // And the freed place can be taken again.
    const jo = await f.worker({ first: "Jo" });
    expect(
      await bookShift(
        withFirm,
        f.firmId,
        { shiftId, workerId: jo, by: { type: "worker", id: jo } },
        {
          clock: at(NOW),
        },
      ),
    ).toMatchObject({ status: "booked", slot: 1 });
  });

  it("counts notice to the minute: 30 minutes before the start is 0.5 hours", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(10) });
    await f.booking(sam, shiftId);
    const late = new Date(NOW.getTime() + 9.5 * HOUR);
    expect(await cancel(f, byWorker(shiftId, sam), late)).toMatchObject({ noticeHours: 0.5 });
    expect((await cancelledEvents(f.firmId))[0]?.data).toMatchObject({ noticeHours: 0.5 });
  });

  it("can't cancel someone else's booking, or a shift that has started", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(24) });
    await f.booking(sam, shiftId);
    await expect(
      cancel(f, { shiftId, workerId: sam, reason: "Mischief", by: { type: "worker", id: jo } }),
    ).rejects.toThrow("a worker can only cancel their own booking");
    const started = new Date(NOW.getTime() + 25 * HOUR);
    expect(await cancel(f, byWorker(shiftId, sam), started)).toEqual({ status: "started" });
    expect((await rowsOf(shiftId)).map((r) => r.status)).toEqual(["confirmed"]);
    expect(await cancelledEvents(f.firmId)).toEqual([]);
  });

  it("needs a reason, and reports what isn't there", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const sam = await mine.worker();
    const shiftId = await mine.shift();
    await expect(cancel(mine, byWorker(shiftId, sam, "   "))).rejects.toThrow();
    expect(await cancel(mine, byWorker(shiftId, sam))).toEqual({ status: "not_assigned" });
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect(await cancel(mine, byWorker(unknown, sam))).toEqual({ status: "not_found" });
    // Another firm's booking is out of reach, and stays as it was.
    const kit = await theirs.worker();
    const theirShift = await theirs.shift();
    await theirs.booking(kit, theirShift);
    expect(await cancel(mine, byWorker(theirShift, kit))).toEqual({ status: "not_found" });
    expect((await rowsOf(theirShift)).map((r) => r.status)).toEqual(["confirmed"]);
  });

  it("is always recorded, whatever the reason says; the reason stays on the row, never in the log", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    await f.booking(sam, shiftId);
    const reason = "My son Tom is in hospital, call me on 07700 900123";
    expect(await cancel(f, byWorker(shiftId, sam, reason))).toMatchObject({
      status: "cancelled",
    });
    expect((await rowsOf(shiftId))[0]).toMatchObject({ reason });
    const { rows } = await su.query("select data::text from events where firm_id = $1", [f.firmId]);
    expect(rows.map((r) => r.data).join(" ")).not.toMatch(/Tom|hospital|900123/);
  });

  it("needs no fresh copy of a firm's sheet: a Sheets shift's cancellation counts at once", async () => {
    const f = await bookingFirm(su, withFirm);
    await f.sheetSource(null); // never synced
    const sam = await f.worker();
    const shiftId = await f.shift({ source: "sheets" });
    await f.booking(sam, shiftId);
    expect(await cancel(f, byWorker(shiftId, sam))).toMatchObject({ status: "cancelled" });
  });
});

describe("cancelBooking: the office cancelling", () => {
  it("records it as the firm's, with the office user, reason and notice hours", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const assignmentId = await f.booking(sam, shiftId);
    const request: CancelRequest = {
      shiftId,
      workerId: sam,
      reason: "Client reduced numbers",
      by: { type: "office", id: resourcer },
    };
    expect(await cancel(f, request)).toEqual({
      status: "cancelled",
      assignmentId,
      noticeHours: 30,
    });
    expect((await rowsOf(shiftId))[0]).toMatchObject({
      status: "cancelled_firm",
      reason: "Client reduced numbers",
      noticeHours: 30,
    });
    expect(await cancelledEvents(f.firmId)).toEqual([
      {
        actor_type: "office",
        actor_id: resourcer,
        entity_id: assignmentId,
        data: {
          by: "firm",
          shiftId,
          workerId: sam,
          noticeHours: 30,
        },
      },
    ]);
  });

  it("can cancel once the shift has started (negative notice), without reopening the place", async () => {
    const f = await bookingFirm(su, withFirm);
    const admin = await f.office("admin");
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(1) }); // 8 hours long
    await f.booking(sam, shiftId);
    await su.query("update shifts set status = 'filled' where id = $1", [shiftId]);
    const threeHoursLater = new Date(NOW.getTime() + 3 * HOUR);
    const office = (reason: string) =>
      ({ shiftId, workerId: sam, reason, by: { type: "office", id: admin } }) as const;
    // Rang in two hours after the start to say they couldn't come.
    expect(await cancel(f, office("Rang in, couldn't come"), threeHoursLater)).toMatchObject({
      status: "cancelled",
      noticeHours: -2,
    });
    // History: nobody can take the place now, so it isn't reopened, and the shift stays as it was.
    expect((await rowsOf(shiftId)).map((r) => r.status)).toEqual(["cancelled_firm"]);
    expect(await shiftStatus(shiftId)).toBe("filled");
  });

  it("can't cancel once the shift has ended (a no-show or completed shift is Phase 5)", async () => {
    const f = await bookingFirm(su, withFirm);
    const admin = await f.office("admin");
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(-30) }); // ended 22 hours ago
    await f.booking(sam, shiftId);
    expect(
      await cancel(f, {
        shiftId,
        workerId: sam,
        reason: "Tidy up",
        by: { type: "office", id: admin },
      }),
    ).toEqual({ status: "ended" });
    expect((await rowsOf(shiftId)).map((r) => r.status)).toEqual(["confirmed"]);
    expect(await cancelledEvents(f.firmId)).toEqual([]);
  });

  it("only active admins and resourcers can cancel staff", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    await f.booking(sam, shiftId);
    const other = await bookingFirm(su, withFirm);
    for (const officeUser of [
      await f.office("payroll"),
      await f.office("admin", "disabled"),
      await other.office("admin"),
    ]) {
      expect(
        await cancel(f, {
          shiftId,
          workerId: sam,
          reason: "No",
          by: { type: "office", id: officeUser },
        }),
      ).toEqual({ status: "not_allowed" });
    }
    expect((await rowsOf(shiftId)).map((r) => r.status)).toEqual(["confirmed"]);
  });
});

describe("cancelBooking: retries", () => {
  it("runs the whole cancellation again after a deadlock", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    await f.booking(sam, shiftId);
    let calls = 0;
    const flaky: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(Object.assign(new Error("deadlock detected"), { code: "40P01" }));
      }
      return withFirm(firmId, fn);
    };
    expect(await cancel(f, byWorker(shiftId, sam), NOW, flaky)).toMatchObject({
      status: "cancelled",
    });
    expect(calls).toBe(2);
    expect(await cancelledEvents(f.firmId)).toHaveLength(1);
  });
});

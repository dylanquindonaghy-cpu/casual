import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { cancelBooking } from "@/lib/roster/cancel";
import { setShiftUrgent } from "@/lib/roster/urgent";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The urgent flag on the real database, as the app role: marked automatically when a dropout
// reopens a place inside the firm's urgent window, and by the office by hand. NOW is Monday 2
// November 2026, 09:00.

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

const at = (when: Date) => ({ clock: { now: () => when } });
const urgent = async (shiftId: string) =>
  (await su.query("select is_urgent from shifts where id = $1", [shiftId])).rows[0]?.is_urgent;
const urgentEvents = async (firmId: string) =>
  (
    await su.query(
      `select actor_type, actor_id::text, action, entity_id::text, data from events
        where firm_id = $1 and action in ('shift.marked_urgent', 'shift.urgent_cleared') order by id`,
      [firmId],
    )
  ).rows;
const workerCancels = (f: BookingFirm, shiftId: string, workerId: string, when = NOW) =>
  cancelBooking(
    withFirm,
    f.firmId,
    { shiftId, workerId, reason: "I'm unwell", by: { type: "worker", id: workerId } },
    at(when),
  );

describe("marked urgent automatically when a dropout lands inside the window", () => {
  it("a worker's cancellation 10 hours before the start (window 24): urgent, logged as the system's", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(10) });
    await f.booking(sam, shiftId);
    expect((await workerCancels(f, shiftId, sam)).status).toBe("cancelled");
    expect(await urgent(shiftId)).toBe(true);
    expect(await urgentEvents(f.firmId)).toEqual([
      {
        actor_type: "system",
        actor_id: null,
        action: "shift.marked_urgent",
        entity_id: shiftId,
        data: { by: "system", cause: "dropout", hoursToStart: 10 },
      },
    ]);
  });

  it("30 hours before (outside the window): not urgent, nothing logged", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    await f.booking(sam, shiftId);
    await workerCancels(f, shiftId, sam);
    expect(await urgent(shiftId)).toBe(false);
    expect(await urgentEvents(f.firmId)).toEqual([]);
  });

  it("uses the firm's own window", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { urgent_window_hours: 12 } });
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const outside = await f.shift({ startsAt: hoursFromNow(20) });
    const inside = await f.shift({ startsAt: hoursFromNow(40), hours: 4 });
    await f.booking(sam, outside);
    await f.booking(jo, inside);
    await workerCancels(f, outside, sam);
    await workerCancels(f, inside, jo, hoursFromNow(30)); // 10 hours before
    expect([await urgent(outside), await urgent(inside)]).toEqual([false, true]);
  });

  it("a window setting that makes no sense uses 24 hours, and the cancellation still goes through", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { urgent_window_hours: "soon" } });
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(10) });
    await f.booking(sam, shiftId);
    expect((await workerCancels(f, shiftId, sam)).status).toBe("cancelled");
    expect(await urgent(shiftId)).toBe(true);
  });

  it("the office's cancellation counts too, and one place freed on a larger shift is enough", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(6), headcount: 2, status: "filled" });
    await f.booking(sam, shiftId, "confirmed", 1);
    await f.booking(jo, shiftId, "confirmed", 2);
    const result = await cancelBooking(
      withFirm,
      f.firmId,
      {
        shiftId,
        workerId: jo,
        reason: "Venue asked for fewer staff",
        by: { type: "office", id: resourcer },
      },
      at(NOW),
    );
    expect(result.status).toBe("cancelled");
    expect(await urgent(shiftId)).toBe(true);
    expect((await urgentEvents(f.firmId))[0]?.data).toEqual({
      by: "system",
      cause: "dropout",
      hoursToStart: 6,
    });
  });

  it("an already urgent shift isn't marked again", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(8), headcount: 2 });
    await f.booking(sam, shiftId, "confirmed", 1);
    await f.booking(jo, shiftId, "confirmed", 2);
    await workerCancels(f, shiftId, sam);
    await workerCancels(f, shiftId, jo);
    expect(await urgentEvents(f.firmId)).toHaveLength(1);
  });

  it("the office cancelling after the start reopens nothing, so nothing is urgent", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(-1), status: "filled" });
    await f.booking(sam, shiftId);
    const result = await cancelBooking(
      withFirm,
      f.firmId,
      { shiftId, workerId: sam, reason: "Sent home early", by: { type: "office", id: resourcer } },
      at(NOW),
    );
    expect(result.status).toBe("cancelled");
    expect(await urgent(shiftId)).toBe(false);
    expect(await urgentEvents(f.firmId)).toEqual([]);
  });
});

describe("marked or cleared by the office (setShiftUrgent)", () => {
  const set = (f: BookingFirm, shiftId: string, on: boolean, officeId: string, when = NOW) =>
    setShiftUrgent(
      withFirm,
      f.firmId,
      { shiftId, urgent: on, by: { type: "office", id: officeId } },
      at(when),
    );

  it("a resourcer marks and clears it, each logged once, as the firm's", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    expect(await set(f, shiftId, true, resourcer)).toEqual({ status: "marked" });
    expect(await set(f, shiftId, true, resourcer)).toEqual({ status: "unchanged" });
    expect(await urgent(shiftId)).toBe(true);
    expect(await set(f, shiftId, false, resourcer)).toEqual({ status: "cleared" });
    expect(await urgent(shiftId)).toBe(false);
    expect(await urgentEvents(f.firmId)).toEqual([
      {
        actor_type: "office",
        actor_id: resourcer,
        action: "shift.marked_urgent",
        entity_id: shiftId,
        data: { by: "firm", cause: "office", hoursToStart: 48 },
      },
      {
        actor_type: "office",
        actor_id: resourcer,
        action: "shift.urgent_cleared",
        entity_id: shiftId,
        data: { by: "firm" },
      },
    ]);
  });

  it("only active admins and resourcers may", async () => {
    const f = await bookingFirm(su, withFirm);
    const shiftId = await f.shift();
    expect(await set(f, shiftId, true, await f.office("payroll"))).toEqual({
      status: "not_allowed",
    });
    expect(await set(f, shiftId, true, await f.office("resourcer", "disabled"))).toEqual({
      status: "not_allowed",
    });
    expect((await set(f, shiftId, true, await f.office("admin"))).status).toBe("marked");
  });

  it("not on a draft, a cancelled shift or one that has started; clearing always works", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    for (const shiftId of [
      await f.shift({ status: "draft" }),
      await f.shift({ status: "cancelled" }),
    ]) {
      expect(await set(f, shiftId, true, resourcer)).toEqual({ status: "not_open" });
    }
    const running = await f.shift({ startsAt: hoursFromNow(-1) });
    expect(await set(f, running, true, resourcer)).toEqual({ status: "not_open" });
    await su.query("update shifts set is_urgent = true where id = $1", [running]);
    expect(await set(f, running, false, resourcer)).toEqual({ status: "cleared" });
    // An urgent shift later cancelled can still have its flag cleared.
    const called = await f.shift({ status: "cancelled" });
    await su.query("update shifts set is_urgent = true where id = $1", [called]);
    expect(await set(f, called, false, resourcer)).toEqual({ status: "cleared" });
    // A filled shift can still be marked (the office may want cover lined up).
    expect((await set(f, await f.shift({ status: "filled" }), true, resourcer)).status).toBe(
      "marked",
    );
  });

  it("refuses a request that isn't exactly the right shape", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const shiftId = await f.shift();
    await expect(
      setShiftUrgent(withFirm, f.firmId, {
        shiftId,
        urgent: "false" as unknown as boolean,
        by: { type: "office", id: resourcer },
      }),
    ).rejects.toThrow();
    await expect(
      setShiftUrgent(withFirm, f.firmId, {
        shiftId,
        urgent: true,
        by: { type: "worker" as "office", id: resourcer },
      }),
    ).rejects.toThrow();
    expect(await urgent(shiftId)).toBe(false);
  });

  it("never touches another firm's shift", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const theirs = await other.shift();
    expect(await set(f, theirs, true, resourcer)).toEqual({ status: "not_found" });
    expect(await set(f, "not-a-shift", true, resourcer)).toEqual({ status: "not_found" });
    expect(await urgent(theirs)).toBe(false);
  });
});

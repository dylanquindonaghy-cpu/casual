import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookShift, SHEET_COPY_FRESH_MS, type BookingRequest } from "@/lib/roster/book";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// bookShift(), the one booking path, on the real database as the app role: who may book whom,
// the rules on the current rows, the live-source check, first yes wins, and the action log.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;
const clock = { now: () => NOW };

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(4);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const book = (f: BookingFirm, request: BookingRequest, run: WithFirm = withFirm) =>
  bookShift(run, f.firmId, request, { clock });
const asWorker = (shiftId: string, workerId: string): BookingRequest => ({
  shiftId,
  workerId,
  by: { type: "worker", id: workerId },
});

const liveRows = async (shiftId: string) =>
  (
    await su.query(
      `select slot, worker_id::text as "workerId", status from assignments
        where shift_id = $1 and status not in ('cancelled_worker', 'cancelled_firm') order by slot`,
      [shiftId],
    )
  ).rows;
const shiftStatus = async (shiftId: string) =>
  (await su.query("select status from shifts where id = $1", [shiftId])).rows[0]?.status;
const assignedEvents = async (firmId: string) =>
  (
    await su.query(
      `select actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action = 'shift.assigned' order by id`,
      [firmId],
    )
  ).rows;

describe("bookShift: a worker taking a shift", () => {
  it("books an eligible worker into the free slot, fills the shift and logs it", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    const result = await book(f, asWorker(shiftId, sam));
    expect(result).toEqual({
      status: "booked",
      assignmentId: expect.any(String),
      slot: 1,
      overridden: [],
    });
    expect(await liveRows(shiftId)).toEqual([{ slot: 1, workerId: sam, status: "confirmed" }]);
    expect(await shiftStatus(shiftId)).toBe("filled");
    expect(await assignedEvents(f.firmId)).toEqual([
      {
        actor_type: "worker",
        actor_id: sam,
        entity_id: result.status === "booked" ? result.assignmentId : "",
        data: { by: "worker", shiftId, workerId: sam, slot: 1, noticeHours: 48 },
      },
    ]);
  });

  it("refuses a worker the rules turn down, says why, and changes nothing", async () => {
    const f = await bookingFirm(su, withFirm);
    const expired = await f.worker({
      credentials: [{ type: "SIA_DS", expiresOn: "2026-10-31" }],
    });
    const shiftId = await f.shift({ role: "door_supervisor" });
    expect(await book(f, asWorker(shiftId, expired))).toEqual({
      status: "not_eligible",
      reasons: [
        "Your SIA door supervisor licence expired on 31 Oct. Renew it, then send the new number to the office.",
      ],
      codes: ["credential_expired"],
    });
    expect((await liveRows(shiftId)).filter((r) => r.workerId !== null)).toEqual([]);
    expect(await assignedEvents(f.firmId)).toEqual([]);
    // The refusal is logged (golden rule 5: every credential check), with codes, never reasons.
    const { rows } = await su.query(
      `select actor_type, actor_id::text, entity_id::text, data from events
        where firm_id = $1 and action = 'shift.booking_refused'`,
      [f.firmId],
    );
    expect(rows).toEqual([
      {
        actor_type: "worker",
        actor_id: expired,
        entity_id: shiftId,
        data: { by: "worker", workerId: expired, codes: ["credential_expired"] },
      },
    ]);
  });

  it("takes ids in any letter case (they're matched as the database writes them)", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    const upper = sam.toUpperCase();
    expect(
      await book(f, {
        shiftId: shiftId.toUpperCase(),
        workerId: upper,
        by: { type: "worker", id: upper },
      }),
    ).toMatchObject({ status: "booked" });
    expect(await liveRows(shiftId)).toEqual([{ slot: 1, workerId: sam, status: "confirmed" }]);
  });

  it("decides on the rows as they are now, not as they were when the page was shown", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    // Booked elsewhere at the same time since the open-shifts page loaded.
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(46) }));
    expect(await book(f, asWorker(shiftId, sam))).toMatchObject({
      status: "not_eligible",
      codes: ["overlap"],
    });
    // Suspended since: refused too.
    const jo = await f.worker({ first: "Jo" });
    await su.query("update credentials set status = 'suspended' where worker_id = $1", [jo]);
    expect(await book(f, asWorker(shiftId, jo))).toMatchObject({ status: "not_eligible" });
  });

  it("first yes wins: the next person is told it's filled; the same person is told they're on it", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const shiftId = await f.shift();
    expect((await book(f, asWorker(shiftId, sam))).status).toBe("booked");
    expect(await book(f, asWorker(shiftId, jo))).toEqual({ status: "filled" });
    // Sam asks again: the rules see Sam's own booking of this shift as no clash; the plug says so.
    expect(await book(f, asWorker(shiftId, sam))).toEqual({ status: "already_assigned" });
    expect(await assignedEvents(f.firmId)).toHaveLength(1);
  });

  it("reports a draft or cancelled shift as not open, and unknown or other firms' ids as not found", async () => {
    const mine = await bookingFirm(su, withFirm);
    const theirs = await bookingFirm(su, withFirm);
    const sam = await mine.worker();
    const draft = await mine.shift({ status: "draft" });
    expect(await book(mine, asWorker(draft, sam))).toEqual({ status: "not_open" });
    const theirShift = await theirs.shift();
    expect(await book(mine, asWorker(theirShift, sam))).toEqual({ status: "not_found" });
    expect(await liveRows(theirShift)).toEqual([]);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect(await book(mine, asWorker(unknown, sam))).toEqual({ status: "not_found" });
  });

  it("lets a worker book only themselves, and never with overrides", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    const shiftId = await f.shift();
    await expect(
      book(f, { shiftId, workerId: jo, by: { type: "worker", id: sam } }),
    ).rejects.toThrow("a worker can only book themselves");
    await expect(
      book(f, {
        shiftId,
        workerId: sam,
        by: { type: "worker", id: sam, overrides: ["rest"] } as unknown as BookingRequest["by"],
      }),
    ).rejects.toThrow();
    expect(await liveRows(shiftId)).toEqual([]);
  });
});

describe("bookShift: the office placing someone", () => {
  it("overrides rest with a reason, and the log records both", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const sam = await f.worker();
    // A shift ending 4 hours before this one starts: too little rest.
    await f.booking(sam, await f.shift({ startsAt: hoursFromNow(36) }));
    const shiftId = await f.shift({ startsAt: hoursFromNow(48) });
    const office = (overrides: ("rest" | "weekly_hours")[], reason?: string): BookingRequest => ({
      shiftId,
      workerId: sam,
      by: { type: "office", id: resourcer, overrides, ...(reason ? { reason } : {}) },
    });
    expect(await book(f, office([]))).toMatchObject({ status: "not_eligible", codes: ["rest"] });
    expect(await book(f, office(["rest"]))).toEqual({ status: "invalid_reason" });
    const result = await book(f, office(["rest"], "Late cover agreed with the worker"));
    expect(result).toMatchObject({ status: "booked", overridden: ["rest"] });
    expect(await assignedEvents(f.firmId)).toEqual([
      {
        actor_type: "office",
        actor_id: resourcer,
        entity_id: result.status === "booked" ? result.assignmentId : "",
        data: {
          by: "firm",
          shiftId,
          workerId: sam,
          slot: 1,
          noticeHours: 48,
          overridden: ["rest"],
          reason: "Late cover agreed with the worker",
        },
      },
    ]);
  });

  it("never overrides a credential, and refuses a reason holding contact details", async () => {
    const f = await bookingFirm(su, withFirm);
    const admin = await f.office("admin");
    const noLicence = await f.worker({ credentials: [] });
    const shiftId = await f.shift({ role: "door_supervisor" });
    await expect(
      book(f, {
        shiftId,
        workerId: noLicence,
        by: {
          type: "office",
          id: admin,
          overrides: ["credential_missing"] as unknown as "rest"[],
          reason: "Trust me",
        },
      }),
    ).rejects.toThrow();
    expect(
      await book(f, {
        shiftId,
        workerId: noLicence,
        by: { type: "office", id: admin, overrides: ["rest"], reason: "Call Sam on 07700 900123" },
      }),
    ).toEqual({ status: "invalid_reason" });
    expect(
      await book(f, { shiftId, workerId: noLicence, by: { type: "office", id: admin } }),
    ).toMatchObject({ status: "not_eligible", codes: ["credential_missing"] });
  });

  it("only active admins and resourcers can place staff", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    for (const officeUser of [await f.office("payroll"), await f.office("admin", "disabled")]) {
      expect(
        await book(f, { shiftId, workerId: sam, by: { type: "office", id: officeUser } }),
      ).toEqual({ status: "not_allowed" });
    }
    const other = await bookingFirm(su, withFirm);
    const theirAdmin = await other.office("admin");
    expect(
      await book(f, { shiftId, workerId: sam, by: { type: "office", id: theirAdmin } }),
    ).toEqual({ status: "not_allowed" });
    expect(await liveRows(shiftId)).toEqual([]);
  });
});

describe("bookShift: re-checking the live source", () => {
  it("books a Sheets shift only while the copy of the sheet is fresh", async () => {
    const fresh = await bookingFirm(su, withFirm);
    await fresh.sheetSource(new Date(NOW.getTime() - SHEET_COPY_FRESH_MS));
    const sam = await fresh.worker();
    const sheetShift = await fresh.shift({ source: "sheets" });
    expect((await book(fresh, asWorker(sheetShift, sam))).status).toBe("booked");

    const cases: [string, Date | null, boolean][] = [
      ["last synced 21 minutes ago", new Date(NOW.getTime() - SHEET_COPY_FRESH_MS - MINUTE), true],
      ["never synced", null, true],
      [
        "synced a minute ago, but the source is switched off",
        new Date(NOW.getTime() - MINUTE),
        false,
      ],
    ];
    for (const [, syncedAt, enabled] of cases) {
      const f = await bookingFirm(su, withFirm);
      await f.sheetSource(syncedAt, enabled);
      const jo = await f.worker();
      const shiftId = await f.shift({ source: "sheets" });
      expect(await book(f, asWorker(shiftId, jo))).toEqual({ status: "source_stale" });
      expect(await liveRows(shiftId)).toEqual([]);
      // Our own and imported shifts don't depend on the sheet.
      expect((await book(f, asWorker(await f.shift(), jo))).status).toBe("booked");
      expect(
        (await book(f, asWorker(await f.shift({ source: "csv", startsAt: hoursFromNow(100) }), jo)))
          .status,
      ).toBe("booked");
    }
  });

  it("tells an ineligible worker why first, even when the sheet copy is stale", async () => {
    const f = await bookingFirm(su, withFirm);
    await f.sheetSource(null);
    const noLicence = await f.worker({ credentials: [] });
    const shiftId = await f.shift({ source: "sheets" });
    expect(await book(f, asWorker(shiftId, noLicence))).toMatchObject({
      status: "not_eligible",
    });
  });
});

describe("bookShift: retries", () => {
  const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });

  it("runs the whole booking again after a deadlock, at most three times in all", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shiftId = await f.shift();
    let calls = 0;
    const flaky: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 1) return Promise.reject(deadlock());
      return withFirm(firmId, fn);
    };
    expect((await book(f, asWorker(shiftId, sam), flaky)).status).toBe("booked");
    expect(calls).toBe(2);

    let tries = 0;
    const alwaysDeadlocked: WithFirm = () => {
      tries += 1;
      return Promise.reject(deadlock());
    };
    await expect(book(f, asWorker(await f.shift(), sam), alwaysDeadlocked)).rejects.toThrow(
      "deadlock detected",
    );
    expect(tries).toBe(3);

    let once = 0;
    const broken: WithFirm = () => {
      once += 1;
      return Promise.reject(new Error("something else"));
    };
    await expect(book(f, asWorker(await f.shift(), sam), broken)).rejects.toThrow("something else");
    expect(once).toBe(1);
  });
});

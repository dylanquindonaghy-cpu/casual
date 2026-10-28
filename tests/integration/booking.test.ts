import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookShift, SHEET_COPY_FRESH_MS, type BookingRequest } from "@/lib/roster/book";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, ownerPool, superuserPool } from "../helpers/db";

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
  it("overrides rest with a reason: the log records the override, the booking keeps the words", async () => {
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
          // The office's words are about a person: never in the append-only log (audit L23, L85).
          reasonGiven: true,
          // A message tells them they're booked (Phase 10 task 19).
          bookingMessage: true,
        },
      },
    ]);
    const { rows } = await su.query("select override_reason from assignments where id = $1", [
      result.status === "booked" ? result.assignmentId : "",
    ]);
    expect(rows).toEqual([{ override_reason: "Late cover agreed with the worker" }]);
    const { rows: logged } = await su.query<{ n: number }>(
      "select count(*)::int as n from events where firm_id = $1 and data::text like '%Late cover%'",
      [f.firmId],
    );
    expect(logged[0]?.n).toBe(0);
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

// P2.2: every booking says where it was made, so "who sends what" (P2.3) can leave the firm's own
// system to tell its casuals about its bookings.
describe("where a booking was made (booked_via)", () => {
  const bookedVia = async (assignmentId: string) =>
    (await su.query("select booked_via from assignments where id = $1", [assignmentId])).rows[0]
      ?.booked_via;

  it("a casual's own take is the app's; the office's placing is the office's", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const sam = await f.worker();
    const ann = await f.worker();
    const own = await book(f, asWorker(await f.shift(), sam));
    const placed = await book(f, {
      shiftId: await f.shift(),
      workerId: ann,
      by: { type: "office", id: resourcer },
    });
    if (own.status !== "booked" || placed.status !== "booked") throw new Error("not booked");
    expect(await bookedVia(own.assignmentId)).toBe("app");
    expect(await bookedVia(placed.assignmentId)).toBe("office");
  });

  it("only app, office, sheet or api", async () => {
    const f = await bookingFirm(su, withFirm);
    const id = await f.booking(await f.worker(), await f.shift());
    for (const via of ["app", "office", "sheet", "api"]) {
      await su.query("update assignments set booked_via = $2 where id = $1", [id, via]);
      expect(await bookedVia(id)).toBe(via);
    }
    await expect(
      su.query("update assignments set booked_via = 'planner' where id = $1", [id]),
    ).rejects.toThrow(/assignments_booked_via_check/);
  });

  it("the migration fills the bookings there were, firm by firm, from their shift.assigned lines", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const assigned = async (firmId: string, assignmentId: string, data: object) =>
      su.query(
        `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
         values ($1, 'system', 'shift.assigned', 'assignment', $2, $3)`,
        [firmId, assignmentId, JSON.stringify(data)],
      );
    const own = await f.booking(sam, await f.shift());
    await assigned(f.firmId, own, { by: "worker" });
    const sheet = await f.booking(sam, await f.shift());
    await assigned(f.firmId, sheet, { by: "firm", source: "sheets" });
    const office = await f.booking(sam, await f.shift());
    await assigned(f.firmId, office, { by: "firm" });
    const noLine = await f.booking(sam, await f.shift());
    // Already said: left as it is.
    const said = await f.booking(sam, await f.shift());
    await assigned(f.firmId, said, { by: "worker" });
    await su.query("update assignments set booked_via = 'office' where id = $1", [said]);
    // An open slot: nobody's booking.
    const { rows: open } = await su.query<{ id: string }>(
      `insert into assignments (firm_id, shift_id, slot, status) values ($1, $2, 2, 'open')
       returning id::text as id`,
      [f.firmId, await f.shift({ headcount: 2 })],
    );
    // Another firm's, filled in its own pass from its own line.
    const theirs = await other.booking(await other.worker(), await other.shift());
    await assigned(other.firmId, theirs, { by: "worker" });

    // The migration's own statement, as db:migrate runs it: the owner, with RLS forced.
    const migration = readFileSync("drizzle/0049_booking_source.sql", "utf8");
    const backfill = migration.slice(migration.indexOf("DO $$"));
    expect(backfill.startsWith("DO $$")).toBe(true);
    const owner = ownerPool(1);
    try {
      await owner.query(backfill);
    } finally {
      await owner.end();
    }
    expect(
      await Promise.all(
        [own, sheet, office, noLine, said, open[0]?.id ?? "", theirs].map(bookedVia),
      ),
    ).toEqual(["app", "sheet", "office", "office", "office", null, "app"]);
  });
});

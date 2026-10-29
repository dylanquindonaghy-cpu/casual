import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadNoticeReport, parseNoticeQuery } from "@/lib/office/notice-report";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking, cancelShiftByFirm } from "@/lib/roster/cancel";
import { nativeRosterPlug } from "@/lib/roster/native";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Who asked for a cancellation (P3.4), recorded apart from who carried it out: the casual's own
// cancel says the casual; the office's says the firm; a rota sheet's, a file's or a planner's say
// not known (their data doesn't say); migration 0053 gave every earlier cancellation its value from
// its own record. The notice report counts cancellations by who asked. And the firm's strikes
// switch: off, a casual's own cancellation is never a strike. On the real database as the app role.

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

const at = (d: Date) => ({ clock: { now: () => d } });
const askedOf = async (assignmentId: string) =>
  (
    await su.query<{ status: string; cancel_via: string | null; cancel_asked_by: string | null }>(
      "select status, cancel_via, cancel_asked_by from assignments where id = $1",
      [assignmentId],
    )
  ).rows[0];

async function bookedFirm(opts: { settings?: Record<string, unknown> } = {}) {
  const f = await bookingFirm(su, withFirm, opts);
  const resourcer = await f.office("resourcer");
  // A booked casual on a shift two days away (a casual's own cancellation then: under 48 hours'
  // notice, a strike while strikes are on).
  const booked = async (hours = 40) => {
    const workerId = await f.worker();
    const shiftId = await f.shift({ startsAt: hoursFromNow(hours) });
    // Taken by the casual through the rules, as in the app (so her own late cancellation is a
    // strike while strikes are on).
    const result = await bookShift(
      withFirm,
      f.firmId,
      { shiftId, workerId, by: { type: "worker", id: workerId } },
      at(NOW),
    );
    if (result.status !== "booked") throw new Error(`not booked: ${result.status}`);
    return { workerId, shiftId, assignmentId: result.assignmentId };
  };
  return { f, resourcer, booked };
}

describe("each way a booking is cancelled says who asked", () => {
  it("the casual's own: the casual; the office's: the firm", async () => {
    const t = await bookedFirm();
    const own = await t.booked();
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: own.shiftId,
          workerId: own.workerId,
          reason: "Travel problem",
          by: { type: "worker", id: own.workerId, warning: { kind: "strike", version: "v1" } },
        },
        at(NOW),
      ),
    ).toMatchObject({ status: "cancelled" });
    expect(await askedOf(own.assignmentId)).toEqual({
      status: "cancelled_worker",
      cancel_via: "app",
      cancel_asked_by: "casual",
    });
    const office = await t.booked();
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: office.shiftId,
          workerId: office.workerId,
          reason: "Event cancelled",
          by: { type: "office", id: t.resourcer },
        },
        at(NOW),
      ),
    ).toMatchObject({ status: "cancelled" });
    expect(await askedOf(office.assignmentId)).toEqual({
      status: "cancelled_firm",
      cancel_via: "office",
      cancel_asked_by: "firm",
    });
    // The office cancelling the whole session: the firm, for each booking.
    const session = await t.booked();
    expect(
      await cancelShiftByFirm(
        withFirm,
        t.f.firmId,
        {
          shiftId: session.shiftId,
          reason: "event_cancelled",
          by: { type: "office", id: t.resourcer },
        },
        at(NOW),
      ),
    ).toMatchObject({ status: "cancelled", bookings: 1 });
    expect((await askedOf(session.assignmentId))?.cancel_asked_by).toBe("firm");
    // The log says it too, as evidence the booking's row can't rewrite.
    const { rows } = await su.query(
      "select data ->> 'askedBy' as asked from events where firm_id = $1 and action = 'shift.cancelled' order by id",
      [t.f.firmId],
    );
    expect(rows.map((r) => r.asked)).toEqual(["casual", "firm", "firm"]);
  });

  it("a rota sheet's, a file's or a planner's: not known; a caller that knows says so", async () => {
    const t = await bookedFirm();
    const cancel = (
      b: { shiftId: string; workerId: string },
      via: "sheet" | "import" | "api" | "office",
      askedBy?: "client",
    ) =>
      withFirm(t.f.firmId, (tx) =>
        nativeRosterPlug(tx, at(NOW)).markCancelled(b.shiftId, b.workerId, {
          reason: "Removed on the rota sheet",
          by: "firm",
          at: NOW,
          via,
          ...(askedBy ? { askedBy } : {}),
        }),
      );
    for (const via of ["sheet", "import", "api"] as const) {
      const b = await t.booked();
      expect(await cancel(b, via)).toMatchObject({ status: "cancelled" });
      expect(await askedOf(b.assignmentId), via).toEqual({
        status: "cancelled_firm",
        cancel_via: via,
        cancel_asked_by: "unknown",
      });
    }
    const client = await t.booked();
    await cancel(client, "office", "client");
    expect((await askedOf(client.assignmentId))?.cancel_asked_by).toBe("client");
  });

  it("the database refuses a value it doesn't know, or one on a booking that isn't cancelled", async () => {
    const t = await bookedFirm();
    const b = await t.booked();
    for (const [sql, values] of [
      ["update assignments set cancel_asked_by = 'casual' where id = $1", [b.assignmentId]],
      [
        `update assignments set status = 'cancelled_firm', cancelled_at = now(), notice_hours = 1,
                cancel_reason = 'x', cancel_asked_by = 'agency' where id = $1`,
        [b.assignmentId],
      ],
    ] as const) {
      await expect(su.query(sql, [...values]), sql).rejects.toMatchObject({ code: "23514" });
    }
  });
});

describe("cancellations from before (migration 0053's backfill)", () => {
  it("each from its own record: the casual's own, the office's, a sheet's or a planner's session", async () => {
    const t = await bookedFirm();
    const row = async (
      status: "cancelled_worker" | "cancelled_firm",
      via: string | null,
      source = "native",
    ) => {
      const b = await t.booked();
      await su.query(
        `update assignments set status = $2, cancelled_at = now(), notice_hours = 10,
                cancel_reason = 'Unwell', cancel_via = $3, cancel_asked_by = null where id = $1`,
        [b.assignmentId, status, via],
      );
      if (source !== "native") {
        await su.query("update shifts set source = $2, external_ref = $3 where id = $1", [
          b.shiftId,
          source,
          `row-${b.shiftId.slice(0, 8)}`,
        ]);
      }
      return b.assignmentId;
    };
    const ids = {
      own: await row("cancelled_worker", "app"),
      ownOld: await row("cancelled_worker", null),
      office: await row("cancelled_firm", "office"),
      officeOld: await row("cancelled_firm", null),
      sheet: await row("cancelled_firm", "sheet"),
      sheetOld: await row("cancelled_firm", null, "sheets"),
      plannerOld: await row("cancelled_firm", null, "api"),
      file: await row("cancelled_firm", "import"),
    };
    // The migration's own statement, for this firm only.
    const migration = readFileSync("drizzle/0053_cancel_asked_by.sql", "utf8");
    const backfill = migration.slice(migration.lastIndexOf("--> statement-breakpoint") + 24);
    expect(backfill).toContain("FOR f IN SELECT id FROM firms ORDER BY id LOOP");
    await su.query(
      backfill.replace(
        "FOR f IN SELECT id FROM firms ORDER BY id LOOP",
        `FOR f IN SELECT id FROM firms WHERE id = '${t.f.firmId}' LOOP`,
      ),
    );
    const got: Record<string, string | null | undefined> = {};
    for (const [k, id] of Object.entries(ids)) got[k] = (await askedOf(id))?.cancel_asked_by;
    expect(got).toEqual({
      own: "casual",
      ownOld: "casual",
      office: "firm",
      officeOld: "firm",
      sheet: "unknown",
      sheetOld: "unknown",
      plannerOld: "unknown",
      file: "unknown",
    });
  });
});

describe("the notice report", () => {
  it("counts the cancellations it finds by who asked, and says so on each", async () => {
    const t = await bookedFirm();
    const own = await t.booked();
    await cancelBooking(
      withFirm,
      t.f.firmId,
      {
        shiftId: own.shiftId,
        workerId: own.workerId,
        reason: "Travel problem",
        by: { type: "worker", id: own.workerId, warning: { kind: "strike", version: "v1" } },
      },
      at(NOW),
    );
    const office = await t.booked();
    await cancelBooking(
      withFirm,
      t.f.firmId,
      {
        shiftId: office.shiftId,
        workerId: office.workerId,
        reason: "Event cancelled",
        by: { type: "office", id: t.resourcer },
      },
      at(NOW),
    );
    const sheet = await t.booked();
    await withFirm(t.f.firmId, (tx) =>
      nativeRosterPlug(tx, at(NOW)).markCancelled(sheet.shiftId, sheet.workerId, {
        reason: "Removed on the rota sheet",
        by: "firm",
        at: NOW,
        via: "sheet",
      }),
    );
    // The plug alone writes no log line: the sync's own (as it writes it), for the report to find.
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'system', 'shift.cancelled', 'assignment', $2, $3)`,
      [
        t.f.firmId,
        sheet.assignmentId,
        JSON.stringify({
          by: "firm",
          source: "sheets",
          shiftId: sheet.shiftId,
          workerId: sheet.workerId,
        }),
      ],
    );
    // The log's times are the database's own (now): the report from 3 days ago to tomorrow.
    const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const report = await withFirm(t.f.firmId, (tx) =>
      loadNoticeReport(tx, parseNoticeQuery({ from: day(-3), to: day(1) }), new Date()),
    );
    expect(report.askedBy).toEqual({ casual: 1, firm: 1, client: 0, unknown: 1 });
    const cancelled = report.rows.filter((r) => r.kind === "cancelled");
    expect(cancelled.map((r) => [r.initiator, r.askedBy]).sort()).toEqual(
      [
        ["office", "firm"],
        ["rota_sheet", "unknown"],
        ["worker", "casual"],
      ].sort(),
    );
    // Rows that aren't cancellations say nothing about it.
    expect(report.rows.filter((r) => r.kind !== "cancelled").every((r) => r.askedBy === null)).toBe(
      true,
    );
  });
});

describe("the firm's strikes switch", () => {
  it("off: a casual's own late cancellation is no strike (strikes_off), and the warning is the notice one", async () => {
    const t = await bookedFirm({ settings: { strikes: { enabled: false } } });
    const own = await t.booked();
    // Told it would be a strike: the warning has changed (nothing is cancelled).
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: own.shiftId,
          workerId: own.workerId,
          reason: "Travel problem",
          by: { type: "worker", id: own.workerId, warning: { kind: "strike", version: "v1" } },
        },
        at(NOW),
      ),
    ).toEqual({ status: "warning_changed", kind: "notice" });
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: own.shiftId,
          workerId: own.workerId,
          reason: "Travel problem",
          by: { type: "worker", id: own.workerId, warning: { kind: "notice", version: "v1" } },
        },
        at(NOW),
      ),
    ).toMatchObject({ status: "cancelled", strike: null });
    const { rows: strikes } = await su.query("select 1 from strikes where firm_id = $1", [
      t.f.firmId,
    ]);
    expect(strikes).toEqual([]);
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'shift.cancelled'",
      [t.f.firmId],
    );
    expect(rows.map((r) => r.data.strike)).toEqual(["strikes_off"]);
    // On (the default), the same cancellation is a strike.
    const on = await bookedFirm();
    const b = await on.booked();
    expect(
      await cancelBooking(
        withFirm,
        on.f.firmId,
        {
          shiftId: b.shiftId,
          workerId: b.workerId,
          reason: "Travel problem",
          by: { type: "worker", id: b.workerId, warning: { kind: "strike", version: "v1" } },
        },
        at(NOW),
      ),
    ).toMatchObject({ status: "cancelled", strike: { strikeId: expect.any(String) } });
  });
});

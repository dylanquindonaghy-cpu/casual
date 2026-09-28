import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import { syncSheet } from "@/lib/roster/sheets/sync";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { FakeSheets, SHIFT_HEADER, shiftRow, STAFF_HEADER, staffRow } from "../helpers/fake-sheets";

// The notice log is complete (golden rules 5 and 12; the Employment Rights Act evidence in
// docs/compliance.md): through every path that books or cancels (a worker taking a shift, the
// office placing someone, a worker cancelling, the office cancelling, a name added in the firm's
// sheet, a name removed from it), every booking has exactly one shift.assigned event and every
// cancellation exactly one shift.cancelled event, each with its notice hours, and a cancellation's
// notice hours are the ones stored on its row.

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

describe("the notice log", () => {
  it("has one event with notice hours for every booking and every cancellation, by every path", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const worker = () => f.worker();

    // A worker takes a shift, then cancels it; the office places someone, then cancels them.
    const sam = await worker();
    const jo = await worker();
    const shiftA = await f.shift({ startsAt: hoursFromNow(48) });
    const shiftB = await f.shift({ startsAt: hoursFromNow(96) });
    const book = (shiftId: string, workerId: string, by: "worker" | "office", when: Date) =>
      bookShift(
        withFirm,
        f.firmId,
        {
          shiftId,
          workerId,
          by:
            by === "worker" ? { type: "worker", id: workerId } : { type: "office", id: resourcer },
        },
        { clock: at(when) },
      );
    const cancel = (shiftId: string, workerId: string, by: "worker" | "office", when: Date) =>
      cancelBooking(
        withFirm,
        f.firmId,
        {
          shiftId,
          workerId,
          reason: by === "worker" ? "Unwell" : "Client cancelled",
          by:
            by === "worker" ? { type: "worker", id: workerId } : { type: "office", id: resourcer },
        },
        { clock: at(when) },
      );
    expect((await book(shiftA, sam, "worker", NOW)).status).toBe("booked");
    expect((await book(shiftB, jo, "office", NOW)).status).toBe("booked");
    expect((await cancel(shiftA, sam, "worker", hoursFromNow(6))).status).toBe("cancelled");
    expect((await cancel(shiftB, jo, "office", hoursFromNow(12))).status).toBe("cancelled");

    // The firm's sheet: a name added (booked by the sync), then removed (cancelled by the sync).
    const sheetId = `test_${randomUUID().replace(/-/g, "")}`;
    await su.query(
      "insert into roster_sources (firm_id, kind, spreadsheet_id, mapping) values ($1, 'sheets', $2, $3)",
      [f.firmId, sheetId, JSON.stringify(DEFAULT_SHEET_MAPPING)],
    );
    const fake = new FakeSheets();
    const shiftCells = (assigned: string) =>
      shiftRow({
        ref: "SH1",
        date: "05/11/2026", // Thursday 10:00 GMT: 73 hours after NOW
        start: "10:00",
        end: "18:00",
        role: "Door Supervisor",
        assigned,
      });
    fake.create(sheetId, {
      Staff: [
        STAFF_HEADER,
        staffRow({
          ref: "ST1",
          first: "Kit",
          last: "Sheet",
          mobile: "07700 900999",
          roles: "Door Supervisor",
        }),
      ],
      Shifts: [SHIFT_HEADER, shiftCells("")],
    });
    const sync = (when: Date) =>
      syncSheet({ run: withFirm, firmId: f.firmId, client: fake, clock: at(when) });
    expect((await sync(NOW)).status).toBe("synced");
    const kit = (
      await su.query<{ id: string }>(
        "select id::text from workers where firm_id = $1 and external_ref = 'ST1'",
        [f.firmId],
      )
    ).rows[0]?.id;
    await su.query(
      "insert into credentials (firm_id, worker_id, type, expires_on) values ($1, $2, 'SIA_DS', '2029-01-01')",
      [f.firmId, kit],
    );
    fake.setCell(sheetId, "Shifts", 2, "Assigned", "ST1");
    expect(await sync(new Date(NOW.getTime() + HOUR))).toMatchObject({ booked: 1 });
    fake.setCell(sheetId, "Shifts", 2, "Assigned", "");
    expect(await sync(new Date(NOW.getTime() + 3 * HOUR))).toMatchObject({ cancelled: 1 });

    // Every booked or cancelled row, and its events.
    const { rows } = await su.query<{
      id: string;
      status: string;
      notice: number | null;
      assigned: { noticeHours: unknown }[];
      cancelled: { noticeHours: unknown }[];
    }>(
      `select a.id::text, a.status, a.notice_hours::float as notice,
              coalesce(jsonb_agg(e.data) filter (where e.action = 'shift.assigned'), '[]') as assigned,
              coalesce(jsonb_agg(e.data) filter (where e.action = 'shift.cancelled'), '[]') as cancelled
         from assignments a
         left join events e on e.firm_id = a.firm_id and e.entity_id = a.id
        where a.firm_id = $1 and a.worker_id is not null
        group by a.id, a.status, a.notice_hours`,
      [f.firmId],
    );
    expect(rows).toHaveLength(3); // Sam's, Jo's and Kit's bookings, all cancelled now
    for (const row of rows) {
      expect(row.assigned).toHaveLength(1);
      expect(typeof row.assigned[0]?.noticeHours).toBe("number");
      expect(row.status).toMatch(/^cancelled_/);
      expect(row.cancelled).toHaveLength(1);
      expect(row.cancelled[0]?.noticeHours).toBe(row.notice);
    }
    // The notice figures themselves: booked 48, 96 and 72 hours ahead; cancelled 42, 84 and 70.
    const ascending = (a: number, b: number) => a - b;
    expect(rows.map((r) => Number(r.assigned[0]?.noticeHours)).sort(ascending)).toEqual([
      48, 72, 96,
    ]);
    expect(rows.map((r) => Number(r.notice)).sort(ascending)).toEqual([42, 70, 84]);
  });
});

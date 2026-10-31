import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  CSV_HEADER,
  loadNoticeReport,
  noticeReportCsv,
  parseNoticeQuery,
  type NoticeRow,
} from "@/lib/office/notice-report";
import {
  assignWorker,
  cancelBookingByOffice,
  cancelShift,
  moveShift,
} from "@/lib/office/quick-actions";
import { cancelMyShift } from "@/lib/portal/cancel-shift";
import { STRIKE_WARNING_VERSION } from "@/lib/strikes/words";
import { takeShift } from "@/lib/portal/take-shift";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import {
  ADDED_ON_SHEET,
  CHANGED_ON_SHEET,
  REMOVED_ON_SHEET,
  syncSheet,
} from "@/lib/roster/sheets/sync";
import { bookingFirm, hoursFromNow } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";
import { FakeSheets, SHIFT_HEADER, shiftRow, STAFF_HEADER, staffRow } from "../helpers/fake-sheets";

// The notice and cancellation report against the real paths that write its rows
// (docs/testing.md: "worker cancel, firm cancel/move/curtail all produce correct notice hours and
// flags"): the portal, the office's screens and the Google Sheets sync, on the real database as
// the app role, read back through the report and its CSV. Each path runs on a fixed clock, so its
// notice hours are exact; the events themselves are stamped by the database's real clock, so the
// report is read for the real days. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

const clockAt = (d: Date) => ({ now: () => d });
const aroundToday = () => {
  const now = Date.now();
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: day(now - 86_400_000), to: day(now + 86_400_000) };
};
// Oldest first, as the paths ran: [what, who started it, worker, notice hours, short, reason].
const rowsOf = (rows: NoticeRow[]) =>
  [...rows]
    .reverse()
    .map((r) => [r.kind, r.initiator, r.worker, r.noticeHours, r.shortNotice, r.reason]);

// Saturday 7 November, 08:00 to 16:00: Ann (a door supervisor) can take it; Ben is booked on a
// second Saturday shift.
async function nativeFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const { rows } = await su.query<{ slug: string; name: string }>(
    "select slug, name from firms where id = $1",
    [f.firmId],
  );
  const shiftId = await f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 2 });
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const portal = (when: Date) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: `${rows[0]?.name} Shift Team` },
    run: withFirm,
    clock: clockAt(when),
  });
  const office = (when: Date) => ({
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: clockAt(when),
  });
  const report = (query: Record<string, string> = {}) =>
    withFirm(f.firmId, (tx) =>
      loadNoticeReport(tx, parseNoticeQuery({ ...aroundToday(), ...query }), new Date()),
    );
  return { f, resourcer, shiftId, ann, ben, portal, office, report };
}

describe("a worker's own cancellation", () => {
  it("booked and cancelled from the portal: two rows started by the worker, notice from the path's clock", async () => {
    const t = await nativeFirm();
    // Ann takes it on Monday at 07:00 (5 days 1 hour ahead) and cancels on Friday at 20:00.
    expect(await takeShift(t.portal(hoursFromNow(-2)), t.ann, t.shiftId)).toMatchObject({
      status: "booked",
    });
    expect(
      await cancelMyShift(
        t.portal(new Date("2026-11-06T20:00:00Z")),
        t.ann,
        t.shiftId,
        "I'm unwell: flu",
        { kind: "strike", version: STRIKE_WARNING_VERSION }, // she took it herself; 12 hours
      ),
    ).toMatchObject({ status: "cancelled" });
    const r = await t.report();
    expect(rowsOf(r.rows)).toEqual([
      ["booked", "worker", "Ann Booker", 121, false, null],
      ["cancelled", "worker", "Ann Booker", 12, true, null],
    ]);
    // Her typed reason stays on her booking: it's never in the log, so never in the report.
    expect(JSON.stringify(r.rows)).not.toContain("flu");
    // The same in the file.
    const csv = noticeReportCsv(r).slice(1).trimEnd().split("\r\n");
    expect(csv[0]).toBe(CSV_HEADER.join(","));
    expect(csv[1]).toMatch(
      /^[^,]+,[^,]+,Cancelled,The worker,The worker,Ann Booker,Door supervisor,2026-11-07 08:00,,,12\.00,Yes,,$/,
    );
  });

  it("the flag at exactly 48 hours: 48.00 is not short notice, 47.99 is", async () => {
    const t = await nativeFirm();
    await t.f.booking(t.ann, t.shiftId, "confirmed", 1);
    await t.f.booking(t.ben, t.shiftId, "confirmed", 2);
    // Thursday 08:00 is exactly 48 hours before; 36 seconds later is 47.99 hours.
    // Booked straight into the table (no record of who booked them): no strike either way. Ann's
    // 48 hours is enough notice; Ben's 47.99 isn't, but the booking counts as the office's.
    for (const [at, who, kind] of [
      ["2026-11-05T08:00:00Z", t.ann, "notice"],
      ["2026-11-05T08:00:36Z", t.ben, "exempt"],
    ] as const) {
      expect(
        await cancelMyShift(t.portal(new Date(at)), who, t.shiftId, "Travel", {
          kind,
          version: STRIKE_WARNING_VERSION,
        }),
      ).toMatchObject({ status: "cancelled", strike: null });
    }
    expect(rowsOf((await t.report({ kind: "cancellations" })).rows)).toEqual([
      ["cancelled", "worker", "Ann Booker", 48, false, null],
      ["cancelled", "worker", "Ben Booker", 47.99, true, null],
    ]);
  });
});

// Phase 10 task 13: the office's typed reason for placing someone despite a rule is kept on the
// booking, not in the log; the report reads it from there, until a deletion or the retention purge
// clears it.
describe("the office placing someone despite a rule", () => {
  it("shows the office's reason, read from the booking", async () => {
    const t = await nativeFirm();
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-07')",
      [t.f.firmId, t.ann],
    );
    expect(
      await assignWorker(t.office(hoursFromNow(0)), t.shiftId, t.ann, {
        codes: ["unavailable"],
        reason: "Rang in: can do it after all",
      }),
    ).toMatchObject({ status: "booked" });
    const r = await t.report({ kind: "bookings" });
    expect(rowsOf(r.rows)).toEqual([
      ["booked", "office", "Ann Booker", expect.any(Number), false, "Rang in: can do it after all"],
    ]);
    // Cleared (the purge, or a deletion): the row stays, without the words.
    await su.query("update assignments set override_reason = null where worker_id = $1", [t.ann]);
    const after = await t.report({ kind: "bookings" });
    expect(rowsOf(after.rows)[0]?.[5]).toBeNull();
  });
});

describe("the firm's changes, from the office's screens", () => {
  it("cancelling one booking and then the whole shift: each worker's notice from the start, with the reason", async () => {
    const t = await nativeFirm();
    await t.f.booking(t.ann, t.shiftId, "confirmed", 1);
    await t.f.booking(t.ben, t.shiftId, "confirmed", 2);
    // Friday 06:00 (26 hours before): Ann's booking. Friday 18:00 (14 hours before): the whole
    // shift, which cancels Ben's booking.
    expect(
      await cancelBookingByOffice(
        t.office(new Date("2026-11-06T06:00:00Z")),
        t.shiftId,
        t.ann,
        "fewer_staff",
      ),
    ).toMatchObject({ status: "cancelled" });
    expect(
      await cancelShift(t.office(new Date("2026-11-06T18:00:00Z")), t.shiftId, "weather"),
    ).toMatchObject({ status: "cancelled", bookings: 1 });
    expect(rowsOf((await t.report()).rows)).toEqual([
      ["cancelled", "office", "Ann Booker", 26, true, "The client needs fewer staff"],
      ["cancelled", "office", "Ben Booker", 14, true, "Weather or safety"],
    ]);
  });

  it("moving later and shortening: notice from the old start (the earlier one), the times before and after, the reason", async () => {
    const t = await nativeFirm();
    await t.f.booking(t.ann, t.shiftId, "confirmed", 1);
    await su.query("update shifts set headcount = 1 where id = $1", [t.shiftId]);
    // Wednesday 08:00 (72 hours before): moved to 10:00 to 18:00.
    expect(
      await moveShift(t.office(new Date("2026-11-04T08:00:00Z")), t.shiftId, {
        date: "2026-11-07",
        start: "10:00",
        end: "18:00",
        siteId: "",
        reason: "event_changed",
      }),
    ).toMatchObject({ status: "moved" });
    // Friday 10:00 (24 hours before the new start): cut to 10:00 to 14:00.
    expect(
      await moveShift(t.office(new Date("2026-11-06T10:00:00Z")), t.shiftId, {
        date: "2026-11-07",
        start: "10:00",
        end: "14:00",
        siteId: "",
        reason: "fewer_staff",
      }),
    ).toMatchObject({ status: "curtailed" });
    const r = await t.report({ kind: "changes" });
    expect(rowsOf(r.rows)).toEqual([
      ["moved", "office", "Ann Booker", 72, false, "The event's times or place changed"],
      ["shortened", "office", "Ann Booker", 24, true, "The client needs fewer staff"],
    ]);
    const [shortened, moved] = r.rows;
    expect(moved?.moved).toEqual({
      fromStart: new Date("2026-11-07T08:00:00Z"),
      fromEnd: new Date("2026-11-07T16:00:00Z"),
      toStart: new Date("2026-11-07T10:00:00Z"),
      toEnd: new Date("2026-11-07T18:00:00Z"),
      siteChanged: false,
    });
    expect(shortened?.moved).toMatchObject({
      fromEnd: new Date("2026-11-07T18:00:00Z"),
      toEnd: new Date("2026-11-07T14:00:00Z"),
    });
    const csv = noticeReportCsv(r).slice(1).trimEnd().split("\r\n");
    expect(csv[2]).toContain(
      ",Moved,The office,,Ann Booker,Door supervisor,2026-11-07 10:00,2026-11-07 08:00 to 2026-11-07 16:00,2026-11-07 10:00 to 2026-11-07 18:00,72.00,No,The event's times or place changed,",
    );
  });

  it("moved earlier: notice from the new start, so the short notice is flagged (audit M6)", async () => {
    const t = await nativeFirm();
    await t.f.booking(t.ann, t.shiftId, "confirmed", 1);
    await su.query("update shifts set headcount = 1 where id = $1", [t.shiftId]);
    // Monday 09:00: Saturday 08:00's shift moved to Tuesday 08:00 (23 hours away; Saturday was 119).
    expect(
      await moveShift(t.office(new Date("2026-11-02T09:00:00Z")), t.shiftId, {
        date: "2026-11-03",
        start: "08:00",
        end: "16:00",
        siteId: "",
        reason: "event_changed",
      }),
    ).toMatchObject({ status: "moved", noticeHours: 23 });
    const r = await t.report({ kind: "changes" });
    expect(rowsOf(r.rows)).toEqual([
      ["moved", "office", "Ann Booker", 23, true, "The event's times or place changed"],
    ]);
    const csv = noticeReportCsv(r).slice(1).trimEnd().split("\r\n");
    expect(csv[1]).toContain(
      ",2026-11-07 08:00 to 2026-11-07 16:00,2026-11-03 08:00 to 2026-11-03 16:00,23.00,Yes,",
    );
    // The short-notice filter finds it.
    const short = await t.report({ kind: "changes", short: "1" });
    expect(short.total).toBe(1);
  });

  it("the flag follows the firm's own threshold", async () => {
    const t = await nativeFirm({ short_notice_threshold_hours: 96 });
    await t.f.booking(t.ann, t.shiftId, "confirmed", 1);
    await moveShift(t.office(new Date("2026-11-04T08:00:00Z")), t.shiftId, {
      date: "2026-11-07",
      start: "09:00",
      end: "17:00",
      siteId: "",
      reason: "event_changed",
    });
    const r = await t.report();
    expect(r.threshold).toEqual({ hours: 96, source: "setting" });
    expect(rowsOf(r.rows)).toEqual([
      ["moved", "office", "Ann Booker", 72, true, "The event's times or place changed"],
    ]);
  });

  it("the office cancelling during the shift: negative notice, flagged, and said so in the file", async () => {
    const t = await nativeFirm();
    await t.f.booking(t.ann, t.shiftId, "confirmed", 1);
    // Saturday 10:30, two and a half hours in: sent home.
    await cancelBookingByOffice(
      t.office(new Date("2026-11-07T10:30:00Z")),
      t.shiftId,
      t.ann,
      "fewer_staff",
    );
    const r = await t.report();
    expect(rowsOf(r.rows)).toEqual([
      ["cancelled", "office", "Ann Booker", -2.5, true, "The client needs fewer staff"],
    ]);
    expect(noticeReportCsv(r)).toContain(",-2.50,Yes,The client needs fewer staff,After the start");
  });
});

describe("the firm's changes, from its Google Sheet", () => {
  // A rail firm whose rota is a sheet: Ada is named on Saturday night's possession, 22:00 to 06:00.
  async function sheetFirm() {
    const slug = uniqueSlug("n");
    const { rows } = await su.query<{ id: string }>(
      "insert into firms (name, slug, sector) values ($1, $2, 'rail') returning id::text as id",
      [`Notice Sheet ${slug}`, slug],
    );
    const firmId = rows[0]?.id ?? "";
    const sheetId = `test_${randomBytes(30).toString("base64url")}`.slice(0, 44);
    await su.query(
      "insert into roster_sources (firm_id, kind, spreadsheet_id, mapping) values ($1, 'sheets', $2, $3)",
      [firmId, sheetId, JSON.stringify(DEFAULT_SHEET_MAPPING)],
    );
    await su.query(
      `insert into credential_rules (firm_id, sector, role, required_types)
       values ($1, 'rail', 'track_operative', '{}')`,
      [firmId],
    );
    const fake = new FakeSheets();
    fake.create(sheetId, {
      Staff: [
        STAFF_HEADER,
        staffRow({
          ref: "N001",
          first: "Ada",
          last: "Example",
          mobile: "07700 900311",
          roles: "track_operative",
        }),
      ],
      Shifts: [
        SHIFT_HEADER,
        shiftRow({
          ref: "P1",
          date: "07/11/2026",
          start: "22:00",
          end: "06:00",
          site: "Demo Junction",
          role: "Track Operative",
          needed: "1",
          assigned: "N001",
        }),
      ],
    });
    const sync = (when: Date) =>
      syncSheet({ run: withFirm, firmId, client: fake, clock: clockAt(when) });
    const report = () =>
      withFirm(firmId, (tx) => loadNoticeReport(tx, parseNoticeQuery(aroundToday()), new Date()));
    return { firmId, sheetId, fake, sync, report };
  }

  it("booked, shortened, moved earlier and removed on the sheet: started by the rota sheet, a move counted from the earlier start", async () => {
    const s = await sheetFirm();
    // Friday 09:00: the first sync books Ada (37 hours ahead).
    expect(await s.sync(new Date("2026-11-06T09:00:00Z"))).toMatchObject({ status: "synced" });
    // Friday 10:00: cut to end at 04:00 (36 hours' notice).
    s.fake.setCell(s.sheetId, "Shifts", 2, "End", "04:00");
    await s.sync(new Date("2026-11-06T10:00:00Z"));
    // Friday 12:00: starts at 21:00 instead: an hour earlier, so 33 hours' notice of the new start
    // (from the old 22:00 it would read 34: audit M6).
    s.fake.setCell(s.sheetId, "Shifts", 2, "Start", "21:00");
    await s.sync(new Date("2026-11-06T12:00:00Z"));
    // Saturday 09:00: Ada taken off the sheet (12 hours' notice).
    s.fake.setCell(s.sheetId, "Shifts", 2, "Assigned", "");
    await s.sync(new Date("2026-11-07T09:00:00Z"));
    const r = await s.report();
    expect(rowsOf(r.rows)).toEqual([
      ["booked", "rota_sheet", "Ada Example", 37, true, ADDED_ON_SHEET],
      ["shortened", "rota_sheet", "Ada Example", 36, true, CHANGED_ON_SHEET],
      ["moved", "rota_sheet", "Ada Example", 33, true, CHANGED_ON_SHEET],
      ["cancelled", "rota_sheet", "Ada Example", 12, true, REMOVED_ON_SHEET],
    ]);
    // Every row names the shift, and the moves carry their times.
    expect(r.rows.every((x) => x.shift?.role === "track_operative")).toBe(true);
    expect(r.rows[1]?.moved).toMatchObject({
      fromStart: new Date("2026-11-07T22:00:00Z"),
      toStart: new Date("2026-11-07T21:00:00Z"),
    });
    // "Started by the firm" covers the rota sheet's changes; the worker filter finds none.
    const firmOnly = await withFirm(s.firmId, (tx) =>
      loadNoticeReport(tx, parseNoticeQuery({ ...aroundToday(), by: "firm" }), new Date()),
    );
    expect(firmOnly.total).toBe(4);
    const workerOnly = await withFirm(s.firmId, (tx) =>
      loadNoticeReport(tx, parseNoticeQuery({ ...aroundToday(), by: "worker" }), new Date()),
    );
    expect(workerOnly.total).toBe(0);
  });
});

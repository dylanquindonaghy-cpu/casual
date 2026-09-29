import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  CSV_HEADER,
  loadNoticeReport,
  noticeReportCsv,
  officeNoticeReport,
  parseNoticeQuery,
} from "@/lib/office/notice-report";
import { moveShift } from "@/lib/office/quick-actions";
import { cancelBooking } from "@/lib/roster/cancel";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The notice and cancellation report (docs/screens.md `/office/reports/notice`; docs/compliance.md):
// every offer, booking, move, shortening and cancellation from the action log, with who started
// it, the notice the worker had, and a short-notice flag at the firm's threshold; and its CSV. On
// the real database, as the app role. NOW is Monday 2 November 2026, 09:00 London (GMT).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function reportFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const { rows: site } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
    [f.firmId],
  );
  // Saturday 7 November, 08:00 to 16:00 at the arena.
  const shiftId = await f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 2 });
  await su.query("update shifts set site_id = $2 where id = $1", [shiftId, site[0]?.id]);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const event = async (o: {
    action: string;
    at: Date;
    actorType?: string;
    actorId?: string | null;
    entityId?: string | null; // the booking it's about
    data: Record<string, unknown>;
  }) =>
    Number(
      (
        await su.query<{ id: string }>(
          `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data, created_at)
           values ($1, $2, $3, $4, 'assignment', $5, $6, $7) returning id::text as id`,
          [
            f.firmId,
            o.actorType ?? "system",
            o.actorId ?? null,
            o.action,
            o.entityId ?? null,
            JSON.stringify(o.data),
            o.at,
          ],
        )
      ).rows[0]?.id,
    );
  const report = (query: Record<string, string> = {}, now = NOW) =>
    withFirm(f.firmId, (tx) => loadNoticeReport(tx, parseNoticeQuery(query), now));
  return { f, resourcer, shiftId, ann, ben, event, report };
}

describe("the notice and cancellation report", () => {
  it("each kind of row: who started it, the notice from the event, the flag and the firm's reason", async () => {
    const t = await reportFirm();
    const s = t.shiftId;
    await t.event({ action: "shift.created", at: hoursFromNow(-9), data: { shiftId: s } }); // not in it
    await t.event({
      action: "offer.sent",
      at: hoursFromNow(-8),
      data: { shiftId: s, workerId: t.ann, wave: 1, noticeHours: 125 },
    });
    await t.event({
      action: "shift.assigned",
      at: hoursFromNow(-7),
      actorType: "worker",
      actorId: t.ann,
      data: { by: "worker", shiftId: s, workerId: t.ann, noticeHours: 124 },
    });
    await t.event({
      action: "shift.assigned",
      at: hoursFromNow(-6),
      actorType: "office",
      actorId: t.resourcer,
      data: { by: "firm", shiftId: s, workerId: t.ben, noticeHours: 123 },
    });
    await t.event({
      action: "shift.moved",
      at: hoursFromNow(-5),
      actorType: "office",
      actorId: t.resourcer,
      data: {
        by: "firm",
        shiftId: s,
        workerId: t.ann,
        reason: "Weather or safety",
        oldStartsAt: "2026-11-07T06:00:00.000Z",
        oldEndsAt: "2026-11-07T14:00:00.000Z",
        newStartsAt: "2026-11-07T08:00:00.000Z",
        newEndsAt: "2026-11-07T16:00:00.000Z",
        oldSiteId: null,
        newSiteId: null,
        noticeHours: 118,
      },
    });
    // The rota sheet shortening Ben's shift, shaped as the Sheets sync logged it before it named the
    // shift and worker: only the booking says whose it is.
    const benBooking = await t.f.booking(t.ben, s, "confirmed", 2);
    await t.event({
      action: "shift.curtailed",
      at: hoursFromNow(-4),
      entityId: benBooking,
      data: {
        source: "sheets",
        by: "firm",
        reason: "Times changed on the rota sheet",
        oldStartsAt: "2026-11-07T08:00:00.000Z",
        oldEndsAt: "2026-11-07T16:00:00.000Z",
        newStartsAt: "2026-11-07T08:00:00.000Z",
        newEndsAt: "2026-11-07T12:00:00.000Z",
        noticeHours: 32.5,
      },
    });
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-3),
      actorType: "worker",
      actorId: t.ben,
      data: { by: "worker", shiftId: s, workerId: t.ben, noticeHours: 20 },
    });
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-2),
      actorType: "office",
      actorId: t.resourcer,
      data: {
        by: "firm",
        shiftId: s,
        workerId: t.ann,
        reason: "The event was cancelled",
        noticeHours: 60,
      },
    });
    // An office offer logged before offers recorded their notice: from the current start.
    await t.event({
      action: "offer.sent",
      at: hoursFromNow(-1),
      data: { shiftId: s, workerId: t.ben, offeredBy: t.resourcer },
    });

    const r = await t.report();
    expect(r.threshold).toEqual({ hours: 48, source: "default" });
    expect(r.total).toBe(8);
    expect(
      r.rows.map((x) => [x.kind, x.initiator, x.worker, x.noticeHours, x.shortNotice, x.reason]),
    ).toEqual([
      ["offered", "office", "Ben Booker", 120, false, null],
      ["cancelled", "office", "Ann Booker", 60, false, "The event was cancelled"],
      ["cancelled", "worker", "Ben Booker", 20, true, null],
      ["shortened", "rota_sheet", "Ben Booker", 32.5, true, "Times changed on the rota sheet"],
      ["moved", "office", "Ann Booker", 118, false, "Weather or safety"],
      ["booked", "office", "Ben Booker", 123, false, null],
      ["booked", "worker", "Ann Booker", 124, false, null],
      ["offered", "offer_wave", "Ann Booker", 125, false, null],
    ]);
    expect(r.rows[0]?.noticeFromCurrentStart).toBe(true);
    expect(r.rows[1]?.noticeFromCurrentStart).toBe(false);
    expect(r.rows[4]?.moved).toEqual({
      fromStart: new Date("2026-11-07T06:00:00Z"),
      fromEnd: new Date("2026-11-07T14:00:00Z"),
      toStart: new Date("2026-11-07T08:00:00Z"),
      toEnd: new Date("2026-11-07T16:00:00Z"),
      siteChanged: false,
    });
    // The shortening: the end moved, and the shift and worker came from the booking.
    expect(r.rows[3]).toMatchObject({
      moved: {
        fromEnd: new Date("2026-11-07T16:00:00Z"),
        toEnd: new Date("2026-11-07T12:00:00Z"),
      },
      shift: { id: s },
    });
    expect(r.rows[1]?.shift).toMatchObject({
      id: s,
      role: "door_supervisor",
      site: "Riverside Arena",
    });
  });

  it("short notice is under the firm's own threshold; a setting that isn't valid falls back to 48", async () => {
    const t = await reportFirm({ short_notice_threshold_hours: 72 });
    const cancel = (noticeHours: number, at: Date) =>
      t.event({
        action: "shift.cancelled",
        at,
        data: { by: "firm", shiftId: t.shiftId, workerId: t.ann, noticeHours },
      });
    await cancel(71.99, hoursFromNow(-2));
    await cancel(72, hoursFromNow(-1));
    const r = await t.report();
    expect(r.threshold).toEqual({ hours: 72, source: "setting" });
    expect(r.rows.map((x) => [x.noticeHours, x.shortNotice])).toEqual([
      [72, false],
      [71.99, true],
    ]);
    await su.query(
      `update firms set settings = settings || '{"short_notice_threshold_hours": "a week"}' where id = $1`,
      [t.f.firmId],
    );
    expect((await t.report()).threshold).toEqual({ hours: 48, source: "invalid" });
    await su.query(
      `update firms set settings = settings || '{"short_notice_threshold_hours": 0}' where id = $1`,
      [t.f.firmId],
    );
    expect((await t.report()).threshold).toEqual({ hours: 48, source: "invalid" });
  });

  it("filters: what, who started it, short notice only, and dates in London time", async () => {
    const t = await reportFirm();
    const s = t.shiftId;
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-3),
      data: { by: "worker", shiftId: s, workerId: t.ann, noticeHours: 20 },
    });
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-2),
      actorType: "office",
      actorId: t.resourcer,
      data: { by: "firm", shiftId: s, workerId: t.ben, noticeHours: 100 },
    });
    await t.event({
      action: "shift.assigned",
      at: hoursFromNow(-1),
      actorType: "worker",
      actorId: t.ann,
      data: { by: "worker", shiftId: s, workerId: t.ann, noticeHours: 10 },
    });
    const kinds = async (q: Record<string, string>) =>
      (await t.report(q)).rows.map((x) => [x.kind, x.initiator]);
    expect(await kinds({ kind: "cancellations" })).toEqual([
      ["cancelled", "office"],
      ["cancelled", "worker"],
    ]);
    expect(await kinds({ by: "firm" })).toEqual([["cancelled", "office"]]);
    expect(await kinds({ by: "worker" })).toEqual([
      ["booked", "worker"],
      ["cancelled", "worker"],
    ]);
    expect(await kinds({ short: "1" })).toEqual([
      ["booked", "worker"],
      ["cancelled", "worker"],
    ]);
    expect((await t.report({ short: "1" })).total).toBe(2);

    // The default: the last 28 days. 00:30 on 21 October (summer time) is 23:30 on the 20th, UTC.
    expect((await t.report()).filters).toMatchObject({ from: "2026-10-06", to: "2026-11-02" });
    const late = await t.event({
      action: "shift.cancelled",
      at: new Date("2026-10-20T23:30:00Z"),
      data: { by: "worker", shiftId: s, workerId: t.ann, noticeHours: 400 },
    });
    const ids = async (q: Record<string, string>) => (await t.report(q)).rows.map((x) => x.eventId);
    expect(await ids({ from: "2026-10-21", to: "2026-10-21" })).toEqual([late]);
    expect(await ids({ from: "2026-10-20", to: "2026-10-20" })).toEqual([]);
    expect(await t.report({ from: "2024-01-01", to: "2026-11-02" })).toMatchObject({
      clamped: true,
      filters: { from: "2025-11-02" },
    });
  });

  it("only this firm's rows; nonsense filters are ignored", async () => {
    const t = await reportFirm();
    const other = await reportFirm();
    await other.event({
      action: "shift.cancelled",
      at: hoursFromNow(-1),
      data: { by: "worker", shiftId: other.shiftId, workerId: other.ann, noticeHours: 5 },
    });
    expect((await t.report()).total).toBe(0);
    expect((await other.report()).total).toBe(1);
    // An event of this firm's that names the other firm's shift and worker names neither.
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-1),
      data: { by: "worker", shiftId: other.shiftId, workerId: other.ann, noticeHours: 5 },
    });
    expect((await t.report()).rows.map((x) => [x.worker, x.shift])).toEqual([["Someone", null]]);
    expect(
      parseNoticeQuery({
        from: "2026-02-30",
        to: "soon",
        kind: "toString",
        by: "boss",
        short: "yes",
      }),
    ).toEqual({ from: null, to: null, kind: null, by: null, shortOnly: false });
  });

  it("rows from the real paths: a worker's cancellation and the office moving a shift", async () => {
    const t = await reportFirm();
    const annBooking = await t.f.booking(t.ann, t.shiftId, "confirmed", 1);
    await t.f.booking(t.ben, t.shiftId, "confirmed", 2);
    await su.query("update shifts set status = 'filled' where id = $1", [t.shiftId]);
    expect(annBooking).toBeTruthy();
    await cancelBooking(
      withFirm,
      t.f.firmId,
      {
        shiftId: t.shiftId,
        workerId: t.ann,
        reason: "I'm unwell",
        by: { type: "worker", id: t.ann },
      },
      { clock: { now: () => hoursFromNow(-1) } },
    );
    await moveShift(
      {
        firm: { id: t.f.firmId },
        officeUserId: t.resourcer,
        run: withFirm,
        clock: { now: () => NOW },
      },
      t.shiftId,
      { date: "2026-11-07", start: "10:00", end: "18:00", siteId: "", reason: "event_changed" },
    );
    // Events are stamped by the database's clock (the real time), not the test's: search those days.
    const real = new Date();
    const dayOf = (d: Date) => d.toISOString().slice(0, 10);
    const r = await t.report({
      from: dayOf(new Date(real.getTime() - 86_400_000)),
      to: dayOf(new Date(real.getTime() + 86_400_000)),
    });
    expect(r.rows.map((x) => [x.kind, x.initiator, x.worker, x.noticeHours, x.reason])).toEqual([
      ["moved", "office", "Ben Booker", 119, "The event's times or place changed"],
      ["cancelled", "worker", "Ann Booker", 120, null],
    ]);
    // The worker's own typed reason isn't in the log, so it isn't in the report either.
    expect(JSON.stringify(r.rows)).not.toContain("unwell");
  });

  it("the CSV: a header, one line per row, times in firm time and UTC, formulas made inert", async () => {
    const t = await reportFirm();
    await su.query("update workers set first_name = '=HYPERLINK(\"x\")' where id = $1", [t.ann]);
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-1),
      actorType: "office",
      actorId: t.resourcer,
      data: {
        by: "firm",
        shiftId: t.shiftId,
        workerId: t.ann,
        reason: "Weather or safety",
        noticeHours: 118,
      },
    });
    const csv = noticeReportCsv(await t.report());
    expect(csv.startsWith("\uFEFF")).toBe(true); // so Excel reads it as UTF-8
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER.join(","));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      [
        "2026-11-02 08:00",
        "2026-11-02T08:00:00.000Z",
        "Cancelled",
        "The office",
        `"'=HYPERLINK(""x"") Booker"`,
        "Door supervisor at Riverside Arena",
        "2026-11-07 08:00",
        "",
        "",
        "118.00",
        "No",
        "Weather or safety",
        "",
      ].join(","),
    );
    // The office cancelling during the shift: negative notice, a plain number, noted.
    await t.event({
      action: "shift.cancelled",
      at: new Date("2026-11-07T10:00:00Z"),
      actorType: "office",
      actorId: t.resourcer,
      data: { by: "firm", shiftId: t.shiftId, workerId: t.ben, noticeHours: -2 },
    });
    const later = noticeReportCsv(await t.report({ from: "2026-11-07", to: "2026-11-07" }));
    expect(later.slice(1).trimEnd().split("\r\n")[1]).toMatch(/,-2\.00,Yes,,After the start$/);
  });

  it("admins and resourcers; not payroll; not logged out", async () => {
    const t = await reportFirm();
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const sessionFor = async (officeUserId: string) =>
      (
        await withFirm(t.f.firmId, (tx) =>
          createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
        )
      ).token;
    const q = parseNoticeQuery({});
    expect(await officeNoticeReport(ctx, await sessionFor(t.resourcer), q)).not.toBeNull();
    expect(
      await officeNoticeReport(ctx, await sessionFor(await t.f.office("admin")), q),
    ).not.toBeNull();
    expect(
      await officeNoticeReport(ctx, await sessionFor(await t.f.office("payroll")), q),
    ).toBeNull();
    expect(await officeNoticeReport(ctx, "", q)).toBeNull();
  });
});

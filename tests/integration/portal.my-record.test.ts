import type { Pool } from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DAY, HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadNoticeReport, parseNoticeQuery } from "@/lib/office/notice-report";
import { cancelMyShift } from "@/lib/portal/cancel-shift";
import { myRecord, type MyRecord } from "@/lib/portal/my-record";
import { NOTICE_NOT_RECORDED, recordNoticeText } from "@/lib/portal/record-copy";
import { takeShift } from "@/lib/portal/take-shift";
import { cancelBooking, cancelShiftByFirm } from "@/lib/roster/cancel";
import { FIRM_CHANGE_REASONS } from "@/lib/roster/firm-reasons";
import { withdrawStrike } from "@/lib/strikes/manage";
import { STRIKE_WARNING_VERSION } from "@/lib/strikes/words";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The casual's own shift record (docs/screens.md "The casual app, Phase 28", 28.4;
// src/lib/portal/my-record.ts) on the real database, as the app role: her offers, bookings, office
// changes and cancellations for 90 days, through the notice report's own row builder, with only
// the notice that was logged, only fixed reason words, the live strike, and nothing office-only.
// Hers only: never another casual's rows, never another firm's. NOW is Monday 2 November 2026,
// 09:00 London (GMT). Entries written by the real paths are stamped by the database's own clock
// (after NOW), so they fall inside the record's 90 days too.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/shifts/record",
}));

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

const at = (d: Date) => ({ now: () => d });
const later = (h: number) => new Date(NOW.getTime() + h * HOUR);
const SAT = new Date("2026-11-07T08:00:00Z"); // Saturday 7 November, 08:00 to 16:00
const times = {
  oldStartsAt: "2026-11-07T06:00:00.000Z",
  oldEndsAt: "2026-11-07T14:00:00.000Z",
  newStartsAt: "2026-11-07T08:00:00.000Z",
  newEndsAt: "2026-11-07T16:00:00.000Z",
};

async function recordFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const admin = await f.office("admin");
  const { rows: site } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
    [f.firmId],
  );
  const siteId = site[0]?.id ?? "";
  const shift = async (startsAt: Date, o: { hidden?: boolean } = {}) => {
    const id = await f.shift({ startsAt, headcount: 3 });
    await su.query("update shifts set site_id = $2, showing_to_casuals = $3 where id = $1", [
      id,
      siteId,
      !o.hidden,
    ]);
    return id;
  };
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  // An action-log entry as its writer logs it (the superuser sets its time).
  const event = async (o: {
    action: string;
    at: Date;
    actorType?: string;
    actorId?: string | null;
    entityType?: string;
    entityId?: string | null;
    data: Record<string, unknown>;
  }) => {
    await su.query(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        f.firmId,
        o.actorType ?? "system",
        o.actorId ?? null,
        o.action,
        o.entityType ?? "assignment",
        o.entityId ?? null,
        JSON.stringify(o.data),
        o.at,
      ],
    );
  };
  const record = (workerId: string, now = NOW) =>
    myRecord({ firm: { id: f.firmId }, run: withFirm, clock: at(now) }, workerId);
  const portal = (now = NOW) => ({
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
    run: withFirm,
    clock: at(now),
  });
  return { f, resourcer, admin, siteId, shift, ann, ben, event, record, portal };
}

const html = async (record: MyRecord, now = NOW) => {
  const { RecordView } = await import("@/app/shifts/record/record-view");
  return renderToStaticMarkup(createElement(RecordView, { record, now }));
};
const refOf = (id: string) => id.slice(0, 8).toUpperCase();

describe("Your shift record", () => {
  it("an offer, her booking, an office move and her own cancellation: four rows with the logged values; nobody else's", async () => {
    const t = await recordFirm();
    const s = await t.shift(SAT);
    const annBooking = await t.f.booking(t.ann, s, "cancelled_worker");
    await su.query("update assignments set cancel_reason = $2 where id = $1", [
      annBooking,
      "I'm unwell",
    ]);
    await t.event({
      action: "offer.sent",
      at: hoursFromNow(-10),
      entityType: "offer",
      data: { shiftId: s, workerId: t.ann, wave: 1, noticeHours: 130, channel: "push" },
    });
    await t.event({
      action: "shift.assigned",
      at: hoursFromNow(-9),
      actorType: "worker",
      actorId: t.ann,
      entityId: annBooking,
      data: { by: "worker", shiftId: s, workerId: t.ann, slot: 1, noticeHours: 129 },
    });
    await t.event({
      action: "shift.moved",
      at: hoursFromNow(-8),
      actorType: "office",
      actorId: t.resourcer,
      entityId: annBooking,
      data: {
        by: "firm",
        shiftId: s,
        workerId: t.ann,
        reason: "Weather or safety",
        ...times,
        oldSiteId: t.siteId,
        newSiteId: t.siteId,
        noticeHours: 21,
        rulesOk: true,
      },
    });
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-7),
      actorType: "worker",
      actorId: t.ann,
      entityId: annBooking,
      data: {
        by: "worker",
        askedBy: "casual",
        shiftId: s,
        workerId: t.ann,
        noticeHours: 20,
        strike: "no_strike",
        place: "reopened",
        reopenedId: "44444444-4444-4444-8444-444444444444",
      },
    });
    // Ben's own: an offer and his cancellation of the same session.
    const benBooking = await t.f.booking(t.ben, s, "cancelled_worker", 2);
    await t.event({
      action: "offer.sent",
      at: hoursFromNow(-6),
      entityType: "offer",
      data: { shiftId: s, workerId: t.ben, wave: 1, noticeHours: 126 },
    });
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-5),
      actorType: "worker",
      actorId: t.ben,
      entityId: benBooking,
      data: { by: "worker", shiftId: s, workerId: t.ben, noticeHours: 125 },
    });
    // Another firm's entries, one naming Ann's id: never hers to see.
    const other = await recordFirm();
    const otherShift = await other.shift(SAT);
    await other.event({
      action: "offer.sent",
      at: hoursFromNow(-4),
      entityType: "offer",
      data: { shiftId: otherShift, workerId: t.ann, wave: 1, noticeHours: 124 },
    });
    await other.event({
      action: "offer.sent",
      at: hoursFromNow(-4),
      entityType: "offer",
      data: { shiftId: otherShift, workerId: other.ann, wave: 1, noticeHours: 124 },
    });

    const r = await t.record(t.ann);
    const shift = {
      id: s,
      role: "door_supervisor",
      site: "Riverside Arena",
      startsAt: SAT,
      canOpen: true,
    };
    const none = { moved: null, reason: null, askedBy: null, ref: null, strike: null, shift };
    expect(r).toEqual({
      timeZone: "Europe/London",
      days: 90,
      more: false,
      rows: [
        {
          ...none,
          at: hoursFromNow(-7),
          kind: "cancelled",
          by: "you",
          noticeHours: 20,
          reason: "I'm unwell",
          ref: refOf(annBooking),
          strike: "none",
        },
        {
          ...none,
          at: hoursFromNow(-8),
          kind: "moved",
          by: "office",
          noticeHours: 21,
          reason: "Because of weather or safety.",
          moved: {
            fromStart: new Date(times.oldStartsAt),
            fromEnd: new Date(times.oldEndsAt),
            toStart: new Date(times.newStartsAt),
            toEnd: new Date(times.newEndsAt),
            siteChanged: false,
          },
        },
        { ...none, at: hoursFromNow(-9), kind: "booked", by: "you", noticeHours: 129 },
        { ...none, at: hoursFromNow(-10), kind: "offered", by: "office", noticeHours: 130 },
      ],
    });
    // Nothing of the place she left (who took it, its new booking).
    expect(JSON.stringify(r)).not.toContain("4444");
    // Ben sees his two; the other firm's casual only their own; Ann, asked for through the other
    // firm, nothing at all (RLS: the other firm's entry naming her id is the other firm's).
    expect((await t.record(t.ben)).rows.map((x) => [x.kind, x.by, x.noticeHours])).toEqual([
      ["cancelled", "you", 125],
      ["offered", "office", 126],
    ]);
    expect((await other.record(other.ann)).rows).toHaveLength(1);
    expect((await other.record(t.ann)).rows).toEqual([]);
    const page = await html(r);
    expect(page).not.toContain("Ben");
    expect(page).toContain("You had 21 hours&#x27; notice.");
    expect(page).toContain("Because of weather or safety.");
    expect(page).toContain("You gave 20 hours&#x27; notice.");
    expect(page).toContain(`Reference <span class="font-mono">${refOf(annBooking)}</span>`);
    expect(page).toContain("Your reason: I&#x27;m unwell");
  });

  it("an office booking with an override reason and a firm cancellation with a typed reason: neither text, no codes, no office user", async () => {
    const t = await recordFirm();
    const s = await t.shift(later(5 * 24));
    const annBooking = await t.f.booking(t.ann, s, "confirmed");
    const overrideText = "Manager OK despite the rest rule";
    await su.query("update assignments set override_reason = $2 where id = $1", [
      annBooking,
      overrideText,
    ]);
    await t.event({
      action: "offer.sent",
      at: hoursFromNow(-6),
      entityType: "offer",
      data: {
        shiftId: s,
        workerId: t.ann,
        offeredBy: t.resourcer,
        noticeHours: 126,
        channel: "sms",
      },
    });
    await t.event({
      action: "shift.assigned",
      at: hoursFromNow(-5),
      actorType: "office",
      actorId: t.resourcer,
      entityId: annBooking,
      data: {
        by: "firm",
        shiftId: s,
        workerId: t.ann,
        slot: 1,
        noticeHours: 125,
        overridden: ["rest_too_short"],
        reasonGiven: true,
        bookingMessage: true,
      },
    });
    await t.event({
      action: "shift.moved",
      at: hoursFromNow(-4),
      actorType: "office",
      actorId: t.resourcer,
      entityId: annBooking,
      data: {
        by: "firm",
        shiftId: s,
        workerId: t.ann,
        reason: "Weather or safety",
        ...times,
        noticeHours: 100,
        rulesOk: false,
        codes: ["rest_too_short"],
      },
    });
    // An old entry whose reason isn't one of the fixed words (none should be): not shown.
    await t.event({
      action: "shift.cancelled",
      at: hoursFromNow(-3),
      actorType: "office",
      actorId: t.resourcer,
      data: {
        by: "firm",
        shiftId: s,
        workerId: t.ann,
        reason: "Typed by the office: rude to staff",
        noticeHours: 99,
      },
    });
    // The real path: the office cancels her booking with a reason it typed. The words stay on the
    // booking (cancel_reason), never in the log, and never on her record.
    const typed = "She was rude to the client's manager";
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        { shiftId: s, workerId: t.ann, reason: typed, by: { type: "office", id: t.resourcer } },
        { clock: at(NOW) },
      ),
    ).toMatchObject({ status: "cancelled" });
    const { rows: stored } = await su.query<{ cancel_reason: string }>(
      "select cancel_reason from assignments where id = $1",
      [annBooking],
    );
    expect(stored[0]?.cancel_reason).toBe(typed);

    const r = await t.record(t.ann);
    expect(r.rows.map((x) => [x.kind, x.by, x.reason])).toEqual([
      ["cancelled", "office", null], // the real path's (stamped after NOW)
      ["cancelled", "office", null],
      ["moved", "office", "Because of weather or safety."],
      ["booked", "office", null],
      ["offered", "office", null],
    ]);
    const text = JSON.stringify(r) + (await html(r));
    for (const never of [
      overrideText,
      typed,
      "rude",
      "rest_too_short",
      "overridden",
      "reasonGiven",
      "offeredBy",
      "codes",
      t.resourcer,
      t.admin,
      "Office Person",
      "sms",
    ]) {
      expect(text, never).not.toContain(never);
    }
  });

  it("the office cancels her booking as 'They've left, or can't work here': she reads it in her own words", async () => {
    const t = await recordFirm();
    const s = await t.shift(later(30));
    await t.f.booking(t.ann, s, "confirmed");
    // The real path (the dashboard's "Bookings to check": cancelBookingByOffice): the fixed reason's
    // words go in the log as the office's list has them.
    expect(
      await cancelBooking(
        withFirm,
        t.f.firmId,
        {
          shiftId: s,
          workerId: t.ann,
          reason: FIRM_CHANGE_REASONS.not_available,
          by: { type: "office", id: t.resourcer },
        },
        { clock: at(NOW) },
      ),
    ).toMatchObject({ status: "cancelled" });
    const { rows: logged } = await su.query<{ reason: string | null }>(
      "select data ->> 'reason' as reason from events where firm_id = $1 and action = 'shift.cancelled'",
      [t.f.firmId],
    );
    expect(logged.map((x) => x.reason)).toEqual([FIRM_CHANGE_REASONS.not_available]);

    const r = await t.record(t.ann);
    expect(r.rows.map((x) => [x.kind, x.by, x.reason])).toEqual([
      ["cancelled", "office", "You could no longer work this shift."],
    ]);
    const page = await html(r);
    expect(page).toContain("You could no longer work this shift.");
    expect(page).not.toContain("They&#x27;ve left");
    expect(page).not.toMatch(/\bthey\b/i);
  });

  it("an offer whose session moved after it was sent: Notice not recorded; an older rota-sheet move naming no worker shows through her booking", async () => {
    const t = await recordFirm();
    const s = await t.shift(SAT);
    // Logged before offers recorded their notice: the office's report works one out from the
    // session's current start; her record shows only what was logged.
    await t.event({
      action: "offer.sent",
      at: hoursFromNow(-5),
      entityType: "offer",
      data: { shiftId: s, workerId: t.ann, offeredBy: t.resourcer },
    });
    await su.query(
      "update shifts set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = $1",
      [s],
    );
    const annBooking = await t.f.booking(t.ann, s, "confirmed");
    const benBooking = await t.f.booking(t.ben, s, "confirmed", 2);
    const sheetMove = (entityId: string) =>
      t.event({
        action: "shift.curtailed",
        at: hoursFromNow(-4),
        entityId,
        data: {
          source: "sheets",
          by: "firm",
          reason: "Times changed on the rota sheet",
          oldStartsAt: "2026-11-08T08:00:00.000Z",
          oldEndsAt: "2026-11-08T16:00:00.000Z",
          newStartsAt: "2026-11-08T08:00:00.000Z",
          newEndsAt: "2026-11-08T12:00:00.000Z",
          noticeHours: 32.5,
        },
      });
    await sheetMove(annBooking);
    await sheetMove(benBooking); // Ben's booking: not hers
    // An entry about her booking that names someone else: never shown to her.
    await t.event({
      action: "shift.moved",
      at: hoursFromNow(-3),
      entityId: annBooking,
      data: {
        by: "firm",
        shiftId: s,
        workerId: t.ben,
        reason: "Weather or safety",
        noticeHours: 5,
      },
    });

    const r = await t.record(t.ann);
    expect(r.rows).toHaveLength(2);
    const [moved, offered] = r.rows;
    expect(moved).toMatchObject({
      kind: "shortened",
      by: "office",
      reason: "The times were changed on the rota sheet.",
      noticeHours: 32.5,
      shift: { id: s, startsAt: new Date("2026-11-08T08:00:00Z") },
      moved: { toEnd: new Date("2026-11-08T12:00:00Z") },
    });
    expect(offered).toMatchObject({ kind: "offered", by: "office", noticeHours: null });
    expect(recordNoticeText(offered!)).toBe(NOTICE_NOT_RECORDED);
    expect(await html(r)).toContain(NOTICE_NOT_RECORDED);
    // The office's report still counts that offer from the current start (04:00 on Mon 2 Nov to
    // 08:00 on Sun 8 Nov: 148 hours), and says so.
    const report = await withFirm(t.f.firmId, (tx) =>
      loadNoticeReport(tx, parseNoticeQuery({}), NOW),
    );
    expect(report.rows.find((x) => x.kind === "offered")).toMatchObject({
      noticeHours: 148,
      noticeFromCurrentStart: true,
    });
  });

  it("strikes as they stand now (withdrawn too), none with strikes off; a cancelled session has no link; 90 days only", async () => {
    const t = await recordFirm();
    // Ann takes a session and cancels it herself, `startsIn` hours away, an hour after NOW.
    const takeAndCancel = async (startsIn: number, kind: "strike" | "notice") => {
      const s = await t.shift(later(startsIn));
      expect(await takeShift(t.portal(), t.ann, s)).toMatchObject({ status: "booked" });
      expect(
        await cancelMyShift(t.portal(later(1)), t.ann, s, "Travel problem", {
          kind,
          version: STRIKE_WARNING_VERSION,
        }),
      ).toMatchObject({ status: "cancelled" });
      const { rows } = await su.query<{ id: string }>(
        "select id::text from assignments where shift_id = $1 and worker_id = $2",
        [s, t.ann],
      );
      return { shiftId: s, assignmentId: rows[0]?.id ?? "" };
    };
    const live = await takeAndCancel(20, "strike");
    const withdrawn = await takeAndCancel(22, "strike");
    expect(
      await withdrawStrike(
        { firm: { id: t.f.firmId }, officeUserId: t.admin, run: withFirm, clock: at(later(2)) },
        withdrawn.assignmentId,
        "Booked by mistake",
      ),
    ).toMatchObject({ status: "withdrawn" });
    const noStrike = await takeAndCancel(100, "notice");

    // The office cancels a whole session she's booked on, at the client's request.
    const gone = await t.shift(later(72));
    expect(await takeShift(t.portal(), t.ann, gone)).toMatchObject({ status: "booked" });
    expect(
      await cancelShiftByFirm(
        withFirm,
        t.f.firmId,
        {
          shiftId: gone,
          reason: "event_cancelled",
          askedBy: "client",
          by: { type: "office", id: t.resourcer },
        },
        { clock: at(later(2)) },
      ),
    ).toMatchObject({ status: "cancelled", bookings: 1 });

    // Offers: a session casuals can see, one hidden from them, and one hidden that she's booked on.
    const shown = await t.shift(later(200));
    const hidden = await t.shift(later(210), { hidden: true });
    const hiddenBooked = await t.shift(later(220), { hidden: true });
    await t.f.booking(t.ann, hiddenBooked, "confirmed");
    for (const s of [shown, hidden, hiddenBooked]) {
      await t.event({
        action: "offer.sent",
        at: hoursFromNow(-2),
        entityType: "offer",
        data: { shiftId: s, workerId: t.ann, wave: 1, noticeHours: 200 },
      });
    }
    // 89 days ago is in; 91 days ago is out.
    await t.event({
      action: "offer.sent",
      at: new Date(NOW.getTime() - 89 * DAY),
      entityType: "offer",
      data: { shiftId: shown, workerId: t.ann, wave: 1, noticeHours: 89 * 24 },
    });
    await t.event({
      action: "offer.sent",
      at: new Date(NOW.getTime() - 91 * DAY),
      entityType: "offer",
      data: { shiftId: shown, workerId: t.ann, wave: 1, noticeHours: 91 * 24 },
    });

    const r = await t.record(t.ann);
    const ownCancel = (shiftId: string) =>
      r.rows.find((x) => x.kind === "cancelled" && x.by === "you" && x.shift?.id === shiftId);
    expect(ownCancel(live.shiftId)).toMatchObject({
      strike: "strike",
      reason: "Travel problem",
      ref: refOf(live.assignmentId),
      noticeHours: 19,
    });
    expect(ownCancel(withdrawn.shiftId)).toMatchObject({ strike: "withdrawn", noticeHours: 21 });
    expect(ownCancel(noStrike.shiftId)).toMatchObject({ strike: "none", noticeHours: 99 });
    // Strikes only on her own cancellations.
    expect(r.rows.filter((x) => x.strike !== null)).toHaveLength(3);

    const ofGone = r.rows.filter((x) => x.shift?.id === gone);
    expect(ofGone.map((x) => [x.kind, x.by, x.shift?.canOpen])).toEqual([
      ["cancelled", "office", false],
      ["booked", "you", false],
    ]);
    expect(ofGone[0]).toMatchObject({
      reason: "The event was cancelled.",
      askedBy: "client",
      noticeHours: 70,
      strike: null,
      ref: null,
    });
    const offerTo = (s: string) =>
      r.rows.filter((x) => x.kind === "offered" && x.shift?.id === s).map((x) => x.shift?.canOpen);
    expect(offerTo(shown)).toEqual([true, true]); // today's and 89 days ago's; not 91 days ago's
    expect(offerTo(hidden)).toEqual([false]);
    expect(offerTo(hiddenBooked)).toEqual([true]);
    expect(r.rows.some((x) => x.noticeHours === 91 * 24)).toBe(false);
    expect(r.rows.some((x) => x.noticeHours === 89 * 24)).toBe(true);

    const page = await html(r);
    expect(page).toContain(">Strike<");
    expect(page).toContain("Strike (withdrawn by the office)");
    expect(page).toContain("No strike");
    expect(page).toContain("The client asked.");
    expect(page).not.toContain(`href="/shifts/${gone}"`);
    expect(page).not.toContain(`href="/shifts/${hidden}"`);
    expect(page).toContain(`href="/shifts/${shown}"`);

    // The firm switches strikes off: no strike words at all (the strikes given stay theirs).
    await su.query(
      `update firms set settings = settings || '{"strikes": {"enabled": false}}' where id = $1`,
      [t.f.firmId],
    );
    const off = await t.record(t.ann);
    expect(off.rows.every((x) => x.strike === null)).toBe(true);
    expect(await html(off)).not.toMatch(/strike/i);
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  loadCancellationRecord,
  loadCancellations,
  logDownload,
  officeCancellationRecord,
  officeCancellations,
} from "@/lib/office/cancellations";
import { cancellationsCsv, recordFields } from "@/lib/office/cancellations-copy";
import { cancelBookingByOffice, cancelShift } from "@/lib/office/quick-actions";
import { cancelMyShift } from "@/lib/portal/cancel-shift";
import { takeShift } from "@/lib/portal/take-shift";
import { recordPdf } from "@/lib/pdf/record";
import { STRIKE_WARNING_VERSION, type WarningKind } from "@/lib/strikes/words";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { pdfText } from "../helpers/pdf-text";

// Cancellation records (12C.3; docs/office-v2.md 3.4) on the real database as the app role,
// through the real paths: casuals take and cancel shifts in the app; the office cancels one
// booking or a whole session. NOW is Monday 2 November 2026, 09:00 London (GMT), the start of the
// firm's week.

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
const TZ = "Europe/London";

async function recordsFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const portal = (now = NOW) => ({
    firm: { id: f.firmId, timezone: TZ, signOff: "Booking Test Shift Team" },
    run: withFirm,
    clock: at(now),
  });
  const office = (now = NOW) => ({
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: at(now),
  });
  const take = async (worker: string, shiftId: string, now = NOW) =>
    expect(await takeShift(portal(now), worker, shiftId)).toMatchObject({ status: "booked" });
  const cancel = async (
    worker: string,
    shiftId: string,
    now: Date,
    kind: WarningKind,
    reason = "Travel problem",
  ) =>
    expect(
      await cancelMyShift(portal(now), worker, shiftId, reason, {
        kind,
        version: STRIKE_WARNING_VERSION,
      }),
    ).toMatchObject({ status: "cancelled" });
  const list = (view: "all" | "under" | "office" = "all", now = NOW) =>
    withFirm(f.firmId, (tx) => loadCancellations(tx, { view, now, limit: 100 }));
  const lookup = (refOrId: string, now = NOW) =>
    withFirm(f.firmId, (tx) => loadCancellationRecord(tx, refOrId, now));
  // The one record a reference or id finds (null when none, or when it's shared).
  const record = async (refOrId: string, now = NOW) => {
    const found = await lookup(refOrId, now);
    return found?.status === "found" ? found.record : null;
  };
  // An offer for the session as a wave sends it: its row, then its log entry.
  const offer = async (shiftId: string, workerId: string, wave: number) => {
    const { rows } = await su.query<{ id: string }>(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel)
       values ($1, $2, $3, $4, 'push') returning id::text as id`,
      [f.firmId, shiftId, workerId, wave],
    );
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'system', 'offer.sent', 'offer', $2, $3)`,
      [f.firmId, rows[0]?.id, JSON.stringify({ shiftId, workerId, wave })],
    );
  };
  const tokenFor = async (id: string) =>
    (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: id, now: NOW }),
      )
    ).token;
  return { f, resourcer, portal, office, take, cancel, list, lookup, record, offer, tokenFor };
}

describe("the list", () => {
  it("every cancellation, newest first, with this week's counts and the three views", async () => {
    const t = await recordsFirm();
    const [sam, jo, ben] = [
      await t.f.worker(),
      await t.f.worker({ first: "Jo" }),
      await t.f.worker({ first: "Ben" }),
    ];
    const soon = await t.f.shift({ startsAt: hoursFromNow(20) });
    const far = await t.f.shift({ startsAt: hoursFromNow(100) });
    const officeOne = await t.f.shift({ startsAt: hoursFromNow(30) });
    await t.take(sam, soon);
    await t.take(jo, far);
    await t.take(ben, officeOne);
    await t.cancel(sam, soon, later(1), "strike");
    await t.cancel(jo, far, later(2), "notice");
    expect(
      await cancelBookingByOffice(t.office(later(3)), officeOne, ben, "weather"),
    ).toMatchObject({ status: "cancelled" });
    const all = await t.list();
    expect(all.rows.map((r) => [r.casual, r.by, r.noticeHours])).toEqual([
      ["Ben Booker", "office", 27],
      ["Jo Booker", "casual", 98],
      ["Sam Booker", "casual", 19],
    ]);
    expect(all.total).toBe(3);
    expect(all.week).toEqual({ byCasuals: 2, byOffice: 1, strikes: 1 });
    expect(all.threshold).toBe(48);
    expect((await t.list("under")).rows.map((r) => r.casual)).toEqual(["Ben Booker", "Sam Booker"]);
    expect((await t.list("office")).rows.map((r) => r.casual)).toEqual(["Ben Booker"]);
    // The next week: still listed, not counted.
    expect((await t.list("all", later(24 * 7))).week).toEqual({
      byCasuals: 0,
      byOffice: 0,
      strikes: 0,
    });
  });
});

describe("one record", () => {
  it("every field, the session's own details, and what happened next", async () => {
    const t = await recordsFirm();
    // The session needs first aid on top of the door supervisor licence.
    const credentials = [
      { type: "SIA_DS", expiresOn: "2029-01-01" },
      { type: "FIRST_AID", expiresOn: "2029-01-01" },
    ];
    const [sam, jo, kit] = [
      await t.f.worker({ credentials }),
      await t.f.worker({ first: "Jo", credentials }),
      await t.f.worker({ first: "Kit" }),
    ];
    await su.query("update workers set external_ref = 'N001' where id = $1", [sam]);
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(20) });
    const { rows: sites } = await su.query<{ id: string }>(
      `insert into sites (firm_id, name, postcode) values ($1, 'Riverside Arena', 'ZZ1 1AA')
       returning id::text as id`,
      [t.f.firmId],
    );
    await su.query(
      `update shifts set site_id = $2, post = 'Gate B', pay_rate_pence = 1550,
              meeting_point = 'Car park C', uniform = 'Black, hi-vis',
              required_credentials = '{FIRST_AID}'
        where id = $1`,
      [shiftId, sites[0]?.id],
    );
    await t.take(sam, shiftId);
    // 19 hours before: inside the 24-hour urgent window, so the place goes urgent.
    await t.cancel(sam, shiftId, later(1), "strike", "Family or caring");
    // An offer went to Kit, then Jo took the place at 11:00.
    await t.offer(shiftId, kit, 1);
    await t.take(jo, shiftId, later(2));
    const [listed] = (await t.list()).rows;
    if (!listed) throw new Error("nothing listed");
    const r = await t.record(listed.ref.toLowerCase(), later(3));
    expect(r?.liveStrikes).toBe(1);
    expect(r?.threshold).toBe(48);
    expect(
      Object.fromEntries(
        recordFields(r!.row, { tz: TZ, threshold: 48, liveStrikes: 1, forExport: false }).map(
          (x) => [x.label, x.value],
        ),
      ),
    ).toMatchObject({
      Reference: listed.ref,
      Casual: "Sam Booker",
      "Staff id": "N001",
      Event: "Fixture event",
      Session: "Door supervisor · Tue 3 Nov, 05:00 to 13:00",
      Site: "Riverside Arena, ZZ1 1AA",
      Post: "Gate B",
      "Pay rate": "£15.50/h",
      Requirements: "SIA door supervisor licence, First aid at work certificate",
      "Meeting point": "Car park C",
      Uniform: "Black, hi-vis",
      "Booked at": "09:00 on Mon 2 Nov",
      "Cancelled at": "10:00 on Mon 2 Nov",
      How: "In the app",
      Notice: "19 hours' notice (19.00 hours)",
      "Under 48 hours": "Yes",
      Reason: "Family or caring",
      Strike: "Issued (counts until Sun 31 Jan)",
      "Evidence email": "Not sent",
      Then: "Place reopened and marked urgent · offered to 1 casual · filled again by Jo Booker at 11:00",
      "Warning on the cancel screen":
        "Version v1, on screen when they confirmed at 10:00 on Mon 2 Nov",
    });
    expect(await t.record("ZZZZZZZZ")).toBeNull();
    expect(await t.record("not a ref")).toBeNull();
  });

  it("a whole session cancelled, and a place the client no longer needs", async () => {
    const t = await recordsFirm();
    const [sam, jo, ben] = [
      await t.f.worker(),
      await t.f.worker({ first: "Jo" }),
      await t.f.worker({ first: "Ben" }),
    ];
    const whole = await t.f.shift({ startsAt: hoursFromNow(40) });
    const fewer = await t.f.shift({ startsAt: hoursFromNow(60), headcount: 2 });
    await t.take(sam, whole);
    await t.take(jo, fewer);
    await t.take(ben, fewer);
    expect(await cancelShift(t.office(), whole, "event_cancelled")).toMatchObject({
      status: "cancelled",
    });
    expect(await cancelBookingByOffice(t.office(), fewer, jo, "fewer_staff")).toMatchObject({
      status: "cancelled",
    });
    const rows = (await t.list("office")).rows;
    const byName = Object.fromEntries(rows.map((r) => [r.casual, r]));
    expect(byName["Sam Booker"]?.then.place).toBe("session_cancelled");
    expect(byName["Sam Booker"]?.strikeCode).toBe("by_firm");
    expect(byName["Jo Booker"]?.then.place).toBe("removed");
    expect(byName["Jo Booker"]?.via).toBe("office");
  });

  it("one booking cancelled by the office, then the whole session: the first record still says reopened", async () => {
    const t = await recordsFirm();
    const [sam, jo] = [await t.f.worker(), await t.f.worker({ first: "Jo" })];
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(60), headcount: 2 });
    await t.take(sam, shiftId);
    await t.take(jo, shiftId);
    expect(await cancelBookingByOffice(t.office(later(1)), shiftId, sam, "weather")).toMatchObject({
      status: "cancelled",
    });
    expect(await cancelShift(t.office(later(2)), shiftId, "event_cancelled")).toMatchObject({
      status: "cancelled",
    });
    const byName = Object.fromEntries((await t.list()).rows.map((r) => [r.casual, r.then]));
    expect(byName["Sam Booker"]).toMatchObject({ place: "reopened", replacement: null });
    expect(byName["Jo Booker"]?.place).toBe("session_cancelled");
  });

  it("not reopened: the session had started, or the place was above its places by then", async () => {
    const t = await recordsFirm();
    const [sam, jo, kit] = [
      await t.f.worker(),
      await t.f.worker({ first: "Jo" }),
      await t.f.worker({ first: "Kit" }),
    ];
    // Starts in 2 hours; the office cancels Sam 3 hours from now, after the start.
    const started = await t.f.shift({ startsAt: hoursFromNow(2) });
    await t.take(sam, started);
    expect(await cancelBookingByOffice(t.office(later(3)), started, sam, "weather")).toMatchObject({
      status: "cancelled",
    });
    // Two places, then one (as a sheet or an import lowers it): Kit's place 2 is above it.
    const lowered = await t.f.shift({ startsAt: hoursFromNow(80), headcount: 2 });
    await t.take(jo, lowered);
    await t.take(kit, lowered);
    await su.query("update shifts set headcount = 1 where id = $1", [lowered]);
    expect(await cancelBookingByOffice(t.office(later(1)), lowered, kit, "weather")).toMatchObject({
      status: "cancelled",
    });
    const byName = Object.fromEntries((await t.list()).rows.map((r) => [r.casual, r.then]));
    expect(byName["Sam Booker"]?.place).toBe("started");
    expect(byName["Kit Booker"]?.place).toBe("above_places");
  });

  it("a booking moved to another place (fewer staff) keeps the record of who filled the place", async () => {
    const t = await recordsFirm();
    const [ann, ben, cal, pat] = [
      await t.f.worker({ first: "Ann" }),
      await t.f.worker({ first: "Ben" }),
      await t.f.worker({ first: "Cal" }),
      await t.f.worker({ first: "Pat" }),
    ];
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(100), headcount: 3 });
    await t.take(ann, shiftId);
    await t.take(ben, shiftId);
    await t.take(cal, shiftId);
    // Cal gives up place 3; Pat takes it at 11:00.
    await t.cancel(cal, shiftId, later(1), "notice");
    await t.take(pat, shiftId, later(2));
    // The client needs one fewer: Ann's place 1 goes, and Pat's booking moves down into it.
    expect(
      await cancelBookingByOffice(t.office(later(3)), shiftId, ann, "fewer_staff"),
    ).toMatchObject({ status: "cancelled", placesNow: 2 });
    const { rows: pats } = await su.query<{ slot: number }>(
      "select slot from assignments where shift_id = $1 and worker_id = $2 and status = 'confirmed'",
      [shiftId, pat],
    );
    expect(pats).toEqual([{ slot: 1 }]);
    const byName = Object.fromEntries((await t.list()).rows.map((r) => [r.casual, r.then]));
    expect(byName["Cal Booker"]).toMatchObject({
      place: "reopened",
      replacement: { name: "Pat Booker", at: later(2) },
    });
    expect(byName["Ann Booker"]?.place).toBe("removed");
  });

  it("a rota-sheet sync's removals in one transaction share its urgent mark and later offers", async () => {
    const t = await recordsFirm();
    const [sam, jo, kit] = [
      await t.f.worker(),
      await t.f.worker({ first: "Jo" }),
      await t.f.worker({ first: "Kit" }),
    ];
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(20), headcount: 2 });
    await t.take(sam, shiftId);
    await t.take(jo, shiftId);
    // Both names removed and the session marked urgent in one transaction, as a sync does
    // (src/lib/roster/sheets/sync.ts): one created_at for all its log entries.
    const client = await su.connect();
    try {
      await client.query("begin");
      for (const worker of [sam, jo]) {
        const { rows } = await client.query<{ id: string; slot: number }>(
          `update assignments set status = 'cancelled_firm', cancelled_at = $3, notice_hours = 19,
                  cancel_reason = 'Removed on the rota sheet', cancel_via = 'sheet'
            where shift_id = $1 and worker_id = $2 and status = 'confirmed'
          returning id::text as id, slot`,
          [shiftId, worker, later(1)],
        );
        const booking = rows[0];
        if (!booking) throw new Error("no booking");
        const reopened = await client.query<{ id: string }>(
          `insert into assignments (firm_id, shift_id, slot) values ($1, $2, $3)
           returning id::text as id`,
          [t.f.firmId, shiftId, booking.slot],
        );
        await client.query(
          `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
           values ($1, 'system', 'shift.cancelled', 'assignment', $2, $3)`,
          [
            t.f.firmId,
            booking.id,
            JSON.stringify({
              by: "firm",
              shiftId,
              workerId: worker,
              reason: "Removed on the rota sheet",
              noticeHours: 19,
              strike: "by_firm",
              place: "reopened",
              reopenedId: reopened.rows[0]?.id,
            }),
          ],
        );
      }
      await client.query(
        `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
         values ($1, 'system', 'shift.marked_urgent', 'shift', $2, $3)`,
        [t.f.firmId, shiftId, JSON.stringify({ by: "system", cause: "dropout", hoursToStart: 19 })],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    await t.offer(shiftId, kit, 1);
    const byName = Object.fromEntries((await t.list()).rows.map((r) => [r.casual, r.then]));
    for (const name of ["Sam Booker", "Jo Booker"]) {
      expect(byName[name], name).toMatchObject({
        place: "reopened",
        markedUrgent: true,
        offeredTo: 1,
      });
    }
  });

  it("a later dropout on the same session: its offers go on its own record, not the first one's", async () => {
    const t = await recordsFirm();
    const [sam, jo, kit, ben] = [
      await t.f.worker(),
      await t.f.worker({ first: "Jo" }),
      await t.f.worker({ first: "Kit" }),
      await t.f.worker({ first: "Ben" }),
    ];
    // Two places, 20 hours away: inside the urgent window.
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(20), headcount: 2 });
    await t.take(sam, shiftId);
    await t.take(jo, shiftId);
    await t.cancel(sam, shiftId, later(1), "strike");
    await t.offer(shiftId, kit, 1);
    await t.cancel(jo, shiftId, later(2), "strike");
    await t.offer(shiftId, ben, 2);
    await t.offer(shiftId, kit, 3);
    const byName = Object.fromEntries((await t.list()).rows.map((r) => [r.casual, r.then]));
    // Sam's: the session marked urgent, and Kit's offer before Jo cancelled.
    expect(byName["Sam Booker"]).toMatchObject({
      place: "reopened",
      markedUrgent: true,
      offeredTo: 1,
    });
    // Jo's: already urgent (no new mark); Ben and Kit offered after.
    expect(byName["Jo Booker"]).toMatchObject({
      place: "reopened",
      markedUrgent: false,
      offeredTo: 2,
    });
  });
});

describe("a reference two cancellations share", () => {
  it("lists both to choose from, never picks one; each opens by its full id", async () => {
    const t = await recordsFirm();
    const [sam, jo] = [await t.f.worker(), await t.f.worker({ first: "Jo" })];
    const a = await t.f.shift({ startsAt: hoursFromNow(100) });
    const b = await t.f.shift({ startsAt: hoursFromNow(120) });
    await t.take(sam, a);
    await t.take(jo, b);
    await t.cancel(sam, a, later(1), "notice");
    await t.cancel(jo, b, later(2), "notice");
    // Give Jo's booking an id starting with the same 8 characters as Sam's.
    const ids = async () =>
      Object.fromEntries((await t.list()).rows.map((r) => [r.casual, r.assignmentId]));
    const before = await ids();
    const samId = before["Sam Booker"] ?? "";
    const joId = `${samId.slice(0, 8)}${(before["Jo Booker"] ?? "").slice(8)}`;
    await su.query("update assignments set id = $2 where id = $1", [before["Jo Booker"], joId]);
    const ref = samId.slice(0, 8).toUpperCase();
    expect((await t.list()).rows.map((r) => r.ref)).toEqual([ref, ref]);

    const shared = await t.lookup(ref.toLowerCase());
    expect(shared?.status).toBe("several");
    if (shared?.status !== "several") throw new Error("not several");
    expect(shared.shared.ref).toBe(ref);
    expect(shared.shared.choices.map((r) => [r.casual, r.assignmentId])).toEqual([
      ["Jo Booker", joId],
      ["Sam Booker", samId],
    ]);
    expect((await t.record(samId))?.row.casual).toBe("Sam Booker");
    expect((await t.record(joId.toUpperCase()))?.row.casual).toBe("Jo Booker");
    // Not an id or a reference; another firm's id.
    expect(await t.lookup(`${samId}0`)).toBeNull();
    expect(await (await recordsFirm()).lookup(samId)).toBeNull();
  });
});

describe("who can see it", () => {
  it("admins and resourcers only, and only their own firm's", async () => {
    const t = await recordsFirm();
    const other = await recordsFirm();
    const sam = await t.f.worker();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(100) });
    await t.take(sam, shiftId);
    await t.cancel(sam, shiftId, later(1), "notice");
    const ref = (await t.list()).rows[0]?.ref ?? "";
    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: at(NOW) };
    for (const id of [t.resourcer, await t.f.office("admin")]) {
      const token = await t.tokenFor(id);
      expect((await officeCancellations(ctx, token, "all"))?.rows).toHaveLength(1);
      expect(await officeCancellationRecord(ctx, token, ref)).toMatchObject({
        status: "found",
        record: { row: { ref } },
      });
    }
    for (const id of [await t.f.office("payroll"), await t.f.office("resourcer", "disabled")]) {
      const token = await t.tokenFor(id);
      expect(await officeCancellations(ctx, token, "all")).toBeNull();
      expect(await officeCancellationRecord(ctx, token, ref)).toBeNull();
      expect(
        await logDownload(ctx, token, { kind: "cancellations_csv", view: "all", rows: 1 }),
      ).toBe(false);
    }
    // Another firm: none of its list, and this record isn't there.
    expect((await other.list()).rows).toEqual([]);
    expect(await other.record(ref)).toBeNull();
  });
});

describe("downloads", () => {
  it("each is logged with ids and counts only; the CSV and the PDF never carry a casual's reason", async () => {
    const t = await recordsFirm();
    const sam = await t.f.worker();
    const ben = await t.f.worker({ first: "Ben" });
    const a = await t.f.shift({ startsAt: hoursFromNow(20) });
    const b = await t.f.shift({ startsAt: hoursFromNow(30) });
    await t.take(sam, a);
    await t.take(ben, b);
    await t.cancel(sam, a, later(1), "strike", "I'm unwell");
    // A booking the office cancelled with its own words (before the fixed list).
    await su.query(
      `update assignments set status = 'cancelled_firm', cancelled_at = $2, notice_hours = 25,
              cancel_reason = 'Ben rang: a health problem', cancel_via = 'office'
        where shift_id = $1 and worker_id = $3 and status = 'confirmed'`,
      [b, later(5), ben],
    );
    const list = await t.list();
    const csv = cancellationsCsv(list.rows, { tz: TZ, threshold: 48 });
    expect(csv).toContain("Casual's own reason (see ShiftDesk)");
    expect(csv).toContain("Office's own reason (see ShiftDesk)");
    expect(csv.toLowerCase()).not.toMatch(/unwell|health/);
    const sams = list.rows.find((r) => r.casual === "Sam Booker");
    if (!sams) throw new Error("no record");
    const fields = { tz: TZ, threshold: 48, liveStrikes: 1 };
    // On the page (admins and resourcers): the reason as given.
    expect(recordFields(sams, { ...fields, forExport: false })).toContainEqual({
      label: "Reason",
      value: "I'm unwell",
    });
    const text = await pdfText(
      await recordPdf({
        title: `Cancellation record ${sams.ref}`,
        firmName: list.firmName,
        fields: recordFields(sams, { ...fields, forExport: true }),
        generatedAt: "09:14 on Mon 2 Nov",
      }),
    );
    expect(text).toContain("Casual's own reason (see ShiftDesk)");
    expect(text.toLowerCase()).not.toMatch(/unwell|health/);

    const ctx = { firm: { id: t.f.firmId }, run: withFirm, clock: at(NOW) };
    const token = await t.tokenFor(t.resourcer);
    expect(
      await logDownload(ctx, token, { kind: "cancellation_pdf", assignmentId: sams.assignmentId }),
    ).toBe(true);
    expect(
      await logDownload(ctx, token, { kind: "cancellations_csv", view: "under", rows: 2 }),
    ).toBe(true);
    const { rows } = await su.query(
      `select actor_type, actor_id::text, entity_type, entity_id::text, data from events
        where firm_id = $1 and action = 'export.downloaded' order by id`,
      [t.f.firmId],
    );
    expect(rows).toEqual([
      {
        actor_type: "office",
        actor_id: t.resourcer,
        entity_type: "assignment",
        entity_id: sams.assignmentId,
        data: { kind: "cancellation_pdf", assignmentId: sams.assignmentId },
      },
      {
        actor_type: "office",
        actor_id: t.resourcer,
        entity_type: "firm",
        entity_id: t.f.firmId,
        data: { kind: "cancellations_csv", view: "under", rows: 2 },
      },
    ]);
  });
});

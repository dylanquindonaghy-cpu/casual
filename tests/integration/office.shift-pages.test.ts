import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { assignWorker, markUrgent } from "@/lib/office/quick-actions";
import { officeShiftDetail, officeShiftForm, officeShiftList } from "@/lib/office/shift-pages";
import { cancelBooking } from "@/lib/roster/cancel";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office's shift pages (src/lib/office/shift-pages.ts) and "Assign" (assignWorker → the one
// booking path) on the real database, as the app role. NOW is Monday 2 November 2026, 09:00.

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

async function pagesFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  const token = async (officeUserId = resourcer) =>
    (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
      )
    ).token;
  const ctx = { firm: { id: f.firmId }, run: withFirm, clock: { now: () => NOW } };
  const octx = {
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: { now: () => NOW },
  };
  return { f, resourcer, token, ctx, octx };
}

describe("the shift list", () => {
  it("4 weeks from the chosen day, soonest first, with how many are booked", async () => {
    const t = await pagesFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const soon = await t.f.shift({ startsAt: hoursFromNow(20), headcount: 2 });
    await t.f.booking(ann, soon, "confirmed", 1);
    const later = await t.f.shift({ startsAt: hoursFromNow(24 * 10), status: "draft" });
    await t.f.shift({ startsAt: hoursFromNow(24 * 30) }); // after the 4 weeks
    await t.f.shift({ startsAt: hoursFromNow(-24) }); // before the chosen day
    const list = await officeShiftList(t.ctx, await t.token(), NOW);
    expect(list?.shifts.map((s) => [s.shiftId, s.booked, s.headcount, s.status])).toEqual([
      [soon, 1, 2, "open"],
      [later, 0, 1, "draft"],
    ]);
    expect(list?.more).toBe(false);
    expect(list?.until).toEqual(hoursFromNow(24 * 28));
  });

  it("payroll and other firms' sessions get nothing", async () => {
    const t = await pagesFirm();
    const payroll = await t.f.office("payroll");
    expect(await officeShiftList(t.ctx, await t.token(payroll), NOW)).toBeNull();
    const other = await pagesFirm();
    expect(await officeShiftList(other.ctx, await t.token(), NOW)).toBeNull();
  });

  it("the form's sites and the roles in use", async () => {
    const t = await pagesFirm();
    await su.query("insert into sites (firm_id, name) values ($1, 'Zed Hall'), ($1, 'Arena')", [
      t.f.firmId,
    ]);
    await t.f.worker({ first: "Ann", roles: ["steward", "car_park"] });
    const form = await officeShiftForm(t.ctx, await t.token());
    expect(form?.sites.map((s) => s.name)).toEqual(["Arena", "Zed Hall"]);
    expect(form?.roles).toEqual(expect.arrayContaining(["car_park", "steward", "door_supervisor"]));
  });
});

describe("the shift page", () => {
  it("places, cancellations, offers and history in plain words, newest first", async () => {
    const t = await pagesFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const ben = await t.f.worker({ first: "Ben" });
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(48), headcount: 2 });
    expect(await assignWorker(t.octx, shiftId, ann, null)).toMatchObject({ status: "booked" });
    expect(await assignWorker(t.octx, shiftId, ben, null)).toMatchObject({ status: "booked" });
    await cancelBooking(
      withFirm,
      t.f.firmId,
      { shiftId, workerId: ben, reason: "I'm unwell", by: { type: "worker", id: ben } },
      { clock: { now: () => NOW } },
    );
    await markUrgent(t.octx, shiftId, true);
    const page = await officeShiftDetail(t.ctx, await t.token(), shiftId);
    expect(page?.shift).toMatchObject({ booked: 1, headcount: 2, isUrgent: true, started: false });
    expect(page?.edit).toEqual({
      date: "2026-11-04",
      start: "09:00",
      end: "17:00",
      editable: true,
    });
    expect(page?.places.map((p) => [p.worker, p.status, p.noticeHours, p.reason])).toEqual([
      ["Ann Booker", "confirmed", null, null],
      ["Ben Booker", "cancelled_worker", 48, "I'm unwell"],
    ]);
    expect(page?.history.map((h) => h.words)).toEqual([
      "Office Person marked it urgent.",
      "Ben Booker cancelled, with 2 days' notice.",
      "Office Person placed Ben Booker.",
      "Office Person placed Ann Booker.",
    ]);
    // The picker: active people with the role, not already on it.
    expect(page?.people.map((p) => p.name)).toEqual(["Ben Booker"]);
  });

  it("checking someone shows the rules' answer, and whether the office may override it", async () => {
    const t = await pagesFirm();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(48) }); // Wed 4 Nov
    const ok = await t.f.worker({ first: "Ok" });
    const away = await t.f.worker({ first: "Away" });
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-04')",
      [t.f.firmId, away],
    );
    const nia = await t.f.worker({ first: "Nia", credentials: [] });
    const check = async (workerId: string) =>
      (await officeShiftDetail(t.ctx, await t.token(), shiftId, workerId))?.check;
    expect(await check(ok)).toMatchObject({ name: "Ok Booker", ok: true, overridable: false });
    expect(await check(away)).toMatchObject({
      ok: false,
      codes: ["unavailable"],
      overridable: true,
    });
    expect(await check(nia)).toMatchObject({ ok: false, overridable: false });
    expect(await check("not-an-id")).toBeNull();
  });

  it("not another firm's shift, a non-id, or for payroll", async () => {
    const t = await pagesFirm();
    const other = await pagesFirm();
    const theirs = await other.f.shift({});
    expect(await officeShiftDetail(t.ctx, await t.token(), theirs)).toBeNull();
    expect(await officeShiftDetail(t.ctx, await t.token(), "nope")).toBeNull();
    const mine = await t.f.shift({});
    const payroll = await t.f.office("payroll");
    expect(await officeShiftDetail(t.ctx, await t.token(payroll), mine)).toBeNull();
  });
});

describe("Assign", () => {
  const eventOf = async (firmId: string) =>
    (
      await su.query<{ actor_type: string; data: Record<string, unknown> }>(
        "select actor_type, data from events where firm_id = $1 and action = 'shift.assigned'",
        [firmId],
      )
    ).rows;

  it("books someone the rules allow, logged as the office's", async () => {
    const t = await pagesFirm();
    const ann = await t.f.worker({ first: "Ann" });
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(48) });
    expect(await assignWorker(t.octx, shiftId, ann, null)).toMatchObject({
      status: "booked",
      overridden: [],
    });
    expect(await eventOf(t.f.firmId)).toEqual([
      {
        actor_type: "office",
        data: expect.objectContaining({ by: "firm", shiftId, workerId: ann }),
      },
    ]);
  });

  it("a day off: refused, unless the office overrides it with a reason (logged)", async () => {
    const t = await pagesFirm();
    const away = await t.f.worker({ first: "Away" });
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-04')",
      [t.f.firmId, away],
    );
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(48) });
    expect(await assignWorker(t.octx, shiftId, away, null)).toMatchObject({
      status: "not_eligible",
      codes: ["unavailable"],
    });
    expect(
      await assignWorker(t.octx, shiftId, away, {
        codes: ["unavailable"],
        reason: "Rang in: can do it",
      }),
    ).toMatchObject({ status: "booked", overridden: ["unavailable"] });
    const [event] = await eventOf(t.f.firmId);
    expect(event?.data).toMatchObject({
      overridden: ["unavailable"],
      reason: "Rang in: can do it",
    });
  });

  it("a reason with a phone number is refused (the log never holds personal details)", async () => {
    const t = await pagesFirm();
    const away = await t.f.worker({ first: "Away" });
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-04')",
      [t.f.firmId, away],
    );
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(48) });
    expect(
      await assignWorker(t.octx, shiftId, away, {
        codes: ["unavailable"],
        reason: "call 07700 900123",
      }),
    ).toEqual({ status: "invalid_reason" });
  });

  it("no licence can't be overridden, even when the office asks", async () => {
    const t = await pagesFirm();
    const nia = await t.f.worker({ first: "Nia", credentials: [] });
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(48) });
    expect(
      await assignWorker(t.octx, shiftId, nia, {
        codes: ["started", "rest", "weekly_hours", "unavailable"],
        reason: "Short staffed",
      }),
    ).toMatchObject({ status: "not_eligible" });
    expect(await eventOf(t.f.firmId)).toEqual([]);
  });

  it("payroll can't place anyone", async () => {
    const t = await pagesFirm();
    const payroll = await t.f.office("payroll");
    const ann = await t.f.worker({ first: "Ann" });
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(48) });
    expect(await assignWorker({ ...t.octx, officeUserId: payroll }, shiftId, ann, null)).toEqual({
      status: "not_allowed",
    });
  });
});

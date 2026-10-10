import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadToday, todayView } from "@/lib/office/today";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office's Today view (src/lib/office/today.ts) on the real database, as the app role. NOW is
// Monday 2 November 2026, 09:00 London (GMT).

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

// A cancellation recorded `hoursAgo`, as the worker's or the office's.
async function cancelled(
  f: BookingFirm,
  workerId: string,
  shiftId: string,
  hoursAgo: number,
  o: { byFirm?: boolean; reason?: string; notice?: number; slot?: number } = {},
) {
  const { rows } = await su.query<{ id: string }>(
    `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at,
                              cancelled_at, cancel_reason, notice_hours)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id::text as id`,
    [
      f.firmId,
      shiftId,
      o.slot ?? 1,
      workerId,
      o.byFirm ? "cancelled_firm" : "cancelled_worker",
      hoursFromNow(-100),
      hoursFromNow(-hoursAgo),
      o.reason ?? "I'm unwell",
      o.notice ?? 30,
    ],
  );
  return rows[0]?.id ?? "";
}

async function credential(
  f: BookingFirm,
  workerId: string,
  expiresOn: string | null,
  status = "valid",
) {
  await su.query(
    "insert into credentials (firm_id, worker_id, type, status, expires_on) values ($1, $2, 'PTS', $3, $4)",
    [f.firmId, workerId, status, expiresOn],
  );
}

async function todayFirm() {
  const f = await bookingFirm(su, withFirm);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });

  // Gaps: two places tomorrow with Ann on one; full, past, far off, draft and cancelled don't count.
  const tomorrow = await f.shift({ startsAt: hoursFromNow(20), headcount: 2 });
  await f.booking(ann, tomorrow, "confirmed", 1);
  const full = await f.shift({ startsAt: hoursFromNow(30) });
  await f.booking(ben, full);
  await f.shift({ startsAt: hoursFromNow(-2) });
  await f.shift({ startsAt: hoursFromNow(24 * 8) });
  await f.shift({ startsAt: hoursFromNow(22), status: "draft" });
  await f.shift({ startsAt: hoursFromNow(23), status: "cancelled" });
  const inAWeek = await f.shift({ startsAt: hoursFromNow(24 * 7 - 1) });

  // An urgent shift at 19:00: wave 1 to Ann and Ben (Ben's failed), then the office offered Cal;
  // the waves stopped for want of people, and the office was emailed.
  const urgent = await f.shift({ startsAt: hoursFromNow(10) });
  await su.query("update shifts set is_urgent = true where id = $1", [urgent]);
  const cal = await f.worker({ first: "Cal" });
  const resourcer = await f.office("resourcer");
  const offer = (worker: string, wave: number | null, response: string | null, at: Date) =>
    su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, offered_by, channel, sent_at,
                           response, responded_at)
       values ($1, $2, $3, $4, $5, 'whatsapp', $6, $7, case when $7::text is null then null else $6::timestamptz end)`,
      [f.firmId, urgent, worker, wave, wave === null ? resourcer : null, at, response],
    );
  await offer(ann, 1, null, hoursFromNow(-1));
  await offer(ben, 1, "failed", hoursFromNow(-1));
  await offer(cal, null, null, hoursFromNow(-0.5));
  const event = (action: string, data: Record<string, unknown>) =>
    su.query(
      "insert into events (firm_id, actor_type, action, entity_type, entity_id, data) values ($1, 'system', $2, 'shift', $3, $4)",
      [f.firmId, action, urgent, JSON.stringify(data)],
    );
  await event("offer.waves_stopped", { reason: "no_candidates", wave: 2 });
  await event("shift.escalated", { notified: 1 });

  // Cancellations: two in the last 24 hours (one by the office), one older.
  const c1 = await f.shift({ startsAt: hoursFromNow(40) });
  const c2 = await f.shift({ startsAt: hoursFromNow(50) });
  const c3 = await f.shift({ startsAt: hoursFromNow(60) });
  const recent = await cancelled(f, ann, c1, 2, { notice: 40, reason: "Travel problem" });
  const byOffice = await cancelled(f, ben, c2, 1, {
    byFirm: true,
    notice: 49,
    reason: "Venue closed",
  });
  await cancelled(f, cal, c3, 30);

  // Requests: three waiting, one answered (declined by the office).
  const request = (type: string, status: string, shiftId: string | null) =>
    su.query(
      `insert into requests (firm_id, worker_id, shift_id, type, status, resolved_by, resolved_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        f.firmId,
        ann,
        shiftId,
        type,
        status,
        status === "declined" ? resourcer : null,
        status === "declined" ? hoursFromNow(-1) : null,
      ],
    );
  await request("time_change", "open", tomorrow);
  await request("time_change", "open", c1);
  await request("swap", "escalated", tomorrow);
  await request("general", "declined", null);
  // A question from the shifts line, still open: counted by Enquiries' Need a person, not here
  // (12D.1).
  await request("general", "open", null);

  // Credentials: Dee's PTS card expires on Thursday; Eve renewed hers; Fay left; Gus's is in 10 days.
  const dee = await f.worker({ first: "Dee" });
  await credential(f, dee, "2026-11-05");
  const eve = await f.worker({ first: "Eve" });
  await credential(f, eve, "2026-11-04");
  await credential(f, eve, "2027-11-04");
  const fay = await f.worker({ first: "Fay", status: "inactive" });
  await credential(f, fay, "2026-11-03");
  const gus = await f.worker({ first: "Gus" });
  await credential(f, gus, "2026-11-12");

  return { f, tomorrow, inAWeek, urgent, recent, byOffice, resourcer };
}

describe("loadToday", () => {
  it("shows each section from the firm's own rows", async () => {
    const t = await todayFirm();
    const view = await withFirm(t.f.firmId, (tx) => loadToday(tx, NOW));

    expect(view.timeZone).toBe("Europe/London");
    expect(view.urgent).toEqual([
      expect.objectContaining({
        shiftId: t.urgent,
        placesLeft: 1,
        wave: 1,
        offered: 2, // Ann's and the office's to Cal (Ben's failed)
        byOffice: 1,
        accepted: 0,
        failed: 1,
        stopped: "no_candidates",
        escalated: true,
      }),
    ]);
    expect(view.gaps.map((g) => [g.shiftId, g.placesLeft, g.headcount])).toEqual([
      [t.tomorrow, 1, 2],
      [expect.any(String), 1, 1], // Tue 21:00 (c1's shift, reopened by its cancellation)
      [expect.any(String), 1, 1], // c2
      [expect.any(String), 1, 1], // c3
      [t.inAWeek, 1, 1],
    ]);
    expect(view.gapsMore).toBe(false);
    expect(
      view.cancellations.map((c) => [c.assignmentId, c.byFirm, c.noticeHours, c.reason]),
    ).toEqual([
      [t.byOffice, true, 49, "Venue closed"],
      [t.recent, false, 40, "Travel problem"],
    ]);
    expect(view.cancellations[1]).toMatchObject({ worker: "Ann Booker", role: "door_supervisor" });
    expect(view.requests).toEqual({ total: 3, byType: { time_change: 2, swap: 1 } });
    expect(view.expiring).toEqual([
      { worker: "Dee Booker", credential: "PTS", expiresOn: "2026-11-05" },
    ]);
  });

  it("an old stop isn't shown once a later offer went (a second dropout restarted the waves)", async () => {
    const t = await todayFirm();
    const zed = await t.f.worker({ first: "Zed" });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
       values ($1, $2, $3, 3, 'sms', $4)`,
      [t.f.firmId, t.urgent, zed, NOW],
    );
    const view = await withFirm(t.f.firmId, (tx) => loadToday(tx, NOW));
    expect(view.urgent[0]).toMatchObject({ wave: 3, offered: 3, stopped: null });
  });

  it("an urgent shift that's full or has started isn't listed; one closed by the office isn't either", async () => {
    const t = await todayFirm();
    await su.query("update shifts set status = 'filled' where id = $1", [t.urgent]);
    const view = await withFirm(t.f.firmId, (tx) => loadToday(tx, NOW));
    expect(view.urgent).toEqual([]);
    expect(view.gaps.map((g) => g.shiftId)).not.toContain(t.urgent);
  });

  it("never shows another firm's rows", async () => {
    const mine = await bookingFirm(su, withFirm);
    const other = await todayFirm(); // another firm, full of data
    // Including a WhatsApp from a number it doesn't know.
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, handled_as, handled_at)
       values ($1, 'in', 'whatsapp', $2, '+447700900986', '+447700900985', 'hello', 'unknown', now())`,
      [other.f.firmId, `SM${"a".repeat(32)}`],
    );
    const view = await withFirm(mine.firmId, (tx) => loadToday(tx, NOW));
    expect(view).toMatchObject({
      urgent: [],
      gaps: [],
      cancellations: [],
      requests: { total: 0, byType: {} },
      expiring: [],
      unknownMessages: [],
    });
  });

  it("says when there are more than 50 gaps", async () => {
    const f = await bookingFirm(su, withFirm);
    await su.query(
      `insert into shifts (firm_id, event_id, role, starts_at, ends_at, headcount, status, source)
       select $1, $3, 'steward', $2::timestamptz + (n || ' minutes')::interval,
              $2::timestamptz + (n || ' minutes')::interval + interval '8 hours', 1, 'open', 'native'
         from generate_series(1, 51) as n`,
      [f.firmId, hoursFromNow(5), await f.event()],
    );
    const view = await withFirm(f.firmId, (tx) => loadToday(tx, NOW));
    expect(view.gaps).toHaveLength(50);
    expect(view.gapsMore).toBe(true);
  });
});

describe("todayView: who may see it", () => {
  const ctx = (firmId: string) => ({
    firm: { id: firmId },
    run: withFirm,
    clock: { now: () => NOW },
  });
  const sessionFor = async (firmId: string, officeUserId: string) =>
    (
      await withFirm(firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: officeUserId, now: NOW }),
      )
    ).token;

  it("admins and resourcers; not payroll; not logged out; not another firm's session", async () => {
    const t = await todayFirm();
    const admin = await t.f.office("admin");
    const payroll = await t.f.office("payroll");
    const view = await todayView(ctx(t.f.firmId), await sessionFor(t.f.firmId, t.resourcer));
    expect(view?.officeUser).toMatchObject({ id: t.resourcer, role: "resourcer" });
    expect(view?.urgent).toHaveLength(1);
    expect(await todayView(ctx(t.f.firmId), await sessionFor(t.f.firmId, admin))).not.toBeNull();
    expect(await todayView(ctx(t.f.firmId), await sessionFor(t.f.firmId, payroll))).toBeNull();
    expect(await todayView(ctx(t.f.firmId), "")).toBeNull();
    const other = await bookingFirm(su, withFirm);
    expect(
      await todayView(ctx(other.firmId), await sessionFor(t.f.firmId, t.resourcer)),
    ).toBeNull();
  });
});

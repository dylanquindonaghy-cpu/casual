import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import type { OutboundMessage } from "@/lib/messaging/transport";
import {
  ESCALATE_SHIFT_QUEUE,
  OFFER_WAVE_QUEUE,
  runEscalation,
  runOfferWave,
  type OfferDeps,
} from "@/lib/offers/waves";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { setShiftUrgent } from "@/lib/roster/urgent";
import { QUEUES } from "@/worker/jobs/queues";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Offer waves and escalation on the real database, as the app role, with a capturing transport
// (nothing is sent anywhere) and a fixed clock. NOW is Monday 2 November 2026, 09:00 London.

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

const later = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

// A fair-rotation firm (groups of 2, 15 minutes, escalation 3 hours before), an urgent door
// supervisor shift at 19:00 today with one place, and workers with 0, 8, 16 and 24 hours booked
// later this week, plus three who must never get it.
async function waveFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, {
    settings: {
      allocation_mode: "fair_rotation",
      wave_size: 2,
      wave_minutes: 15,
      escalate_hours_before_start: 3,
      ...settings,
    },
  });
  const worker = async (first: string, o: Parameters<BookingFirm["worker"]>[0] = {}) => {
    const id = await f.worker({ first, ...o });
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [id],
    );
    return { id, mobile: rows[0]?.mobile ?? "" };
  };
  const ann = await worker("Ann");
  const ben = await worker("Ben");
  const cal = await worker("Cal");
  const dee = await worker("Dee");
  const nia = await worker("Nia", { credentials: [] }); // no licence: the rules say no
  const off = await worker("Off"); // turned open-shift messages off
  await su.query("update workers set offer_alerts = false where id = $1", [off.id]);
  await su.query("update workers set notify_channel = 'sms' where id = $1", [ben.id]);
  let slot = 1;
  for (const [w, count] of [
    [ben, 1],
    [cal, 2],
    [dee, 3],
  ] as const) {
    for (const h of [72, 96, 120].slice(0, count)) {
      await f.booking(w.id, await f.shift({ startsAt: hoursFromNow(h) }), "confirmed", slot);
    }
    slot += 1;
  }
  const shiftId = await f.shift({ startsAt: hoursFromNow(10) }); // 19:00 today, until 03:00
  await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
  const { transport, sent } = captureTransport();
  const deps = (when = NOW): OfferDeps => ({
    transport,
    baseDomain: "localhost:3000",
    clock: { now: () => when },
  });
  const slug = (
    await su.query<{ slug: string }>("select slug from firms where id = $1", [f.firmId])
  ).rows[0]?.slug;
  const wave = (n: number, when = NOW) =>
    withFirm(f.firmId, (tx) =>
      runOfferWave(
        { firmId: f.firmId, idempotencyKey: `t:${n}`, shiftId, wave: n },
        tx,
        deps(when),
      ),
    );
  const escalate = (when: Date) =>
    withFirm(f.firmId, (tx) =>
      runEscalation({ firmId: f.firmId, idempotencyKey: "t:e", shiftId }, tx, deps(when)),
    );
  return { f, shiftId, ann, ben, cal, dee, nia, off, sent, wave, escalate, slug };
}

const queued = async (shiftId: string) =>
  (
    await su.query<{ name: string; data: Record<string, unknown>; start_after: Date }>(
      `select name, data, start_after from pgboss.job where data ->> 'shiftId' = $1
        order by name, (data ->> 'wave')::int nulls first`,
      [shiftId],
    )
  ).rows;
const offersOf = async (shiftId: string) =>
  (
    await su.query(
      `select worker_id::text, wave, channel, response from offers where shift_id = $1
        order by wave, worker_id`,
      [shiftId],
    )
  ).rows;
const phones = (sent: OutboundMessage[]) => sent.map((m) => (m.channel === "email" ? "" : m.to));

describe("starting the waves", () => {
  it("a dropout inside the urgent window queues wave 1 now and the escalation for 3 hours before", async () => {
    const f = await bookingFirm(su, withFirm, { settings: { escalate_hours_before_start: 3 } });
    const zed = await f.worker({ first: "Zed" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(10) });
    await f.booking(zed, shiftId);
    await cancelBooking(
      withFirm,
      f.firmId,
      { shiftId, workerId: zed, reason: "I'm unwell", by: { type: "worker", id: zed } },
      { clock: { now: () => NOW } },
    );
    const jobs = await queued(shiftId);
    expect(jobs.map((j) => [j.name, j.data])).toEqual([
      [
        ESCALATE_SHIFT_QUEUE,
        { firmId: f.firmId, idempotencyKey: `escalate-shift:${shiftId}`, shiftId },
      ],
      [
        OFFER_WAVE_QUEUE,
        { firmId: f.firmId, idempotencyKey: `offer-wave:${shiftId}:1`, shiftId, wave: 1 },
      ],
    ]);
    expect(jobs[0]?.start_after).toEqual(hoursFromNow(7)); // 19:00 minus 3 hours
    // Ids only in the payloads: never a phone number, name or message.
    expect(JSON.stringify(jobs)).not.toMatch(/\+44|Zed|unwell/);
  });

  it("a second dropout on a shift that's already urgent queues the next wave, without marking it again", async () => {
    const t = await waveFirm();
    await t.wave(1); // Ann and Ben offered
    const zed = await t.f.worker({ first: "Zed" });
    await t.f.booking(zed, t.shiftId);
    await cancelBooking(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: zed, reason: "I'm unwell", by: { type: "worker", id: zed } },
      { clock: { now: () => later(5) } },
    );
    const waves = (await queued(t.shiftId)).filter((j) => j.name === OFFER_WAVE_QUEUE);
    expect(waves.map((j) => j.data.wave)).toContain(2);
    const { rows } = await su.query(
      "select count(*)::int as n from events where firm_id = $1 and action = 'shift.marked_urgent'",
      [t.f.firmId],
    );
    expect(rows).toEqual([{ n: 0 }]); // it was marked urgent by hand in the fixture
  });

  it("a nonsense escalation setting never stops a cancellation; the escalation is due at once when its time has passed", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { escalate_hours_before_start: "soon" },
    });
    const zed = await f.worker({ first: "Zed" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(2) }); // inside the default 3 hours
    await f.booking(zed, shiftId);
    const result = await cancelBooking(
      withFirm,
      f.firmId,
      { shiftId, workerId: zed, reason: "I'm unwell", by: { type: "worker", id: zed } },
      { clock: { now: () => NOW } },
    );
    expect(result.status).toBe("cancelled");
    const jobs = await queued(shiftId);
    expect(jobs.map((j) => j.name)).toEqual([ESCALATE_SHIFT_QUEUE, OFFER_WAVE_QUEUE]);
    const { rows } = await su.query<{ due: boolean }>(
      "select start_after <= now() as due from pgboss.job where name = $1 and data ->> 'shiftId' = $2",
      [ESCALATE_SHIFT_QUEUE, shiftId],
    );
    expect(rows).toEqual([{ due: true }]);
  });

  it("the office marking a shift urgent starts them too; a dropout far ahead doesn't", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const marked = await f.shift({ startsAt: hoursFromNow(72) });
    await setShiftUrgent(
      withFirm,
      f.firmId,
      { shiftId: marked, urgent: true, by: { type: "office", id: resourcer } },
      { clock: { now: () => NOW } },
    );
    expect((await queued(marked)).map((j) => j.name)).toEqual([
      ESCALATE_SHIFT_QUEUE,
      OFFER_WAVE_QUEUE,
    ]);
    const zed = await f.worker({ first: "Zed" });
    const far = await f.shift({ startsAt: hoursFromNow(72) });
    await f.booking(zed, far);
    await cancelBooking(
      withFirm,
      f.firmId,
      { shiftId: far, workerId: zed, reason: "I'm unwell", by: { type: "worker", id: zed } },
      { clock: { now: () => NOW } },
    );
    expect(await queued(far)).toEqual([]);
  });
});

describe("a wave", () => {
  it("goes to the 2 best eligible workers, then the next 2 after 15 minutes; never the rest", async () => {
    const t = await waveFirm();
    expect(await t.wave(1)).toEqual({ status: "sent", sent: 2, next: 2 });
    // Ann (0 hours) and Ben (8): Ben by text message, as his profile says.
    expect(await offersOf(t.shiftId)).toEqual(
      [
        { worker_id: t.ann.id, wave: 1, channel: "whatsapp", response: null },
        { worker_id: t.ben.id, wave: 1, channel: "sms", response: null },
      ].sort((a, b) => a.worker_id.localeCompare(b.worker_id)),
    );
    expect(t.sent.map((m) => [m.channel, m.channel === "email" ? "" : m.to]).sort()).toEqual(
      [
        ["sms", t.ben.mobile],
        ["whatsapp", t.ann.mobile],
      ].sort(),
    );
    const body = t.sent[0] && "body" in t.sent[0] ? t.sent[0].body : "";
    expect(body).toBe(
      `URGENT: we need a door supervisor today 19:00–03:00. Tap to take it: http://${t.slug}.localhost:3000/shifts/${t.shiftId}. — Booking Test ${t.slug} Shift Team`,
    );
    // Wave 2 is queued for 15 minutes later.
    const next = (await queued(t.shiftId)).find((j) => j.data.wave === 2);
    expect(next?.start_after).toEqual(later(15));

    // Asking again for wave 1 (a retry) sends nothing more.
    expect(await t.wave(1)).toEqual({ status: "already_sent" });
    expect(t.sent).toHaveLength(2);

    // Wave 2: Cal and Dee. Never Nia (no licence) or Off (messages off). Nobody left after that.
    expect(await t.wave(2, later(15))).toEqual({ status: "sent", sent: 2, next: null });
    expect(phones(t.sent).slice(2).sort()).toEqual([t.cal.mobile, t.dee.mobile].sort());
    expect(phones(t.sent)).not.toContain(t.nia.mobile);
    expect(phones(t.sent)).not.toContain(t.off.mobile);
    expect(await t.wave(3, later(30))).toEqual({ status: "stopped", reason: "no_candidates" });

    const { rows } = await su.query(
      "select action, count(*)::int as n from events where firm_id = $1 and action like 'offer.%' group by action order by action",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      { action: "offer.sent", n: 4 },
      { action: "offer.waves_stopped", n: 1 },
    ]);
  });

  it("stops when the shift is filled; the taker's offer is accepted, the others' filled elsewhere", async () => {
    const t = await waveFirm();
    await t.wave(1);
    const booked = await bookShift(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: t.ann.id, by: { type: "worker", id: t.ann.id } },
      { clock: { now: () => later(5) } },
    );
    expect(booked.status).toBe("booked");
    expect(await t.wave(2, later(15))).toEqual({ status: "stopped", reason: "filled" });
    expect((await offersOf(t.shiftId)).map((o) => [o.worker_id, o.response]).sort()).toEqual(
      [
        [t.ann.id, "accepted"],
        [t.ben.id, "filled_elsewhere"],
      ].sort(),
    );
    expect(t.sent).toHaveLength(2); // nothing new
  });

  it("an offered worker the office placed took it; only the others were filled elsewhere", async () => {
    const t = await waveFirm();
    await t.wave(1); // Ann and Ben
    await t.f.booking(t.ben.id, t.shiftId); // the office placed Ben (he rang in)
    expect(await t.wave(2, later(15))).toEqual({ status: "stopped", reason: "filled" });
    expect((await offersOf(t.shiftId)).map((o) => [o.worker_id, o.response]).sort()).toEqual(
      [
        [t.ann.id, "filled_elsewhere"],
        [t.ben.id, "accepted"],
      ].sort(),
    );
  });

  it("stops when the office clears the urgent mark, and there's nothing to escalate", async () => {
    const t = await waveFirm();
    await t.f.office("resourcer");
    await t.wave(1);
    await su.query("update shifts set is_urgent = false where id = $1", [t.shiftId]);
    expect(await t.wave(2, later(15))).toEqual({ status: "stopped", reason: "not_urgent" });
    expect(await t.escalate(hoursFromNow(7))).toEqual({ status: "not_needed" });
    expect(t.sent).toHaveLength(2); // only wave 1's
  });

  it("stops once the shift has started or is no longer open", async () => {
    const t = await waveFirm();
    expect(await t.wave(1, hoursFromNow(10))).toEqual({ status: "stopped", reason: "started" });
    await su.query("update shifts set status = 'cancelled' where id = $1", [t.shiftId]);
    expect(await t.wave(1)).toEqual({ status: "stopped", reason: "not_open" });
    expect(t.sent).toEqual([]);
  });

  it("first come, first served offers everyone eligible at once, with no second wave", async () => {
    const t = await waveFirm({ allocation_mode: "first_come_first_served" });
    expect(await t.wave(1)).toEqual({ status: "sent", sent: 4, next: null });
    expect(phones(t.sent).sort()).toEqual(
      [t.ann.mobile, t.ben.mobile, t.cal.mobile, t.dee.mobile].sort(),
    );
    expect((await queued(t.shiftId)).filter((j) => j.name === OFFER_WAVE_QUEUE)).toEqual([]);
  });

  it("never offers it back to someone who cancelled it, and never another firm's workers", async () => {
    const t = await waveFirm({ allocation_mode: "first_come_first_served" });
    const other = await bookingFirm(su, withFirm);
    await other.worker({ first: "Kit" });
    await su.query(
      `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at,
         cancelled_at, cancel_reason, notice_hours)
       values ($1, $2, 1, $3, 'cancelled_worker', $4, $4, 'I''m unwell', 10)`,
      [t.f.firmId, t.shiftId, t.ann.id, NOW],
    );
    await t.wave(1);
    expect(phones(t.sent).sort()).toEqual([t.ben.mobile, t.cal.mobile, t.dee.mobile].sort());
  });
});

describe("escalation", () => {
  it("emails the office's active admins and resourcers once, if a place is still free", async () => {
    const t = await waveFirm();
    await t.f.office("admin");
    await t.f.office("resourcer");
    await t.f.office("payroll");
    await t.f.office("resourcer", "disabled");
    await t.wave(1);
    expect(await t.escalate(hoursFromNow(7))).toEqual({ status: "escalated", notified: 2 });
    const emails = t.sent.filter((m) => m.channel === "email");
    expect(emails).toHaveLength(2);
    expect(emails[0]).toMatchObject({
      subject: "Unfilled: Door supervisor, Mon 2 Nov, 19:00 to 03:00 Tue",
    });
    expect(emails[0] && "body" in emails[0] ? emails[0].body : "").toContain(
      "The door supervisor shift, Mon 2 Nov, 19:00 to 03:00 Tue, still has 1 place free.",
    );
    expect(emails[0] && "body" in emails[0] ? emails[0].body : "").toContain("2 offers sent");
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'shift.escalated'",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      { data: { freePlaces: 1, offersSent: 2, notified: 2, hoursToStart: 3 } },
    ]);
    // Once only.
    expect(await t.escalate(hoursFromNow(8))).toEqual({ status: "already" });
  });

  it("does nothing once the shift is filled", async () => {
    const t = await waveFirm();
    await t.f.office("resourcer");
    await t.f.booking(t.ann.id, t.shiftId);
    expect(await t.escalate(hoursFromNow(7))).toEqual({ status: "not_needed" });
    expect(t.sent).toEqual([]);
  });
});

describe("wiring", () => {
  it("db:migrate and the worker create both queues", () => {
    const names = QUEUES.map((q) => q.name);
    expect(names).toContain(OFFER_WAVE_QUEUE);
    expect(names).toContain(ESCALATE_SHIFT_QUEUE);
  });
});

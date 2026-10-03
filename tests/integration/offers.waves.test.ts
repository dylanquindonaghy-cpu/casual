import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { ChannelRefusedError, type OutboundMessage } from "@/lib/messaging/transport";
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
import type { PushTransport } from "@/lib/push/transport";
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
async function waveFirm(settings: Record<string, unknown> = {}, startsInHours = 10) {
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
  const shiftId = await f.shift({ startsAt: hoursFromNow(startsInHours) }); // 19:00 today by default
  await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
  const { transport: capture, sent } = captureTransport();
  // `refuseWhatsApp`: the provider refuses WhatsApp (a number that isn't on it). `failFor`: sends to
  // these numbers fail some other way (a timeout, an outage); `failSms` makes texts fail too.
  const sendState = { refuseWhatsApp: false, failFor: [] as string[], failSms: false };
  const transport: typeof capture = {
    name: "capture",
    async send(message) {
      if (message.channel !== "email" && sendState.failFor.includes(message.to)) {
        throw new Error("timed out");
      }
      if (sendState.refuseWhatsApp && message.channel === "whatsapp") {
        throw new ChannelRefusedError("whatsapp");
      }
      if (sendState.failSms && message.channel === "sms") throw new Error("sms outage");
      return capture.send(message);
    },
  };
  // Pushes are captured too; `gone` makes the push service say a subscription no longer exists.
  const pushed: { endpoint: string; title: string; body: string; url: string }[] = [];
  const pushState = { gone: false };
  const push: PushTransport = {
    name: "capture",
    async send(target, payload) {
      if (pushState.gone) return { status: "gone" };
      pushed.push({ endpoint: target.endpoint, ...payload });
      return { status: "sent" };
    },
  };
  const deps = (when = NOW): OfferDeps => ({
    transport,
    push,
    baseDomain: "localhost:3000",
    clock: { now: () => when },
  });
  const slug = (
    await su.query<{ slug: string }>("select slug from firms where id = $1", [f.firmId])
  ).rows[0]?.slug;
  const wave = (n: number, when = NOW) =>
    runOfferWave(
      { firmId: f.firmId, idempotencyKey: `t:${n}`, shiftId, wave: n },
      withFirm,
      deps(when),
    );
  const escalate = (when: Date) =>
    runEscalation({ firmId: f.firmId, idempotencyKey: "t:e", shiftId }, withFirm, deps(when));
  return {
    f,
    shiftId,
    ann,
    ben,
    cal,
    dee,
    nia,
    off,
    sent,
    pushed,
    pushState,
    sendState,
    wave,
    escalate,
    slug,
  };
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

  it("also pushes to each phone an offered worker turned notifications on for", async () => {
    const t = await waveFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/ann-phone', 'k', 'a')`,
      [t.f.firmId, t.ann.id],
    );
    await t.wave(1); // Ann and Ben: only Ann has a phone subscribed
    expect(t.pushed).toEqual([
      {
        endpoint: "https://push.example.test/ann-phone",
        title: "Urgent shift",
        body: "Door supervisor needed today 19:00.",
        url: `/shifts/${t.shiftId}`, // the path: opened on whichever address the phone uses
      },
    ]);
    const { rows } = await su.query(
      "select data ->> 'workerId' as worker, (data ->> 'pushes')::int as pushes from events where firm_id = $1 and action = 'offer.sent'",
      [t.f.firmId],
    );
    expect(rows.find((r) => r.worker === t.ann.id)?.pushes).toBe(1);
    expect(rows.find((r) => r.worker === t.ben.id)?.pushes).toBe(0);
    // No push address ever goes into the log.
    expect(JSON.stringify(rows)).not.toContain("push.example.test");
  });

  it("forgets a phone the push service says is gone", async () => {
    const t = await waveFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/old-phone', 'k', 'a')`,
      [t.f.firmId, t.ann.id],
    );
    t.pushState.gone = true;
    await t.wave(1);
    const { rows } = await su.query(
      "select count(*)::int as n from push_subscriptions where worker_id = $1",
      [t.ann.id],
    );
    expect(rows).toEqual([{ n: 0 }]);
    expect(t.sent).toHaveLength(2); // the WhatsApp and text still went
    const { rows: forgotten } = await su.query(
      "select actor_type, data from events where firm_id = $1 and action = 'push.forgotten'",
      [t.f.firmId],
    );
    expect(forgotten).toEqual([{ actor_type: "system", data: { reason: "gone" } }]);
  });

  it("in quiet hours, a firm that won't let urgent override holds the wave until they end", async () => {
    const quiet = { quiet_hours: { start: "22:00", end: "07:00", urgent_override: false } };
    const t = await waveFirm(quiet, 30); // Tuesday 15:00
    const night = later(14.5 * 60); // Monday 23:30
    const morning = hoursFromNow(22); // Tuesday 07:00
    expect(await t.wave(1, night)).toEqual({ status: "held", until: morning });
    expect(t.sent).toEqual([]);
    expect(await offersOf(t.shiftId)).toEqual([]);
    const held = (await queued(t.shiftId)).find(
      (j) => j.data.idempotencyKey === `offer-wave:${t.shiftId}:1:after-quiet`,
    );
    expect(held?.start_after).toEqual(morning);
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'offer.wave_held'",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      { data: { wave: 1, until: morning.toISOString(), reason: "quiet_hours" } },
    ]);
    // At 07:00 it goes.
    expect((await t.wave(1, morning)).status).toBe("sent");
    expect(t.sent).toHaveLength(2);
  });

  it("in quiet hours, urgent goes at once when the firm allows it (the default)", async () => {
    const t = await waveFirm({}, 30);
    expect((await t.wave(1, later(14.5 * 60))).status).toBe("sent");
  });

  it("a WhatsApp the transport won't send goes by text instead, and the offer says so", async () => {
    const t = await waveFirm();
    t.sendState.refuseWhatsApp = true;
    await t.wave(1); // Ann (WhatsApp) and Ben (text already)
    expect(t.sent.map((m) => [m.channel, m.channel === "email" ? "" : m.to]).sort()).toEqual(
      [
        ["sms", t.ann.mobile],
        ["sms", t.ben.mobile],
      ].sort(),
    );
    expect((await offersOf(t.shiftId)).map((o) => o.channel)).toEqual(["sms", "sms"]);
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'offer.sent' and data ->> 'workerId' = $2",
      [t.f.firmId, t.ann.id],
    );
    expect(rows[0]?.data).toMatchObject({ channel: "sms", fellBackFrom: "whatsapp" });
    // The notice they had of the shift, for the notice report: sent at 09:00 for 19:00.
    expect(rows[0]?.data).toMatchObject({ noticeHours: 10 });
  });

  it("by text, the offer is the doc's short SMS version (the fallback too)", async () => {
    const t = await waveFirm();
    const sms = `Booking Test ${t.slug} URGENT: door supervisor needed today 19:00. http://${t.slug}.localhost:3000/shifts/${t.shiftId} - Booking Test ${t.slug} Shift Team`;
    await t.wave(1); // Ann by WhatsApp, Ben by text (his choice)
    const bodyTo = (mobile: string) => {
      const m = t.sent.find((s) => s.channel !== "email" && s.to === mobile);
      return m && "body" in m ? m.body : "";
    };
    expect(bodyTo(t.ben.mobile)).toBe(sms);
    expect(bodyTo(t.ann.mobile)).toMatch(/^URGENT: we need a door supervisor today 19:00–03:00\./);

    const again = await waveFirm();
    again.sendState.refuseWhatsApp = true;
    await again.wave(1);
    const annText = again.sent.find((s) => s.channel === "sms" && s.to === again.ann.mobile);
    expect(annText && "body" in annText ? annText.body : "").toMatch(
      new RegExp(`^Booking Test ${again.slug} URGENT: door supervisor needed today 19:00\\. `),
    );
  });

  it("any other failure isn't sent again by text; that offer is dropped and logged, the rest still go", async () => {
    const t = await waveFirm();
    t.sendState.failFor = [t.ann.mobile];
    expect(await t.wave(1)).toEqual({ status: "sent", sent: 1, next: 2 });
    expect(phones(t.sent)).toEqual([t.ben.mobile]); // Ben by text, as usual; nothing to Ann
    // Ann's offer stays on the record, marked failed (offers are evidence, never deleted).
    expect(
      (await offersOf(t.shiftId)).map((o) => [o.worker_id, o.channel, o.response]).sort(),
    ).toEqual(
      [
        [t.ann.id, "whatsapp", "failed"],
        [t.ben.id, "sms", null],
      ].sort(),
    );
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'offer.send_failed'",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      { data: { workerId: t.ann.id, wave: 1, channel: "whatsapp", code: "Error" } },
    ]);
  });

  it("if the text also fails, that offer is dropped and logged, never the whole wave", async () => {
    const t = await waveFirm();
    t.sendState.refuseWhatsApp = true;
    t.sendState.failSms = true;
    expect(await t.wave(1)).toEqual({ status: "sent", sent: 0, next: 2 });
    const { rows } = await su.query(
      "select data ->> 'channel' as channel from events where firm_id = $1 and action = 'offer.send_failed' order by id",
      [t.f.firmId],
    );
    expect(rows).toEqual([{ channel: "sms" }, { channel: "sms" }]);
    expect((await offersOf(t.shiftId)).map((o) => [o.channel, o.response])).toEqual([
      ["sms", "failed"],
      ["sms", "failed"],
    ]);
    // A failed offer doesn't count as offered: they're in the next wave.
    t.sendState.refuseWhatsApp = false;
    t.sendState.failSms = false;
    await t.wave(2, later(15));
    expect(phones(t.sent).sort()).toEqual([t.ann.mobile, t.ben.mobile].sort());
  });

  it("two copies of a held wave: one sends at 07:00, the other finds it sent", async () => {
    const quiet = { quiet_hours: { start: "22:00", end: "07:00", urgent_override: false } };
    const t = await waveFirm(quiet, 30);
    await t.wave(1, later(14.5 * 60));
    await t.wave(1, later(15 * 60));
    const held = (await queued(t.shiftId)).filter((j) =>
      String(j.data.idempotencyKey).endsWith(":after-quiet"),
    );
    expect(held).toHaveLength(2);
    expect((await t.wave(1, hoursFromNow(22))).status).toBe("sent");
    expect(await t.wave(1, hoursFromNow(22))).toEqual({ status: "already_sent" });
    expect(t.sent).toHaveLength(2);
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

  it("an urgent wave still reaches a worker already offered 3 shifts today (the cap is for non-urgent offers)", async () => {
    const t = await waveFirm({ allocation_mode: "first_come_first_served" });
    for (const h of [200, 224, 248]) {
      const other = await t.f.shift({ startsAt: hoursFromNow(h) });
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'whatsapp', $4)`,
        [t.f.firmId, other, t.ann.id, later(-60)],
      );
    }
    expect(await t.wave(1)).toEqual({ status: "sent", sent: 4, next: null });
    expect(phones(t.sent)).toContain(t.ann.mobile);
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

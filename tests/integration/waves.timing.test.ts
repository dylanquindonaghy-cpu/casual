import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR, MINUTE } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmJob } from "@/lib/jobs/firm-job";
import type { OutboundMessage } from "@/lib/messaging/transport";
import {
  createEscalateShiftJob,
  createOfferWaveJob,
  ESCALATE_SHIFT_QUEUE,
  OFFER_WAVE_QUEUE,
  type OfferDeps,
} from "@/lib/offers/waves";
import type { PushTransport } from "@/lib/push/transport";
import { bookShift } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { wallTimeOf } from "@/lib/time/zoned";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { fakeWorker } from "../helpers/fake-worker";

// Offer-wave timing end to end (docs/testing.md, waves.timing): a real cancellation starts the
// chain, and a fake worker runs the firm's queued jobs from pg-boss in start_after order on a fake
// clock, through the real job wrappers. So what's checked is the queue the worker would really
// run: wave 1 now, the next wave after the firm's minutes, stop on fill, the office emailed at the
// start minus the firm's hours. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

const at = (d: Date) => {
  const w = wallTimeOf(d, "Europe/London");
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
};

// A door supervisor shift with one place; Zed holds it and cancels at `dropoutAt`. Five workers
// could take it, with 0, 8, 16, 24 and 32 hours booked that week (so fair rotation offers them in
// that order), and a resourcer to escalate to.
async function chain(
  settings: Record<string, unknown>,
  o: { startsAt?: Date; dropoutAt?: Date } = {},
) {
  const f = await bookingFirm(su, withFirm, {
    settings: { escalate_hours_before_start: 3, ...settings },
  });
  const officeId = await f.office("resourcer");
  const startsAt = o.startsAt ?? hoursFromNow(10); // 19:00 today
  const dropoutAt = o.dropoutAt ?? NOW;
  const names = ["Ann", "Ben", "Cal", "Dee", "Eve"];
  const workers: Record<string, { id: string; mobile: string }> = {};
  let slot = 1;
  for (const [i, first] of names.entries()) {
    const id = await f.worker({ first });
    const { rows } = await su.query<{ mobile: string }>(
      "select mobile_e164 as mobile from workers where id = $1",
      [id],
    );
    workers[first] = { id, mobile: rows[0]?.mobile ?? "" };
    for (let k = 0; k < i; k++) {
      await f.booking(
        id,
        await f.shift({ startsAt: hoursFromNow(72 + 24 * k) }),
        "confirmed",
        slot,
      );
      slot += 1;
    }
  }
  const shiftId = await f.shift({ startsAt });
  const zed = await f.worker({ first: "Zed" });
  await f.booking(zed, shiftId);

  // Messages and pushes, each with the fake time it was sent at.
  let now = dropoutAt;
  const sent: { at: string; message: OutboundMessage }[] = [];
  const deps = (): OfferDeps => ({
    transport: {
      name: "capture",
      async send(message) {
        sent.push({ at: at(now), message });
        return { providerMessageId: `capture-${sent.length}` };
      },
    },
    push: {
      name: "none",
      async send() {
        return { status: "skipped" };
      },
    } satisfies PushTransport,
    baseDomain: "localhost:3000",
    clock: { now: () => now },
  });
  const worker = fakeWorker(su, f.firmId, {
    [OFFER_WAVE_QUEUE]: (job, when) => {
      now = when;
      return runFirmJob(createOfferWaveJob(deps), job, withFirm);
    },
    [ESCALATE_SHIFT_QUEUE]: (job, when) => {
      now = when;
      return runFirmJob(createEscalateShiftJob(deps), job, withFirm);
    },
  });
  await cancelBooking(
    withFirm,
    f.firmId,
    { shiftId, workerId: zed, reason: "I'm unwell", by: { type: "worker", id: zed } },
    { clock: { now: () => dropoutAt } },
  );
  const phone = (m: OutboundMessage) => (m.channel === "email" ? m.to : m.to);
  const who = (mobile: string) =>
    Object.entries(workers).find(([, w]) => w.mobile === mobile)?.[0] ?? mobile;
  // Jobs due at the same moment have no order (pg-boss runs them side by side): sorted by name.
  const timeline = (ran: Awaited<ReturnType<typeof worker.runUntil>>) =>
    [...ran]
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.name.localeCompare(b.name))
      .map((r) => [at(r.at), r.name, r.output]);
  const messagesAt = () =>
    sent.map((s) => [s.at, s.message.channel === "email" ? "office email" : who(phone(s.message))]);
  return { f, officeId, shiftId, workers, worker, sent, timeline, messagesAt, startsAt };
}

describe("waves on the clock", () => {
  it("wave 1 at the dropout, the next every 15 minutes until nobody's left, the office at start minus 3 hours", async () => {
    const t = await chain({ allocation_mode: "fair_rotation", wave_size: 2, wave_minutes: 15 });
    const ran = await t.worker.runUntil(hoursFromNow(12), NOW);
    expect(t.timeline(ran)).toEqual([
      ["09:00", OFFER_WAVE_QUEUE, { status: "sent", sent: 2, next: 2 }],
      ["09:15", OFFER_WAVE_QUEUE, { status: "sent", sent: 2, next: 3 }],
      ["09:30", OFFER_WAVE_QUEUE, { status: "sent", sent: 1, next: null }],
      ["16:00", ESCALATE_SHIFT_QUEUE, { status: "escalated", notified: 1 }],
    ]);
    expect(t.messagesAt()).toEqual([
      ["09:00", "Ann"],
      ["09:00", "Ben"],
      ["09:15", "Cal"],
      ["09:15", "Dee"],
      ["09:30", "Eve"],
      ["16:00", "office email"],
    ]);
    expect(await t.worker.waiting()).toEqual([]);
  });

  it("the firm's own wave size and minutes (3 every 10 minutes)", async () => {
    const t = await chain({ allocation_mode: "fair_rotation", wave_size: 3, wave_minutes: 10 });
    const ran = await t.worker.runUntil(hoursFromNow(6), NOW);
    expect(t.timeline(ran)).toEqual([
      ["09:00", OFFER_WAVE_QUEUE, { status: "sent", sent: 3, next: 2 }],
      ["09:10", OFFER_WAVE_QUEUE, { status: "sent", sent: 2, next: null }],
    ]);
  });

  it("first come, first served: everyone at once, no second wave; the office still at 16:00", async () => {
    const t = await chain({ allocation_mode: "first_come_first_served" });
    const ran = await t.worker.runUntil(hoursFromNow(12), NOW);
    expect(t.timeline(ran)).toEqual([
      ["09:00", OFFER_WAVE_QUEUE, { status: "sent", sent: 5, next: null }],
      ["16:00", ESCALATE_SHIFT_QUEUE, { status: "escalated", notified: 1 }],
    ]);
  });

  it("the office is emailed once, even if the escalation job runs again", async () => {
    const t = await chain({ allocation_mode: "first_come_first_served" });
    await t.worker.runUntil(hoursFromNow(12), NOW);
    const again = await runFirmJob(
      createEscalateShiftJob(() => ({
        transport: {
          name: "x",
          async send() {
            throw new Error("must not send");
          },
        },
        push: {
          name: "none",
          async send() {
            return { status: "skipped" };
          },
        },
        baseDomain: "localhost:3000",
        clock: { now: () => hoursFromNow(7.5) },
      })),
      {
        id: "again",
        data: {
          firmId: t.f.firmId,
          idempotencyKey: `escalate-shift:${t.shiftId}`,
          shiftId: t.shiftId,
        },
      },
      withFirm,
    );
    expect(again).toMatchObject({ status: "completed", output: { status: "already" } });
  });

  it("quiet hours with no urgent override: a 23:00 dropout waits until 07:00, then every 15 minutes", async () => {
    const t = await chain(
      {
        allocation_mode: "fair_rotation",
        wave_size: 2,
        wave_minutes: 15,
        quiet_hours: { start: "22:00", end: "07:00", urgent_override: false },
      },
      { startsAt: hoursFromNow(27), dropoutAt: hoursFromNow(14) }, // Tue 12:00; Mon 23:00
    );
    const ran = await t.worker.runUntil(hoursFromNow(27), hoursFromNow(14));
    expect(t.timeline(ran)).toEqual([
      ["23:00", OFFER_WAVE_QUEUE, { status: "held", until: hoursFromNow(22) }],
      ["07:00", OFFER_WAVE_QUEUE, { status: "sent", sent: 2, next: 2 }],
      ["07:15", OFFER_WAVE_QUEUE, { status: "sent", sent: 2, next: 3 }],
      ["07:30", OFFER_WAVE_QUEUE, { status: "sent", sent: 1, next: null }],
      ["09:00", ESCALATE_SHIFT_QUEUE, { status: "escalated", notified: 1 }],
    ]);
    expect(t.messagesAt().filter(([time]) => time === "23:00")).toEqual([]);
  });
});

describe("stop on fill", () => {
  it("someone takes it between waves: the next wave stops, the others are filled elsewhere, the office isn't needed", async () => {
    const t = await chain({ allocation_mode: "fair_rotation", wave_size: 2, wave_minutes: 15 });
    await t.worker.runUntil(NOW, NOW); // wave 1: Ann and Ben
    const took = await bookShift(
      withFirm,
      t.f.firmId,
      {
        shiftId: t.shiftId,
        workerId: t.workers.Ben?.id ?? "",
        by: { type: "worker", id: t.workers.Ben?.id ?? "" },
      },
      { clock: { now: () => new Date(NOW.getTime() + 5 * MINUTE) } },
    );
    expect(took.status).toBe("booked");
    const ran = await t.worker.runUntil(hoursFromNow(12), new Date(NOW.getTime() + 5 * MINUTE));
    expect(t.timeline(ran)).toEqual([
      ["09:15", OFFER_WAVE_QUEUE, { status: "stopped", reason: "filled" }],
      ["16:00", ESCALATE_SHIFT_QUEUE, { status: "not_needed" }],
    ]);
    expect(t.messagesAt()).toEqual([
      ["09:00", "Ann"],
      ["09:00", "Ben"],
    ]);
    const { rows } = await su.query<{ worker_id: string; response: string }>(
      "select worker_id::text, response from offers where shift_id = $1 order by worker_id",
      [t.shiftId],
    );
    expect(rows.map((r) => [r.worker_id, r.response]).sort()).toEqual(
      [
        [t.workers.Ann?.id, "filled_elsewhere"],
        [t.workers.Ben?.id, "accepted"],
      ].sort(),
    );
    expect(await t.worker.waiting()).toEqual([]);
  });

  it("filled by the office in the last minute before a wave: that wave sends nothing", async () => {
    const t = await chain({ allocation_mode: "fair_rotation", wave_size: 2, wave_minutes: 15 });
    await t.worker.runUntil(NOW, NOW);
    const eve = t.workers.Eve?.id ?? "";
    const placed = await bookShift(
      withFirm,
      t.f.firmId,
      { shiftId: t.shiftId, workerId: eve, by: { type: "office", id: t.officeId } },
      { clock: { now: () => new Date(NOW.getTime() + 14 * MINUTE) } },
    );
    expect(placed.status).toBe("booked");
    const ran = await t.worker.runUntil(
      new Date(NOW.getTime() + 15 * MINUTE),
      new Date(NOW.getTime() + 14 * MINUTE),
    );
    expect(ran.map((r) => r.output)).toEqual([{ status: "stopped", reason: "filled" }]);
    expect(t.sent).toHaveLength(2);
  });

  it("the shift starting ends the chain even with people left and no one booked", async () => {
    const t = await chain(
      { allocation_mode: "fair_rotation", wave_size: 1, wave_minutes: 60 },
      { startsAt: new Date(NOW.getTime() + 2.5 * HOUR) }, // 11:30
    );
    const ran = await t.worker.runUntil(hoursFromNow(4), NOW);
    expect(t.timeline(ran)).toEqual([
      ["09:00", ESCALATE_SHIFT_QUEUE, { status: "escalated", notified: 1 }], // already inside 3 hours
      ["09:00", OFFER_WAVE_QUEUE, { status: "sent", sent: 1, next: 2 }],
      ["10:00", OFFER_WAVE_QUEUE, { status: "sent", sent: 1, next: 3 }],
      ["11:00", OFFER_WAVE_QUEUE, { status: "sent", sent: 1, next: 4 }],
      ["12:00", OFFER_WAVE_QUEUE, { status: "stopped", reason: "started" }],
    ]);
  });
});

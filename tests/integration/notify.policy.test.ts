import type { Pool } from "pg";
import type { JobResult } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmJob, runFirmTask } from "@/lib/jobs/firm-job";
import { ChannelRefusedError, type MessagingTransport } from "@/lib/messaging/transport";
import { waveCandidates } from "@/lib/offers/candidates";
import {
  createEscalateShiftJob,
  createOfferWaveJob,
  ESCALATE_SHIFT_QUEUE,
  OFFER_WAVE_QUEUE,
  type OfferDeps,
} from "@/lib/offers/waves";
import type { PushTransport } from "@/lib/push/transport";
import { createShiftRemindersTask } from "@/lib/reminders/send";
import { previewBooking } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { fakeWorker } from "../helpers/fake-worker";

// The notification policy (docs/messaging-templates.md, "Notification policy"; docs/testing.md,
// notify.policy), held for every sender that messages workers: offer waves and shift reminders,
// each run through its real job on the real database, with capturing transports (nothing is sent
// anywhere). As built:
// - channel order: the worker's own channel (WhatsApp, or text by their choice); a text only
//   after the provider refuses the WhatsApp; never both for one message; the push alongside once
//   the message has gone, never for a failed one. (The 60-second "not delivered" fallback needs
//   Twilio's delivery reports: parked.)
// - quiet hours: urgent offers go at night only if the firm allows it; reminders always wait.
// - the daily cap: at most 3 offers a worker a day unless urgent; reminders aren't offers.
// - idempotency: a retried or doubled job never sends a message twice.
// - no notifications to ineligible workers: over a whole chain, exactly the workers the booking
//   rules allow get anything.
// NOW is Monday 2 November 2026, 09:00 London (GMT).

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

type Behaviour = "ok" | "refused" | "fails";

// Everything sent, in order: "whatsapp:<to>", "sms:<to>" (attempts, failed or not), "push:<endpoint>".
function recorder() {
  const log: string[] = [];
  const state = { whatsapp: "ok" as Behaviour, sms: "ok" as Behaviour };
  const transport: MessagingTransport = {
    name: "record",
    async send(message) {
      if (message.channel === "email") {
        log.push(`email:${message.to}`);
        return { providerMessageId: `id-${log.length}` };
      }
      log.push(`${message.channel}:${message.to}`);
      const how = state[message.channel];
      if (how === "refused") throw new ChannelRefusedError(message.channel);
      if (how === "fails") throw new Error("timed out");
      return { providerMessageId: `id-${log.length}` };
    },
  };
  const push: PushTransport = {
    name: "record",
    async send(target) {
      log.push(`push:${target.endpoint}`);
      return { status: "sent" };
    },
  };
  return { log, state, transport, push };
}

const mobileOf = async (workerId: string) =>
  (
    await su.query<{ mobile: string }>("select mobile_e164 as mobile from workers where id = $1", [
      workerId,
    ])
  ).rows[0]?.mobile ?? "";

async function subscribe(f: BookingFirm, workerId: string): Promise<string> {
  const endpoint = `https://push.example.test/${workerId}`;
  await su.query(
    `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
     values ($1, $2, $3, 'k', 'a')`,
    [f.firmId, workerId, endpoint],
  );
  return endpoint;
}

// A sender, set up for one worker: `run` sends them its one message through the real job.
interface Sender {
  name: string;
  setup(settings?: Record<string, unknown>): Promise<{
    f: BookingFirm;
    workerId: string;
    rec: ReturnType<typeof recorder>;
    run: (when?: Date) => Promise<JobResult>;
  }>;
}

const offerSender: Sender = {
  name: "an urgent offer",
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "first_come_first_served", ...settings },
    });
    const workerId = await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(20) });
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    const rec = recorder();
    const run = (when = NOW) =>
      runFirmJob(
        createOfferWaveJob((): OfferDeps => ({
          transport: rec.transport,
          push: rec.push,
          baseDomain: "localhost:3000",
          clock: { now: () => when },
        })),
        {
          id: "job",
          data: { firmId: f.firmId, idempotencyKey: `offer-wave:${shiftId}:1`, shiftId, wave: 1 },
        },
        withFirm,
      );
    return { f, workerId, rec, run };
  },
};

const reminderSender: Sender = {
  name: "a shift reminder",
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, { settings });
    const workerId = await f.worker({ first: "Rae" });
    await f.booking(workerId, await f.shift({ startsAt: hoursFromNow(20) }));
    const rec = recorder();
    const run = (when = NOW) =>
      runFirmTask(
        createShiftRemindersTask(() => ({
          transport: rec.transport,
          push: rec.push,
          baseDomain: "localhost:3000",
          clock: { now: () => when },
        })),
        { id: "job", data: { firmId: f.firmId, idempotencyKey: "shift-reminders:1" } },
        withFirm,
      );
    return { f, workerId, rec, run };
  },
};

const SENDERS = [offerSender, reminderSender].map((s) => [s.name, s] as const);

describe.each(SENDERS)("channel order: %s", (_name, sender) => {
  it("WhatsApp when that's their channel, then the push; nothing else", async () => {
    const t = await sender.setup();
    const endpoint = await subscribe(t.f, t.workerId);
    const mobile = await mobileOf(t.workerId);
    expect(await t.run()).toMatchObject({ status: "completed" });
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`, `push:${endpoint}`]);
  });

  it("a text when they chose texts: never WhatsApp", async () => {
    const t = await sender.setup();
    await su.query("update workers set notify_channel = 'sms' where id = $1", [t.workerId]);
    const endpoint = await subscribe(t.f, t.workerId);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`sms:${mobile}`, `push:${endpoint}`]);
  });

  it("a text only after the provider refuses the WhatsApp, then the push", async () => {
    const t = await sender.setup();
    t.rec.state.whatsapp = "refused";
    const endpoint = await subscribe(t.f, t.workerId);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`, `sms:${mobile}`, `push:${endpoint}`]);
  });

  it("any other failure: no text (it may have arrived), and no push", async () => {
    const t = await sender.setup();
    t.rec.state.whatsapp = "fails";
    await subscribe(t.f, t.workerId);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`]);
  });

  it("a refused WhatsApp and a failed text: nothing more (no push)", async () => {
    const t = await sender.setup();
    t.rec.state.whatsapp = "refused";
    t.rec.state.sms = "fails";
    await subscribe(t.f, t.workerId);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`, `sms:${mobile}`]);
  });
});

describe.each(SENDERS)("idempotency: %s", (_name, sender) => {
  it("the same job again sends nothing more", async () => {
    const t = await sender.setup();
    await t.run();
    await t.run();
    await t.run(new Date(NOW.getTime() + 5 * 60_000));
    expect(t.rec.log.filter((l) => !l.startsWith("push:"))).toHaveLength(1);
  });

  it("two copies at the same moment send it once", async () => {
    const t = await sender.setup();
    await Promise.all([t.run(), t.run()]);
    expect(t.rec.log.filter((l) => !l.startsWith("push:"))).toHaveLength(1);
  });
});

describe("quiet hours (22:00–07:00)", () => {
  const night = hoursFromNow(14); // Monday 23:00

  it("an urgent offer goes at night when the firm lets urgent through (the default)", async () => {
    const t = await offerSender.setup();
    await t.run(night);
    expect(t.rec.log).toHaveLength(1);
  });

  it("an urgent offer waits for 07:00 when the firm doesn't", async () => {
    const t = await offerSender.setup({
      quiet_hours: { start: "22:00", end: "07:00", urgent_override: false },
    });
    expect(await t.run(night)).toMatchObject({ output: { status: "held" } });
    expect(t.rec.log).toEqual([]);
  });

  it("a reminder always waits for 07:00 (reminders aren't urgent), then goes", async () => {
    const f = await bookingFirm(su, withFirm);
    const workerId = await f.worker({ first: "Rae" });
    await f.booking(workerId, await f.shift({ startsAt: hoursFromNow(37) })); // Tuesday 22:00
    const rec = recorder();
    const run = (when: Date) =>
      runFirmTask(
        createShiftRemindersTask(() => ({
          transport: rec.transport,
          push: rec.push,
          baseDomain: "localhost:3000",
          clock: { now: () => when },
        })),
        { id: "job", data: { firmId: f.firmId, idempotencyKey: "shift-reminders:1" } },
        withFirm,
      );
    expect(await run(night)).toMatchObject({ output: { sent: 0, skipped: 0 } });
    expect(rec.log).toEqual([]);
    expect(await run(hoursFromNow(22))).toMatchObject({ output: { sent: 1 } }); // Tuesday 07:00
  });
});

describe("the daily cap (3 offers a worker a day unless urgent)", () => {
  async function offeredToday(f: BookingFirm, workerId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const other = await f.shift({ startsAt: hoursFromNow(200 + 24 * i) });
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'whatsapp', $4)`,
        [f.firmId, other, workerId, hoursFromNow(-1)],
      );
    }
  }

  it("a non-urgent offer leaves out a worker offered 3 today; an urgent one doesn't", async () => {
    const f = await bookingFirm(su, withFirm);
    const busy = await f.worker({ first: "Busy" });
    await offeredToday(f, busy, 3);
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const candidates = () =>
      withFirm(f.firmId, async (tx) =>
        (await waveCandidates(tx, shiftId, NOW)).map((c) => c.workerId),
      );
    expect(await candidates()).toEqual([]);
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    expect(await candidates()).toEqual([busy]);
  });

  it("an urgent offer still reaches them end to end; reminders aren't offers and aren't capped", async () => {
    const offer = await offerSender.setup();
    await offeredToday(offer.f, offer.workerId, 3);
    await offer.run();
    expect(offer.rec.log).toHaveLength(1);

    const reminder = await reminderSender.setup();
    await offeredToday(reminder.f, reminder.workerId, 3);
    await reminder.run();
    expect(reminder.rec.log).toHaveLength(1);
  });
});

describe("no notifications to ineligible workers", () => {
  it("over a whole chain of waves, exactly the workers the rules allow (and who want offers) get anything", async () => {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "fair_rotation", wave_size: 2, wave_minutes: 15 },
    });
    await f.office("resourcer");
    const startsAt = hoursFromNow(10); // Monday 19:00
    const shiftId = await f.shift({ startsAt });
    const eligible = [
      await f.worker({ first: "Ann" }),
      await f.worker({ first: "Ben" }),
      await f.worker({ first: "Cal" }),
    ];
    const ineligible: Record<string, string> = {
      "no licence": await f.worker({ first: "Nia", credentials: [] }),
      expired: await f.worker({
        first: "Exp",
        credentials: [
          { type: "STEWARD_L2", expiresOn: null },
          { type: "SIA_DS", expiresOn: "2026-10-01", status: "expired" },
        ],
      }),
      suspended: await f.worker({
        first: "Sus",
        credentials: [
          { type: "STEWARD_L2", expiresOn: null },
          { type: "SIA_DS", expiresOn: "2029-01-01", status: "suspended" },
        ],
      }),
      "wrong role": await f.worker({ first: "Stu", roles: ["steward"] }),
      inactive: await f.worker({ first: "Ina", status: "inactive" }),
      blocked: await f.worker({ first: "Blo", status: "blocked" }),
      "alerts off": await f.worker({ first: "Off" }),
      "day off": await f.worker({ first: "Day" }),
      clash: await f.worker({ first: "Cla" }),
    };
    await su.query("update workers set offer_alerts = false where id = $1", [
      ineligible["alerts off"],
    ]);
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-02')",
      [f.firmId, ineligible["day off"]],
    );
    await f.booking(ineligible.clash ?? "", await f.shift({ startsAt: hoursFromNow(11) }));
    // Another firm's worker, who could do the job.
    const other = await bookingFirm(su, withFirm);
    const outsider = await other.worker({ first: "Out" });
    // Zed holds the place and cancels: the chain starts.
    const zed = await f.worker({ first: "Zed" });
    await f.booking(zed, shiftId);

    const everyone = [...eligible, ...Object.values(ineligible), zed];
    for (const id of [...everyone, outsider]) await subscribe(id === outsider ? other : f, id);
    // The rules' own answer for each, before anything is sent.
    const allowed = await withFirm(f.firmId, async (tx) => {
      const yes: string[] = [];
      for (const workerId of [...eligible, ...Object.values(ineligible)]) {
        const v = await previewBooking(tx, { shiftId, workerId, now: NOW });
        if (v?.ok) yes.push(workerId);
      }
      return yes;
    });
    await cancelBooking(
      withFirm,
      f.firmId,
      { shiftId, workerId: zed, reason: "I'm unwell", by: { type: "worker", id: zed } },
      { clock: { now: () => NOW } },
    );

    const rec = recorder();
    const deps = (now: Date) => (): OfferDeps => ({
      transport: rec.transport,
      push: rec.push,
      baseDomain: "localhost:3000",
      clock: { now: () => now },
    });
    const worker = fakeWorker(su, f.firmId, {
      [OFFER_WAVE_QUEUE]: (job, now) => runFirmJob(createOfferWaveJob(deps(now)), job, withFirm),
      [ESCALATE_SHIFT_QUEUE]: (job, now) =>
        runFirmJob(createEscalateShiftJob(deps(now)), job, withFirm),
    });
    await worker.runUntil(startsAt, NOW);

    // Who got anything: a message to their phone, or a push to their subscription.
    const reached = new Set<string>();
    for (const id of [...everyone, outsider]) {
      const mobile = await mobileOf(id);
      if (rec.log.some((l) => l === `whatsapp:${mobile}` || l === `sms:${mobile}`)) reached.add(id);
      if (rec.log.includes(`push:https://push.example.test/${id}`)) reached.add(id);
    }
    // The rules allow the three, and the worker who turned offer messages off (they could still
    // take it themselves). Messages go only to those the rules allow who want them.
    expect(allowed.sort()).toEqual([...eligible, ineligible["alerts off"]].sort());
    expect([...reached].sort()).toEqual([...eligible].sort());
    for (const [kind, id] of Object.entries(ineligible)) {
      expect(reached.has(id), kind).toBe(false);
    }
    expect(reached.has(zed)).toBe(false); // cancelled off it
    expect(reached.has(outsider)).toBe(false); // another firm
    // The office still hears about it (by email, not a worker message).
    expect(rec.log.filter((l) => l.startsWith("email:"))).toHaveLength(1);
    expect(worker.ran.length).toBeGreaterThanOrEqual(3); // two waves and the escalation at least
  });
});

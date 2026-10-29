import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanCredentials } from "@/lib/credentials/scan";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import {
  ChannelRefusedError,
  NoTextSenderError,
  type MessagingTransport,
} from "@/lib/messaging/transport";
import { runFirmChangeNotice } from "@/lib/notices/firm-change";
import { runPayQueryUpdate } from "@/lib/notices/pay-query-update";
import { runRequestUpdate } from "@/lib/notices/request-update";
import { runShiftConfirmed } from "@/lib/notices/shift-confirmed";
import { waveCandidates } from "@/lib/offers/candidates";
import { runOfficeOffer } from "@/lib/offers/office-offer";
import {
  createEscalateShiftTask,
  createOfferWaveTask,
  ESCALATE_SHIFT_QUEUE,
  OFFER_WAVE_QUEUE,
  type OfferDeps,
} from "@/lib/offers/waves";
import { assignWorker, cancelBookingByOffice } from "@/lib/office/quick-actions";
import type { PushTransport } from "@/lib/push/transport";
import { createShiftRemindersTask } from "@/lib/reminders/send";
import { resolveRequest } from "@/lib/requests/resolve";
import { previewBooking } from "@/lib/roster/book";
import { cancelBooking } from "@/lib/roster/cancel";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { fakeWorker } from "../helpers/fake-worker";

// The notification policy (docs/messaging-templates.md, "Notification policy" and "How a message
// reaches a casual"; docs/testing.md, notify.policy), held for every sender that messages a casual:
// offer waves, the office's offer, shift reminders, the booking confirmation, the office's change
// notice, a request's answer, a pay query's answer and the licence messages, each run through its
// real job on the real database, with capturing transports (nothing is sent anywhere). As built
// (P2.4, deliverToWorker):
// - the order: a push to their phones, and when one phone takes it nothing else goes; else their
//   own channel (WhatsApp, or text by their choice), a text only after the provider refuses the
//   WhatsApp, never both for one message; else, only when there's no text sender at all, an email
//   to the address the firm holds for them; else nothing goes and the miss is logged (no_channel).
//   A WhatsApp or text that fails is never sent again another way (it may have arrived). The
//   licence messages have no push words: they start at the WhatsApp or text. (The 60-second "not
//   delivered" fallback needs Twilio's delivery reports: parked.)
// - quiet hours: urgent offers go at night only if the firm allows it; reminders always wait.
// - the daily cap: at most 3 offers a worker a day unless urgent; reminders aren't offers.
// - idempotency: a retried or doubled job never sends a message twice, whichever way it went.
// - STOP: never a text to a worker who replied STOP (workers.sms_opted_out_at): WhatsApp instead
//   if they chose texts, and no text when the WhatsApp is refused.
// - no notifications to ineligible workers: over a whole chain, exactly the workers the booking
//   rules allow get anything.
// Before P2.4 the push went alongside the WhatsApp or text, once that had gone (Messages 2 decided
// it: a push now instead of the text).
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

// "none": there's no text sender at all (MESSAGING_TRANSPORT=none, P2.5): nothing is tried.
type Behaviour = "ok" | "refused" | "fails" | "none";

// Everything sent, in order: "whatsapp:<to>", "sms:<to>" (attempts, failed or not),
// "email:<to>", "push:<endpoint>". With no text sender, nothing is logged for the text.
function recorder() {
  const log: string[] = [];
  const emails: { to: string; subject?: string; body: string }[] = [];
  const state = {
    whatsapp: "ok" as Behaviour,
    sms: "ok" as Behaviour,
    push: "sent" as "sent" | "gone" | "failed",
  };
  const transport: MessagingTransport = {
    name: "record",
    async send(message) {
      if (message.channel === "email") {
        log.push(`email:${message.to}`);
        emails.push({ to: message.to, subject: message.subject, body: message.body });
        // As an SMTP server's Message-ID comes back: the sending host after an "@".
        return { providerMessageId: `<id-${log.length}@mail.example.test>` };
      }
      const how = state[message.channel];
      if (how === "none") throw new NoTextSenderError(message.channel);
      log.push(`${message.channel}:${message.to}`);
      if (how === "refused") throw new ChannelRefusedError(message.channel);
      if (how === "fails") throw new Error("timed out");
      return { providerMessageId: `id-${log.length}` };
    },
  };
  const push: PushTransport = {
    name: "record",
    async send(target) {
      log.push(`push:${target.endpoint}`);
      return state.push === "failed"
        ? { status: "failed", code: "timeout" }
        : { status: state.push };
    },
  };
  // No text sender at all.
  const noTexts = () => {
    state.whatsapp = "none";
    state.sms = "none";
  };
  return { log, emails, state, transport, push, noTexts };
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

// The address the firm holds for them (made up: example.test).
async function giveEmail(workerId: string): Promise<string> {
  const email = `w-${workerId.slice(0, 8)}@example.test`;
  await su.query("update workers set email = $2 where id = $1", [workerId, email]);
  return email;
}

const eventsOf = async (firmId: string, action: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = $2 order by id",
      [firmId, action],
    )
  ).rows.map((r) => r.data);

const jobPayload = async (f: BookingFirm, queue: string) => {
  const { rows } = await su.query<{ data: Record<string, unknown> }>(
    "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
    [queue, f.firmId],
  );
  expect(rows).toHaveLength(1);
  return rows[0]?.data;
};

const clock = (when: Date) => ({ now: () => when });

// A sender, set up for one worker: `run` sends them its one message through the real job.
interface Sender {
  name: string;
  push: boolean; // whether the message has push words (the licence messages don't)
  sent: string; // the event that logs it sent, with the channel it went by
  failed: string; // the event that logs it failed, with its code
  subject: RegExp; // its email's subject (docs/messaging-templates.md "Email to casuals")
  setup(settings?: Record<string, unknown>): Promise<{
    f: BookingFirm;
    workerId: string;
    rec: ReturnType<typeof recorder>;
    run: (when?: Date) => Promise<unknown>;
  }>;
}

const offerSender: Sender = {
  name: "an urgent offer",
  push: true,
  sent: "offer.sent",
  failed: "offer.send_failed",
  subject: /^URGENT: a door supervisor needed tomorrow$/,
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, {
      settings: { allocation_mode: "first_come_first_served", ...settings },
    });
    const workerId = await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(20) });
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    const rec = recorder();
    const run = (when = NOW) =>
      runFirmTask(
        createOfferWaveTask((): OfferDeps => ({
          transport: rec.transport,
          push: rec.push,
          baseDomain: "localhost:3000",
          clock: clock(when),
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

const officeOfferSender: Sender = {
  name: "the office's offer",
  push: true,
  sent: "offer.sent",
  failed: "offer.send_failed",
  subject: /^Shift available: Tue 3 Nov 15:00–23:00$/,
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, { settings });
    const workerId = await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const officeUserId = await f.office("resourcer");
    const rec = recorder();
    const payload = {
      firmId: f.firmId,
      idempotencyKey: `office-offer:${shiftId}:${workerId}`,
      shiftId,
      workerId,
      officeUserId,
    };
    const run = (when = NOW) =>
      runOfficeOffer(payload, withFirm, {
        transport: rec.transport,
        push: rec.push,
        baseDomain: "localhost:3000",
        clock: clock(when),
      });
    return { f, workerId, rec, run };
  },
};

const reminderSender: Sender = {
  name: "a shift reminder",
  push: true,
  sent: "shift.reminder_sent",
  failed: "shift.reminder_failed",
  subject: /^Reminder: your shift tomorrow$/,
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
          clock: clock(when),
        })),
        { id: "job", data: { firmId: f.firmId, idempotencyKey: "shift-reminders:1" } },
        withFirm,
      );
    return { f, workerId, rec, run };
  },
};

const bookedSender: Sender = {
  name: "the booking confirmation",
  push: true,
  sent: "shift.booked_notice_sent",
  failed: "shift.booked_notice_failed",
  subject: /^Confirmed: your shift on Tue 3 Nov$/,
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, { settings });
    const workerId = await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const officeUserId = await f.office("resourcer");
    expect(
      await assignWorker(
        { firm: { id: f.firmId }, officeUserId, run: withFirm, clock: clock(NOW) },
        shiftId,
        workerId,
        null,
      ),
    ).toMatchObject({ status: "booked" });
    const payload = (await jobPayload(f, "shift-confirmed")) as Parameters<
      typeof runShiftConfirmed
    >[0];
    const rec = recorder();
    const run = (when = NOW) =>
      runShiftConfirmed(payload, withFirm, {
        transport: rec.transport,
        push: rec.push,
        baseDomain: "localhost:3000",
        clock: clock(when),
      });
    return { f, workerId, rec, run };
  },
};

const changeSender: Sender = {
  name: "the office's cancellation",
  push: true,
  sent: "shift.change_notice_sent",
  failed: "shift.change_notice_failed",
  subject: /^Your shift on Tue 3 Nov is cancelled$/,
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, { settings });
    const workerId = await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    await f.booking(workerId, shiftId);
    const officeUserId = await f.office("resourcer");
    expect(
      await cancelBookingByOffice(
        { firm: { id: f.firmId }, officeUserId, run: withFirm, clock: clock(NOW) },
        shiftId,
        workerId,
        "event_cancelled",
      ),
    ).toMatchObject({ status: "cancelled" });
    const payload = (await jobPayload(f, "firm-change-notice")) as Parameters<
      typeof runFirmChangeNotice
    >[0];
    const rec = recorder();
    const run = (when = NOW) =>
      runFirmChangeNotice(payload, withFirm, {
        transport: rec.transport,
        push: rec.push,
        baseDomain: "localhost:3000",
        clock: clock(when),
      });
    return { f, workerId, rec, run };
  },
};

const requestSender: Sender = {
  name: "a request's answer",
  push: true,
  sent: "request.update_sent",
  failed: "request.update_failed",
  subject: /^Your request \(ref [0-9A-F]{8}\) is approved$/,
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, { settings });
    const workerId = await f.worker({ first: "Rae" });
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    await f.booking(workerId, shiftId);
    const officeUserId = await f.office("resourcer");
    const { rows } = await su.query<{ id: string }>(
      `insert into requests (firm_id, worker_id, shift_id, type, payload, status, created_at)
       values ($1, $2, $3, 'time_change', $4, 'open', $5) returning id::text as id`,
      [f.firmId, workerId, shiftId, JSON.stringify({ text: "Can I start at 15:30?" }), NOW],
    );
    const requestId = rows[0]?.id ?? "";
    expect(
      await resolveRequest(
        withFirm,
        f.firmId,
        { requestId, decision: "approved", note: "", by: { type: "office", id: officeUserId } },
        { clock: clock(NOW) },
      ),
    ).toMatchObject({ status: "resolved" });
    const payload = { firmId: f.firmId, idempotencyKey: `request-update:${requestId}`, requestId };
    const rec = recorder();
    const run = (when = NOW) =>
      runRequestUpdate(payload, withFirm, {
        transport: rec.transport,
        push: rec.push,
        clock: clock(when),
      });
    return { f, workerId, rec, run };
  },
};

const payQuerySender: Sender = {
  name: "a pay query's answer",
  push: true,
  sent: "pay_query.update_sent",
  failed: "pay_query.update_failed",
  subject: /^Payroll has answered your pay query$/,
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, { settings });
    const workerId = await f.worker({ first: "Rae" });
    const { rows } = await su.query<{ id: string }>(
      `insert into pay_queries
         (firm_id, worker_id, work_date, issue_type, status, resolution_note, resolved_at)
       values ($1, $2, '2026-10-31', 'missing_hours', 'resolved', 'Added to Friday''s pay', $3)
       returning id::text as id`,
      [f.firmId, workerId, NOW],
    );
    const payQueryId = rows[0]?.id ?? "";
    const payload = {
      firmId: f.firmId,
      idempotencyKey: `pay-query-update:${payQueryId}`,
      payQueryId,
    };
    const rec = recorder();
    const run = (when = NOW) =>
      runPayQueryUpdate(payload, withFirm, {
        transport: rec.transport,
        push: rec.push,
        baseDomain: "localhost:3000",
        clock: clock(when),
      });
    return { f, workerId, rec, run };
  },
};

// The licence warning (no push words: it starts at the WhatsApp or text). The scan of Tuesday
// 3 November, for a licence that runs out on the 9th: the 7-day warning.
const licenceSender: Sender = {
  name: "a licence warning",
  push: false,
  sent: "credential.expiry_warning",
  failed: "credential.expiry_warning_failed",
  subject: /^Your .+ expires on 9 Nov$/,
  async setup(settings = {}) {
    const f = await bookingFirm(su, withFirm, { settings });
    const workerId = await f.worker({
      first: "Rae",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-11-09" }],
    });
    const payload = { firmId: f.firmId, idempotencyKey: "credential-scan:2026-11-03" };
    const rec = recorder();
    const run = () =>
      scanCredentials(payload, withFirm, {
        transport: rec.transport,
        baseDomain: "localhost:3000",
      });
    return { f, workerId, rec, run };
  },
};

const ALL: Sender[] = [
  offerSender,
  officeOfferSender,
  reminderSender,
  bookedSender,
  changeSender,
  requestSender,
  payQuerySender,
  licenceSender,
];
const SENDERS = ALL.map((s) => [s.name, s] as const);
const PUSHING = ALL.filter((s) => s.push).map((s) => [s.name, s] as const);

describe.each(PUSHING)("a push first: %s", (_name, sender) => {
  it("a phone takes the push: that's the message, and nothing else goes", async () => {
    const t = await sender.setup();
    const endpoint = await subscribe(t.f, t.workerId);
    await giveEmail(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`push:${endpoint}`]);
    expect((await eventsOf(t.f.firmId, sender.sent)).at(-1)).toMatchObject({
      channel: "push",
      pushes: 1,
    });
  });

  it("a phone that's gone: forgotten, and the WhatsApp goes", async () => {
    const t = await sender.setup();
    const endpoint = await subscribe(t.f, t.workerId);
    t.rec.state.push = "gone";
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`push:${endpoint}`, `whatsapp:${mobile}`]);
    const { rows } = await su.query("select 1 from push_subscriptions where worker_id = $1", [
      t.workerId,
    ]);
    expect(rows).toEqual([]);
    expect(await eventsOf(t.f.firmId, "push.forgotten")).toEqual([{ reason: "gone" }]);
  });

  it("a push that fails: the phone is kept, and the WhatsApp goes", async () => {
    const t = await sender.setup();
    const endpoint = await subscribe(t.f, t.workerId);
    t.rec.state.push = "failed";
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`push:${endpoint}`, `whatsapp:${mobile}`]);
    expect((await eventsOf(t.f.firmId, sender.sent)).at(-1)).toMatchObject({
      channel: "whatsapp",
      pushes: 0,
    });
  });

  it("a WhatsApp or text that fails after the push failed: forgotten phones still forgotten", async () => {
    const t = await sender.setup();
    await subscribe(t.f, t.workerId);
    t.rec.state.push = "gone";
    t.rec.state.whatsapp = "fails";
    await t.run();
    expect(await eventsOf(t.f.firmId, "push.forgotten")).toEqual([{ reason: "gone" }]);
    expect((await eventsOf(t.f.firmId, sender.failed)).at(-1)).toMatchObject({
      channel: "whatsapp",
      code: "Error",
    });
  });
});

describe.each(SENDERS)("then a WhatsApp or text: %s", (_name, sender) => {
  it("no phones: WhatsApp when that's their channel; nothing else", async () => {
    const t = await sender.setup();
    await giveEmail(t.workerId);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`]);
    expect((await eventsOf(t.f.firmId, sender.sent)).at(-1)).toMatchObject({
      channel: "whatsapp",
    });
  });

  if (!sender.push) {
    it("no push words: a WhatsApp even when they have a phone with notifications on", async () => {
      const t = await sender.setup();
      await subscribe(t.f, t.workerId);
      const mobile = await mobileOf(t.workerId);
      await t.run();
      expect(t.rec.log).toEqual([`whatsapp:${mobile}`]);
    });
  }

  it("a text when they chose texts: never WhatsApp", async () => {
    const t = await sender.setup();
    await su.query("update workers set notify_channel = 'sms' where id = $1", [t.workerId]);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`sms:${mobile}`]);
  });

  it("a text only after the provider refuses the WhatsApp", async () => {
    const t = await sender.setup();
    t.rec.state.whatsapp = "refused";
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`, `sms:${mobile}`]);
  });

  it("any other failure: no text and no email (it may have arrived)", async () => {
    const t = await sender.setup();
    t.rec.state.whatsapp = "fails";
    await giveEmail(t.workerId);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`]);
  });

  it("a refused WhatsApp and a failed text: nothing more", async () => {
    const t = await sender.setup();
    t.rec.state.whatsapp = "refused";
    t.rec.state.sms = "fails";
    await giveEmail(t.workerId);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`, `sms:${mobile}`]);
  });
});

describe.each(SENDERS)("then an email: %s", (_name, sender) => {
  it("no text sender: by email to the address the firm holds, its subject and its own words", async () => {
    const t = await sender.setup();
    t.rec.noTexts();
    const email = await giveEmail(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`email:${email}`]);
    expect(t.rec.emails).toHaveLength(1);
    expect(t.rec.emails[0]?.subject).toMatch(sender.subject);
    expect(t.rec.emails[0]?.body).toMatch(/Shift Team$/);
    // Logged with the Message-ID's id only: the log refuses the host after its "@".
    expect((await eventsOf(t.f.firmId, sender.sent)).at(-1)).toMatchObject({
      channel: "email",
      providerMessageId: "id-1",
    });
  });

  it("no text sender and no address: nothing goes, and the miss is logged (no_channel)", async () => {
    const t = await sender.setup();
    t.rec.noTexts();
    await t.run();
    expect(t.rec.log).toEqual([]);
    expect((await eventsOf(t.f.firmId, sender.failed)).at(-1)).toMatchObject({
      code: "no_channel",
    });
    expect(await eventsOf(t.f.firmId, sender.sent)).toEqual([]);
  });
});

describe.each(SENDERS)("replied STOP: %s", (_name, sender) => {
  const stopped = (workerId: string) =>
    su.query("update workers set sms_opted_out_at = $2 where id = $1", [workerId, NOW]);

  it("chose texts, then replied STOP: WhatsApp instead", async () => {
    const t = await sender.setup();
    await su.query("update workers set notify_channel = 'sms' where id = $1", [t.workerId]);
    await stopped(t.workerId);
    const mobile = await mobileOf(t.workerId);
    await t.run();
    expect(t.rec.log).toEqual([`whatsapp:${mobile}`]);
  });

  it("a refused WhatsApp is never sent as a text, nor by email", async () => {
    for (const channel of ["whatsapp", "sms"]) {
      const t = await sender.setup();
      await su.query("update workers set notify_channel = $2 where id = $1", [t.workerId, channel]);
      await stopped(t.workerId);
      await giveEmail(t.workerId);
      t.rec.state.whatsapp = "refused";
      const mobile = await mobileOf(t.workerId);
      await t.run();
      expect(t.rec.log).toEqual([`whatsapp:${mobile}`]);
    }
  });
});

describe.each(SENDERS)("idempotency: %s", (_name, sender) => {
  it("the same job again sends nothing more", async () => {
    const t = await sender.setup();
    await t.run();
    await t.run();
    await t.run(new Date(NOW.getTime() + 5 * 60_000));
    expect(t.rec.log).toHaveLength(1);
  });

  it("two copies at the same moment send it once", async () => {
    const t = await sender.setup();
    await Promise.all([t.run(), t.run()]);
    expect(t.rec.log).toHaveLength(1);
  });

  it("by email: once, however often the job runs", async () => {
    const t = await sender.setup();
    t.rec.noTexts();
    await giveEmail(t.workerId);
    await Promise.all([t.run(), t.run()]);
    await t.run(new Date(NOW.getTime() + 5 * 60_000));
    expect(t.rec.log).toHaveLength(1);
  });

  if (sender.push) {
    it("by push: once, however often the job runs", async () => {
      const t = await sender.setup();
      await subscribe(t.f, t.workerId);
      await Promise.all([t.run(), t.run()]);
      await t.run(new Date(NOW.getTime() + 5 * 60_000));
      expect(t.rec.log).toHaveLength(1);
    });
  }
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
      [OFFER_WAVE_QUEUE]: (job, now) => runFirmTask(createOfferWaveTask(deps(now)), job, withFirm),
      [ESCALATE_SHIFT_QUEUE]: (job, now) =>
        runFirmTask(createEscalateShiftTask(deps(now)), job, withFirm),
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

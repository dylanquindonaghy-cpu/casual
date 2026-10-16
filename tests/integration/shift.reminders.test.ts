import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { ChannelRefusedError, type OutboundMessage } from "@/lib/messaging/transport";
import type { PushTransport } from "@/lib/push/transport";
import {
  runShiftReminders,
  runShiftReminderTick,
  SHIFT_REMINDER_TICK_CRON,
  SHIFT_REMINDER_TICK_QUEUE,
  SHIFT_REMINDERS_QUEUE,
  type ReminderDeps,
} from "@/lib/reminders/send";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Shift reminders on the real database, as the app role, with a capturing transport (nothing is
// sent anywhere) and a fixed clock. NOW is Monday 2 November 2026, 09:00 London (GMT). Firms here
// have no quiet hours unless a test gives them some.

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

const NO_QUIET = { quiet_hours: { start: "00:00", end: "00:00" } };

async function reminderFirm(settings: Record<string, unknown> = NO_QUIET) {
  const f = await bookingFirm(su, withFirm, { settings });
  const workerId = await f.worker({ first: "Rae" });
  const mobile = (
    await su.query<{ mobile: string }>("select mobile_e164 as mobile from workers where id = $1", [
      workerId,
    ])
  ).rows[0]?.mobile;
  const slug = (
    await su.query<{ slug: string }>("select slug from firms where id = $1", [f.firmId])
  ).rows[0]?.slug;
  const { transport: capture, sent } = captureTransport();
  // `refuseWhatsApp`: the provider refuses WhatsApp; `fail`: every send fails another way;
  // `pushThrows`: the push sender throws (after the message has gone); `onSend`: runs as each
  // message goes (to change the rows mid-run).
  const state = {
    refuseWhatsApp: false,
    fail: false,
    pushThrows: false,
    onSend: async (): Promise<void> => {},
  };
  const transport: typeof capture = {
    name: "capture",
    async send(message) {
      await state.onSend();
      if (state.fail) throw new Error("timed out");
      if (state.refuseWhatsApp && message.channel === "whatsapp") {
        throw new ChannelRefusedError("whatsapp");
      }
      return capture.send(message);
    },
  };
  const pushed: { title: string; body: string; url: string }[] = [];
  const push: PushTransport = {
    name: "capture",
    async send(_target, payload) {
      if (state.pushThrows) throw new Error("push service down");
      pushed.push(payload);
      return { status: "sent" };
    },
  };
  const deps = (when: Date): ReminderDeps => ({
    transport,
    push,
    baseDomain: "localhost:3000",
    clock: { now: () => when },
  });
  const run = (when: Date) =>
    runShiftReminders(
      { firmId: f.firmId, idempotencyKey: "shift-reminders:1" },
      withFirm,
      deps(when),
    );
  return { f, workerId, mobile, slug, sent, pushed, state, run };
}

const bodies = (sent: OutboundMessage[]) => sent.map((m) => ("body" in m ? m.body : ""));
const reminderRows = async (assignmentId: string) =>
  (
    await su.query(
      `select kind, status, channel, starts_at from shift_reminders
        where assignment_id = $1 order by recorded_at, kind`,
      [assignmentId],
    )
  ).rows;
const eventsOf = async (firmId: string) =>
  (
    await su.query<{ action: string; data: Record<string, unknown> }>(
      `select action, data from events where firm_id = $1 and action like 'shift.reminder_%'
        order by created_at, id`,
      [firmId],
    )
  ).rows;

describe("the 24-hour and 2-hour reminders", () => {
  it("a booking made days ago gets the 24h reminder, then the 2h one, each once", async () => {
    const t = await reminderFirm();
    const startsAt = hoursFromNow(30); // Tuesday 15:00
    const shiftId = await t.f.shift({ startsAt });
    const bookingId = await t.f.booking(t.workerId, shiftId);

    expect(await t.run(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 }); // 30 hours before
    expect(await t.run(hoursFromNow(6))).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(t.sent).toEqual([
      {
        channel: "whatsapp",
        to: t.mobile,
        body: `Reminder: tomorrow 15:00–23:00. Details: http://${t.slug}.localhost:3000/shifts/${shiftId}. Can't make it? Cancel in the app as early as you can. — Booking Test ${t.slug} Shift Team`,
      },
    ]);
    // Again, and again later the same day: nothing more.
    expect(await t.run(hoursFromNow(6))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await t.run(hoursFromNow(20))).toEqual({ sent: 0, failed: 0, skipped: 0 });

    expect(await t.run(hoursFromNow(28))).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(bodies(t.sent)[1]).toBe(
      `Your shift starts at 15:00. Meeting point and instructions: http://${t.slug}.localhost:3000/shifts/${shiftId}. — Booking Test ${t.slug} Shift Team`,
    );
    expect(await t.run(hoursFromNow(29.5))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await t.run(hoursFromNow(31))).toEqual({ sent: 0, failed: 0, skipped: 0 }); // started

    expect(await reminderRows(bookingId)).toEqual([
      { kind: "24h", status: "sent", channel: "whatsapp", starts_at: startsAt },
      { kind: "2h", status: "sent", channel: "whatsapp", starts_at: startsAt },
    ]);
    const events = await eventsOf(t.f.firmId);
    expect(events.map((e) => [e.action, e.data.kind])).toEqual([
      ["shift.reminder_sent", "24h"],
      ["shift.reminder_sent", "2h"],
    ]);
    expect(events[0]?.data).toEqual({
      shiftId,
      workerId: t.workerId,
      kind: "24h",
      channel: "whatsapp",
      providerMessageId: "capture-1",
      pushes: 0,
    });
  });

  it("names the site when the shift has one, and says 'today' for a late 24h reminder", async () => {
    const t = await reminderFirm();
    const { rows } = await su.query<{ id: string }>(
      "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
      [t.f.firmId],
    );
    const startsAt = hoursFromNow(10); // 19:00 today: the 24h window is still open until 17:00
    const shiftId = await t.f.shift({ startsAt });
    await su.query("update shifts set site_id = $2 where id = $1", [shiftId, rows[0]?.id]);
    await t.f.booking(t.workerId, shiftId);

    await t.run(NOW);
    expect(bodies(t.sent)[0]).toMatch(/^Reminder: today 19:00–03:00 at Riverside Arena\. /);
    await t.run(hoursFromNow(8));
    expect(bodies(t.sent)[1]).toMatch(/^Your shift at Riverside Arena starts at 19:00\. /);
  });

  it("a booking made after the 24h mark gets only the 2h reminder; one inside 2 hours gets none", async () => {
    const t = await reminderFirm();
    const lateBooked = await t.f.shift({ startsAt: hoursFromNow(12) });
    const b1 = await t.f.booking(t.workerId, lateBooked);
    await su.query("update assignments set confirmed_at = $2 where id = $1", [
      b1,
      hoursFromNow(-1),
    ]);
    const lastMinute = await t.f.shift({ startsAt: hoursFromNow(1.5) });
    const other = await t.f.worker({ first: "Lou" });
    const b2 = await t.f.booking(other, lastMinute);
    await su.query("update assignments set confirmed_at = $2 where id = $1", [
      b2,
      hoursFromNow(-0.25),
    ]);

    expect(await t.run(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await t.run(hoursFromNow(10))).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(bodies(t.sent)[0]).toMatch(/^Your shift starts at 21:00\./);
  });

  it("never to a cancelled booking, an offered place, or a cancelled or draft shift", async () => {
    const t = await reminderFirm();
    const startsAt = hoursFromNow(20);
    const cancelledBooking = await t.f.shift({ startsAt });
    await t.f.booking(t.workerId, cancelledBooking, "cancelled_worker");
    const offered = await t.f.shift({ startsAt: hoursFromNow(21) });
    await t.f.booking(t.workerId, offered, "offered");
    const cancelledShift = await t.f.shift({ startsAt: hoursFromNow(22), status: "cancelled" });
    await t.f.booking(t.workerId, cancelledShift);
    const draft = await t.f.shift({ startsAt: hoursFromNow(23), status: "draft" });
    await t.f.booking(t.workerId, draft);

    expect(await t.run(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(t.sent).toEqual([]);
  });

  it("a shift moved to a new time gets the reminder again for the new time", async () => {
    const t = await reminderFirm();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(20) });
    const bookingId = await t.f.booking(t.workerId, shiftId);
    await t.run(NOW);
    const moved = hoursFromNow(22);
    await su.query("update shifts set starts_at = $2, ends_at = $3 where id = $1", [
      shiftId,
      moved,
      new Date(moved.getTime() + 8 * HOUR),
    ]);
    expect(await t.run(hoursFromNow(1))).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(bodies(t.sent)[1]).toMatch(/^Reminder: tomorrow 07:00–15:00\./);
    expect((await reminderRows(bookingId)).map((r) => r.kind)).toEqual(["24h", "24h"]);
  });

  it("two jobs at the same moment send it once", async () => {
    const t = await reminderFirm();
    const shiftId = await t.f.shift({ startsAt: hoursFromNow(20) });
    await t.f.booking(t.workerId, shiftId);
    const results = await Promise.all([t.run(NOW), t.run(NOW)]);
    expect(results.map((r) => r.sent).sort()).toEqual([0, 1]);
    expect(t.sent).toHaveLength(1);
  });

  it("a job that stops after a message went leaves it 'sending', and it's never sent again", async () => {
    const t = await reminderFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/rae-2', 'k', 'a')`,
      [t.f.firmId, t.workerId],
    );
    const bookingId = await t.f.booking(
      t.workerId,
      await t.f.shift({ startsAt: hoursFromNow(20) }),
    );
    t.state.pushThrows = true; // recording the outcome fails, after the message has gone
    await expect(t.run(NOW)).rejects.toThrow("push service down");
    expect(t.sent).toHaveLength(1);
    expect(await reminderRows(bookingId)).toEqual([
      expect.objectContaining({ kind: "24h", status: "sending", channel: "whatsapp" }),
    ]);
    // The retry, and later runs: nothing more.
    t.state.pushThrows = false;
    expect(await t.run(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await t.run(hoursFromNow(1))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(t.sent).toHaveLength(1);
  });

  it("a booking cancelled while the job is running isn't reminded", async () => {
    const t = await reminderFirm();
    await t.f.booking(t.workerId, await t.f.shift({ startsAt: hoursFromNow(20) }));
    const lou = await t.f.worker({ first: "Lou" });
    const later = await t.f.booking(lou, await t.f.shift({ startsAt: hoursFromNow(21) }));
    // As the first reminder goes, Lou cancels.
    t.state.onSend = async () => {
      await su.query(
        `update assignments set status = 'cancelled_worker', cancelled_at = $2,
                cancel_reason = 'Unwell', notice_hours = 21 where id = $1`,
        [later, NOW],
      );
    };
    expect(await t.run(NOW)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(t.sent.map((m) => m.to)).toEqual([t.mobile]);
    expect(await reminderRows(later)).toEqual([]);
  });

  it("never reminds another firm's workers", async () => {
    const t = await reminderFirm();
    const other = await reminderFirm();
    await other.f.booking(other.workerId, await other.f.shift({ startsAt: hoursFromNow(20) }));
    expect(await t.run(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(t.sent).toEqual([]);
  });
});

describe("how a reminder goes", () => {
  it("by text message when that's the worker's choice, with a push to their phones", async () => {
    const t = await reminderFirm();
    await su.query("update workers set notify_channel = 'sms' where id = $1", [t.workerId]);
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/rae', 'k', 'a')`,
      [t.f.firmId, t.workerId],
    );
    const startsAt = hoursFromNow(20);
    const shiftId = await t.f.shift({ startsAt });
    await t.f.booking(t.workerId, shiftId);
    await t.run(NOW);
    expect(t.sent.map((m) => m.channel)).toEqual(["sms"]);
    expect(t.pushed).toEqual([
      {
        title: "Tomorrow: your shift",
        body: "05:00–13:00. Tap for instructions.",
        url: `/shifts/${shiftId}`,
        until: startsAt, // for the push service only (13.3): not delivered once it has started
      },
    ]);
    expect((await eventsOf(t.f.firmId))[0]?.data).toMatchObject({ channel: "sms", pushes: 1 });
  });

  it("a WhatsApp the provider refuses goes by text, and the record says so", async () => {
    const t = await reminderFirm();
    t.state.refuseWhatsApp = true;
    const bookingId = await t.f.booking(
      t.workerId,
      await t.f.shift({ startsAt: hoursFromNow(20) }),
    );
    expect(await t.run(NOW)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(t.sent.map((m) => m.channel)).toEqual(["sms"]);
    expect((await reminderRows(bookingId))[0]).toMatchObject({ status: "sent", channel: "sms" });
    expect((await eventsOf(t.f.firmId))[0]?.data).toMatchObject({
      channel: "sms",
      fellBackFrom: "whatsapp",
    });
  });

  it("any other failure is recorded and logged, and never sent again", async () => {
    const t = await reminderFirm();
    t.state.fail = true;
    const bookingId = await t.f.booking(
      t.workerId,
      await t.f.shift({ startsAt: hoursFromNow(20) }),
    );
    expect(await t.run(NOW)).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect((await reminderRows(bookingId))[0]).toMatchObject({
      status: "failed",
      channel: "whatsapp",
    });
    expect(await eventsOf(t.f.firmId)).toEqual([
      {
        action: "shift.reminder_failed",
        data: expect.objectContaining({ kind: "24h", channel: "whatsapp", code: "Error" }),
      },
    ]);
    t.state.fail = false;
    expect(await t.run(hoursFromNow(1))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(t.sent).toEqual([]);
  });
});

describe("quiet hours (the default 22:00–07:00)", () => {
  it("a 24h reminder due at night waits until 07:00, then goes", async () => {
    const t = await reminderFirm({});
    const startsAt = new Date("2026-11-03T23:00:00Z"); // Tuesday 23:00
    const bookingId = await t.f.booking(t.workerId, await t.f.shift({ startsAt }));
    expect(await t.run(new Date("2026-11-02T23:00:00Z"))).toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    expect(await reminderRows(bookingId)).toEqual([]);
    expect(await t.run(new Date("2026-11-03T07:00:00Z"))).toEqual({
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    expect(bodies(t.sent)[0]).toMatch(/^Reminder: today 23:00–07:00\./);
  });

  it("a 2h reminder for a 06:00 start is skipped (it would come after the start), and logged", async () => {
    const t = await reminderFirm({});
    const startsAt = new Date("2026-11-03T06:00:00Z");
    const bookingId = await t.f.booking(t.workerId, await t.f.shift({ startsAt }));
    await t.run(new Date("2026-11-02T09:00:00Z")); // the 24h one, in the day
    expect(await t.run(new Date("2026-11-03T04:00:00Z"))).toEqual({
      sent: 0,
      failed: 0,
      skipped: 1,
    });
    expect(t.sent).toHaveLength(1);
    expect(await reminderRows(bookingId)).toEqual([
      { kind: "24h", status: "sent", channel: "whatsapp", starts_at: startsAt },
      { kind: "2h", status: "skipped", channel: null, starts_at: startsAt },
    ]);
    const events = await eventsOf(t.f.firmId);
    expect(events[1]).toEqual({
      action: "shift.reminder_skipped",
      data: expect.objectContaining({ kind: "2h", reason: "quiet_hours" }),
    });
    // Recorded once: the next run doesn't skip it again.
    expect(await t.run(new Date("2026-11-03T04:05:00Z"))).toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
    });
  });
});

describe("the tick", () => {
  const pending = async (firmId: string) =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2`,
        [SHIFT_REMINDERS_QUEUE, firmId],
      )
    ).rows.map((r) => r.data);

  it("queues one job for a firm with a reminder due, none for a firm without", async () => {
    const due = await reminderFirm();
    await due.f.booking(due.workerId, await due.f.shift({ startsAt: hoursFromNow(20) }));
    const quiet = await reminderFirm();
    await quiet.f.booking(quiet.workerId, await quiet.f.shift({ startsAt: hoursFromNow(40) }));
    const tick = () =>
      runShiftReminderTick({
        listFirmIds: async () => [due.f.firmId, quiet.f.firmId],
        run: withFirm,
        clock: { now: () => NOW },
      });
    expect(await tick()).toEqual({ queued: 1 });
    expect(await pending(due.f.firmId)).toEqual([
      {
        firmId: due.f.firmId,
        idempotencyKey: `shift-reminders:${Math.floor(NOW.getTime() / 300_000)}`,
      },
    ]);
    expect(await pending(quiet.f.firmId)).toEqual([]);
    // The same slot again: no second job.
    expect(await tick()).toEqual({ queued: 0 });
    expect(await pending(due.f.firmId)).toHaveLength(1);
  });

  it("the worker works both queues and schedules the tick every 5 minutes", async () => {
    const calls: unknown[][] = [];
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string) => {
        calls.push(["work", name]);
        return "worker-id";
      },
      schedule: async (...args: unknown[]) => {
        calls.push(["schedule", ...args]);
      },
      unschedule: async (name: string) => {
        calls.push(["unschedule", name]);
      },
    } as unknown as PgBoss;
    await registerJobs(boss);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["work", SHIFT_REMINDERS_QUEUE],
        ["work", SHIFT_REMINDER_TICK_QUEUE],
        ["schedule", SHIFT_REMINDER_TICK_QUEUE, "*/5 * * * *"],
      ]),
    );
    expect(SHIFT_REMINDER_TICK_CRON).toBe("*/5 * * * *");
    expect(QUEUES.find((q) => q.name === SHIFT_REMINDERS_QUEUE)?.options).toMatchObject({
      policy: "standard",
    });
    expect(QUEUES.map((q) => q.name)).toContain(SHIFT_REMINDER_TICK_QUEUE);
  });
});

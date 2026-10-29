import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "@/lib/auth/clock";
import { activeFirmId, createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { ChannelRefusedError, type OutboundMessage } from "@/lib/messaging/transport";
import type { PushTransport } from "@/lib/push/transport";
import {
  createShiftRemindersTask,
  REMINDERS_PER_RUN,
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
import { BULK_MAX, bulkBookings, bulkWorkers } from "../helpers/bulk-seed";
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
  // `pushThrows`: the push sender throws; `loseDatabaseOnSend`: the database goes away as a message
  // or a push goes, so every transaction after it fails (`databaseGone`);
  // `onSend`: runs as each message goes (to change the rows mid-run); `afterRead`: runs once, after
  // the next transaction returns (a run's first: its list of what's due).
  const state = {
    refuseWhatsApp: false,
    fail: false,
    pushThrows: false,
    loseDatabaseOnSend: false,
    databaseGone: false,
    onSend: async (): Promise<void> => {},
    afterRead: null as null | (() => Promise<void>),
  };
  const transport: typeof capture = {
    name: "capture",
    async send(message) {
      await state.onSend();
      if (state.fail) throw new Error("timed out");
      if (state.refuseWhatsApp && message.channel === "whatsapp") {
        throw new ChannelRefusedError("whatsapp");
      }
      const sent = await capture.send(message);
      if (state.loseDatabaseOnSend) state.databaseGone = true;
      return sent;
    },
  };
  // `pushedInTransaction`: whether a transaction was open as each push went (14.1: never).
  const pushed: { title: string; body: string; url: string }[] = [];
  const pushedInTransaction: boolean[] = [];
  const push: PushTransport = {
    name: "capture",
    async send(_target, payload) {
      pushedInTransaction.push(activeFirmId() !== undefined);
      if (state.pushThrows) throw new Error("push service down");
      pushed.push(payload);
      if (state.loseDatabaseOnSend) state.databaseGone = true;
      return { status: "sent" };
    },
  };
  const deps = (when: Date): ReminderDeps => ({
    transport,
    push,
    baseDomain: "localhost:3000",
    clock: { now: () => when },
  });
  const inFirm: WithFirm = async (firmId, fn) => {
    if (state.databaseGone) throw new Error("database went away");
    const value = await withFirm(firmId, fn);
    const after = state.afterRead;
    if (after) {
      state.afterRead = null;
      await after();
    }
    return value;
  };
  const run = (when: Date) =>
    runShiftReminders(
      { firmId: f.firmId, idempotencyKey: "shift-reminders:1" },
      inFirm,
      deps(when),
    );
  return { f, workerId, mobile, slug, sent, pushed, pushedInTransaction, state, run };
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
        body: `Reminder: tomorrow 15:00–23:00. Details: http://${t.slug}.localhost:3000/shifts/${shiftId}. Can't make it? Cancel with the link as early as you can. — Booking Test ${t.slug} Shift Team`,
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
    const bookingId = await t.f.booking(
      t.workerId,
      await t.f.shift({ startsAt: hoursFromNow(20) }),
    );
    // Recording the outcome fails, after the message has gone. (Until 14.1 a throwing push did
    // this; now a push can't stop the record, so the database goes away instead.)
    t.state.loseDatabaseOnSend = true;
    await expect(t.run(NOW)).rejects.toThrow("database went away");
    expect(t.sent).toHaveLength(1);
    t.state.loseDatabaseOnSend = false;
    t.state.databaseGone = false;
    expect(await reminderRows(bookingId)).toEqual([
      expect.objectContaining({ kind: "24h", status: "sending", channel: "whatsapp" }),
    ]);
    // The retry, and later runs: nothing more.
    expect(await t.run(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await t.run(hoursFromNow(1))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(t.sent).toHaveLength(1);
  });

  it("the same when it went by push (P2.4): left 'sending', and nothing more goes, by push or text", async () => {
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
    t.state.loseDatabaseOnSend = true;
    await expect(t.run(NOW)).rejects.toThrow("database went away");
    expect(t.pushed).toHaveLength(1);
    t.state.loseDatabaseOnSend = false;
    t.state.databaseGone = false;
    expect(await reminderRows(bookingId)).toEqual([
      expect.objectContaining({ kind: "24h", status: "sending", channel: "whatsapp" }),
    ]);
    expect(await t.run(NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await t.run(hoursFromNow(1))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(t.pushed).toHaveLength(1);
    expect(t.sent).toEqual([]);
  });

  it("a booking cancelled while the job is running isn't reminded", async () => {
    const t = await reminderFirm();
    await t.f.booking(t.workerId, await t.f.shift({ startsAt: hoursFromNow(20) }));
    const lou = await t.f.worker({ first: "Lou" });
    const later = await t.f.booking(lou, await t.f.shift({ startsAt: hoursFromNow(21) }));
    // Once the job has read what's due, Lou cancels: before the claims, which re-check the booking.
    // (Until P4.5 this was as the first reminder went; 4 at a time, Lou's claim no longer waits
    // for Rae's message.)
    t.state.afterRead = async () => {
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

// Who sends what (P2.3; "Connecting the firm's systems" 9 and 17): a firm whose own system
// reminds the casuals it books switches firm_system_sends on, and ShiftDesk leaves those to it.
describe("who sends what (P2.3)", () => {
  // Rae booked on five shifts (30 to 34 hours away), each made a different way (booked_via):
  // 11 hours from now, all five are due their 24h reminder; 28.5 hours from now, the first its 2h one.
  async function bookedFiveWays(settings: Record<string, unknown>) {
    const t = await reminderFirm(settings);
    const ways = ["app", "office", "sheet", "api", null] as const;
    const bookings: string[] = [];
    for (const [i, via] of ways.entries()) {
      const id = await t.f.booking(t.workerId, await t.f.shift({ startsAt: hoursFromNow(30 + i) }));
      await su.query("update assignments set booked_via = $2 where id = $1", [id, via]);
      bookings.push(id);
    }
    return { t, bookings };
  }
  const reminded = async (bookings: string[]) =>
    Promise.all(bookings.map(async (id) => (await reminderRows(id)).length));

  it("off (the default): every booking is reminded, the sheet's and the API's too", async () => {
    const { t, bookings } = await bookedFiveWays(NO_QUIET);
    expect(await t.run(hoursFromNow(11))).toEqual({ sent: 5, failed: 0, skipped: 0 });
    expect(await reminded(bookings)).toEqual([1, 1, 1, 1, 1]);
    // 31.5 hours on: the sheet's and the API's 2h reminders (half an hour and 1.5 hours before).
    expect(await t.run(hoursFromNow(31.5))).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(await reminded(bookings)).toEqual([1, 1, 2, 2, 1]);
  });

  it("on: none for the sheet's or the API's bookings; the app's, the office's and one with no record still go", async () => {
    const { t, bookings } = await bookedFiveWays({ ...NO_QUIET, firm_system_sends: true });
    expect(await t.run(hoursFromNow(11))).toEqual({ sent: 3, failed: 0, skipped: 0 });
    expect(await reminded(bookings)).toEqual([1, 1, 0, 0, 1]);
    // The app's booking gets its 2h reminder (28.5 hours on: 1.5 hours before its start); the
    // sheet's and the API's are still in their 24h windows, and still get none.
    expect(await t.run(hoursFromNow(28.5))).toMatchObject({ sent: 1 });
    expect(await reminded(bookings)).toEqual([2, 1, 0, 0, 1]);
    // Nor their 2h reminders: inside both 2h windows (31.5 hours on), where with it off those two
    // go (above), nothing.
    expect(await t.run(hoursFromNow(31.5))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await reminded(bookings)).toEqual([2, 1, 0, 0, 1]);
    // Anything but true is off.
    const odd = await bookedFiveWays({ ...NO_QUIET, firm_system_sends: "yes" });
    expect(await odd.t.run(hoursFromNow(11))).toMatchObject({ sent: 5 });
  });
});

describe("how a reminder goes", () => {
  it("by text message when that's the worker's choice and no phone has notifications on", async () => {
    const t = await reminderFirm();
    await su.query("update workers set notify_channel = 'sms' where id = $1", [t.workerId]);
    await t.f.booking(t.workerId, await t.f.shift({ startsAt: hoursFromNow(20) }));
    await t.run(NOW);
    expect(t.sent.map((m) => m.channel)).toEqual(["sms"]);
    expect(t.pushed).toEqual([]);
    expect((await eventsOf(t.f.firmId))[0]?.data).toMatchObject({ channel: "sms", pushes: 0 });
  });

  it("a push to their phones when one takes it, instead of the text (P2.4; Messages 2)", async () => {
    const t = await reminderFirm();
    await su.query("update workers set notify_channel = 'sms' where id = $1", [t.workerId]);
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/rae', 'k', 'a')`,
      [t.f.firmId, t.workerId],
    );
    const startsAt = hoursFromNow(20);
    const shiftId = await t.f.shift({ startsAt });
    const bookingId = await t.f.booking(t.workerId, shiftId);
    await t.run(NOW);
    expect(t.sent).toEqual([]);
    expect(t.pushed).toEqual([
      {
        title: "Tomorrow: your shift",
        body: "05:00–13:00. Tap for instructions.",
        url: `/shifts/${shiftId}`,
        until: startsAt, // for the push service only (13.3): not delivered once it has started
      },
    ]);
    expect((await eventsOf(t.f.firmId))[0]?.data).toMatchObject({
      channel: "push",
      providerMessageId: null,
      pushes: 1,
    });
    expect(await reminderRows(bookingId)).toEqual([
      expect.objectContaining({ kind: "24h", status: "sent", channel: "push" }),
    ]);
    // With no transaction open (14.1): a slow push service holds no database connection.
    expect(t.pushedInTransaction).toEqual([false]);
  });

  it("a push that throws never stops the record of the message that went (14.1)", async () => {
    const t = await reminderFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/rae-3', 'k', 'a')`,
      [t.f.firmId, t.workerId],
    );
    const bookingId = await t.f.booking(
      t.workerId,
      await t.f.shift({ startsAt: hoursFromNow(20) }),
    );
    t.state.pushThrows = true;
    expect(await t.run(NOW)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await reminderRows(bookingId)).toEqual([
      expect.objectContaining({ kind: "24h", status: "sent", channel: "whatsapp" }),
    ]);
    expect(await eventsOf(t.f.firmId)).toEqual([
      expect.objectContaining({
        action: "shift.reminder_sent",
        data: expect.objectContaining({ pushes: 0 }),
      }),
    ]);
    // The phone is kept: a push that failed this time may go next time.
    const { rows } = await su.query(
      "select count(*)::int as n from push_subscriptions where worker_id = $1",
      [t.workerId],
    );
    expect(rows).toEqual([{ n: 1 }]);
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

describe("at a big firm's size (P4.5)", () => {
  const noPush: PushTransport = {
    name: "none",
    async send() {
      return { status: "skipped" };
    },
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // A firm of `count` made-up casuals, each booked on a session 20 hours away (their 24h reminder
  // is due), at most 1,000 a session.
  async function bigFirm(count: number) {
    const f = await bookingFirm(su, withFirm, { settings: NO_QUIET });
    const ids = await bulkWorkers(su, f.firmId, count);
    for (let i = 0; i < ids.length; i += 1000) {
      const shiftId = await f.shift({ startsAt: hoursFromNow(20), headcount: 1000 });
      await bulkBookings(su, f.firmId, shiftId, ids.slice(i, i + 1000));
    }
    return f;
  }
  const remindersOf = async (firmId: string) =>
    (
      await su.query<{ n: number; bookings: number; sent: number; sending: number }>(
        `select count(*)::int as n, count(distinct assignment_id)::int as bookings,
                count(*) filter (where status = 'sent')::int as sent,
                count(*) filter (where status = 'sending')::int as sending
           from shift_reminders where firm_id = $1`,
        [firmId],
      )
    ).rows[0];

  it("2,000 due in one slot: 200 a run, 4 at a time, each sent once, and another firm's in between", async () => {
    const big = await bigFirm(BULK_MAX);
    const small = await bookingFirm(su, withFirm, { settings: NO_QUIET });
    for (const first of ["Ann", "Ben", "Cal"]) {
      await small.booking(
        await small.worker({ first }),
        await small.shift({ startsAt: hoursFromNow(20) }),
      );
    }
    // Each message waits (up to 100 ms) until 4 are going, so the most at once is seen whatever
    // the claims' speed.
    let going = 0;
    let most = 0;
    const sent: OutboundMessage[] = [];
    const deps: ReminderDeps = {
      transport: {
        name: "counting",
        async send(message) {
          going += 1;
          most = Math.max(most, going);
          for (let waited = 0; going < 4 && waited < 100; waited += 2) await sleep(2);
          going -= 1;
          sent.push(message);
          return { providerMessageId: `counting-${sent.length}` };
        },
      },
      push: noPush,
      baseDomain: "localhost:3000",
      clock: { now: () => NOW },
    };
    // The tick queues the big firm's job, then the small firm's.
    expect(
      await runShiftReminderTick({
        listFirmIds: async () => [big.firmId, small.firmId],
        run: withFirm,
        clock: { now: () => NOW },
      }),
    ).toEqual({ queued: 2 });
    // The worker's order: the two firms' waiting jobs as pg-boss 12.35 fetches them (by priority,
    // then when they were queued: node_modules/pg-boss/dist/plans.js, the fetch's `next`). A real
    // fetch can't be kept to two firms in the shared test database, so the order is copied.
    const task = createShiftRemindersTask(() => deps);
    const runs: { firm: string; key: string; output: Record<string, unknown> }[] = [];
    for (let guard = 0; guard < 30; guard += 1) {
      const { rows } = await su.query<{
        id: string;
        data: { firmId: string; idempotencyKey: string };
      }>(
        `select id::text as id, data from pgboss.job
          where name = $1 and state = 'created' and data ->> 'firmId' = any($2)
          order by priority desc, created_on limit 1`,
        [SHIFT_REMINDERS_QUEUE, [big.firmId, small.firmId]],
      );
      const job = rows[0];
      if (!job) break;
      const result = await runFirmTask(task, job, withFirm);
      await su.query(
        "update pgboss.job set state = 'completed', completed_on = now() where id = $1",
        [job.id],
      );
      runs.push({
        firm: job.data.firmId === big.firmId ? "big" : "small",
        key: job.data.idempotencyKey,
        output: result.output as Record<string, unknown>,
      });
    }
    const slot = `shift-reminders:${Math.floor(NOW.getTime() / 300_000)}`;
    // The big firm's first 200, the small firm's 3, then the big firm's follow-ups, 200 each.
    expect(REMINDERS_PER_RUN).toBe(200);
    expect(runs.map((r) => [r.firm, r.key, r.output.sent, r.output.more])).toEqual([
      ["big", slot, 200, true],
      ["small", slot, 3, undefined],
      ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ["big", `${slot}:${n}`, 200, true]),
      ["big", `${slot}:10`, 200, undefined],
    ]);
    // Each reminder once: 2,000 rows, one a booking, all sent; 2,003 messages in all.
    expect(await remindersOf(big.firmId)).toEqual({
      n: 2000,
      bookings: 2000,
      sent: 2000,
      sending: 0,
    });
    expect(sent).toHaveLength(2003);
    expect(most).toBe(4);
  }, 300_000);

  it("a run that stops part-way: the next runs send the rest, and nobody hears twice", async () => {
    const big = await bigFirm(300);
    let gone = false;
    const sent: OutboundMessage[] = [];
    const deps: ReminderDeps = {
      transport: {
        name: "capture",
        async send(message) {
          await sleep(2);
          sent.push(message);
          // The database goes away as the 50th message goes: every transaction after fails.
          if (sent.length === 50) gone = true;
          return { providerMessageId: `capture-${sent.length}` };
        },
      },
      push: noPush,
      baseDomain: "localhost:3000",
      clock: { now: () => NOW },
    };
    const inFirm: WithFirm = async (firmId, fn) => {
      if (gone) throw new Error("database went away");
      return withFirm(firmId, fn);
    };
    const payload = { firmId: big.firmId, idempotencyKey: "shift-reminders:1" };
    await expect(runShiftReminders(payload, inFirm, deps)).rejects.toThrow("database went away");
    // Thrown only once the messages already going had gone (at most 3 beside the 50th): nothing is
    // still sending afterwards.
    const before = sent.length;
    expect(before).toBeGreaterThanOrEqual(50);
    expect(before).toBeLessThanOrEqual(53);
    await sleep(20);
    expect(sent).toHaveLength(before);
    gone = false;
    // The retry, and its follow-up: the rest.
    let more = true;
    for (let guard = 0; more && guard < 5; guard += 1) {
      more = (await runShiftReminders(payload, withFirm, deps)).more === true;
    }
    expect(sent).toHaveLength(300);
    expect(new Set(sent.map((m) => m.to)).size).toBe(300);
    // The ones whose record failed stay 'sending' (they went): never sent again.
    const rows = await remindersOf(big.firmId);
    expect(rows).toMatchObject({ n: 300, bookings: 300 });
    expect((rows?.sent ?? 0) + (rows?.sending ?? 0)).toBe(300);
    expect(rows?.sending).toBeGreaterThanOrEqual(1);
    expect(rows?.sending).toBeLessThanOrEqual(4);
  }, 120_000);
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

import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { ChannelRefusedError, type OutboundMessage } from "@/lib/messaging/transport";
import {
  createFirmChangeNoticeTask,
  FIRM_CHANGE_NOTICE_QUEUE,
  type NoticeDeps,
} from "@/lib/notices/firm-change";
import { cancelBookingByOffice, cancelShift, moveShift } from "@/lib/office/quick-actions";
import { cancelBooking } from "@/lib/roster/cancel";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Firm-initiated changes (golden rule 12; docs/api-and-jobs.md "Firm-initiated changes"): the
// office cancelling a shift or a booking, moving or shortening a booked shift, and telling each
// worker. On the real database, as the app role, with a capturing transport. NOW is Monday
// 2 November 2026, 09:00 London (GMT).

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

async function changeFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena'), ($1, 'Other Stadium') returning id::text as id",
    [f.firmId],
  );
  const [arena = "", stadium = ""] = rows.map((r) => r.id);
  // Saturday 7 November, 08:00 to 16:00 at the arena, two places, Ann and Ben booked.
  const shiftId = await f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 2 });
  await su.query("update shifts set site_id = $2 where id = $1", [shiftId, arena]);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const annBooking = await f.booking(ann, shiftId, "confirmed", 1);
  const benBooking = await f.booking(ben, shiftId, "confirmed", 2);
  await su.query("update shifts set status = 'filled' where id = $1", [shiftId]);
  const ctx = (officeUserId = resourcer, when = NOW) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: { now: () => when },
  });
  return { f, resourcer, arena, stadium, shiftId, ann, ben, annBooking, benBooking, ctx };
}

// Ordered by the number (events.id): a bare "id" would be the text column selected above, and
// "1000003" sorts before "999998".
const eventsOf = async (firmId: string, like: string) =>
  (
    await su.query<{
      id: string;
      action: string;
      actor_type: string;
      entity_id: string;
      data: Record<string, unknown>;
    }>(
      `select id::text, action, actor_type, entity_id::text, data from events
        where firm_id = $1 and action like $2 order by events.id`,
      [firmId, like],
    )
  ).rows;
const noticeJobs = async (firmId: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      // Jobs queued in one transaction share created_on: ordered by the change they tell about.
      `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
        order by (data ->> 'eventId')::bigint, data ->> 'idempotencyKey'`,
      [FIRM_CHANGE_NOTICE_QUEUE, firmId],
    )
  ).rows.map((r) => r.data);
const assignment = async (id: string) =>
  (
    await su.query(
      "select status, cancel_reason, notice_hours::float as notice_hours from assignments where id = $1",
      [id],
    )
  ).rows[0];

describe("cancelling a shift", () => {
  it("cancels every booking (notice hours, the reason), logs each worker, tells each one", async () => {
    const t = await changeFirm();
    const cal = await t.f.worker({ first: "Cal" });
    await su.query(
      `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
       values ($1, $2, $3, 1, 'whatsapp', $4)`,
      [t.f.firmId, t.shiftId, cal, hoursFromNow(-1)],
    );
    expect(await cancelShift(t.ctx(), t.shiftId, "event_cancelled")).toEqual({
      status: "cancelled",
      bookings: 2,
    });
    for (const id of [t.annBooking, t.benBooking]) {
      expect(await assignment(id)).toEqual({
        status: "cancelled_firm",
        cancel_reason: "The event was cancelled",
        notice_hours: 119,
      });
    }
    const events = await eventsOf(t.f.firmId, "shift.cancelled%");
    expect(events.map((e) => [e.action, e.actor_type, e.entity_id, e.data])).toEqual([
      [
        "shift.cancelled",
        "office",
        t.annBooking,
        {
          by: "firm",
          shiftId: t.shiftId,
          workerId: t.ann,
          reason: "The event was cancelled",
          noticeHours: 119,
        },
      ],
      [
        "shift.cancelled",
        "office",
        t.benBooking,
        {
          by: "firm",
          shiftId: t.shiftId,
          workerId: t.ben,
          reason: "The event was cancelled",
          noticeHours: 119,
        },
      ],
      [
        "shift.cancelled_by_firm",
        "office",
        t.shiftId,
        { by: "firm", reason: "The event was cancelled", bookings: 2 },
      ],
    ]);
    const { rows } = await su.query<{ status: string }>("select status from shifts where id = $1", [
      t.shiftId,
    ]);
    expect(rows).toEqual([{ status: "cancelled" }]);
    const offer = await su.query("select response from offers where shift_id = $1", [t.shiftId]);
    expect(offer.rows).toEqual([{ response: "expired" }]);
    // One notice job per worker, ids only; no offer waves for a cancelled shift.
    expect(await noticeJobs(t.f.firmId)).toEqual([
      {
        firmId: t.f.firmId,
        idempotencyKey: `firm-change:${events[0]?.id}`,
        eventId: Number(events[0]?.id),
        assignmentId: t.annBooking,
      },
      {
        firmId: t.f.firmId,
        idempotencyKey: `firm-change:${events[1]?.id}`,
        eventId: Number(events[1]?.id),
        assignmentId: t.benBooking,
      },
    ]);
    const waves = await su.query(
      "select 1 from pgboss.job where name = 'offer-wave' and data ->> 'shiftId' = $1",
      [t.shiftId],
    );
    expect(waves.rows).toEqual([]);
  });

  it("an empty shift; already cancelled; started; a sheet's; payroll; another firm's", async () => {
    const t = await changeFirm();
    const empty = await t.f.shift({ startsAt: hoursFromNow(30) });
    expect(await cancelShift(t.ctx(), empty, "fewer_staff")).toEqual({
      status: "cancelled",
      bookings: 0,
    });
    expect(await cancelShift(t.ctx(), empty, "fewer_staff")).toEqual({ status: "unchanged" });
    const started = await t.f.shift({ startsAt: hoursFromNow(-1) });
    expect(await cancelShift(t.ctx(), started, "weather")).toEqual({ status: "started" });
    const sheet = await t.f.shift({ source: "sheets" });
    expect(await cancelShift(t.ctx(), sheet, "weather")).toEqual({ status: "sheet" });
    const payroll = await t.f.office("payroll");
    expect(await cancelShift(t.ctx(payroll), t.shiftId, "weather")).toEqual({
      status: "not_allowed",
    });
    const other = await changeFirm();
    expect(await cancelShift(t.ctx(), other.shiftId, "weather")).toEqual({ status: "not_found" });
  });
});

describe("the office cancelling one booking", () => {
  it("cancelled by the firm, the reason's words in the log, and they're told", async () => {
    const t = await changeFirm();
    const result = await cancelBookingByOffice(t.ctx(), t.shiftId, t.ann, "fewer_staff");
    expect(result).toMatchObject({ status: "cancelled", noticeHours: 119 });
    expect(await assignment(t.annBooking)).toMatchObject({
      status: "cancelled_firm",
      cancel_reason: "The client needs fewer staff",
    });
    const [event] = await eventsOf(t.f.firmId, "shift.cancelled");
    expect(event?.data).toEqual({
      by: "firm",
      shiftId: t.shiftId,
      workerId: t.ann,
      noticeHours: 119,
      reason: "The client needs fewer staff",
    });
    expect(await noticeJobs(t.f.firmId)).toHaveLength(1);
  });

  it("a worker's own cancellation: their free-text reason stays off the log, and no notice", async () => {
    const t = await changeFirm();
    await cancelBooking(
      withFirm,
      t.f.firmId,
      {
        shiftId: t.shiftId,
        workerId: t.ann,
        reason: "I'm unwell",
        by: { type: "worker", id: t.ann },
      },
      { clock: { now: () => NOW } },
    );
    const [event] = await eventsOf(t.f.firmId, "shift.cancelled");
    expect(event?.data).not.toHaveProperty("reason");
    expect(await noticeJobs(t.f.firmId)).toEqual([]);
  });
});

describe("moving or shortening a booked shift", () => {
  const move = (o: Partial<Record<string, string>> = {}) => ({
    date: "2026-11-07",
    start: "08:00",
    end: "16:00",
    siteId: "",
    reason: "event_changed" as const,
    ...o,
  });

  it("new times: moved, logged per worker with old and new times and notice, each told", async () => {
    const t = await changeFirm();
    const result = await moveShift(
      t.ctx(),
      t.shiftId,
      move({ start: "10:00", end: "18:00", siteId: t.arena }),
    );
    expect(result).toEqual({ status: "moved", told: 2, noticeHours: 119, warnings: [] });
    const events = await eventsOf(t.f.firmId, "shift.moved");
    expect(events.map((e) => [e.entity_id, e.data])).toEqual(
      [t.annBooking, t.benBooking].map((id, i) => [
        id,
        {
          by: "firm",
          shiftId: t.shiftId,
          workerId: i === 0 ? t.ann : t.ben,
          reason: "The event's times or place changed",
          oldStartsAt: "2026-11-07T08:00:00.000Z",
          oldEndsAt: "2026-11-07T16:00:00.000Z",
          newStartsAt: "2026-11-07T10:00:00.000Z",
          newEndsAt: "2026-11-07T18:00:00.000Z",
          oldSiteId: t.arena,
          newSiteId: t.arena,
          noticeHours: 119,
          rulesOk: true,
        },
      ]),
    );
    expect(await noticeJobs(t.f.firmId)).toHaveLength(2);
    const [changed] = await eventsOf(t.f.firmId, "shift.changed");
    expect(changed?.data).toMatchObject({
      fields: ["startsAt", "endsAt"],
      reason: "The event's times or place changed",
    });
    // Still booked.
    expect(await assignment(t.annBooking)).toMatchObject({ status: "confirmed" });
  });

  it("inside the old times at the same site: curtailed", async () => {
    const t = await changeFirm();
    expect(
      await moveShift(t.ctx(), t.shiftId, move({ start: "08:00", end: "12:00", siteId: t.arena })),
    ).toMatchObject({
      status: "curtailed",
      told: 2,
    });
    expect(await eventsOf(t.f.firmId, "shift.curtailed")).toHaveLength(2);
  });

  it("another site, same times: moved", async () => {
    const t = await changeFirm();
    expect(await moveShift(t.ctx(), t.shiftId, move({ siteId: t.stadium }))).toMatchObject({
      status: "moved",
    });
    const [e] = await eventsOf(t.f.firmId, "shift.moved");
    expect(e?.data).toMatchObject({ oldSiteId: t.arena, newSiteId: t.stadium });
  });

  it("someone the rules would refuse at the new time for a reason that can't be overridden: nothing moves", async () => {
    const t = await changeFirm();
    // Ben's licence runs out on Tuesday 10 November; the shift would move to Thursday.
    await su.query(
      "update credentials set expires_on = '2026-11-10' where worker_id = $1 and type = 'SIA_DS'",
      [t.ben],
    );
    const result = await moveShift(
      t.ctx(),
      t.shiftId,
      move({ date: "2026-11-12", siteId: t.arena }),
    );
    expect(result).toMatchObject({
      status: "blocked",
      workers: [{ workerId: t.ben, name: "Ben Booker" }],
    });
    const { rows } = await su.query<{ starts_at: Date }>(
      "select starts_at from shifts where id = $1",
      [t.shiftId],
    );
    expect(rows).toEqual([{ starts_at: new Date("2026-11-07T08:00:00Z") }]);
    expect(await eventsOf(t.f.firmId, "shift.moved")).toEqual([]);
    expect(await noticeJobs(t.f.firmId)).toEqual([]);
    // The refusal is on the record: who tried, the reason, and the rules' codes (no names).
    const refused = await eventsOf(t.f.firmId, "shift.move_refused");
    expect(refused.map((e) => [e.actor_type, e.entity_id, e.data])).toEqual([
      [
        "office",
        t.shiftId,
        {
          by: "firm",
          reason: "The event's times or place changed",
          workers: [{ workerId: t.ben, codes: ["credential_expired"] }],
        },
      ],
    ]);
    // A clash with another booking can't be overridden either.
    await su.query("update credentials set expires_on = '2029-01-01' where worker_id = $1", [
      t.ben,
    ]);
    await t.f.booking(
      t.ben,
      await t.f.shift({ startsAt: new Date("2026-11-07T19:00:00Z") }),
      "confirmed",
    );
    expect(
      await moveShift(t.ctx(), t.shiftId, move({ start: "14:00", end: "22:00", siteId: t.arena })),
    ).toMatchObject({
      status: "blocked",
    });
  });

  it("someone with only an overridable problem (a day off) stays booked, is listed, and the log says so", async () => {
    const t = await changeFirm();
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-08')",
      [t.f.firmId, t.ben],
    );
    const result = await moveShift(
      t.ctx(),
      t.shiftId,
      move({ date: "2026-11-08", siteId: t.arena }),
    );
    expect(result).toMatchObject({ status: "moved", told: 2 });
    expect(result.status === "moved" && result.warnings.map((w) => w.name)).toEqual(["Ben Booker"]);
    const events = await eventsOf(t.f.firmId, "shift.moved");
    expect(events.map((e) => [e.data.workerId, e.data.rulesOk, e.data.codes])).toEqual([
      [t.ann, true, undefined],
      [t.ben, false, ["unavailable"]],
    ]);
    expect(await assignment(t.benBooking)).toMatchObject({ status: "confirmed" });
  });

  it("another firm's shift can't be moved or have a booking cancelled", async () => {
    const t = await changeFirm();
    const other = await changeFirm();
    expect(await moveShift(t.ctx(), other.shiftId, move({ start: "10:00" }))).toEqual({
      status: "not_found",
    });
    expect(await cancelBookingByOffice(t.ctx(), other.shiftId, other.ann, "weather")).toEqual({
      status: "not_found",
    });
  });

  it("unchanged, bad input, started, cancelled, a sheet's, payroll", async () => {
    const t = await changeFirm();
    expect(await moveShift(t.ctx(), t.shiftId, move({ siteId: t.arena }))).toEqual({
      status: "unchanged",
    });
    expect(await moveShift(t.ctx(), t.shiftId, move({ date: "7/11/2026" }))).toEqual({
      status: "invalid",
      problem: "bad_date",
    });
    expect(await moveShift(t.ctx(), t.shiftId, move({ start: "8am" }))).toEqual({
      status: "invalid",
      problem: "bad_time",
    });
    expect(await moveShift(t.ctx(), t.shiftId, move({ date: "2026-11-01" }))).toEqual({
      status: "invalid",
      problem: "in_past",
    });
    const other = await changeFirm();
    expect(await moveShift(t.ctx(), t.shiftId, move({ siteId: other.arena }))).toEqual({
      status: "invalid",
      problem: "bad_site",
    });
    const started = await t.f.shift({ startsAt: hoursFromNow(-1) });
    expect(await moveShift(t.ctx(), started, move())).toEqual({ status: "not_open" });
    const sheet = await t.f.shift({ source: "sheets" });
    expect(await moveShift(t.ctx(), sheet, move())).toEqual({ status: "sheet" });
    const payroll = await t.f.office("payroll");
    expect(await moveShift(t.ctx(payroll), t.shiftId, move({ start: "10:00" }))).toEqual({
      status: "not_allowed",
    });
    expect(await eventsOf(t.f.firmId, "shift.moved")).toEqual([]);
  });
});

describe("telling the worker (the firm-change-notice job)", () => {
  async function notices(t: Awaited<ReturnType<typeof changeFirm>>) {
    const sent: OutboundMessage[] = [];
    const state = { fail: false, refuseWhatsApp: false };
    const deps = (when: Date): NoticeDeps => ({
      transport: {
        name: "capture",
        async send(m) {
          if (state.fail) throw new Error("timed out");
          if (state.refuseWhatsApp && m.channel === "whatsapp")
            throw new ChannelRefusedError("whatsapp");
          sent.push(m);
          return { providerMessageId: `id-${sent.length}` };
        },
      },
      push: {
        name: "none",
        async send() {
          return { status: "skipped" };
        },
      },
      baseDomain: "localhost:3000",
      clock: { now: () => when },
    });
    const run = (data: Record<string, unknown>, when = NOW) =>
      runFirmTask(
        createFirmChangeNoticeTask(() => deps(when)),
        { id: "job", data },
        withFirm,
      );
    const slug = (
      await su.query<{ slug: string }>("select slug from firms where id = $1", [t.f.firmId])
    ).rows[0]?.slug;
    return { sent, state, run, slug };
  }
  const bodies = (sent: OutboundMessage[]) => sent.map((m) => ("body" in m ? m.body : ""));

  it("a cancellation: the words, once only, logged", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    await cancelShift(t.ctx(), t.shiftId, "event_cancelled");
    const [annJob] = await noticeJobs(t.f.firmId);
    expect(await n.run(annJob ?? {})).toMatchObject({
      output: { status: "sent", channel: "whatsapp" },
    });
    expect(bodies(n.sent)).toEqual([
      `Your shift on Sat 7 Nov 08:00–16:00 at Riverside Arena has been cancelled by the office. Open shifts: http://${n.slug}.localhost:3000/shifts/open. — Booking Test ${n.slug} Shift Team`,
    ]);
    expect(await n.run(annJob ?? {})).toMatchObject({ output: { status: "already" } });
    expect(n.sent).toHaveLength(1);
    expect(
      (await eventsOf(t.f.firmId, "shift.change_notice%")).map((e) => [
        e.action,
        e.data.status ?? e.data.channel,
      ]),
    ).toEqual([
      ["shift.change_notice", "sending"],
      ["shift.change_notice_sent", "whatsapp"],
    ]);
  });

  it("a move: what changed and the new time; another day names the day", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    await moveShift(t.ctx(), t.shiftId, {
      date: "2026-11-08",
      start: "10:00",
      end: "18:00",
      siteId: t.stadium,
      reason: "event_changed",
    });
    const [job] = await noticeJobs(t.f.firmId);
    await n.run(job ?? {});
    expect(bodies(n.sent)[0]).toBe(
      `Change to your shift on Sat 7 Nov at Riverside Arena: new times, and it's now at Other Stadium. New time: Sun 8 Nov 10:00–18:00. Details: http://${n.slug}.localhost:3000/shifts/${t.shiftId}. — Booking Test ${n.slug} Shift Team`,
    );
  });

  it("a shortened shift says so", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    await moveShift(t.ctx(), t.shiftId, {
      date: "2026-11-07",
      start: "08:00",
      end: "12:00",
      siteId: t.arena,
      reason: "fewer_staff",
    });
    await n.run((await noticeJobs(t.f.firmId))[0] ?? {});
    expect(bodies(n.sent)[0]).toMatch(
      /^Change to your shift on Sat 7 Nov at Riverside Arena: it's now shorter\. New time: 08:00–12:00\./,
    );
  });

  it("quiet hours: a change days ahead waits for the morning; one inside the urgent window goes at night", async () => {
    const night = hoursFromNow(14); // Monday 23:00
    const t = await changeFirm();
    const n = await notices(t);
    await cancelShift(t.ctx(t.resourcer, night), t.shiftId, "weather"); // Saturday's shift: days ahead
    const [job] = await noticeJobs(t.f.firmId);
    expect(await n.run(job ?? {}, night)).toMatchObject({ output: { status: "held" } });
    expect(n.sent).toEqual([]);
    const held = (await noticeJobs(t.f.firmId)).filter((j) =>
      String(j.idempotencyKey).endsWith(":after-quiet"),
    );
    expect(held.map((j) => j.idempotencyKey)).toEqual([
      `${String(job?.idempotencyKey)}:after-quiet`,
    ]);

    const soon = await changeFirm();
    const s = await notices(soon);
    const tomorrow = await soon.f.shift({ startsAt: hoursFromNow(22) }); // Tuesday 07:00
    const ann = await soon.f.worker({ first: "Zoe" });
    await soon.f.booking(ann, tomorrow, "confirmed", 1);
    await cancelBookingByOffice(soon.ctx(soon.resourcer, night), tomorrow, ann, "weather");
    const [urgentJob] = await noticeJobs(soon.f.firmId);
    expect(await s.run(urgentJob ?? {}, night)).toMatchObject({ output: { status: "sent" } });
  });

  it("quiet hours: a booking cancelled while the shift is under way is told at once, even at night", async () => {
    const night = hoursFromNow(14); // Monday 23:00
    const t = await changeFirm();
    const n = await notices(t);
    const tonight = await t.f.shift({ startsAt: hoursFromNow(11) }); // Monday 20:00, under way
    const zoe = await t.f.worker({ first: "Zoe" });
    await t.f.booking(zoe, tonight, "confirmed", 1);
    expect(
      await cancelBookingByOffice(t.ctx(t.resourcer, night), tonight, zoe, "fewer_staff"),
    ).toMatchObject({ status: "cancelled" });
    const [job] = await noticeJobs(t.f.firmId);
    expect(await n.run(job ?? {}, night)).toMatchObject({ output: { status: "sent" } });
  });

  it("quiet hours use the earlier start: a shift moved to early tomorrow is told at night", async () => {
    const night = hoursFromNow(14); // Monday 23:00
    const t = await changeFirm();
    const n = await notices(t);
    await moveShift(t.ctx(t.resourcer, night), t.shiftId, {
      date: "2026-11-03",
      start: "06:00",
      end: "14:00",
      siteId: t.arena,
      reason: "event_changed",
    });
    const [job] = await noticeJobs(t.f.firmId);
    expect(await n.run(job ?? {}, night)).toMatchObject({ output: { status: "sent" } });
  });

  it("a held notice is logged (and whether it will arrive after the start), and queued again, never dropped", async () => {
    const night = hoursFromNow(14);
    const t = await changeFirm({
      quiet_hours: { start: "22:00", end: "07:00", urgent_override: false },
    });
    const n = await notices(t);
    await moveShift(t.ctx(t.resourcer, night), t.shiftId, {
      date: "2026-11-03",
      start: "06:00",
      end: "14:00",
      siteId: t.arena,
      reason: "event_changed",
    });
    const [job] = await noticeJobs(t.f.firmId);
    expect(await n.run(job ?? {}, night)).toMatchObject({ output: { status: "held" } });
    const held = await eventsOf(t.f.firmId, "shift.change_notice_held");
    expect(held[0]?.data).toMatchObject({ until: "2026-11-03T07:00:00.000Z", afterStart: true });
    // The follow-up job, still inside quiet hours (say the firm widened them): queued again.
    const again = (await noticeJobs(t.f.firmId)).find((j) =>
      String(j.idempotencyKey).endsWith(":after-quiet"),
    );
    expect(await n.run(again ?? {}, hoursFromNow(15))).toMatchObject({
      output: { status: "held" },
    });
    const queued = (await noticeJobs(t.f.firmId)).filter((j) =>
      String(j.idempotencyKey).endsWith(":after-quiet"),
    );
    expect(queued.length).toBeGreaterThanOrEqual(2);
    expect(n.sent).toEqual([]);
  });

  it("out of date: a later change supersedes an earlier notice; a move notice for someone no longer booked isn't sent", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    await moveShift(t.ctx(), t.shiftId, {
      date: "2026-11-07",
      start: "09:00",
      end: "17:00",
      siteId: t.arena,
      reason: "event_changed",
    });
    await moveShift(t.ctx(), t.shiftId, {
      date: "2026-11-07",
      start: "10:00",
      end: "18:00",
      siteId: t.arena,
      reason: "event_changed",
    });
    const jobs = await noticeJobs(t.f.firmId);
    const annJobs = jobs.filter((j) => j.assignmentId === t.annBooking);
    expect(await n.run(annJobs[0] ?? {})).toMatchObject({
      output: { status: "skipped", reason: "superseded" },
    });
    expect(await n.run(annJobs[1] ?? {})).toMatchObject({ output: { status: "sent" } });
    expect(bodies(n.sent)[0]).toMatch(/New time: 10:00–18:00\./);
    // Ben's booking stops being a booking another way before his notice goes (the office marking
    // it, say): his notice isn't sent. (His own cancellation would itself be a later change.)
    await su.query("update assignments set status = 'no_show' where id = $1", [t.benBooking]);
    const benLatest = jobs.filter((j) => j.assignmentId === t.benBooking).at(-1);
    expect(await n.run(benLatest ?? {})).toMatchObject({
      output: { status: "skipped", reason: "not_booked" },
    });
    expect(
      (await eventsOf(t.f.firmId, "shift.change_notice_skipped")).map((e) => e.data.reason),
    ).toEqual(["superseded", "not_booked"]);
  });

  it("a superseded notice loses nothing: the one message goes from what they last knew to what's true now", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    const toSunday = {
      date: "2026-11-08",
      start: "10:00",
      end: "18:00",
      siteId: t.stadium,
      reason: "event_changed" as const,
    };
    // Moved to another day and site, then only the times change, before Ann is told.
    await moveShift(t.ctx(), t.shiftId, toSunday);
    await moveShift(t.ctx(), t.shiftId, { ...toSunday, start: "12:00", end: "20:00" });
    const annJobs = (await noticeJobs(t.f.firmId)).filter((j) => j.assignmentId === t.annBooking);
    expect(await n.run(annJobs[0] ?? {})).toMatchObject({
      output: { status: "skipped", reason: "superseded" },
    });
    await n.run(annJobs[1] ?? {});
    expect(bodies(n.sent)).toEqual([
      `Change to your shift on Sat 7 Nov at Riverside Arena: new times, and it's now at Other Stadium. New time: Sun 8 Nov 12:00–20:00. Details: http://${n.slug}.localhost:3000/shifts/${t.shiftId}. — Booking Test ${n.slug} Shift Team`,
    ]);
    // Told: the next change starts from what that message said.
    await moveShift(t.ctx(), t.shiftId, { ...toSunday, start: "13:00", end: "21:00" });
    await n.run(
      (await noticeJobs(t.f.firmId)).filter((j) => j.assignmentId === t.annBooking)[2] ?? {},
    );
    expect(bodies(n.sent)[1]).toMatch(
      /^Change to your shift on Sun 8 Nov at Other Stadium: the times have changed\. New time: 13:00–21:00\./,
    );
  });

  it("moved, then cancelled before they were told: the cancellation names the shift they knew", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    await moveShift(t.ctx(), t.shiftId, {
      date: "2026-11-08",
      start: "10:00",
      end: "18:00",
      siteId: t.stadium,
      reason: "event_changed",
    });
    await cancelShift(t.ctx(), t.shiftId, "event_cancelled");
    const annJobs = (await noticeJobs(t.f.firmId)).filter((j) => j.assignmentId === t.annBooking);
    expect(annJobs).toHaveLength(2);
    expect(await n.run(annJobs[0] ?? {})).toMatchObject({
      output: { status: "skipped", reason: "superseded" },
    });
    await n.run(annJobs[1] ?? {});
    expect(bodies(n.sent)).toEqual([
      `Your shift on Sat 7 Nov 08:00–16:00 at Riverside Arena has been cancelled by the office. Open shifts: http://${n.slug}.localhost:3000/shifts/open. — Booking Test ${n.slug} Shift Team`,
    ]);
  });

  it("moved and moved back before they were told: nothing to tell, and that's logged", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    const base = { date: "2026-11-07", siteId: t.arena, reason: "event_changed" as const };
    await moveShift(t.ctx(), t.shiftId, { ...base, start: "09:00", end: "17:00" });
    await moveShift(t.ctx(), t.shiftId, { ...base, start: "08:00", end: "16:00" });
    const annJobs = (await noticeJobs(t.f.firmId)).filter((j) => j.assignmentId === t.annBooking);
    expect(await n.run(annJobs[0] ?? {})).toMatchObject({
      output: { status: "skipped", reason: "superseded" },
    });
    expect(await n.run(annJobs[1] ?? {})).toMatchObject({
      output: { status: "skipped", reason: "unchanged" },
    });
    expect(n.sent).toHaveLength(0);
  });

  it("two copies of a notice at the same moment send it once", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    await cancelShift(t.ctx(), t.shiftId, "weather");
    const [job] = await noticeJobs(t.f.firmId);
    const results = await Promise.all([n.run(job ?? {}), n.run(job ?? {})]);
    expect(results.map((r) => (r.output as { status: string }).status).sort()).toEqual([
      "already",
      "sent",
    ]);
    expect(n.sent).toHaveLength(1);
  });

  it("a notice naming another firm's change sends nothing", async () => {
    const t = await changeFirm();
    const other = await changeFirm();
    await cancelShift(other.ctx(), other.shiftId, "weather");
    const [theirs] = await noticeJobs(other.f.firmId);
    const n = await notices(t);
    expect(await n.run({ ...theirs, firmId: t.f.firmId })).toMatchObject({
      output: { status: "gone" },
    });
    expect(n.sent).toEqual([]);
  });

  it("a failed send is logged and never sent again; a refused WhatsApp goes by text", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    await cancelShift(t.ctx(), t.shiftId, "weather");
    const [a, b] = await noticeJobs(t.f.firmId);
    n.state.fail = true;
    expect(await n.run(a ?? {})).toMatchObject({ output: { status: "failed" } });
    n.state.fail = false;
    expect(await n.run(a ?? {})).toMatchObject({ output: { status: "already" } });
    n.state.refuseWhatsApp = true;
    expect(await n.run(b ?? {})).toMatchObject({ output: { status: "sent", channel: "sms" } });
    expect(n.sent.map((m) => m.channel)).toEqual(["sms"]);
    expect(await eventsOf(t.f.firmId, "shift.change_notice_failed")).toHaveLength(1);
  });

  it("a change that isn't this booking's sends nothing", async () => {
    const t = await changeFirm();
    const n = await notices(t);
    expect(
      await n.run({
        firmId: t.f.firmId,
        idempotencyKey: "firm-change:1",
        eventId: 1,
        assignmentId: t.annBooking,
      }),
    ).toMatchObject({ output: { status: "gone" } });
    expect(n.sent).toEqual([]);
  });

  it("the worker works the queue, and db:migrate creates it", async () => {
    expect(QUEUES.find((q) => q.name === FIRM_CHANGE_NOTICE_QUEUE)?.options).toMatchObject({
      policy: "standard",
    });
    const worked: string[] = [];
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string) => {
        worked.push(name);
        return "id";
      },
      schedule: async () => undefined,
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(boss);
    expect(worked).toContain(FIRM_CHANGE_NOTICE_QUEUE);
  });
});

describe("a move while one of the booked workers books another shift (audit L21)", () => {
  it("the move waits for that booking and sees it: refused for the overlap, never double-booked", async () => {
    const t = await changeFirm();
    // Ann takes Saturday's 14:00 to 22:00 at the stadium: her booking holds her row ...
    const other = await t.f.shift({ startsAt: new Date("2026-11-07T14:00:00Z") });
    const booking = await su.connect();
    let moving: ReturnType<typeof moveShift> | null = null;
    try {
      const { rows: me } = await booking.query<{ pid: number }>("select pg_backend_pid() as pid");
      await booking.query("begin");
      await booking.query("select id from workers where id = $1 for no key update", [t.ann]);
      await booking.query(
        `insert into assignments (firm_id, shift_id, slot, worker_id, status, confirmed_at)
         values ($1, $2, 1, $3, 'confirmed', now())`,
        [t.f.firmId, other, t.ann],
      );
      // ... while the office moves her 08:00 shift to 14:00: the move waits for Ann's row.
      moving = moveShift(t.ctx(), t.shiftId, {
        date: "2026-11-07",
        start: "14:00",
        end: "22:00",
        siteId: t.arena,
        reason: "event_changed",
      });
      // Something is waiting for the booking's own connection: the move, at Ann's row.
      for (let i = 0; ; i += 1) {
        const { rows } = await su.query(
          "select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
          [me[0]?.pid],
        );
        if (rows.length > 0) break;
        if (i > 100) throw new Error("the move never waited for Ann's row");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await booking.query("commit");
    } finally {
      await booking.query("rollback").catch(() => undefined);
      booking.release();
      await moving?.catch(() => undefined);
    }
    // The move saw the new booking: Ann would overlap, which the office can't override.
    expect(await moving).toMatchObject({
      status: "blocked",
      workers: [expect.objectContaining({ workerId: t.ann })],
    });
    const refused = await eventsOf(t.f.firmId, "shift.move_refused");
    expect(refused.at(-1)?.data).toMatchObject({
      workers: [{ workerId: t.ann, codes: expect.arrayContaining(["overlap"]) }],
    });
    const { rows } = await su.query<{ starts_at: Date }>(
      "select starts_at from shifts where id = $1",
      [t.shiftId],
    );
    expect(rows[0]?.starts_at).toEqual(new Date("2026-11-07T08:00:00Z"));
  });
});

describe("a move onto a day while someone books that day on an application in progress", () => {
  it("the move takes the day's 'applied' lock after the workers', as a booking does, and waits its turn", async () => {
    const t = await changeFirm();
    // A booking relying on the "applied" allowance for Saturday 7 November holds the day's lock ...
    const booking = await su.connect();
    let moving: ReturnType<typeof moveShift> | null = null;
    try {
      const { rows: me } = await booking.query<{ pid: number }>("select pg_backend_pid() as pid");
      await booking.query("begin");
      await booking.query(
        "select pg_advisory_xact_lock(hashtextextended('applied-day:' || $1::text || ':' || $2, 0))",
        [t.f.firmId, "2026-11-07"],
      );
      // ... while the office moves the shift to later that day: the move waits for it.
      moving = moveShift(t.ctx(), t.shiftId, {
        date: "2026-11-07",
        start: "09:00",
        end: "17:00",
        siteId: t.arena,
        reason: "event_changed",
      });
      for (let i = 0; ; i += 1) {
        const { rows } = await su.query(
          "select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
          [me[0]?.pid],
        );
        if (rows.length > 0) break;
        if (i > 100) throw new Error("the move never waited for the day's lock");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await booking.query("commit");
    } finally {
      await booking.query("rollback").catch(() => undefined);
      booking.release();
      await moving?.catch(() => undefined);
    }
    expect(await moving).toMatchObject({ status: "moved" });
  });
});

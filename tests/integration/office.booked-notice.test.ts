import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { ChannelRefusedError, type OutboundMessage } from "@/lib/messaging/transport";
import { createFirmChangeNoticeTask, FIRM_CHANGE_NOTICE_QUEUE } from "@/lib/notices/firm-change";
import {
  createShiftConfirmedTask,
  SHIFT_CONFIRMED_QUEUE,
  type ConfirmedDeps,
} from "@/lib/notices/shift-confirmed";
import { assignWorker, cancelBookingByOffice, moveShift } from "@/lib/office/quick-actions";
import { bookShift } from "@/lib/roster/book";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// A worker the office books onto a shift ("Assign") is told by message (Phase 10 task 19, audit
// L22): shift_confirmed, by a shift-confirmed job queued with the booking. On the real database,
// as the app role, with a capturing transport. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

async function placingFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const resourcer = await f.office("resourcer");
  const { rows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena') returning id::text as id",
    [f.firmId],
  );
  const arena = rows[0]?.id ?? "";
  // Saturday 7 November, 08:00 to 16:00 at the arena.
  const shiftId = await f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 2 });
  await su.query("update shifts set site_id = $2 where id = $1", [shiftId, arena]);
  const ann = await f.worker({ first: "Ann" });
  const ctx = (when = NOW) => ({
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: { now: () => when },
  });
  const slug = (
    await su.query<{ slug: string }>("select slug from firms where id = $1", [f.firmId])
  ).rows[0]?.slug;
  return { f, resourcer, arena, shiftId, ann, ctx, slug };
}

const jobsOf = async (firmId: string, queue = SHIFT_CONFIRMED_QUEUE) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
        order by (data ->> 'eventId')::bigint, data ->> 'idempotencyKey'`,
      [queue, firmId],
    )
  ).rows.map((r) => r.data);
const eventsOf = async (firmId: string, like: string) =>
  (
    await su.query<{ action: string; entity_id: string; data: Record<string, unknown> }>(
      `select action, entity_id::text, data from events
        where firm_id = $1 and action like $2 order by events.id`,
      [firmId, like],
    )
  ).rows;

function capture() {
  const sent: OutboundMessage[] = [];
  const pushes: { title: string; body: string; url: string }[] = [];
  const state = { fail: false, refuseWhatsApp: false };
  const deps = (when: Date): ConfirmedDeps => ({
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
      name: "capture",
      async send(_target, payload) {
        pushes.push(payload);
        return { status: "sent" };
      },
    },
    baseDomain: "localhost:3000",
    clock: { now: () => when },
  });
  const run = (data: Record<string, unknown>, when = NOW) =>
    runFirmTask(
      createShiftConfirmedTask(() => deps(when)),
      { id: "job", data },
      withFirm,
    );
  const bodies = () => sent.map((m) => ("body" in m ? m.body : ""));
  // The office's change notices, through the same transport.
  const runChange = (data: Record<string, unknown>, when = NOW) =>
    runFirmTask(
      createFirmChangeNoticeTask(() => deps(when)),
      { id: "job", data },
      withFirm,
    );
  return { sent, pushes, state, run, runChange, bodies };
}

describe("the office books a worker: they're told", () => {
  it("one message with the shift and a link to it, once only, logged; their phones get a push", async () => {
    const t = await placingFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example/ann', 'key', 'auth')`,
      [t.f.firmId, t.ann],
    );
    const booked = await assignWorker(t.ctx(), t.shiftId, t.ann, null);
    expect(booked).toMatchObject({ status: "booked" });
    const [job, ...others] = await jobsOf(t.f.firmId);
    expect(others).toEqual([]);
    // Ids only.
    expect(Object.keys(job ?? {}).sort()).toEqual([
      "assignmentId",
      "eventId",
      "firmId",
      "idempotencyKey",
    ]);
    const n = capture();
    expect(await n.run(job ?? {})).toMatchObject({
      output: { status: "sent", channel: "whatsapp" },
    });
    expect(n.bodies()).toEqual([
      `Confirmed: Sat 7 Nov 08:00–16:00 at Riverside Arena (door supervisor). Details and instructions: http://${t.slug}.localhost:3000/shifts/${t.shiftId}. — Booking Test ${t.slug} Shift Team`,
    ]);
    expect(n.sent[0]?.to).toBe(
      (await su.query("select mobile_e164 from workers where id = $1", [t.ann])).rows[0]
        ?.mobile_e164,
    );
    expect(n.pushes).toEqual([
      {
        title: "Shift booked",
        body: "Sat 7 Nov 08:00 at Riverside Arena. Tap for details.",
        url: `/shifts/${t.shiftId}`,
      },
    ]);
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "already" } });
    expect(n.sent).toHaveLength(1);
    const logged = await eventsOf(t.f.firmId, "shift.booked_notice%");
    expect(logged.map((e) => [e.action, e.data.status ?? e.data.channel])).toEqual([
      ["shift.booked_notice", "sending"],
      ["shift.booked_notice_sent", "whatsapp"],
    ]);
    const bookingId = booked.status === "booked" ? booked.assignmentId : "";
    expect(logged.every((e) => e.entity_id === bookingId && e.data.workerId === t.ann)).toBe(true);
  });

  it("a shift with no site leaves 'at {site}' out", async () => {
    const t = await placingFirm();
    const bare = await t.f.shift({ startsAt: new Date("2026-11-07T08:00:00Z") });
    await assignWorker(t.ctx(), bare, t.ann, null);
    const n = capture();
    await n.run((await jobsOf(t.f.firmId))[0] ?? {});
    expect(n.bodies()[0]).toMatch(
      /^Confirmed: Sat 7 Nov 08:00–16:00 \(door supervisor\)\. Details and instructions: /,
    );
  });

  it("a worker who takes a shift themselves isn't messaged (it's on their screen)", async () => {
    const t = await placingFirm();
    expect(
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, workerId: t.ann, by: { type: "worker", id: t.ann } },
        { clock: { now: () => NOW } },
      ),
    ).toMatchObject({ status: "booked" });
    expect(await jobsOf(t.f.firmId)).toEqual([]);
  });

  it("a booking the rules refuse queues nothing", async () => {
    const t = await placingFirm();
    const lapsed = await t.f.worker({ first: "Lee", credentials: [] });
    expect(await assignWorker(t.ctx(), t.shiftId, lapsed, null)).toMatchObject({
      status: "not_eligible",
    });
    expect(await jobsOf(t.f.firmId)).toEqual([]);
  });

  it("quiet hours: a shift days ahead waits for the morning, logged and queued again; one inside the urgent window goes at night", async () => {
    const night = hoursFromNow(14); // Monday 23:00
    const t = await placingFirm();
    await assignWorker(t.ctx(night), t.shiftId, t.ann, null);
    const [job] = await jobsOf(t.f.firmId);
    const n = capture();
    expect(await n.run(job ?? {}, night)).toMatchObject({ output: { status: "held" } });
    expect(n.sent).toEqual([]);
    expect((await jobsOf(t.f.firmId)).map((j) => j.idempotencyKey)).toEqual([
      job?.idempotencyKey,
      `${String(job?.idempotencyKey)}:after-quiet`,
    ]);
    expect(
      (await eventsOf(t.f.firmId, "shift.booked_notice_held")).map((e) => e.data.afterStart),
    ).toEqual([false]);
    // Queued again for when the quiet hours end: 07:00 Tuesday, London (GMT in November).
    const { rows: when } = await su.query<{ start_after: Date }>(
      "select start_after from pgboss.job where name = $1 and data ->> 'idempotencyKey' = $2",
      [SHIFT_CONFIRMED_QUEUE, `${String(job?.idempotencyKey)}:after-quiet`],
    );
    expect(when.map((w) => w.start_after.toISOString())).toEqual(["2026-11-03T07:00:00.000Z"]);
    // The held copy, run in the morning, sends it.
    const morning = hoursFromNow(22); // Tuesday 07:00
    const held = (await jobsOf(t.f.firmId))[1] ?? {};
    expect(await n.run(held, morning)).toMatchObject({ output: { status: "sent" } });

    const soon = await placingFirm();
    const early = await soon.f.shift({ startsAt: hoursFromNow(22) }); // Tuesday 07:00
    await assignWorker(soon.ctx(night), early, soon.ann, null);
    const s = capture();
    expect(await s.run((await jobsOf(soon.f.firmId))[0] ?? {}, night)).toMatchObject({
      output: { status: "sent" },
    });
  });

  it("not sent, and logged: cancelled before it went, the shift over, the worker deleted, already marked", async () => {
    const t = await placingFirm();
    await assignWorker(t.ctx(), t.shiftId, t.ann, null);
    const [job] = await jobsOf(t.f.firmId);
    await cancelBookingByOffice(t.ctx(), t.shiftId, t.ann, "weather");
    const n = capture();
    expect(await n.run(job ?? {})).toMatchObject({
      output: { status: "skipped", reason: "cancelled" },
    });

    const over = await placingFirm();
    await assignWorker(over.ctx(), over.shiftId, over.ann, null);
    expect(
      await n.run((await jobsOf(over.f.firmId))[0] ?? {}, new Date("2026-11-07T17:00:00Z")),
    ).toMatchObject({ output: { status: "skipped", reason: "ended" } });

    const gone = await placingFirm();
    await assignWorker(gone.ctx(), gone.shiftId, gone.ann, null);
    // Erased (the row as src/lib/gdpr/worker-erase.ts leaves it; the workers_erased check).
    await su.query(
      `update workers set erased_at = now(), mobile_e164 = null, email = null, external_ref = null,
              first_name = 'Deleted', last_name = 'worker', status = 'inactive', roles = '{}'
        where id = $1`,
      [gone.ann],
    );
    expect(await n.run((await jobsOf(gone.f.firmId))[0] ?? {})).toMatchObject({
      output: { status: "skipped", reason: "erased" },
    });
    // Held past the start, and marked as not attended before it went (the reviews: this was logged
    // as "cancelled first").
    const marked = await placingFirm();
    await assignWorker(marked.ctx(), marked.shiftId, marked.ann, null);
    await su.query(
      "update assignments set status = 'no_show' where shift_id = $1 and worker_id = $2",
      [marked.shiftId, marked.ann],
    );
    expect(
      await n.run((await jobsOf(marked.f.firmId))[0] ?? {}, new Date("2026-11-07T10:00:00Z")),
    ).toMatchObject({ output: { status: "skipped", reason: "not_booked" } });
    expect(n.sent).toEqual([]);
    const skipped = [t, over, gone, marked].map(async (x) =>
      (await eventsOf(x.f.firmId, "shift.booked_notice_skipped")).map((e) => e.data.reason),
    );
    expect(await Promise.all(skipped)).toEqual([
      ["cancelled"],
      ["ended"],
      ["erased"],
      ["not_booked"],
    ]);
  });

  it("two copies at the same moment send it once", async () => {
    const t = await placingFirm();
    await assignWorker(t.ctx(), t.shiftId, t.ann, null);
    const [job] = await jobsOf(t.f.firmId);
    const n = capture();
    const results = await Promise.all([n.run(job ?? {}), n.run(job ?? {})]);
    expect(results.map((r) => (r.output as { status: string }).status).sort()).toEqual([
      "already",
      "sent",
    ]);
    expect(n.sent).toHaveLength(1);
  });

  it("a failed send is logged and never sent again; a refused WhatsApp goes by text", async () => {
    const t = await placingFirm();
    const ben = await t.f.worker({ first: "Ben" });
    await assignWorker(t.ctx(), t.shiftId, t.ann, null);
    await assignWorker(t.ctx(), t.shiftId, ben, null);
    const [a, b] = await jobsOf(t.f.firmId);
    const n = capture();
    n.state.fail = true;
    expect(await n.run(a ?? {})).toMatchObject({ output: { status: "failed" } });
    n.state.fail = false;
    expect(await n.run(a ?? {})).toMatchObject({ output: { status: "already" } });
    n.state.refuseWhatsApp = true;
    expect(await n.run(b ?? {})).toMatchObject({ output: { status: "sent", channel: "sms" } });
    expect(n.sent.map((m) => m.channel)).toEqual(["sms"]);
    expect(await eventsOf(t.f.firmId, "shift.booked_notice_failed")).toHaveLength(1);
  });

  it("another firm's booking, or an event that isn't a booking, sends nothing", async () => {
    const t = await placingFirm();
    const other = await placingFirm();
    await assignWorker(other.ctx(), other.shiftId, other.ann, null);
    const [theirs] = await jobsOf(other.f.firmId);
    const n = capture();
    expect(await n.run({ ...theirs, firmId: t.f.firmId })).toMatchObject({
      output: { status: "gone" },
    });
    await assignWorker(t.ctx(), t.shiftId, t.ann, null);
    const [mine] = await jobsOf(t.f.firmId);
    const [created] = (
      await su.query<{ id: string }>(
        "select id::text from events where firm_id = $1 and action <> 'shift.assigned' order by id limit 1",
        [t.f.firmId],
      )
    ).rows;
    expect(
      await n.run({
        ...mine,
        eventId: Number(created?.id),
        idempotencyKey: `shift-confirmed:${created?.id}`,
      }),
    ).toMatchObject({ output: { status: "gone" } });
    expect(n.sent).toEqual([]);
  });

  // The reviews of Phase 10 task 19: the booking message and the office's change notices crossed.
  describe("with the office's changes", () => {
    const later = {
      date: "2026-11-07",
      start: "10:00",
      end: "18:00",
      reason: "event_changed" as const,
    };

    it("moved before the booking message went: the message has the new times, and the move's notice isn't sent", async () => {
      const t = await placingFirm();
      await assignWorker(t.ctx(), t.shiftId, t.ann, null);
      await moveShift(t.ctx(), t.shiftId, { ...later, siteId: t.arena });
      const n = capture();
      const [change] = await jobsOf(t.f.firmId, FIRM_CHANGE_NOTICE_QUEUE);
      expect(await n.runChange(change ?? {})).toMatchObject({
        output: { status: "skipped", reason: "not_told" },
      });
      await n.run((await jobsOf(t.f.firmId))[0] ?? {});
      expect(n.bodies()).toEqual([
        expect.stringMatching(/^Confirmed: Sat 7 Nov 10:00–18:00 at Riverside Arena /),
      ]);
    });

    it("moved before the message went, its notice run after: nothing more to tell", async () => {
      const t = await placingFirm();
      await assignWorker(t.ctx(), t.shiftId, t.ann, null);
      await moveShift(t.ctx(), t.shiftId, { ...later, siteId: t.arena });
      const n = capture();
      await n.run((await jobsOf(t.f.firmId))[0] ?? {});
      const [change] = await jobsOf(t.f.firmId, FIRM_CHANGE_NOTICE_QUEUE);
      expect(await n.runChange(change ?? {})).toMatchObject({
        output: { status: "skipped", reason: "unchanged" },
      });
      expect(n.sent).toHaveLength(1);
    });

    it("moved after the booking message went: the change notice starts from the times it gave", async () => {
      const t = await placingFirm();
      await assignWorker(t.ctx(), t.shiftId, t.ann, null);
      const n = capture();
      await n.run((await jobsOf(t.f.firmId))[0] ?? {});
      await moveShift(t.ctx(), t.shiftId, { ...later, siteId: t.arena });
      const [change] = await jobsOf(t.f.firmId, FIRM_CHANGE_NOTICE_QUEUE);
      expect(await n.runChange(change ?? {})).toMatchObject({ output: { status: "sent" } });
      expect(n.bodies()[1]).toMatch(
        /^Change to your shift on Sat 7 Nov at Riverside Arena: the times have changed\. New time: 10:00–18:00\./,
      );
    });

    it("cancelled before the booking message went (both held for the night): neither goes", async () => {
      const night = hoursFromNow(14); // Monday 23:00
      const t = await placingFirm();
      await assignWorker(t.ctx(night), t.shiftId, t.ann, null);
      const n = capture();
      expect(await n.run((await jobsOf(t.f.firmId))[0] ?? {}, night)).toMatchObject({
        output: { status: "held" },
      });
      await cancelBookingByOffice(t.ctx(night), t.shiftId, t.ann, "weather");
      // The morning.
      const morning = hoursFromNow(22);
      const [change] = await jobsOf(t.f.firmId, FIRM_CHANGE_NOTICE_QUEUE);
      expect(await n.runChange(change ?? {}, morning)).toMatchObject({
        output: { status: "skipped", reason: "not_told" },
      });
      const held = (await jobsOf(t.f.firmId)).find((j) =>
        String(j.idempotencyKey).endsWith(":after-quiet"),
      );
      expect(await n.run(held ?? {}, morning)).toMatchObject({
        output: { status: "skipped", reason: "cancelled" },
      });
      expect(n.sent).toEqual([]);
    });

    // The re-review: a sheet's booking is logged "by the firm" too, but queues no booking message,
    // so an office cancellation was never told.
    it("a rota sheet's booking (no booking message) is told of an office cancellation as before", async () => {
      const t = await placingFirm();
      await su.query(
        "update shifts set source = 'sheets', external_ref = 'row-told' where id = $1",
        [t.shiftId],
      );
      const booking = await t.f.booking(t.ann, t.shiftId, "confirmed", 1);
      // As the sheet sync logs a name typed into the sheet (src/lib/roster/sheets/sync.ts).
      await su.query(
        `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
         values ($1, 'system', 'shift.assigned', 'assignment', $2, $3)`,
        [
          t.f.firmId,
          booking,
          JSON.stringify({ by: "firm", shiftId: t.shiftId, workerId: t.ann, slot: 1 }),
        ],
      );
      expect(await cancelBookingByOffice(t.ctx(), t.shiftId, t.ann, "weather")).toMatchObject({
        status: "cancelled",
      });
      const n = capture();
      const [change] = await jobsOf(t.f.firmId, FIRM_CHANGE_NOTICE_QUEUE);
      expect(await n.runChange(change ?? {})).toMatchObject({ output: { status: "sent" } });
      expect(n.bodies()[0]).toMatch(
        /^Your shift on Sat 7 Nov 08:00–16:00 at Riverside Arena has been cancelled/,
      );
    });

    it("a worker who booked themselves is told of a change as before", async () => {
      const t = await placingFirm();
      await bookShift(
        withFirm,
        t.f.firmId,
        { shiftId: t.shiftId, workerId: t.ann, by: { type: "worker", id: t.ann } },
        { clock: { now: () => NOW } },
      );
      await moveShift(t.ctx(), t.shiftId, { ...later, siteId: t.arena });
      const n = capture();
      const [change] = await jobsOf(t.f.firmId, FIRM_CHANGE_NOTICE_QUEUE);
      expect(await n.runChange(change ?? {})).toMatchObject({ output: { status: "sent" } });
    });
  });

  it("the worker works the queue, and db:migrate creates it", async () => {
    expect(QUEUES.find((q) => q.name === SHIFT_CONFIRMED_QUEUE)?.options).toMatchObject({
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
    expect(worked).toContain(SHIFT_CONFIRMED_QUEUE);
  });
});

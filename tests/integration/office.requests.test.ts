import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeFirmId, createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { ChannelRefusedError, type OutboundMessage } from "@/lib/messaging/transport";
import {
  createRequestUpdateTask,
  REQUEST_UPDATE_QUEUE,
  type RequestUpdateDeps,
} from "@/lib/notices/request-update";
import { answerRequest } from "@/lib/office/quick-actions";
import { loadRequestQueue } from "@/lib/office/request-queue";
import { myRequests } from "@/lib/portal/requests";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office answering workers' requests (docs/screens.md `/office/enquiries` "Requests from the app", `/office/requests` until 12D.1; product spec P0-6)
// and the worker being told (docs/messaging-templates.md `request_update`). On the real database,
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

// Ann is booked on Saturday's shift and has asked to change its times; Ben asked to swap his.
async function requestFirm() {
  const f = await bookingFirm(su, withFirm);
  const resourcer = await f.office("resourcer");
  await su.query("update office_users set name = 'Sam Rota' where id = $1", [resourcer]);
  const shiftId = await f.shift({ startsAt: new Date("2026-11-07T08:00:00Z"), headcount: 2 });
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  await f.booking(ann, shiftId, "confirmed", 1);
  await f.booking(ben, shiftId, "confirmed", 2);
  const request = async (
    workerId: string,
    type: string,
    payload: Record<string, unknown>,
    o: { shiftId?: string | null; createdAt?: Date; status?: string } = {},
  ) =>
    (
      await su.query<{ id: string }>(
        `insert into requests (firm_id, worker_id, shift_id, type, payload, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id::text as id`,
        [
          f.firmId,
          workerId,
          o.shiftId === undefined ? shiftId : o.shiftId,
          type,
          JSON.stringify(payload),
          o.status ?? "open",
          o.createdAt ?? hoursFromNow(-2),
        ],
      )
    ).rows[0]?.id ?? "";
  const timeChange = await request(ann, "time_change", {
    start: "10:00",
    end: "18:00",
    note: "My train gets in at 09:40.",
  });
  const swap = await request(
    ben,
    "swap",
    { swapWith: "Cal Jones", note: "" },
    { createdAt: hoursFromNow(-5) },
  );
  const ctx = (officeUserId = resourcer, when = NOW) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: { now: () => when },
  });
  return { f, resourcer, shiftId, ann, ben, timeChange, swap, request, ctx };
}

const rowOf = async (id: string) =>
  (
    await su.query(
      `select status, resolved_by::text as resolved_by, resolved_at, resolution_note
         from requests where id = $1`,
      [id],
    )
  ).rows[0];
const eventsOf = async (firmId: string, like: string) =>
  (
    await su.query<{ action: string; entity_id: string; data: Record<string, unknown> }>(
      `select action, entity_id::text, data from events
        where firm_id = $1 and action like $2 order by id`,
      [firmId, like],
    )
  ).rows;
const jobsOf = async (firmId: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
        order by created_on, data ->> 'idempotencyKey'`,
      [REQUEST_UPDATE_QUEUE, firmId],
    )
  ).rows.map((r) => r.data);

describe("the office's requests page", () => {
  it("waiting ones oldest first, with what they asked; answered ones from the last 7 days", async () => {
    const t = await requestFirm();
    const escalated = await t.request(
      t.ann,
      "review",
      { codes: ["credential_expired"], reasons: ["Your SIA licence has expired."], note: "" },
      { createdAt: hoursFromNow(-1), status: "escalated" },
    );
    const general = await t.request(
      t.ben,
      "general",
      { note: "Can I bring a friend?" },
      {
        shiftId: null,
        createdAt: hoursFromNow(-0.5),
      },
    );
    const old = await t.request(
      t.ann,
      "general",
      {},
      { shiftId: null, createdAt: hoursFromNow(-300) },
    );
    await answerRequest(t.ctx(t.resourcer, hoursFromNow(-24 * 8)), old, "approved", "");

    // A question still linked to its shifts-line message is on Enquiries instead (12D.1): left out
    // here. The one above has no message (deleted at 90 days, say): it's answered here, never lost.
    const linked = await t.request(
      t.ben,
      "general",
      { note: "Where do I park?" },
      { shiftId: null },
    );
    const { rows: msg } = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, handled_at, handled_as, intent)
       values ($1, 'in', 'whatsapp', $2, '+447700900113', '+447700900000', 'Where do I park?', now(),
               'office', 'office')
       returning id::text as id`,
      [t.f.firmId, `SM${Math.random().toString(16).slice(2)}`],
    );
    await su.query("update requests set message_id = $2 where id = $1", [linked, msg[0]?.id]);

    const queue = await withFirm(t.f.firmId, (tx) => loadRequestQueue(tx, NOW));
    expect(queue.waiting.map((r) => r.requestId)).toEqual([
      t.swap,
      t.timeChange,
      escalated,
      general,
    ]);
    const [swap, timeChange, review, question] = queue.waiting;
    expect(timeChange).toMatchObject({
      type: "time_change",
      status: "open",
      ref: t.timeChange.slice(0, 8).toUpperCase(),
      worker: { id: t.ann, name: "Ann Booker", firstName: "Ann" },
      shift: { shiftId: t.shiftId, startsAt: new Date("2026-11-07T08:00:00Z") },
      asked: { start: "10:00", end: "18:00", note: "My train gets in at 09:40." },
      answer: null,
    });
    expect(swap?.asked).toMatchObject({ swapWith: "Cal Jones", note: null });
    expect(review).toMatchObject({
      status: "escalated",
      asked: { reasons: ["Your SIA licence has expired."] },
    });
    expect(question).toMatchObject({ shift: null, asked: { note: "Can I bring a friend?" } });
    // Answered 8 days ago: not shown.
    expect(queue.answered).toEqual([]);

    await answerRequest(t.ctx(), t.swap, "declined", "Cal isn't free that day.");
    const after = await withFirm(t.f.firmId, (tx) => loadRequestQueue(tx, NOW));
    expect(after.waiting.map((r) => r.requestId)).toEqual([t.timeChange, escalated, general]);
    // The linked question can't be answered here: Enquiries answers it, with its message locked.
    expect(await answerRequest(t.ctx(), linked, "approved", "Car park B.")).toEqual({
      status: "on_enquiries",
    });
    const { rows: still } = await su.query("select status from requests where id = $1", [linked]);
    expect(still).toEqual([{ status: "open" }]);
    expect(after.answered).toMatchObject([
      {
        requestId: t.swap,
        status: "declined",
        answer: { by: "Sam Rota", at: NOW, note: "Cal isn't free that day.", told: null },
      },
    ]);

    // Another firm's requests never show here.
    const other = await requestFirm();
    expect(
      (await withFirm(other.f.firmId, (tx) => loadRequestQueue(tx, NOW))).waiting.map(
        (r) => r.requestId,
      ),
    ).toEqual([other.swap, other.timeChange]);
  });
});

describe("answering a request", () => {
  it("approved with a note: the row, the log (no note text) and a job to tell them", async () => {
    const t = await requestFirm();
    expect(await answerRequest(t.ctx(), t.timeChange, "approved", "  See you at 10:00.  ")).toEqual(
      {
        status: "resolved",
        decision: "approved",
      },
    );
    expect(await rowOf(t.timeChange)).toEqual({
      status: "approved",
      resolved_by: t.resourcer,
      resolved_at: NOW,
      resolution_note: "See you at 10:00.",
    });
    expect(await eventsOf(t.f.firmId, "request.%")).toEqual([
      {
        action: "request.approved",
        entity_id: t.timeChange,
        data: { type: "time_change", shiftId: t.shiftId, withNote: true },
      },
    ]);
    expect(await jobsOf(t.f.firmId)).toEqual([
      {
        firmId: t.f.firmId,
        idempotencyKey: `request-update:${t.timeChange}`,
        requestId: t.timeChange,
      },
    ]);
    // The shift itself isn't changed by approving.
    const { rows } = await su.query("select starts_at from shifts where id = $1", [t.shiftId]);
    expect(rows).toEqual([{ starts_at: new Date("2026-11-07T08:00:00Z") }]);
  });

  it("approving needs no note; declining does; a note has a limit", async () => {
    const t = await requestFirm();
    expect(await answerRequest(t.ctx(), t.swap, "declined", "   ")).toEqual({
      status: "note_needed",
    });
    expect(await answerRequest(t.ctx(), t.swap, "declined", "x".repeat(501))).toEqual({
      status: "note_too_long",
    });
    expect(await rowOf(t.swap)).toMatchObject({ status: "open", resolution_note: null });
    expect(await answerRequest(t.ctx(), t.swap, "approved", "")).toMatchObject({
      status: "resolved",
    });
    expect(await rowOf(t.swap)).toMatchObject({ status: "approved", resolution_note: null });
    expect((await eventsOf(t.f.firmId, "request.approved"))[0]?.data.withNote).toBe(false);
  });

  it("only once: already answered, sorted, or two office users at the same moment", async () => {
    const t = await requestFirm();
    await answerRequest(t.ctx(), t.swap, "approved", "");
    expect(await answerRequest(t.ctx(), t.swap, "declined", "No.")).toEqual({
      status: "already",
      current: "approved",
    });
    const sorted = await t.request(t.ann, "general", {}, { shiftId: null });
    await su.query(
      "update requests set status = 'auto_resolved', resolved_at = now() where id = $1",
      [sorted],
    );
    expect(await answerRequest(t.ctx(), sorted, "approved", "")).toEqual({
      status: "already",
      current: "auto_resolved",
    });

    const admin = await t.f.office("admin");
    const both = await Promise.all([
      answerRequest(t.ctx(), t.timeChange, "approved", "Yes."),
      answerRequest(t.ctx(admin), t.timeChange, "declined", "No."),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual(["already", "resolved"]);
    expect(await eventsOf(t.f.firmId, `request.%`)).toHaveLength(2); // the swap and this one
    expect((await jobsOf(t.f.firmId)).filter((j) => j.requestId === t.timeChange)).toHaveLength(1);
  });

  it("admins and resourcers only; another firm's request can't be found", async () => {
    const t = await requestFirm();
    const payroll = await t.f.office("payroll");
    const gone = await t.f.office("resourcer", "disabled");
    expect(await answerRequest(t.ctx(payroll), t.swap, "approved", "")).toEqual({
      status: "not_allowed",
    });
    expect(await answerRequest(t.ctx(gone), t.swap, "approved", "")).toEqual({
      status: "not_allowed",
    });
    const other = await requestFirm();
    expect(await answerRequest(t.ctx(), other.swap, "approved", "")).toEqual({
      status: "not_found",
    });
    expect(await rowOf(other.swap)).toMatchObject({ status: "open" });
    expect(await eventsOf(other.f.firmId, "request.%")).toEqual([]);
  });

  it("the worker sees the answer and the office's note in My requests", async () => {
    const t = await requestFirm();
    await answerRequest(t.ctx(), t.swap, "declined", "Cal isn't free.\nTry Dee?");
    const mine = await myRequests(
      {
        firm: { id: t.f.firmId, timezone: "Europe/London", signOff: "Shift Team" },
        run: withFirm,
        clock: { now: () => NOW },
      },
      t.ben,
    );
    expect(mine.map((r) => [r.type, r.status, r.note])).toEqual([
      ["swap", "declined", "Cal isn't free.\nTry Dee?"],
    ]);
  });
});

describe("telling the worker (the request-update job)", () => {
  async function notices(t: Awaited<ReturnType<typeof requestFirm>>) {
    const sent: OutboundMessage[] = [];
    // A transaction open as each push went (14.1: never).
    const pushedInTransaction: boolean[] = [];
    const state = { fail: false, refuseWhatsApp: false };
    const deps = (when: Date): RequestUpdateDeps => ({
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
        async send() {
          pushedInTransaction.push(activeFirmId() !== undefined);
          return { status: "sent" };
        },
      },
      clock: { now: () => when },
    });
    const run = (data: Record<string, unknown>, when = NOW) =>
      runFirmTask(
        createRequestUpdateTask(() => deps(when)),
        { id: "job", data },
        withFirm,
      );
    const slug = (
      await su.query<{ slug: string }>("select slug from firms where id = $1", [t.f.firmId])
    ).rows[0]?.slug;
    return { sent, pushedInTransaction, state, run, slug };
  }
  const bodies = (sent: OutboundMessage[]) => sent.map((m) => ("body" in m ? m.body : ""));
  const ref = (id: string) => id.slice(0, 8).toUpperCase();

  it("the words, with the note on one line; once only; logged", async () => {
    const t = await requestFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/ben', 'k', 'a')`,
      [t.f.firmId, t.ben],
    );
    const n = await notices(t);
    await answerRequest(t.ctx(), t.swap, "declined", "Cal isn't free.\n\nTry   Dee?");
    const [job] = await jobsOf(t.f.firmId);
    expect(await n.run(job ?? {})).toMatchObject({
      output: { status: "sent", channel: "whatsapp" },
    });
    expect(bodies(n.sent)).toEqual([
      `Your request (swap, ref ${ref(t.swap)}) is declined. The office says: Cal isn't free. Try Dee? — Booking Test ${n.slug} Shift Team`,
    ]);
    expect(n.sent[0]?.to).toMatch(/^\+447700900\d{3}$/);
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "already" } });
    expect(n.sent).toHaveLength(1);
    const logged = await eventsOf(t.f.firmId, "request.update%");
    expect(logged.map((e) => [e.action, e.data.status ?? e.data.channel])).toEqual([
      ["request.update_notice", "sending"],
      ["request.update_sent", "whatsapp"],
    ]);
    // Ben's phone got a push, with no transaction open (14.1).
    expect(logged[1]?.data.pushes).toBe(1);
    expect(n.pushedInTransaction).toEqual([false]);
    // The office's page says they were told.
    const answered = (await withFirm(t.f.firmId, (tx) => loadRequestQueue(tx, NOW))).answered;
    expect(answered.map((r) => r.answer?.told)).toEqual(["sent"]);
    // The note is on the row and in the message, never in the log.
    expect(JSON.stringify(await eventsOf(t.f.firmId, "%"))).not.toContain("Cal isn't free");
  });

  it("no note: the no-note wording", async () => {
    const t = await requestFirm();
    const n = await notices(t);
    await answerRequest(t.ctx(), t.timeChange, "approved", "");
    await n.run((await jobsOf(t.f.firmId))[0] ?? {});
    expect(bodies(n.sent)).toEqual([
      `Your request (time change, ref ${ref(t.timeChange)}) is approved. — Booking Test ${n.slug} Shift Team`,
    ]);
  });

  it('a question the office approved is told as answered ("approved" can read as "booked")', async () => {
    const t = await requestFirm();
    const n = await notices(t);
    const question = await t.request(
      t.ann,
      "general",
      { note: "Is parking free?" },
      { shiftId: null },
    );
    await answerRequest(t.ctx(), question, "approved", "Yes, in car park B.");
    const job = (await jobsOf(t.f.firmId)).find((j) => j.requestId === question);
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "sent" } });
    expect(bodies(n.sent)).toEqual([
      `Your request (question, ref ${ref(question)}) is answered. The office says: Yes, in car park B. — Booking Test ${n.slug} Shift Team`,
    ]);
  });

  it("quiet hours: a reply about next week (or a shift that has ended) waits for the morning; one about a shift soon or under way goes at night", async () => {
    const night = hoursFromNow(14); // Monday 23:00
    const t = await requestFirm();
    const n = await notices(t);
    await answerRequest(t.ctx(t.resourcer, night), t.swap, "approved", "");
    const [job] = await jobsOf(t.f.firmId);
    expect(await n.run(job ?? {}, night)).toMatchObject({ output: { status: "held" } });
    expect(n.sent).toEqual([]);
    expect((await jobsOf(t.f.firmId)).map((j) => j.idempotencyKey)).toEqual([
      `request-update:${t.swap}`,
      `request-update:${t.swap}:after-quiet`,
    ]);
    const [held] = await eventsOf(t.f.firmId, "request.update_held");
    expect(held?.data).toMatchObject({ workerId: t.ben });
    expect(
      (await withFirm(t.f.firmId, (tx) => loadRequestQueue(tx, night))).answered.map(
        (r) => r.answer?.told,
      ),
    ).toEqual(["held"]);
    // A question with no shift waits too.
    const question = await t.request(t.ann, "general", {}, { shiftId: null });
    await answerRequest(t.ctx(t.resourcer, night), question, "approved", "");
    const qJob = (await jobsOf(t.f.firmId)).find((j) => j.requestId === question);
    expect(await n.run(qJob ?? {}, night)).toMatchObject({ output: { status: "held" } });

    // A shift that ended this morning isn't urgent any more: it waits too.
    const ended = await t.f.shift({ startsAt: hoursFromNow(-10) }); // Sunday 23:00 to Monday 07:00
    await t.f.booking(t.ben, ended, "confirmed");
    const late = await t.request(
      t.ben,
      "time_change",
      { start: "00:00", end: "06:00", note: "" },
      {
        shiftId: ended,
      },
    );
    await answerRequest(t.ctx(t.resourcer, night), late, "declined", "Too late now.");
    const lateJob = (await jobsOf(t.f.firmId)).find((j) => j.requestId === late);
    expect(await n.run(lateJob ?? {}, night)).toMatchObject({ output: { status: "held" } });
    expect(n.sent).toEqual([]);

    // One under way right now (20:00 to 04:00) is: told at night.
    const tonight = await t.f.shift({ startsAt: hoursFromNow(11) });
    await t.f.booking(t.ben, tonight, "confirmed");
    const now = await t.request(t.ben, "swap", { swapWith: "", note: "" }, { shiftId: tonight });
    await answerRequest(t.ctx(t.resourcer, night), now, "approved", "");
    const nowJob = (await jobsOf(t.f.firmId)).find((j) => j.requestId === now);
    expect(await n.run(nowJob ?? {}, night)).toMatchObject({ output: { status: "sent" } });

    // Tomorrow 07:00's shift is inside the urgent window: told at night.
    const tomorrow = await t.f.shift({ startsAt: hoursFromNow(22) });
    await t.f.booking(t.ann, tomorrow, "confirmed");
    const soon = await t.request(
      t.ann,
      "time_change",
      { start: "08:00", end: "15:00", note: "" },
      {
        shiftId: tomorrow,
      },
    );
    await answerRequest(t.ctx(t.resourcer, night), soon, "approved", "OK.");
    const soonJob = (await jobsOf(t.f.firmId)).find((j) => j.requestId === soon);
    expect(await n.run(soonJob ?? {}, night)).toMatchObject({ output: { status: "sent" } });
  });

  it("a failed send is logged and never sent again; a refused WhatsApp goes by text", async () => {
    const t = await requestFirm();
    const n = await notices(t);
    await answerRequest(t.ctx(), t.swap, "approved", "");
    await answerRequest(t.ctx(), t.timeChange, "approved", "");
    const jobs = await jobsOf(t.f.firmId);
    const swapJob = jobs.find((j) => j.requestId === t.swap);
    n.state.fail = true;
    expect(await n.run(swapJob ?? {})).toMatchObject({ output: { status: "failed" } });
    n.state.fail = false;
    expect(await n.run(swapJob ?? {})).toMatchObject({ output: { status: "already" } });
    expect(n.sent).toEqual([]);
    const [failed] = await eventsOf(t.f.firmId, "request.update_failed");
    expect(failed?.data).toMatchObject({ workerId: t.ben, channel: "whatsapp" });

    n.state.refuseWhatsApp = true;
    const tcJob = jobs.find((j) => j.requestId === t.timeChange);
    expect(await n.run(tcJob ?? {})).toMatchObject({ output: { status: "sent", channel: "sms" } });
    const sentEvent = (await eventsOf(t.f.firmId, "request.update_sent"))[0];
    expect(sentEvent?.data).toMatchObject({ channel: "sms", fellBackFrom: "whatsapp" });
  });

  it("nothing for a request that isn't answered, or another firm's", async () => {
    const t = await requestFirm();
    const n = await notices(t);
    const job = {
      firmId: t.f.firmId,
      idempotencyKey: `request-update:${t.swap}`,
      requestId: t.swap,
    };
    expect(await n.run(job)).toMatchObject({ output: { status: "gone" } });
    const other = await requestFirm();
    await answerRequest(other.ctx(), other.swap, "approved", "");
    expect(
      await n.run({
        ...job,
        idempotencyKey: `request-update:${other.swap}`,
        requestId: other.swap,
      }),
    ).toMatchObject({ output: { status: "gone" } });
    expect(n.sent).toEqual([]);
  });

  it("the worker works the queue, and db:migrate creates it", async () => {
    expect(QUEUES.find((q) => q.name === REQUEST_UPDATE_QUEUE)?.options).toMatchObject({
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
    expect(worked).toContain(REQUEST_UPDATE_QUEUE);
  });
});

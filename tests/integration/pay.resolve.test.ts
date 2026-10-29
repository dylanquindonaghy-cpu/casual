import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActiveSession } from "@/lib/auth/sessions";
import { activeFirmId, createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import { ChannelRefusedError, type OutboundMessage } from "@/lib/messaging/transport";
import {
  createPayQueryUpdateTask,
  PAY_QUERY_UPDATE_QUEUE,
  type PayQueryUpdateDeps,
} from "@/lib/notices/pay-query-update";
import { loadActionLog, parseLogQuery } from "@/lib/office/action-log";
import { sortPayQueries } from "@/lib/office/pay-sort";
import { myPayQueries, raisePayQuery } from "@/lib/portal/pay-queries";
import type { PayQueryInput } from "@/lib/portal/pay-query-kinds";
import type { PushPayload } from "@/lib/push/transport";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Payroll sorting pay queries and the worker hearing about it (src/lib/pay/resolve.ts,
// src/lib/notices/pay-query-update.ts, src/lib/portal/pay-queries.ts) on the real database, as the
// app role. The worker's message is payroll's typed note in the doc's template, word for word: no
// AI answers a pay dispute (the import boundary is tests/unit/ai.boundary.test.ts). NOW is Monday
// 2 November 2026, 09:00 London (GMT).

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

const stepped = (workerId: string) => ({
  worker: { id: workerId },
  session: {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "worker",
    subjectId: workerId,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    rotatedAt: NOW,
    steppedUpUntil: new Date(NOW.getTime() + 600_000),
    rotationDue: false,
  } as ActiveSession,
});

const NOTE = "The new rate is now applied.\n\nThe difference is paid on   Fri 13 Nov.";
const NOTE_ONE_LINE = "The new rate is now applied. The difference is paid on Fri 13 Nov.";

async function sortFirm() {
  const f = await bookingFirm(su, withFirm);
  const [ann, ben, cal] = [
    await f.worker({ first: "Ann" }),
    await f.worker({ first: "Ben" }),
    await f.worker({ first: "Cal" }),
  ];
  const thursday = await f.shift({ startsAt: new Date("2026-10-29T08:00:00Z"), headcount: 3 });
  await f.booking(ann, thursday, "completed", 1);
  await f.booking(ben, thursday, "completed", 2);
  await f.booking(cal, thursday, "completed", 3);
  const portal = {
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Shift Team" },
    run: withFirm,
    clock: { now: () => NOW },
  };
  const raise = async (workerId: string, input: Partial<PayQueryInput> = {}) => {
    const r = await raisePayQuery(portal, stepped(workerId), {
      shiftId: thursday,
      day: null,
      issue: "wrong_rate",
      details: "Paid £12.50, should be £13",
      ...input,
    });
    if (r.status !== "created") throw new Error(`not raised: ${r.status}`);
    const { rows } = await su.query<{ id: string }>(
      "select id::text as id from pay_queries where firm_id = $1 and worker_id = $2 order by created_at desc limit 1",
      [f.firmId, workerId],
    );
    return rows[0]?.id ?? "";
  };
  const [qa, qb, qc] = [await raise(ann), await raise(ben), await raise(cal)];
  const payroll = await f.office("payroll");
  const sort = (ids: string[], note = NOTE, by = payroll, when = NOW) =>
    sortPayQueries(
      { firm: { id: f.firmId }, officeUserId: by, run: withFirm, clock: { now: () => when } },
      ids,
      note,
    );
  const rows = async () =>
    (
      await su.query<{
        id: string;
        status: string;
        resolved_by: string | null;
        resolved_at: Date | null;
        resolution_note: string | null;
      }>(
        `select id::text as id, status, resolved_by::text as resolved_by, resolved_at, resolution_note
           from pay_queries where firm_id = $1 order by created_at, id`,
        [f.firmId],
      )
    ).rows;
  const eventsOf = async (like: string) =>
    (
      await su.query<{
        action: string;
        actor_type: string;
        actor_id: string | null;
        entity_id: string | null;
        data: Record<string, unknown>;
      }>(
        `select action, actor_type, actor_id::text as actor_id, entity_id::text as entity_id, data
           from events where firm_id = $1 and action like $2 order by id`,
        [f.firmId, like],
      )
    ).rows;
  const jobs = async () =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2 order by created_on",
        [PAY_QUERY_UPDATE_QUEUE, f.firmId],
      )
    ).rows.map((r) => r.data);
  const { name: firmName, slug } = (
    await su.query<{ name: string; slug: string }>("select name, slug from firms where id = $1", [
      f.firmId,
    ])
  ).rows[0] ?? { name: "", slug: "" };
  return {
    f,
    ann,
    ben,
    cal,
    qa,
    qb,
    qc,
    payroll,
    portal,
    sort,
    rows,
    eventsOf,
    jobs,
    firmName,
    slug,
  };
}

describe("payroll sorting a group", () => {
  it("marks the queries payroll saw sorted, with the note, who and when; logs each without the note; queues a message each", async () => {
    const t = await sortFirm();
    expect(await t.sort([t.qa, t.qb])).toEqual({ status: "sorted", count: 2, skipped: 0 });
    const [a, b, c] = await t.rows();
    for (const row of [a, b]) {
      expect(row).toMatchObject({
        status: "resolved",
        resolved_by: t.payroll,
        resolved_at: NOW,
        resolution_note: NOTE.trim(),
      });
    }
    // Cal's query wasn't in what payroll sorted.
    expect(c).toMatchObject({ status: "open", resolved_at: null, resolution_note: null });
    const logged = await t.eventsOf("pay_query.resolved");
    const workerOf = { [t.qa]: t.ann, [t.qb]: t.ben };
    expect(logged.map((e) => [e.actor_type, e.actor_id, e.entity_id, e.data])).toEqual(
      [t.qa, t.qb]
        .sort()
        .map((id) => [
          "office",
          t.payroll,
          id,
          { workerId: workerOf[id], previous: "open", withNote: true },
        ]),
    );
    // The note is on the row and goes to the worker, never in the log.
    expect(JSON.stringify(await t.eventsOf("%"))).not.toContain("new rate is now applied");
    expect((await t.jobs()).map((j) => j.payQueryId).sort()).toEqual([t.qa, t.qb].sort());
    expect((await t.jobs())[0]).toMatchObject({
      firmId: t.f.firmId,
      idempotencyKey: expect.stringMatching(/^pay-query-update:[0-9a-f-]{36}$/),
    });
  });

  it("payroll and admins only; a note is needed, and a short one", async () => {
    const t = await sortFirm();
    const resourcer = await t.f.office("resourcer");
    const gone = await t.f.office("payroll", "disabled");
    for (const by of [resourcer, gone, "00000000-0000-4000-8000-000000000009"]) {
      expect(await t.sort([t.qa], NOTE, by)).toEqual({ status: "not_allowed" });
    }
    expect(await t.sort([t.qa], "")).toEqual({ status: "note_needed" });
    expect(await t.sort([t.qa], "  \n ")).toEqual({ status: "note_needed" });
    expect(await t.sort([t.qa], "x".repeat(501))).toEqual({ status: "note_too_long" });
    expect((await t.rows()).map((r) => r.status)).toEqual(["open", "open", "open"]);
    expect(await t.jobs()).toEqual([]);
    const admin = await t.f.office("admin");
    expect(await t.sort([t.qa], `  ${"x".repeat(500)}  `, admin)).toEqual({
      status: "sorted",
      count: 1,
      skipped: 0,
    });
    // Another firm's payroll user can't sort here.
    const elsewhere = await sortFirm();
    expect(await t.sort([t.qb], NOTE, elsewhere.payroll)).toEqual({ status: "not_allowed" });
  });

  it("only those still waiting (open or in a digest); two payroll users at once sort each once", async () => {
    const t = await sortFirm();
    await su.query("update pay_queries set status = 'in_digest' where id = $1", [t.qb]);
    const other = await t.f.office("payroll");
    const both = await Promise.all([
      t.sort([t.qa, t.qb]),
      t.sort([t.qb, t.qa], "Another note.", other),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual(["already", "sorted"]);
    expect(both.find((r) => r.status === "sorted")).toEqual({
      status: "sorted",
      count: 2,
      skipped: 0,
    });
    expect((await t.eventsOf("pay_query.resolved")).map((e) => e.data.previous).sort()).toEqual([
      "in_digest",
      "open",
    ]);
    expect(await t.jobs()).toHaveLength(2);
    // Sorting again: already. Some already sorted: counted.
    expect(await t.sort([t.qa])).toEqual({ status: "already" });
    expect(await t.sort([t.qa, t.qc])).toEqual({ status: "sorted", count: 1, skipped: 1 });
  });

  it("the action log finds the sort under the worker's name", async () => {
    const t = await sortFirm();
    await t.sort([t.qa, t.qb]);
    // Event times are the database's real time: the log is read for the last 7 days to now.
    const log = await withFirm(t.f.firmId, (tx) =>
      loadActionLog(tx, parseLogQuery({ worker: t.ann }), new Date()),
    );
    const words = log.entries.map((e) => e.words);
    expect(words).toContain("Office Person sorted Ann Booker's pay query and wrote them a note.");
    expect(words.some((w) => w.includes("Ben Booker"))).toBe(false);
  });

  it("another firm's query can't be sorted from here", async () => {
    const t = await sortFirm();
    const other = await sortFirm();
    expect(await t.sort([other.qa])).toEqual({ status: "already" });
    expect((await other.rows())[0]?.status).toBe("open");
  });

  it("the worker sees it on their pay page: sorted on the day, with payroll's note", async () => {
    const t = await sortFirm();
    await t.sort([t.qa]);
    const mine = await myPayQueries(t.portal, stepped(t.ann));
    expect(mine.map((q) => [q.status, q.sortedOn, q.note])).toEqual([
      ["resolved", "2026-11-02", NOTE.trim()],
    ]);
    // Still with payroll: no date or note.
    expect(
      (await myPayQueries(t.portal, stepped(t.ben))).map((q) => [q.status, q.sortedOn, q.note]),
    ).toEqual([["open", null, null]]);
  });
});

describe("telling the worker (the pay-query-update job)", () => {
  async function notices() {
    const sent: OutboundMessage[] = [];
    const pushed: PushPayload[] = [];
    const pushedInTransaction: boolean[] = []; // a transaction open as each push went (14.1: never)
    const state = { fail: false, refuseWhatsApp: false };
    const deps = (when: Date): PayQueryUpdateDeps => ({
      transport: {
        name: "capture",
        async send(m) {
          if (state.fail) throw new Error("timed out");
          if (state.refuseWhatsApp && m.channel === "whatsapp") {
            throw new ChannelRefusedError("whatsapp");
          }
          sent.push(m);
          return { providerMessageId: `id-${sent.length}` };
        },
      },
      push: {
        name: "capture",
        async send(_target, payload) {
          pushedInTransaction.push(activeFirmId() !== undefined);
          pushed.push(payload);
          return { status: "sent" };
        },
      },
      clock: { now: () => when },
      baseDomain: "localhost:3000",
    });
    const run = (data: Record<string, unknown>, when = NOW) =>
      runFirmTask(
        createPayQueryUpdateTask(() => deps(when)),
        { id: "job", data },
        withFirm,
      );
    return { sent, pushed, pushedInTransaction, state, run };
  }
  const bodies = (sent: OutboundMessage[]) => sent.map((m) => ("body" in m ? m.body : ""));
  const ref = (id: string) => id.slice(0, 8).toUpperCase();

  it("the doc's words: payroll has answered, with the pay page's link, never the note (13.4); once only; logged", async () => {
    const t = await sortFirm();
    const n = await notices();
    await t.sort([t.qa]);
    const [job] = await t.jobs();
    expect(await n.run(job ?? {})).toMatchObject({
      output: { status: "sent", channel: "whatsapp" },
    });
    expect(bodies(n.sent)).toEqual([
      `Payroll has answered your pay query (ref ${ref(t.qa)}). See their answer on your pay page: http://${t.slug}.localhost:3000/pay — ${t.firmName} Shift Team`,
    ]);
    // Payroll's note stays behind the pay code: no part of it is in the message.
    for (const part of [NOTE_ONE_LINE, "new rate", "difference", "13 Nov"]) {
      expect(bodies(n.sent).join(" ")).not.toContain(part);
    }
    expect(n.pushed).toEqual([]);
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "already" } });
    expect(n.sent).toHaveLength(1);
    const logged = await t.eventsOf("pay_query.update%");
    expect(logged.map((e) => [e.action, e.data])).toEqual([
      ["pay_query.update_notice", { workerId: t.ann, status: "sending" }],
      [
        "pay_query.update_sent",
        { workerId: t.ann, channel: "whatsapp", providerMessageId: "id-1", pushes: 0 },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toContain("new rate");
  });

  it("a phone that takes the push: the push to the pay page instead (P2.4), nothing about the pay on a lock screen", async () => {
    const t = await sortFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/ann', 'k', 'a')`,
      [t.f.firmId, t.ann],
    );
    const n = await notices();
    await t.sort([t.qa]);
    const [job] = await t.jobs();
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "sent", channel: "push" } });
    expect(n.sent).toEqual([]);
    expect(n.pushed).toEqual([
      {
        title: "Pay query sorted",
        body: "Payroll has answered. Open your pay page to see it.",
        url: "/pay",
      },
    ]);
    // With no transaction open (14.1): a slow push service holds no database connection.
    expect(n.pushedInTransaction).toEqual([false]);
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "already" } });
    expect(n.pushed).toHaveLength(1);
    const logged = await t.eventsOf("pay_query.update_sent");
    expect(logged.map((e) => e.data)).toEqual([
      { workerId: t.ann, channel: "push", providerMessageId: null, pushes: 1 },
    ]);
  });

  it("by text when WhatsApp refuses it, or when the worker chose text", async () => {
    const t = await sortFirm();
    const n = await notices();
    await su.query("update workers set notify_channel = 'sms' where id = $1", [t.ben]);
    await t.sort([t.qa, t.qb]);
    n.state.refuseWhatsApp = true;
    for (const job of await t.jobs()) await n.run(job);
    expect(n.sent.map((m) => m.channel)).toEqual(["sms", "sms"]);
    expect(
      (await t.eventsOf("pay_query.update_sent")).map((e) => e.data.fellBackFrom ?? null).sort(),
    ).toEqual(["whatsapp", null].sort());
  });

  it("quiet hours: it waits for the morning (pay answers are never urgent)", async () => {
    const night = hoursFromNow(14); // Monday 23:00 London
    const t = await sortFirm();
    const n = await notices();
    await t.sort([t.qa], NOTE, t.payroll, night);
    const [job] = await t.jobs();
    expect(await n.run(job ?? {}, night)).toMatchObject({ output: { status: "held" } });
    expect(n.sent).toEqual([]);
    expect(await t.eventsOf("pay_query.update_held")).toEqual([
      expect.objectContaining({
        data: { workerId: t.ann, until: "2026-11-03T07:00:00.000Z" },
      }),
    ]);
    const again = (await t.jobs()).find((j) => String(j.idempotencyKey).endsWith(":after-quiet"));
    expect(again).toBeDefined();
    // At 07:00 it goes.
    expect(await n.run(again ?? {}, new Date("2026-11-03T07:00:00Z"))).toMatchObject({
      output: { status: "sent" },
    });
    expect(n.sent).toHaveLength(1);
  });

  it("a failed send is logged and never sent again; an unsorted query sends nothing", async () => {
    const t = await sortFirm();
    const n = await notices();
    await t.sort([t.qa]);
    n.state.fail = true;
    const [job] = await t.jobs();
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "failed" } });
    expect((await t.eventsOf("pay_query.update_failed"))[0]?.data).toMatchObject({
      workerId: t.ann,
      channel: "whatsapp",
    });
    n.state.fail = false;
    expect(await n.run(job ?? {})).toMatchObject({ output: { status: "already" } });
    // Cal's query isn't sorted: a job for it (it can't be queued by the app) sends nothing.
    expect(
      await n.run({
        firmId: t.f.firmId,
        idempotencyKey: `pay-query-update:${t.qc}`,
        payQueryId: t.qc,
      }),
    ).toMatchObject({ output: { status: "gone" } });
    expect(n.sent).toEqual([]);
  });

  it("the worker registers the job's queue as a firm queue", async () => {
    const calls: string[] = [];
    const boss = {
      createQueue: async () => undefined,
      updateQueue: async () => undefined,
      work: async (name: string) => {
        calls.push(name);
        return "worker-id";
      },
      schedule: async () => undefined,
      unschedule: async () => undefined,
    } as unknown as PgBoss;
    await registerJobs(boss);
    expect(calls).toContain(PAY_QUERY_UPDATE_QUEUE);
    expect(QUEUES.find((q) => q.name === PAY_QUERY_UPDATE_QUEUE)?.options).toMatchObject({
      policy: "standard",
    });
  });
});

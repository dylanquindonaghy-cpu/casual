import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, noAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createFirmIdLister } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { runFirmTask } from "@/lib/jobs/firm-job";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import {
  loadDigestStatus,
  PAY_DIGEST_QUEUE,
  PAY_DIGEST_TICK_CRON,
  PAY_DIGEST_TICK_QUEUE,
  payDigestTask,
  queuePayDigestNow,
  runPayDigest,
  runPayDigestTick,
  type PayDigestDeps,
} from "@/lib/pay/digest";
import { raisePayQuery } from "@/lib/portal/pay-queries";
import type { PayQueryInput } from "@/lib/portal/pay-query-kinds";
import { registerJobs } from "@/worker/jobs";
import { QUEUES } from "@/worker/jobs/queues";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The payroll digest (src/lib/pay/digest.ts) on the real database, as the app role: the email
// with its groups and attached list, the marks and events, once per key, the skips and failures,
// the AI line, other firms, the tick, "Send the digest now" and the wiring. Emails go to a
// capturing transport; nothing is sent anywhere. NOW is Monday 2 November 2026, 09:00 London (GMT);
// last week is the week of Mon 26 Oct.

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

const key = (date: string) => `pay-digest:${date}`;

async function digestFirm(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const [ann, ben, cal] = [
    await f.worker({ first: "Ann" }),
    await f.worker({ first: "Ben" }),
    await f.worker({ first: "Cal" }),
  ];
  const { rows: siteRows } = await su.query<{ id: string }>(
    "insert into sites (firm_id, name) values ($1, 'Riverside Arena'), ($1, 'Other Stadium') returning id::text as id",
    [f.firmId],
  );
  const [arena = "", stadium = ""] = siteRows.map((r) => r.id);
  const thursday = await f.shift({ startsAt: new Date("2026-10-29T08:00:00Z"), headcount: 2 });
  await su.query("update shifts set site_id = $2 where id = $1", [thursday, arena]);
  const friday = await f.shift({ startsAt: new Date("2026-10-30T08:00:00Z") });
  await su.query("update shifts set site_id = $2 where id = $1", [friday, stadium]);
  await f.booking(ann, thursday, "completed", 1);
  await f.booking(ben, thursday, "completed", 2);
  await f.booking(cal, friday, "completed", 1);
  const payLine = (workerId: string, ratePence: number) =>
    su.query(
      `insert into pay_records (firm_id, worker_id, period_start, period_end, hours, rate_pence)
       values ($1, $2, '2026-10-26', '2026-11-01', 8, $3)`,
      [f.firmId, workerId, ratePence],
    );
  const ctx = {
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Shift Team" },
    run: withFirm,
    clock: { now: () => NOW },
  };
  const raise = async (workerId: string, input: Partial<PayQueryInput>) => {
    const r = await raisePayQuery(ctx, stepped(workerId), {
      shiftId: null,
      day: null,
      issue: "missing_hours",
      details: null,
      ...input,
    });
    if (r.status !== "created") throw new Error(`not raised: ${r.status}`);
    return r.ref;
  };
  const { rows: firmRows } = await su.query<{ name: string; slug: string }>(
    "select name, slug from firms where id = $1",
    [f.firmId],
  );
  const firm = firmRows[0] ?? { name: "", slug: "" };
  const emailOf = async (officeUserId: string) =>
    (
      await su.query<{ email: string }>("select email from office_users where id = $1", [
        officeUserId,
      ])
    ).rows[0]?.email ?? "";
  const statuses = async () =>
    (
      await su.query<{ status: string }>(
        "select status from pay_queries where firm_id = $1 order by created_at, id",
        [f.firmId],
      )
    ).rows.map((r) => r.status);
  const digestEvents = async () =>
    (
      await su.query<{
        action: string;
        actor_type: string;
        actor_id: string | null;
        entity_type: string;
        data: Record<string, unknown>;
      }>(
        `select action, actor_type, actor_id::text as actor_id, entity_type, data from events
          where firm_id = $1
            and (action like 'pay_digest.%' or action in ('pay_query.in_digest', 'pay_query.back_to_open'))
          order by id`,
        [f.firmId],
      )
    ).rows;
  // The usual week: two wrong-rate queries at £12.50 (Ann's with a note), one missing hours.
  const usualWeek = async () => {
    await payLine(ann, 1250);
    await payLine(ben, 1250);
    await raise(ann, {
      shiftId: thursday,
      issue: "wrong_rate",
      details: "Paid £12.50, should be £13",
    });
    await raise(ben, { shiftId: thursday, issue: "wrong_rate" });
    await raise(cal, { shiftId: friday, issue: "missing_hours" });
  };
  return {
    f,
    firm,
    ann,
    ben,
    cal,
    arena,
    stadium,
    thursday,
    friday,
    payLine,
    raise,
    emailOf,
    statuses,
    digestEvents,
    usualWeek,
  };
}

const deps = (transport: MessagingTransport, ai: AiClient = noAi): PayDigestDeps => ({
  transport,
  ai,
  baseDomain: "shiftdesk.test",
});

const digest = (firmId: string, idempotencyKey: string, d: PayDigestDeps, officeUserId?: string) =>
  runPayDigest({ firmId, idempotencyKey, ...(officeUserId ? { officeUserId } : {}) }, withFirm, d);

type Email = Extract<OutboundMessage, { channel: "email" }>;
const emails = (sent: OutboundMessage[]) => sent.filter((m): m is Email => m.channel === "email");

describe("the payroll digest", () => {
  it("emails payroll the new queries grouped, with the list attached; marks and logs them", async () => {
    const t = await digestFirm();
    const payroll = await t.f.office("payroll");
    await t.f.office("admin"); // the firm has payroll, so admins don't get it
    await t.f.office("resourcer");
    await t.f.office("payroll", "disabled");
    await t.usualWeek();
    const { transport, sent } = captureTransport();

    expect(await digest(t.f.firmId, key("2026-11-02"), deps(transport))).toEqual({
      status: "sent",
      queries: 3,
      groups: 2,
      recipients: 1,
      failed: 0,
    });
    const [email, ...others] = emails(sent);
    expect(others).toEqual([]);
    expect(email?.to).toBe(await t.emailOf(payroll));
    expect(email?.subject).toBe(`${t.firm.name}: 3 new pay queries`);
    expect(email?.body).toBe(
      [
        "3 new pay queries since the last digest. 2 are about the same thing: wrong rate, the week of Mon 26 Oct, paid at £12.50.",
        "",
        "Grouped by likely cause, biggest first:",
        "- 2 queries: wrong rate, the week of Mon 26 Oct, paid at £12.50.",
        "- 1 query: hours missing, the week of Mon 26 Oct, at Other Stadium.",
        "",
        "The list is attached (pay-queries-2026-11-02.csv): each query with the worker, the day, the shift, the issue and what they wrote.",
        "",
        `Answer them on the pay queries page: https://${t.firm.slug}.shiftdesk.test/office/pay-queries`,
        "",
        `— ${t.firm.name} Shift Team`,
      ].join("\n"),
    );
    // Names and what workers wrote are only in the attachment.
    const [file] = email?.attachments ?? [];
    expect(file?.filename).toBe("pay-queries-2026-11-02.csv");
    expect(file?.contentType).toBe("text/csv");
    const rows = (file?.content ?? "").slice(1).trim().split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe(
      "Reference,Worker,Day worked,Shift,Issue,What they wrote,Sent (firm time),Group",
    );
    expect(rows[1]).toMatch(
      /^[0-9A-F]{8},Ann Booker,2026-10-29,"Thu 29 Oct, 08:00 to 16:00",Wrong rate,"Paid £12\.50, should be £13",\d{4}-\d{2}-\d{2} \d{2}:\d{2},"2 queries: wrong rate, the week of Mon 26 Oct, paid at £12\.50\."$/,
    );
    expect(rows[2]).toMatch(/^[0-9A-F]{8},Ben Booker,2026-10-29,/);
    expect(rows[3]).toMatch(
      /^[0-9A-F]{8},Cal Booker,2026-10-30,"Fri 30 Oct, 08:00 to 16:00",Hours missing,,/,
    );
    expect(email?.body).not.toMatch(/Ann|Ben|Cal|should be £13/);

    expect(await t.statuses()).toEqual(["in_digest", "in_digest", "in_digest"]);
    const logged = await t.digestEvents();
    expect(logged.map((e) => [e.action, e.actor_type, e.entity_type])).toEqual([
      ["pay_digest.sending", "system", "firm"],
      ["pay_query.in_digest", "system", "pay_query"],
      ["pay_query.in_digest", "system", "pay_query"],
      ["pay_query.in_digest", "system", "pay_query"],
      ["pay_digest.sent", "system", "firm"],
    ]);
    expect(logged[0]?.data).toEqual({
      key: key("2026-11-02"),
      date: "2026-11-02",
      queries: 3,
      groups: 2,
      recipients: 1,
    });
    expect(logged[1]?.data).toEqual({
      digestKey: key("2026-11-02"),
    });
    expect(logged[4]?.data).toEqual({
      key: key("2026-11-02"),
      date: "2026-11-02",
      queries: 3,
      groups: 2,
      recipients: 1,
      failed: 0,
      skipped: 0,
    });
    // Payroll's page: the last digest.
    expect(await withFirm(t.f.firmId, (tx) => loadDigestStatus(tx))).toMatchObject({
      lastSent: { queries: 3, recipients: 1 },
      problem: null,
      sendingSince: null,
    });
  });

  it("once per key; the next digest has only the new queries and counts the earlier ones", async () => {
    const t = await digestFirm();
    await t.f.office("payroll");
    await t.usualWeek();
    const { transport, sent } = captureTransport();
    await digest(t.f.firmId, key("2026-11-02"), deps(transport));
    // The same key again (a retry, a second tick): nothing.
    expect(await digest(t.f.firmId, key("2026-11-02"), deps(transport))).toEqual({
      status: "already",
    });
    expect(sent).toHaveLength(1);

    await t.raise(t.ben, { day: "2026-10-31", issue: "late_pay" });
    expect(await digest(t.f.firmId, key("2026-11-03"), deps(transport))).toMatchObject({
      status: "sent",
      queries: 1,
    });
    const second = emails(sent)[1];
    expect(second?.subject).toMatch(/: 1 new pay query$/);
    expect(second?.body.split("\n")[0]).toBe(
      "1 new pay query since the last digest: paid late or not paid, the week of Mon 26 Oct.",
    );
    expect(second?.body).toContain("3 queries from earlier digests are still waiting.");
    expect((second?.attachments?.[0]?.content ?? "").slice(1).trim().split("\r\n")).toHaveLength(2);

    // Nothing new: no email, and the day's digest is marked done.
    expect(await digest(t.f.firmId, key("2026-11-04"), deps(transport))).toEqual({
      status: "nothing_new",
    });
    expect(sent).toHaveLength(2);
    expect((await t.digestEvents()).at(-1)).toMatchObject({
      action: "pay_digest.skipped",
      data: { key: key("2026-11-04"), date: "2026-11-04", reason: "nothing_new", queries: 0 },
    });
    expect(await digest(t.f.firmId, key("2026-11-04"), deps(transport))).toEqual({
      status: "already",
    });
  });

  it("a pay line imported after a query moves it to its group before the digest", async () => {
    const t = await digestFirm();
    await t.f.office("payroll");
    await t.raise(t.ann, { shiftId: t.thursday, issue: "wrong_rate" });
    await t.payLine(t.ann, 1250);
    const { transport, sent } = captureTransport();
    await digest(t.f.firmId, key("2026-11-02"), deps(transport));
    expect(emails(sent)[0]?.body).toContain(
      "- 1 query: wrong rate, the week of Mon 26 Oct, paid at £12.50.",
    );
  });

  it("no one to send it to: skipped and the queries stay open; admins get it when there's no payroll", async () => {
    const t = await digestFirm();
    await t.f.office("resourcer");
    await t.f.office("payroll", "disabled");
    // An address the email can't go to (no dot in the domain) is counted, never sent to.
    await su.query(
      `insert into office_users (firm_id, email, name, role) values ($1, 'pay@localhost', 'Pay', 'payroll')`,
      [t.f.firmId],
    );
    await t.usualWeek();
    const { transport, sent } = captureTransport();
    expect(await digest(t.f.firmId, key("2026-11-02"), deps(transport))).toEqual({
      status: "no_recipients",
      queries: 3,
    });
    expect(sent).toEqual([]);
    expect(await t.statuses()).toEqual(["open", "open", "open"]);
    expect((await t.digestEvents()).map((e) => [e.action, e.data.reason, e.data.queries])).toEqual([
      ["pay_digest.skipped", "no_recipients", 3],
    ]);
    expect(await withFirm(t.f.firmId, (tx) => loadDigestStatus(tx))).toMatchObject({
      lastSent: null,
      problem: { reason: "no_recipients" },
    });

    const admin = await t.f.office("admin");
    expect(await digest(t.f.firmId, key("2026-11-03"), deps(transport))).toMatchObject({
      status: "sent",
      recipients: 1,
    });
    expect(emails(sent).map((m) => m.to)).toEqual([await t.emailOf(admin)]);
    expect((await t.digestEvents()).at(-1)?.data).toMatchObject({ skipped: 1 });
    expect(await withFirm(t.f.firmId, (tx) => loadDigestStatus(tx))).toMatchObject({
      lastSent: { queries: 3 },
      problem: null,
    });
  });

  it("every send failing: the queries go back to open for the next digest; one of two failing still counts", async () => {
    const t = await digestFirm();
    const first = await t.f.office("payroll");
    await t.usualWeek();
    const broken: MessagingTransport = {
      name: "broken",
      send: async () => {
        throw new Error("provider down");
      },
    };
    expect(await digest(t.f.firmId, key("2026-11-02"), deps(broken))).toEqual({
      status: "failed",
      queries: 3,
      code: "Error",
    });
    expect(await t.statuses()).toEqual(["open", "open", "open"]);
    // Each query's move into the digest and back is logged, with the digest's own events.
    const inDigest = ["pay_query.in_digest", { digestKey: key("2026-11-02") }];
    const back = [
      "pay_query.back_to_open",
      { digestKey: key("2026-11-02"), reason: "send_failed" },
    ];
    expect((await t.digestEvents()).map((e) => [e.action, e.data])).toEqual([
      [
        "pay_digest.sending",
        { key: key("2026-11-02"), date: "2026-11-02", queries: 3, groups: 2, recipients: 1 },
      ],
      inDigest,
      inDigest,
      inDigest,
      back,
      back,
      back,
      [
        "pay_digest.failed",
        { key: key("2026-11-02"), date: "2026-11-02", queries: 3, recipients: 1, code: "Error" },
      ],
    ]);
    expect(await withFirm(t.f.firmId, (tx) => loadDigestStatus(tx))).toMatchObject({
      lastSent: null,
      problem: { reason: "failed" },
      sendingSince: null,
    });

    // Two in payroll, the first address failing: the other gets it, and it counts as sent.
    const second = await t.f.office("payroll");
    const firstEmail = await t.emailOf(first);
    const { transport: capture, sent } = captureTransport();
    const halfBroken: MessagingTransport = {
      name: "half",
      send: async (m) => {
        if (m.channel === "email" && m.to === firstEmail) throw new Error("mailbox full");
        return capture.send(m);
      },
    };
    expect(await digest(t.f.firmId, key("2026-11-03"), deps(halfBroken))).toEqual({
      status: "sent",
      queries: 3,
      groups: 2,
      recipients: 1,
      failed: 1,
    });
    expect(emails(sent).map((m) => m.to)).toEqual([await t.emailOf(second)]);
    expect(await t.statuses()).toEqual(["in_digest", "in_digest", "in_digest"]);
    expect(await withFirm(t.f.firmId, (tx) => loadDigestStatus(tx))).toMatchObject({
      lastSent: { queries: 3, recipients: 1, failed: 1 },
      problem: null,
    });
  });

  it("recording the outcome is run again when Postgres aborts it (a deadlock): sent once, logged once", async () => {
    const t = await digestFirm();
    await t.f.office("payroll");
    await t.usualWeek();
    let calls = 0;
    // The second transaction (the outcome) is aborted once, as a deadlock would.
    const flaky: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 2)
        return Promise.reject(Object.assign(new Error("deadlock"), { code: "40P01" }));
      return withFirm(firmId, fn);
    };
    const { transport, sent } = captureTransport();
    expect(
      await runPayDigest(
        { firmId: t.f.firmId, idempotencyKey: key("2026-11-02") },
        flaky,
        deps(transport),
      ),
    ).toMatchObject({ status: "sent", queries: 3 });
    expect(calls).toBe(3);
    expect(sent).toHaveLength(1);
    expect((await t.digestEvents()).filter((e) => e.action === "pay_digest.sent")).toHaveLength(1);
  });

  it("a digest that stops after claiming: its queries stay in it, logged; the page says it may not have gone", async () => {
    const t = await digestFirm();
    await t.f.office("payroll");
    await t.usualWeek();
    let calls = 0;
    const crashing: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls >= 2) return Promise.reject(new Error("worker stopped"));
      return withFirm(firmId, fn);
    };
    const { transport } = captureTransport();
    await expect(
      runPayDigest(
        { firmId: t.f.firmId, idempotencyKey: key("2026-11-02") },
        crashing,
        deps(transport),
      ),
    ).rejects.toThrow("worker stopped");
    expect(await t.statuses()).toEqual(["in_digest", "in_digest", "in_digest"]);
    expect((await t.digestEvents()).map((e) => e.action)).toEqual([
      "pay_digest.sending",
      "pay_query.in_digest",
      "pay_query.in_digest",
      "pay_query.in_digest",
    ]);
    const status = (now: Date) => withFirm(t.f.firmId, (tx) => loadDigestStatus(tx, now));
    // Just now: being sent. Half an hour later with no outcome: it may not have gone.
    const started = new Date();
    expect(await status(started)).toMatchObject({ problem: null });
    expect((await status(started)).sendingSince).toBeInstanceOf(Date);
    expect(await status(new Date(started.getTime() + 31 * 60_000))).toMatchObject({
      problem: { reason: "unfinished" },
      sendingSince: null,
    });
    // A retry of the job does nothing more.
    expect(await digest(t.f.firmId, key("2026-11-02"), deps(transport))).toEqual({
      status: "already",
    });
  });

  it("the AI's line goes beneath its group's own line; it sees facts only; a failing AI changes nothing", async () => {
    const t = await digestFirm();
    await t.f.office("payroll");
    await t.usualWeek();
    const asked: AiRequest[] = [];
    const ai = createFakeAi((request) => {
      asked.push(request);
      return asked.length === 1
        ? "2 queries: last week still paid at £12.50."
        : "You should pay £99.";
    });
    const { transport, sent } = captureTransport();
    await digest(t.f.firmId, key("2026-11-02"), deps(transport, ai));
    const body = emails(sent)[0]?.body ?? "";
    expect(body).toContain(
      "- 2 queries: wrong rate, the week of Mon 26 Oct, paid at £12.50.\n  AI summary: 2 queries: last week still paid at £12.50. (written by AI)\n- 1 query: hours missing",
    );
    // A line that fails the check adds nothing.
    expect(body).not.toContain("£99");
    expect(asked).toHaveLength(2);
    for (const request of asked) {
      expect(request.prompt).not.toMatch(/Ann|Ben|Cal|Booker|should be £13/);
    }
    // The list's group column is the app's line, never the AI's.
    expect(emails(sent)[0]?.attachments?.[0]?.content).not.toContain("last week still paid");

    // The AI failing: the same email as with no AI.
    const u = await digestFirm();
    await u.f.office("payroll");
    await u.usualWeek();
    const down = createFakeAi(() => {
      throw new Error("timeout");
    });
    const { transport: t2, sent: sent2 } = captureTransport();
    expect(await digest(u.f.firmId, key("2026-11-02"), deps(t2, down))).toMatchObject({
      status: "sent",
    });
    expect(emails(sent2)[0]?.body).not.toContain("AI summary");
  });

  it("only this firm's queries and payroll", async () => {
    const t = await digestFirm();
    const other = await digestFirm();
    await t.f.office("payroll");
    const theirs = await other.f.office("payroll");
    await t.usualWeek();
    await other.usualWeek();
    const { transport, sent } = captureTransport();
    await digest(t.f.firmId, key("2026-11-02"), deps(transport));
    expect(emails(sent).map((m) => m.to)).not.toContain(await other.emailOf(theirs));
    expect(await other.statuses()).toEqual(["open", "open", "open"]);
    expect(await other.digestEvents()).toEqual([]);
  });

  it("two digests at once (the schedule and Send now): one sends, the other finds nothing new", async () => {
    const t = await digestFirm();
    await t.f.office("payroll");
    await t.usualWeek();
    const { transport, sent } = captureTransport();
    const results = await Promise.all([
      digest(t.f.firmId, key("2026-11-02"), deps(transport)),
      digest(
        t.f.firmId,
        `${key("2026-11-02")}:now:5b0f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e`,
        deps(transport),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["nothing_new", "sent"]);
    expect(sent).toHaveLength(1);
  });
});

describe("pay-digest-tick and the job", () => {
  // The tick's jobs for a firm on the test dates (a real worker elsewhere could add today's).
  const queuedFor = async (firmId: string) =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
            and data ->> 'idempotencyKey' like 'pay-digest:2026-11-%' order by created_on`,
        [PAY_DIGEST_QUEUE, firmId],
      )
    ).rows.map((r) => r.data.idempotencyKey);

  it("queues one digest per firm when it's due, once a day; none on other days or with no days", async () => {
    const weekdays = await digestFirm();
    const none = await digestFirm({ pay_digest: { days: [] } });
    const evenings = await digestFirm({ pay_digest: { time: "17:00", days: ["mon"] } });
    const tick = (iso: string) =>
      runPayDigestTick({
        listFirmIds: createFirmIdLister(app),
        run: withFirm,
        clock: { now: () => new Date(iso) },
      });
    await tick("2026-11-02T08:55:00Z");
    expect(await queuedFor(weekdays.f.firmId)).toEqual([]);
    await tick("2026-11-02T09:00:00Z");
    expect(await queuedFor(weekdays.f.firmId)).toEqual([key("2026-11-02")]);
    expect(await queuedFor(evenings.f.firmId)).toEqual([]);
    // Later ticks the same day queue nothing new; the evening firm's goes at 17:00.
    await tick("2026-11-02T12:00:00Z");
    await tick("2026-11-02T17:05:00Z");
    expect(await queuedFor(weekdays.f.firmId)).toEqual([key("2026-11-02")]);
    expect(await queuedFor(evenings.f.firmId)).toEqual([key("2026-11-02")]);
    // Saturday: not a digest day. Tuesday: the next one.
    await tick("2026-11-07T10:00:00Z");
    await tick("2026-11-03T09:05:00Z");
    expect(await queuedFor(weekdays.f.firmId)).toEqual([key("2026-11-02"), key("2026-11-03")]);
    expect(await queuedFor(none.f.firmId)).toEqual([]);
  });

  it("runs as a firm task: a digest payroll asked for is logged as theirs; bad payloads are dead-lettered", async () => {
    const t = await digestFirm();
    const payroll = await t.f.office("payroll");
    await t.usualWeek();
    const { transport, sent } = captureTransport();
    const task = payDigestTask(() => deps(transport));
    const nowKey = `${key("2026-11-02")}:now:5b0f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e`;
    expect(
      await runFirmTask(
        task,
        {
          id: "job-1",
          data: { firmId: t.f.firmId, idempotencyKey: nowKey, officeUserId: payroll },
        },
        withFirm,
      ),
    ).toEqual({
      id: "job-1",
      status: "completed",
      output: { status: "sent", queries: 3, groups: 2, recipients: 1, failed: 0 },
    });
    expect(
      (await t.digestEvents()).map((e) => [e.action, e.actor_type, e.actor_id]).slice(0, 1),
    ).toEqual([["pay_digest.sending", "office", payroll]]);
    for (const idempotencyKey of ["free text", key("2026-02-30"), `${key("2026-11-02")}:now:x`]) {
      expect(
        await runFirmTask(
          task,
          { id: "job-2", data: { firmId: t.f.firmId, idempotencyKey } },
          withFirm,
        ),
      ).toMatchObject({ status: "deadletter", output: { error: "invalid_payload" } });
    }
    expect(sent).toHaveLength(1);
  });

  it("the worker works both queues and schedules the tick every 5 minutes", async () => {
    const calls: unknown[][] = [];
    const boss = {
      createQueue: async () => undefined,
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
        ["work", PAY_DIGEST_QUEUE],
        ["work", PAY_DIGEST_TICK_QUEUE],
        ["schedule", PAY_DIGEST_TICK_QUEUE, "*/5 * * * *"],
      ]),
    );
    expect(PAY_DIGEST_TICK_CRON).toBe("*/5 * * * *");
    // A firm queue: the standard policy, so one firm's job never dedupes another's.
    expect(QUEUES.find((q) => q.name === PAY_DIGEST_QUEUE)?.options).toMatchObject({
      policy: "standard",
    });
  });
});

describe("Send the digest now", () => {
  const jobsFor = async (firmId: string) =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        `select data from pgboss.job where name = $1 and data ->> 'firmId' = $2
            and data ->> 'idempotencyKey' like '%:now:%'`,
        [PAY_DIGEST_QUEUE, firmId],
      )
    ).rows.map((r) => r.data);

  it("payroll and admins queue a digest with who asked; one a minute; others can't", async () => {
    const t = await digestFirm();
    const payroll = await t.f.office("payroll");
    const admin = await t.f.office("admin");
    const resourcer = await t.f.office("resourcer");
    const gone = await t.f.office("payroll", "disabled");
    await t.usualWeek();
    const press = (id: string) =>
      queuePayDigestNow(
        withFirm,
        t.f.firmId,
        { type: "office", id },
        { clock: { now: () => NOW } },
      );
    for (const id of [resourcer, gone, "00000000-0000-4000-8000-000000000009"]) {
      expect(await press(id)).toEqual({ status: "not_allowed" });
    }
    expect(await jobsFor(t.f.firmId)).toEqual([]);
    expect(await press(payroll)).toEqual({ status: "queued", queries: 3, recipients: 1 });
    // A second press within the minute (here, by an admin): still one job.
    expect(await press(admin)).toEqual({ status: "just_asked" });
    const jobs = await jobsFor(t.f.firmId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ firmId: t.f.firmId, officeUserId: payroll });
    expect(String(jobs[0]?.idempotencyKey)).toMatch(
      /^pay-digest:2026-11-02:now:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("nothing new, or no one to send it to: nothing queued", async () => {
    const t = await digestFirm();
    const admin = await t.f.office("admin");
    const press = () =>
      queuePayDigestNow(
        withFirm,
        t.f.firmId,
        { type: "office", id: admin },
        { clock: { now: () => NOW } },
      );
    expect(await press()).toEqual({ status: "nothing_new" });
    await t.usualWeek();
    await su.query("update office_users set email = 'boss@localhost' where id = $1", [admin]);
    expect(await press()).toEqual({ status: "no_recipients" });
    expect(await jobsFor(t.f.firmId)).toEqual([]);
  });
});

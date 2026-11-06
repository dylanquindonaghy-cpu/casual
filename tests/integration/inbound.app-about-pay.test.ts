import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MINUTE } from "@/lib/auth/clock";
import type { ActiveSession } from "@/lib/auth/sessions";
import { createFakeAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveAppMessage, type AboutPay } from "@/lib/inbound/app";
import { runInboundMessage } from "@/lib/inbound/reply";
import { loadEnquiries, loadEnquiry } from "@/lib/office/enquiries";
import { OUTCOME_WORDS, sortedStep } from "@/lib/office/enquiries-copy";
import { loadPayQueryGroups } from "@/lib/office/pay-query-groups";
import { payDigestCsv, sentFromWords } from "@/lib/pay/digest-list";
import { readMessageAboutPay } from "@/lib/portal/message-office";
import { messagesThread } from "@/lib/portal/messages";
import { MESSAGE_OFFICE } from "@/lib/portal/pay-copy";
import { myPayQueries } from "@/lib/portal/pay-queries";
import { PROBLEM_LINKS } from "@/lib/portal/pay-query-kinds";
import { captureTransport } from "../helpers/auth";
import { bookingFirm, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Phase 29.1 (Dylan's decision 20; docs/screens.md "### 29.1"), on the real database as the app
// role. Pay's "Message the office" (no way to send her a code) and the pay query's too_old "message
// the office" both open Messages about her pay (/messages?about=pay). What she sends from there is
// a pay query for payroll's digest (golden rule 9), raised in the same transaction that stores the
// message: issue "other", no shift, open, the day she sent it in the firm's time, her words as its
// details. Never sorted: no keyword (her words say "pay"), no AI, no automatic answer of any kind,
// and no office request (it no longer waits in Enquiries' Need a person). Logged with ids only. A
// resend with the same id raises nothing new. Payroll's list shows it with where it came from;
// another firm and another casual never see it; her Pay page lists it. The same words sent without
// it still get the pay link, as before. Nothing goes by WhatsApp, text or email.
// (Before 29.1 this file expected an office request, Phase 28.10's guardrails fix: the behaviour
// changed on purpose.) NOW is Monday 2 November 2026, 09:00 London (GMT).

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

const SECRET = "test-session-secret-for-app-about-pay-0123456789";

// What Messages reads from a link's address (src/app/messages/page.tsx).
const aboutPayFrom = (href: string) => {
  const q = new URL(href, "https://acme.shiftdesk.test").searchParams;
  return readMessageAboutPay({
    ...(q.has("shift") ? { shift: q.get("shift") ?? "" } : {}),
    ...(q.has("about") ? { about: q.get("about") ?? "" } : {}),
  });
};

const steppedFor = (workerId: string) => ({
  worker: { id: workerId },
  session: {
    id: randomUUID(),
    kind: "worker",
    subjectId: workerId,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    rotatedAt: NOW,
    steppedUpUntil: new Date(NOW.getTime() + 25 * MINUTE),
    rotationDue: false,
  } as ActiveSession,
});

async function setup(opts: { status?: "active" | "inactive" } = {}) {
  const f = await bookingFirm(su, withFirm);
  const kay = await f.worker({ first: "Kay", ...(opts.status ? { status: opts.status } : {}) });
  const line = captureTransport();
  const asked: AiRequest[] = [];
  const ai: AiClient = createFakeAi((r) => {
    asked.push(r);
    return "pay";
  });
  const at = { firmId: f.firmId, run: withFirm, secret: SECRET, clock: { now: () => NOW } };
  const jobDeps = {
    transport: line.transport,
    ai,
    baseDomain: "shiftdesk.test",
    aiTimeoutMs: 200,
    clock: { now: () => NOW },
  };
  // Sent, then the inbound job run as the worker would (if one was queued, it's the same).
  const ask = async (
    text: string,
    aboutPay?: boolean | AboutPay,
    clientId: string = randomUUID(),
    worker = kay,
  ) => {
    const sent = await receiveAppMessage(at, worker, text, clientId, null, aboutPay);
    if (sent.status !== "sent") throw new Error(`not sent: ${sent.status}`);
    const result = await runInboundMessage(
      { firmId: f.firmId, messageId: sent.messageId, idempotencyKey: `x:${sent.messageId}` },
      withFirm,
      jobDeps,
    );
    return { id: sent.messageId, sent, result };
  };
  const repliesTo = async (messageId: string) =>
    (
      await su.query<{ body: string }>("select body from messages where reply_to = $1", [messageId])
    ).rows.map((r) => r.body);
  const requestsOf = async (workerId: string) =>
    (
      await su.query<{ id: string }>(
        "select id::text as id from requests where firm_id = $1 and worker_id = $2",
        [f.firmId, workerId],
      )
    ).rows;
  const queriesOf = async (workerId: string) =>
    (
      await su.query<{
        id: string;
        issue_type: string;
        status: string;
        shift_id: string | null;
        work_date: string;
        details: string | null;
        group_key: string | null;
      }>(
        `select id::text as id, issue_type, status, shift_id, work_date::text as work_date, details,
                group_key
           from pay_queries where firm_id = $1 and worker_id = $2 order by created_at, id`,
        [f.firmId, workerId],
      )
    ).rows;
  const jobsFor = async (messageId: string) =>
    (
      await su.query<{ n: number }>(
        "select count(*)::int as n from pgboss.job where name = 'inbound-message' and data ->> 'messageId' = $1",
        [messageId],
      )
    ).rows[0]?.n ?? 0;
  const eventsAbout = async (entityId: string) =>
    (
      await su.query<{ action: string; data: Record<string, unknown> }>(
        "select action, data from events where firm_id = $1 and entity_id = $2 order by id",
        [f.firmId, entityId],
      )
    ).rows;
  const ctx = {
    firm: { id: f.firmId, timezone: "Europe/London", signOff: "Booking Test Shift Team" },
    run: withFirm,
    clock: { now: () => NOW },
  };
  return {
    f,
    kay,
    line,
    asked,
    ask,
    repliesTo,
    requestsOf,
    queriesOf,
    jobsFor,
    eventsAbout,
    ctx,
  };
}

describe("Pay's 'Message the office' opens Messages about her pay", () => {
  it("both links: no code sender, and a pay question older than 90 days", () => {
    expect(MESSAGE_OFFICE.href).toBe("/messages?about=pay");
    expect(PROBLEM_LINKS.too_old?.href).toBe("/messages?about=pay");
    expect(aboutPayFrom(MESSAGE_OFFICE.href)).toBe(true);
    expect(aboutPayFrom(PROBLEM_LINKS.too_old?.href ?? "")).toBe(true);
    // Plain Messages is not about her pay.
    expect(aboutPayFrom("/messages")).toBe(false);
  });
});

describe("a message sent about her pay", () => {
  for (const [from, href, text] of [
    ["no code sender", MESSAGE_OFFICE.href, "I can't open my pay. Was I paid for Saturday?"],
    [
      "too old",
      PROBLEM_LINKS.too_old?.href ?? "",
      "I wasn't paid for my shift on 2 June, my wages were short",
    ],
  ] as const) {
    it(`from ${from}: one pay query for payroll, never sorted, no request, no automatic reply`, async () => {
      const t = await setup();
      const { id, sent, result } = await t.ask(text, aboutPayFrom(href));
      expect(sent).toEqual({ status: "sent", messageId: id, toPayroll: true });
      // Stored already handled, with no job queued: the job finds nothing to do.
      expect(await t.jobsFor(id)).toBe(0);
      expect(result).toEqual({ status: "already" });
      // Not the keyword, not the AI, and no answer of any kind (never the /pay link).
      expect(t.asked).toHaveLength(0);
      expect(await t.repliesTo(id)).toEqual([]);
      expect(t.line.sent).toEqual([]);
      const { rows: m } = await su.query<{ handled_as: string; intent: string; handled: boolean }>(
        "select handled_as, intent, handled_at is not null as handled from messages where id = $1",
        [id],
      );
      expect(m[0]).toEqual({ handled_as: "office", intent: "pay", handled: true });

      // No office request: payroll's, not Enquiries'.
      expect(await t.requestsOf(t.kay)).toEqual([]);

      // One pay query: open, "other", no shift, today in the firm's time, her words.
      const queries = await t.queriesOf(t.kay);
      expect(queries).toHaveLength(1);
      const q = queries[0];
      expect(q).toMatchObject({
        issue_type: "other",
        status: "open",
        shift_id: null,
        work_date: "2026-11-02",
        details: text,
      });
      expect(q?.group_key).toMatch(/:other:/);

      // Logged with ids only (golden rule 5): the query as the Pay page's are, with where it came
      // from; the message with the query's id.
      expect(await t.eventsAbout(q?.id ?? "")).toEqual([
        {
          action: "pay_query.created",
          data: {
            issueType: "other",
            shiftId: null,
            workDate: "2026-11-02",
            groupKey: q?.group_key,
            via: "messages",
            messageId: id,
          },
        },
      ]);
      expect(await t.eventsAbout(id)).toEqual([
        {
          action: "message.received",
          data: {
            channel: "app",
            handledAs: "office",
            intent: "pay",
            aboutPay: true,
            payQueryId: q?.id,
            workerId: t.kay,
          },
        },
      ]);
      const logged = JSON.stringify([
        ...(await t.eventsAbout(id)),
        ...(await t.eventsAbout(q?.id ?? "")),
      ]);
      expect(logged).not.toContain("paid");
      expect(logged).not.toContain("Saturday");

      // Enquiries: not waiting for a person; its page says it went to payroll, by reference.
      const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
      expect(person.rows).toEqual([]);
      const pay = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "pay", new Date()));
      expect(pay.rows.map((r) => [r.messageId, r.outcome])).toEqual([[id, "payroll"]]);
      expect(OUTCOME_WORDS.payroll).toBe("Pay: sent to payroll");
      const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
      const ref = (q?.id ?? "").slice(0, 8).toUpperCase();
      expect(e?.timeline.sorted).toEqual({ how: "to_payroll", ref });
      expect(e && sortedStep(e.timeline.sorted)).toBe(
        `About their pay, from Messages: it went to payroll as pay query ${ref}, for the pay digest. Never sorted or answered automatically.`,
      );
      expect(e?.waiting).toBe(false);
      expect(e?.question).toBeNull();
    });
  }

  it("resent with the same id: nothing new is stored, raised or queued", async () => {
    const t = await setup();
    const clientId = randomUUID();
    const first = await t.ask("Was I paid for Saturday?", true, clientId);
    const again = await t.ask("Was I paid for Saturday?", true, clientId);
    expect(again.id).toBe(first.id);
    expect(again.sent).toEqual({ status: "sent", messageId: first.id, toPayroll: true });
    expect(await t.queriesOf(t.kay)).toHaveLength(1);
    const { rows } = await su.query<{ n: number }>(
      "select count(*)::int as n from messages where firm_id = $1 and worker_id = $2",
      [t.f.firmId, t.kay],
    );
    expect(rows[0]?.n).toBe(1);
    expect(t.asked).toHaveLength(0);
  });

  it("a second, different message the same day raises no second query: it names the one waiting", async () => {
    const t = await setup();
    const first = await t.ask("Was I paid for Saturday?", true);
    const second = await t.ask("Also my holiday pay looks wrong", { why: "no_code" });
    expect(second.id).not.toBe(first.id);
    expect(second.sent).toEqual({ status: "sent", messageId: second.id, toPayroll: true });
    expect(await t.jobsFor(second.id)).toBe(0);
    expect(t.asked).toHaveLength(0);
    expect(await t.repliesTo(second.id)).toEqual([]);
    // One query, with her first words; both messages stay on her thread.
    const queries = await t.queriesOf(t.kay);
    expect(queries.map((q) => [q.status, q.details])).toEqual([
      ["open", "Was I paid for Saturday?"],
    ]);
    const q = queries[0];
    expect((await t.eventsAbout(q?.id ?? "")).map((e) => e.action)).toEqual(["pay_query.created"]);
    expect(await t.eventsAbout(second.id)).toEqual([
      {
        action: "message.received",
        data: {
          channel: "app",
          handledAs: "office",
          intent: "pay",
          aboutPay: true,
          payQueryId: q?.id,
          payQueryAlreadyOpen: true,
          workerId: t.kay,
        },
      },
    ]);
    const thread = await messagesThread(t.ctx, t.kay);
    expect(thread.items.map((i) => [i.mine, i.toPayroll])).toEqual([
      [true, true],
      [true, true],
    ]);
    // Enquiries names that query for the second message too.
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, second.id, new Date()));
    expect(e?.timeline.sorted).toEqual({
      how: "to_payroll",
      ref: (q?.id ?? "").slice(0, 8).toUpperCase(),
    });
    expect(e?.waiting).toBe(false);

    // Once payroll has answered it, a new message raises a new one.
    await su.query("update pay_queries set status = 'resolved' where id = $1", [q?.id]);
    await t.ask("Still not paid for Saturday", true);
    expect((await t.queriesOf(t.kay)).map((r) => [r.status, r.details])).toEqual([
      ["resolved", "Was I paid for Saturday?"],
      ["open", "Still not paid for Saturday"],
    ]);
  });

  it("many sends with different ids at once raise one query (the per-worker lock)", async () => {
    const t = await setup();
    const at = { firmId: t.f.firmId, run: withFirm, secret: SECRET, clock: { now: () => NOW } };
    const sent = await Promise.all(
      ["one", "two", "three", "four"].map((w) =>
        receiveAppMessage(at, t.kay, `Pay question ${w}`, randomUUID(), null, true),
      ),
    );
    expect(sent.every((s) => s.status === "sent" && s.toPayroll === true)).toBe(true);
    expect(await t.queriesOf(t.kay)).toHaveLength(1);
  });

  it("payroll's list and digest show it with where it came from (and why, when the app knew)", async () => {
    const t = await setup();
    // Two casuals (one of hers is waiting a day: below), each from Messages.
    const ola = await t.f.worker({ first: "Ola" });
    await t.ask("Was I paid for Saturday?", { why: "no_code" });
    await t.ask("My June pay was short", true, randomUUID(), ola);
    const { groups } = await withFirm(t.f.firmId, (tx) => loadPayQueryGroups(tx));
    const items = groups.flatMap((g) => g.queries);
    expect(items.map((i) => [i.details, i.status, i.fromMessages])).toEqual([
      ["Was I paid for Saturday?", "open", { why: "no_code" }],
      ["My June pay was short", "open", { why: null }],
    ]);
    expect(items.map((i) => sentFromWords(i).note)).toEqual([
      "Sent from Messages: we couldn't send them a pay code, so the Pay page couldn't take it.",
      "Sent from Messages.",
    ]);
    const csv = payDigestCsv(groups, "Europe/London").slice(1).trim().split("\r\n");
    expect(csv[0]?.endsWith(",Group,Sent from")).toBe(true);
    expect(csv[1]).toContain("Kay Booker,2026-11-02,,Something else,Was I paid for Saturday?");
    expect(csv[1]?.endsWith(",Messages (we couldn't send them a pay code)")).toBe(true);
    expect(csv[2]?.endsWith(",Messages")).toBe(true);
    // The pay_query.created event carries the why (ids and words of ours only).
    const q = (await t.queriesOf(t.kay))[0];
    expect((await t.eventsAbout(q?.id ?? ""))[0]?.data.why).toBe("no_code");
  });

  it("her Pay page lists it with its reference; another casual and another firm never see it", async () => {
    const t = await setup();
    const ola = await t.f.worker({ first: "Ola" });
    const other = await setup();
    await t.ask("Was I paid for Saturday?", true);
    const q = (await t.queriesOf(t.kay))[0];
    const ref = (q?.id ?? "").slice(0, 8).toUpperCase();

    const mine = await myPayQueries(t.ctx, steppedFor(t.kay));
    expect(mine.map((m) => [m.ref, m.issue, m.day, m.status])).toEqual([
      [ref, "other", "2026-11-02", "open"],
    ]);
    // Another casual of the same firm: not hers.
    expect(await myPayQueries(t.ctx, steppedFor(ola))).toEqual([]);
    // Another firm (RLS): its payroll list and its casual's Pay page see nothing of it.
    const theirs = await withFirm(other.f.firmId, (tx) => loadPayQueryGroups(tx));
    expect(theirs.groups).toEqual([]);
    expect(await myPayQueries(other.ctx, steppedFor(other.kay))).toEqual([]);
    const { rows } = await app.query<{ n: number }>(
      "select count(*)::int as n from pay_queries where id = $1",
      [q?.id],
    );
    expect(rows[0]?.n).toBe(0); // the app role with no firm set sees no row

    // Her thread marks it as sent to payroll, waiting for no answer there.
    const thread = await messagesThread(t.ctx, t.kay);
    expect(thread.items.map((i) => [i.mine, i.toPayroll])).toEqual([[true, true]]);
    expect(thread.answered).toBe(true);
  });

  it("from someone no longer active: no pay query, held for a person as before", async () => {
    const t = await setup({ status: "inactive" });
    const { id, sent, result } = await t.ask("Was I paid for Saturday?", true);
    expect(sent).toEqual({ status: "sent", messageId: id });
    expect(result).toMatchObject({ status: "held", intent: "office", handledAs: "office" });
    expect(await t.queriesOf(t.kay)).toEqual([]);
    expect(t.asked).toHaveLength(0);
    expect(await t.repliesTo(id)).toEqual([]);
  });

  it("the same words sent from plain Messages still get the pay link, as before", async () => {
    const t = await setup();
    const { id, result } = await t.ask("I wasn't paid for my shift on 2 June");
    expect(result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
    expect((await t.repliesTo(id))[0]).toContain("/pay");
    expect(await t.requestsOf(t.kay)).toEqual([]);
    expect(await t.queriesOf(t.kay)).toEqual([]);
  });

  it("her next message, from plain Messages, is sorted as any other", async () => {
    const t = await setup();
    await t.ask("Was I paid for Saturday?", true);
    const next = await t.ask("Was I paid for Sunday?");
    expect(next.result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
    expect(await t.queriesOf(t.kay)).toHaveLength(1);
  });
});

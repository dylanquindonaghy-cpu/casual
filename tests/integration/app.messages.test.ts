import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, noAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import { collectWorkerData } from "@/lib/gdpr/worker-export";
import { APP_MESSAGE_MAX, receiveAppMessage } from "@/lib/inbound/app";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import {
  APP_REPLIES_PER_HOUR,
  runInboundMessage,
  runInboundWithLastTry,
} from "@/lib/inbound/reply";
import { ENQUIRY_REPLY_QUEUE, runEnquiryReply } from "@/lib/notices/enquiry-reply";
import { loadEnquiries, loadEnquiry } from "@/lib/office/enquiries";
import { replyToEnquiry } from "@/lib/office/enquiry-actions";
import { messagesThread, openMessages, unreadReplies } from "@/lib/portal/messages";
import type { PushTransport } from "@/lib/push/transport";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Messages in the app (P8; Phase 25.6; docs/screens.md "Messages: the in-app chat";
// docs/messaging-templates.md "Messages in the app") on the real database as the app role: a
// casual's message stored and queued (src/lib/inbound/app.ts), sorted and answered in the app at
// once whatever the firm's automatic replies switch (src/lib/inbound/reply.ts), at most 5 automatic
// answers an hour and none to an echo; the office's reply from Enquiries shown in the app with a
// push (src/lib/office/enquiry-actions.ts, src/lib/notices/enquiry-reply.ts); the casual's thread
// and the tab's count (src/lib/portal/messages.ts); another firm's casual. Nothing is sent by
// WhatsApp, text or email: the capturing transport stays empty. No real AI and no push service.

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

const SECRET = "test-session-secret-for-app-messages-0123456789";

// The firm's own default: automatic replies off (P4.7). The app answers anyway (decision 11).
async function appFirm() {
  const f = await bookingFirm(su, withFirm, {});
  const kay = await f.worker({ first: "Kay" });
  const { rows } = await su.query<{ slug: string; name: string }>(
    "select slug, name from firms where id = $1",
    [f.firmId],
  );
  const slug = rows[0]?.slug ?? "";
  const name = rows[0]?.name ?? "";
  const resourcer = await f.office("resourcer");
  const line = captureTransport();
  const deps = (ai: AiClient = noAi) => ({
    transport: line.transport,
    ai,
    baseDomain: "shiftdesk.test",
    aiTimeoutMs: 200,
  });
  const send = (text: string, workerId = kay) =>
    receiveAppMessage({ firmId: f.firmId, run: withFirm, secret: SECRET }, workerId, text);
  // A message sent in the app, then the job answers it. Returns the message's id.
  const ask = async (text: string, o: { ai?: AiClient; workerId?: string } = {}) => {
    const sent = await send(text, o.workerId);
    if (sent.status !== "sent") throw new Error(`not sent: ${sent.status}`);
    const result = await runInboundMessage(
      {
        firmId: f.firmId,
        messageId: sent.messageId,
        idempotencyKey: `inbound-message:${sent.messageId}`,
      },
      withFirm,
      deps(o.ai),
    );
    return { id: sent.messageId, result };
  };
  const rowsOf = async () =>
    (
      await su.query<{
        id: string;
        direction: string;
        channel: string;
        worker_id: string | null;
        from_e164: string | null;
        to_e164: string | null;
        body: string | null;
        handled_as: string | null;
        intent: string | null;
        reply_to: string | null;
        provider_message_id: string;
      }>(
        `select id::text as id, direction, channel, worker_id::text as worker_id, from_e164, to_e164,
                body, handled_as, intent, reply_to::text as reply_to, provider_message_id
           from messages where firm_id = $1 order by created_at, direction, id`,
        [f.firmId],
      )
    ).rows;
  const eventsOf = async (like: string) =>
    (
      await su.query<{ action: string; actor_type: string; data: Record<string, unknown> }>(
        "select action, actor_type, data from events where firm_id = $1 and action like $2 order by id",
        [f.firmId, like],
      )
    ).rows;
  const ctx = (now = new Date()) => ({
    firm: { id: f.firmId },
    officeUserId: resourcer,
    run: withFirm,
    clock: { now: () => now },
  });
  return { f, kay, slug, name, line, deps, send, ask, rowsOf, eventsOf, ctx };
}

const signOff = (name: string) => `${name} Shift Team`;
const AUTOMATIC = "Automatic reply. Send OFFICE to reach a person.";

describe("a casual's message in the app", () => {
  it("is stored as theirs with no numbers, its words tidied, and one job queued in their group", async () => {
    const t = await appFirm();
    const sent = await t.send("  Is parking free at the arena?\r\nThanks  ");
    expect(sent.status).toBe("sent");
    const [m] = await t.rowsOf();
    expect(m).toMatchObject({
      direction: "in",
      channel: "app",
      worker_id: t.kay,
      from_e164: null,
      to_e164: null,
      body: "Is parking free at the arena?\nThanks",
      handled_as: null,
    });
    expect(m?.provider_message_id).toMatch(/^app:[0-9a-f-]{36}$/);
    const { rows: jobs } = await su.query<{ data: Record<string, unknown>; group_id: string }>(
      `select data, group_id from pgboss.job where name = $1 and data ->> 'messageId' = $2`,
      [INBOUND_MESSAGE_QUEUE, m?.id],
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({ firmId: t.f.firmId, messageId: m?.id });
    // Firm-scoped, as every group is (src/lib/jobs/firm-job.ts).
    expect(jobs[0]?.group_id).toBe(`${t.f.firmId}:w:${t.kay}`);
  });

  it("a send repeated after it seemed to fail (its own id again) stores nothing new; another casual can't claim that id", async () => {
    const t = await appFirm();
    const clientId = "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f8091a2";
    const at = { firmId: t.f.firmId, run: withFirm, secret: SECRET };
    const first = await receiveAppMessage(at, t.kay, "Running late", clientId);
    const again = await receiveAppMessage(at, t.kay, "Running late", clientId);
    expect(first.status).toBe("sent");
    expect(again).toEqual(first);
    const rows = await t.rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider_message_id).toBe(`app:${clientId}`);
    const { rows: jobs } = await su.query(
      "select 1 from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [INBOUND_MESSAGE_QUEUE, t.f.firmId],
    );
    expect(jobs).toHaveLength(1);
    const lee = await t.f.worker({ first: "Lee" });
    expect(await receiveAppMessage(at, lee, "Hello", clientId)).toEqual({ status: "error" });
    expect(await t.rowsOf()).toHaveLength(1);
  });

  it("refuses an empty one and one past 1,600 characters (an emoji counts once), and the 21st in an hour", async () => {
    const t = await appFirm();
    expect(await t.send(" \n\t ")).toEqual({ status: "empty" });
    expect(await t.send("x".repeat(APP_MESSAGE_MAX + 1))).toEqual({ status: "too_long" });
    expect((await t.send("👋".repeat(APP_MESSAGE_MAX))).status).toBe("sent");
    for (let i = 0; i < 19; i += 1) expect((await t.send(`hello ${i}`)).status).toBe("sent");
    expect(await t.send("one more")).toMatchObject({ status: "rate_limited" });
    expect(await t.send("and another")).toMatchObject({ status: "rate_limited" });
    // Logged once, when it was first reached, by the limit's name.
    expect(await t.eventsOf("auth.rate_limited")).toEqual([
      expect.objectContaining({ data: { limit: "app_message:worker" } }),
    ]);
    expect((await t.rowsOf()).filter((r) => r.direction === "in")).toHaveLength(20);
  });

  it("a keyword: answered in the app at once with the WhatsApp words, though automatic replies are off; nothing sent", async () => {
    const t = await appFirm();
    const { id, result } = await t.ask("when do I get paid");
    expect(result).toEqual({ status: "replied", intent: "pay", handledAs: "keyword" });
    const rows = await t.rowsOf();
    expect(rows.find((r) => r.id === id)).toMatchObject({ handled_as: "keyword", intent: "pay" });
    const answer = rows.find((r) => r.direction === "out");
    expect(answer).toMatchObject({
      channel: "app",
      worker_id: t.kay,
      from_e164: null,
      to_e164: null,
      intent: "pay",
      reply_to: id,
      body: `Your hours, rates and pay dates: https://${t.slug}.shiftdesk.test/pay (you'll get a code to log in). ${AUTOMATIC} — ${signOff(t.name)}`,
    });
    expect(answer?.provider_message_id).toMatch(/^app:[0-9a-f-]{36}$/);
    expect(t.line.sent).toEqual([]);
    expect(await t.eventsOf("message.%")).toEqual([
      {
        action: "message.received",
        actor_type: "worker",
        data: { channel: "app", handledAs: "keyword", intent: "pay", workerId: t.kay },
      },
      {
        action: "message.replied",
        actor_type: "system",
        data: { channel: "app", intent: "pay", workerId: t.kay, replyId: answer?.id },
      },
    ]);
  });

  it("shifts: the personal list, as on WhatsApp, with what it was built from logged for the app", async () => {
    const t = await appFirm();
    await t.f.shift({ role: "steward" });
    const { result } = await t.ask("any shifts this week?");
    expect(result).toMatchObject({ status: "replied", intent: "shifts" });
    const answer = (await t.rowsOf()).find((r) => r.direction === "out");
    expect(answer?.body).toMatch(/^Hi Kay, /);
    expect(answer?.body).toContain(`https://${t.slug}.shiftdesk.test/`);
    expect(answer?.body?.endsWith(`\n${AUTOMATIC}\n— ${signOff(t.name)}`)).toBe(true);
    const [checks] = await t.eventsOf("enquiry.checks");
    expect(checks?.data).toMatchObject({ sent: true, channel: "app", workerId: t.kay });
    expect(t.line.sent).toEqual([]);
  });

  it("the AI sorts what no keyword matched, told it's a message in the app; unsorted, it's the office's question with a reference", async () => {
    const t = await appFirm();
    const asked: AiRequest[] = [];
    const ai = createFakeAi((r) => {
      asked.push(r);
      return "pay";
    });
    expect((await t.ask("short changed again?", { ai })).result).toMatchObject({
      status: "replied",
      intent: "pay",
      handledAs: "ai",
    });
    expect(asked[0]).toMatchObject({ purpose: "classify_message", prompt: "short changed again?" });
    expect(asked[0]?.system).toMatch(
      /^You sort a message a casual worker sent to their staffing firm in its app\. /,
    );

    const { id, result } = await t.ask("Can I bring my dog?");
    expect(result).toEqual({ status: "replied", intent: "office", handledAs: "office" });
    const { rows: q } = await su.query<{ id: string; payload: Record<string, unknown> }>(
      "select id::text as id, payload from requests where message_id = $1",
      [id],
    );
    expect(q[0]?.payload).toEqual({ note: "Can I bring my dog?", via: "app" });
    const ref = q[0]?.id.slice(0, 8).toUpperCase();
    const answer = (await t.rowsOf()).filter((r) => r.direction === "out").at(-1);
    expect(answer?.body).toBe(
      `The office will see this and get back to you. Ref ${ref}. ${AUTOMATIC} — ${signOff(t.name)}`,
    );
    expect((await t.eventsOf("request.created")).at(-1)?.data).toEqual({
      type: "general",
      shiftId: null,
      via: "app",
      workerId: t.kay,
    });
    // On Enquiries: waiting for a person, in the app, with how it was answered.
    const page = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(page.rows.map((r) => [r.messageId, r.channel])).toEqual([[id, "app"]]);
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
    expect(e?.channel).toBe("app");
    expect(e?.timeline.received).toMatchObject({ channel: "app", who: { kind: "casual" } });
    expect(e?.timeline.sorted).toEqual({ how: "person", why: "not_sorted", ai: "not_connected" });
    expect(e?.timeline.sent).toMatchObject({ how: "sent", channel: "app" });
    expect(e?.plan).toEqual({ ok: true, channel: "app", form: "free_text" });
    expect(e?.conversation.map((c) => [c.direction, c.channel])).toEqual([
      ["in", "app"],
      ["out", "app"],
    ]);
    // A later message of hers in the app joins the conversation on that page, with its answer.
    const later = await t.ask("Or a cat?");
    const again = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
    expect(again?.conversation.map((c) => [c.direction, c.text?.slice(0, 9)])).toEqual([
      ["in", "Can I bri"],
      ["out", "The offic"],
      ["in", "Or a cat?"],
      ["out", "The offic"],
    ]);
    expect(again?.conversation[2]?.id).toBe(later.id);
  });

  it(`no automatic answer past ${APP_REPLIES_PER_HOUR} in an hour, nor to an echo of ours: it waits for a person`, async () => {
    const t = await appFirm();
    for (let i = 0; i < APP_REPLIES_PER_HOUR; i += 1) {
      expect((await t.ask(`pay ${i}`)).result).toMatchObject({ status: "replied" });
    }
    const { id, result } = await t.ask("pay again");
    expect(result).toEqual({
      status: "held",
      intent: "office",
      sortedAs: "pay",
      handledAs: "keyword",
    });
    const rows = await t.rowsOf();
    expect(rows.filter((r) => r.direction === "out")).toHaveLength(APP_REPLIES_PER_HOUR);
    expect(rows.find((r) => r.id === id)).toMatchObject({
      handled_as: "keyword",
      intent: "office",
    });
    expect((await t.eventsOf("message.received")).at(-1)?.data).toEqual({
      channel: "app",
      handledAs: "keyword",
      intent: "office",
      replyLimit: true,
      sortedAs: "pay",
      workerId: t.kay,
    });
    const limited = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
    expect(limited?.timeline.sorted).toEqual({ how: "person", why: "reply_limit" });
    expect(limited?.timeline.sent).toEqual({ how: "none" });
    expect(limited?.waiting).toBe(true);
    // Past the cap, no keyword: the AI isn't asked (nothing would go), and it's the office's.
    const asked: AiRequest[] = [];
    const ai = createFakeAi((r) => {
      asked.push(r);
      return "shifts";
    });
    expect((await t.ask("is there anything on", { ai })).result).toEqual({
      status: "held",
      intent: "office",
      sortedAs: "office",
      handledAs: "office",
    });
    expect(asked).toEqual([]);

    // An echo (our automatic line quoted back), in another firm with no answers used.
    const u = await appFirm();
    const echo = await u.ask(`"${AUTOMATIC}" what does this mean`);
    expect(echo.result).toEqual({
      status: "held",
      intent: "office",
      sortedAs: "office",
      handledAs: "office",
    });
    expect((await u.rowsOf()).filter((r) => r.direction === "out")).toEqual([]);
    expect((await u.eventsOf("message.received"))[0]?.data).toMatchObject({ echo: true });
    const e = await withFirm(u.f.firmId, (tx) => loadEnquiry(tx, echo.id, new Date()));
    expect(e?.timeline.sorted).toEqual({ how: "person", why: "echo" });
  });

  it("the hour's count is taken again in the claim: an answer another worker gave meanwhile counts", async () => {
    const t = await appFirm();
    for (let i = 0; i < APP_REPLIES_PER_HOUR - 1; i += 1) await t.ask(`pay ${i}`);
    const sent = await t.send("pay?");
    if (sent.status !== "sent") throw new Error("not sent");
    // Between this job's read (4 answers) and its claim, another worker answers one more of hers.
    let calls = 0;
    const meanwhile: WithFirm = async (firmId, fn) => {
      calls += 1;
      if (calls === 3) {
        await su.query(
          `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
           values ($1, 'system', 'message.replied', 'message', gen_random_uuid(),
                   jsonb_build_object('channel', 'app', 'intent', 'pay', 'workerId', $2::text))`,
          [t.f.firmId, t.kay],
        );
      }
      return withFirm(firmId, fn);
    };
    expect(
      await runInboundMessage(
        {
          firmId: t.f.firmId,
          messageId: sent.messageId,
          idempotencyKey: `inbound-message:${sent.messageId}`,
        },
        meanwhile,
        t.deps(),
      ),
    ).toEqual({ status: "held", intent: "office", sortedAs: "pay", handledAs: "keyword" });
    expect((await t.rowsOf()).filter((r) => r.direction === "out")).toHaveLength(
      APP_REPLIES_PER_HOUR - 1,
    );
    expect((await t.eventsOf("message.received")).at(-1)?.data).toMatchObject({
      replyLimit: true,
      sortedAs: "pay",
    });
  });

  it("someone no longer active gets no automatic answer; the last try finds them by the message", async () => {
    const t = await appFirm();
    const sent = await t.send("pay?");
    if (sent.status !== "sent") throw new Error("not sent");
    await su.query("update workers set status = 'inactive' where id = $1", [t.kay]);
    const job = {
      firmId: t.f.firmId,
      messageId: sent.messageId,
      idempotencyKey: `inbound-message:${sent.messageId}`,
    };
    expect(await runInboundMessage(job, withFirm, t.deps())).toMatchObject({ status: "held" });
    expect((await t.eventsOf("message.received"))[0]?.data).toMatchObject({
      formerWorker: true,
      intent: "office",
    });
    expect((await t.rowsOf()).filter((r) => r.direction === "out")).toEqual([]);

    // The last try of a message that keeps failing: passed to a person, theirs by the row.
    const u = await appFirm();
    const again = await u.send("hello");
    if (again.status !== "sent") throw new Error("not sent");
    // The database failing for the try's first call (a lost connection), then back.
    let calls = 0;
    const failingFirstCall: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(
          Object.assign(new Error("terminating connection"), { code: "57P01" }),
        );
      }
      return withFirm(firmId, fn);
    };
    await expect(
      runInboundWithLastTry(
        {
          firmId: u.f.firmId,
          messageId: again.messageId,
          idempotencyKey: `inbound-message:${again.messageId}`,
        },
        failingFirstCall,
        u.deps(),
        { retryCount: 3, retryLimit: 3 },
      ),
    ).rejects.toThrow("terminating connection");
    expect((await u.eventsOf("message.received"))[0]).toMatchObject({
      actor_type: "worker",
      data: {
        channel: "app",
        handledAs: "office",
        intent: "office",
        answerFailed: "57P01",
        workerId: u.kay,
      },
    });
  });

  it("one casual's messages are answered in the order they came, whichever job runs first", async () => {
    const t = await appFirm();
    const first = await t.send("pay");
    const second = await t.send("shifts");
    if (first.status !== "sent" || second.status !== "sent") throw new Error("not sent");
    await runInboundMessage(
      {
        firmId: t.f.firmId,
        messageId: second.messageId,
        idempotencyKey: `inbound-message:${second.messageId}`,
      },
      withFirm,
      t.deps(),
    );
    const answers = (await t.rowsOf()).filter((r) => r.direction === "out");
    expect(answers.map((a) => a.reply_to)).toEqual([first.messageId, second.messageId]);
  });
});

describe("the office's reply in the app", () => {
  const pushes = () => {
    const sent: { endpoint: string; payload: unknown }[] = [];
    const push: PushTransport = {
      name: "record",
      async send(target, payload) {
        sent.push({ endpoint: target.endpoint, payload });
        return { status: "sent" };
      },
    };
    return { push, sent };
  };

  it("shows in their app as soon as it's stored, signed; the job pushes 'The office replied' and logs it shown; nothing by text", async () => {
    const t = await appFirm();
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/kay', 'k', 'a')`,
      [t.f.firmId, t.kay],
    );
    const { id } = await t.ask("Can I bring my dog?");
    expect(await unreadReplies({ firm: { id: t.f.firmId }, run: withFirm }, t.kay)).toBe(0);
    expect(await replyToEnquiry(t.ctx(), id, "  Sorry, no dogs\n on site. ")).toEqual({
      status: "queued",
      channel: "app",
      form: "free_text",
    });
    const reply = (await t.rowsOf()).filter((r) => r.direction === "out").at(-1);
    expect(reply).toMatchObject({
      channel: "app",
      worker_id: t.kay,
      from_e164: null,
      to_e164: null,
      intent: null,
      reply_to: id,
      body: `Sorry, no dogs on site. — ${signOff(t.name)}`,
    });
    expect((await t.eventsOf("enquiry.answered"))[0]?.data).toMatchObject({
      replyId: reply?.id,
      channel: "app",
      form: "free_text",
      workerId: t.kay,
    });
    const { rows: q } = await su.query<{ status: string }>(
      "select status from requests where message_id = $1",
      [id],
    );
    expect(q[0]?.status).toBe("approved");
    // In their thread at once, and the tab counts it.
    const ctx = { firm: { id: t.f.firmId }, run: withFirm };
    expect((await messagesThread(ctx, t.kay)).items.at(-1)).toMatchObject({
      mine: false,
      from: "office",
      text: `Sorry, no dogs on site. — ${signOff(t.name)}`,
    });
    expect(await unreadReplies(ctx, t.kay)).toBe(1);

    // The job: the push to their phone, none of the words; then logged shown.
    const { rows: jobs } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'replyId' = $2",
      [ENQUIRY_REPLY_QUEUE, reply?.id],
    );
    expect(jobs).toHaveLength(1);
    const p = pushes();
    const payload = jobs[0]?.data as Parameters<typeof runEnquiryReply>[0];
    expect(
      await runEnquiryReply(payload, withFirm, { transport: t.line.transport, push: p.push }),
    ).toEqual({ status: "sent", channel: "app" });
    expect(p.sent).toEqual([
      {
        endpoint: "https://push.example.test/kay",
        payload: { title: "The office replied", body: "Tap to read it.", url: "/messages" },
      },
    ]);
    expect((await t.eventsOf("enquiry.reply_%")).map((e) => [e.action, e.data])).toEqual([
      ["enquiry.reply_sending", { replyId: reply?.id, channel: "app", workerId: t.kay }],
      ["enquiry.reply_sent", { replyId: reply?.id, channel: "app", pushes: 1, workerId: t.kay }],
    ]);
    // Once only.
    expect(
      await runEnquiryReply(payload, withFirm, { transport: t.line.transport, push: p.push }),
    ).toEqual({ status: "already" });
    expect(p.sent).toHaveLength(1);
    expect(t.line.sent).toEqual([]);
    // Out of Need a person, and on its page: shown in the app, by the resourcer.
    const e = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
    expect(e?.waiting).toBe(false);
    expect(e?.timeline.then).toEqual([
      expect.objectContaining({
        kind: "office_reply",
        channel: "app",
        state: "sent",
        form: "free_text",
      }),
    ]);

    // Opening Messages marks it read; their own messages and the automatic answers never count.
    const opened = await openMessages(ctx, t.kay);
    expect(opened.items.map((i) => [i.mine, i.from])).toEqual([
      [true, null],
      [false, "automatic"],
      [false, "office"],
    ]);
    expect(opened.answered).toBe(true);
    expect(await unreadReplies(ctx, t.kay)).toBe(0);
    await t.ask("pay");
    expect(await unreadReplies(ctx, t.kay)).toBe(0);
  });

  it("the push job does nothing for an automatic answer (only the office's reply gets a push)", async () => {
    const t = await appFirm();
    await t.ask("pay");
    const answer = (await t.rowsOf()).find((r) => r.direction === "out");
    const p = pushes();
    expect(
      await runEnquiryReply(
        {
          firmId: t.f.firmId,
          idempotencyKey: `enquiry-reply:${answer?.id ?? ""}`,
          replyId: answer?.id ?? "",
        },
        withFirm,
        { transport: t.line.transport, push: p.push },
      ),
    ).toEqual({ status: "gone" });
    expect(p.sent).toEqual([]);
    expect(await t.eventsOf("enquiry.%")).toEqual([]);
  });

  it("with no phone to push to, or no push sender, it's still logged shown (0 pushes)", async () => {
    const t = await appFirm();
    const { id } = await t.ask("Can I swap with Lee?");
    await replyToEnquiry(t.ctx(), id, "Yes, that's fine.");
    const { rows: jobs } = await su.query<{ data: Record<string, unknown> }>(
      "select j.data from pgboss.job j where j.name = $1 and j.data ->> 'firmId' = $2",
      [ENQUIRY_REPLY_QUEUE, t.f.firmId],
    );
    const payload = jobs[0]?.data as Parameters<typeof runEnquiryReply>[0];
    expect(await runEnquiryReply(payload, withFirm, { transport: t.line.transport })).toEqual({
      status: "sent",
      channel: "app",
    });
    expect((await t.eventsOf("enquiry.reply_sent"))[0]?.data).toMatchObject({ pushes: 0 });
  });
});

describe("the messages table, for the app", () => {
  it("an app row never has a number, always has its casual; the shifts line's rows still need theirs", async () => {
    const t = await appFirm();
    const insert = (o: { from?: string | null; to?: string | null; worker?: string | null }) =>
      su.query(
        `insert into messages (firm_id, direction, channel, provider_message_id, worker_id,
                               from_e164, to_e164, body)
         values ($1, 'in', 'app', $2, $3, $4, $5, 'hello')`,
        [
          t.f.firmId,
          `app:${randomUUID()}`,
          o.worker === undefined ? t.kay : o.worker,
          o.from ?? null,
          o.to ?? null,
        ],
      );
    await expect(insert({ from: "+447700900972" })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ to: "+447700900973" })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ worker: null })).rejects.toMatchObject({ code: "23514" });
    // A WhatsApp still needs the number it went to.
    await expect(
      su.query(
        `insert into messages (firm_id, direction, channel, provider_message_id, from_e164)
         values ($1, 'in', 'whatsapp', $2, '+447700900972')`,
        [t.f.firmId, `SM${randomUUID().replaceAll("-", "")}`],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await insert({});
    expect(await t.rowsOf()).toHaveLength(1);
  });
});

describe("another firm's casual", () => {
  it("sees none of these, and can't be written as from another firm", async () => {
    const t = await appFirm();
    const other = await appFirm();
    await t.ask("Can I bring my dog?");
    const theirs = { firm: { id: other.f.firmId }, run: withFirm };
    // Kay's id read inside the other firm: nothing.
    expect((await messagesThread(theirs, t.kay)).items).toEqual([]);
    expect(await unreadReplies(theirs, t.kay)).toBe(0);
    // A message for Kay stored under the other firm: refused by the database (her row isn't there).
    await expect(other.send("hello", t.kay)).rejects.toThrow();
    const page = await withFirm(other.f.firmId, (tx) => loadEnquiries(tx, "all", new Date()));
    expect(page.rows).toEqual([]);
  });

  it("erasing them deletes their messages in the app, the answers and the office's reply, and clears what they'd seen", async () => {
    const t = await appFirm();
    const { id } = await t.ask("Can I bring my dog?");
    await replyToEnquiry(t.ctx(), id, "No dogs, sorry.");
    await openMessages({ firm: { id: t.f.firmId }, run: withFirm }, t.kay);
    const { rows: seen } = await su.query<{ at: Date | null }>(
      "select messages_read_at as at from workers where id = $1",
      [t.kay],
    );
    expect(seen[0]?.at).not.toBeNull();
    const admin = await t.f.office("admin");
    expect(
      await eraseWorker({ firm: { id: t.f.firmId }, officeUserId: admin, run: withFirm }, t.kay),
    ).toMatchObject({ status: "erased" });
    expect(await t.rowsOf()).toEqual([]);
    const { rows: after } = await su.query<{ at: Date | null; erased: Date | null }>(
      "select messages_read_at as at, erased_at as erased from workers where id = $1",
      [t.kay],
    );
    expect(after[0]).toMatchObject({ at: null, erased: expect.any(Date) });
  });

  it("their data export holds their messages in the app and the answers", async () => {
    const t = await appFirm();
    await t.ask("pay");
    const data = await withFirm(t.f.firmId, (tx) => collectWorkerData(tx, t.kay, new Date()));
    expect(data?.sections.messages?.map((m) => [m.direction, m.channel])).toEqual([
      ["in", "app"],
      ["out", "app"],
    ]);
  });
});

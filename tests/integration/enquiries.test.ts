import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, noAi, type AiClient } from "@/lib/ai/client";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveSms, receiveWhatsApp } from "@/lib/inbound/receive";
import { runInboundMessage } from "@/lib/inbound/reply";
import { ChannelRefusedError, type MessagingTransport } from "@/lib/messaging/transport";
import { ENQUIRY_REPLY_QUEUE, runEnquiryReply } from "@/lib/notices/enquiry-reply";
import { loadEnquiries, loadEnquiry, needPersonCount } from "@/lib/office/enquiries";
import { closeEnquiry, replyToEnquiry } from "@/lib/office/enquiry-actions";
import { WHATSAPP_WINDOW_MS } from "@/lib/office/enquiry-rules";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Enquiries (docs/office-v2.md 3.6; 12D.1) on the real database as the app role: the loader that
// joins a message to its replies, its question and the log; each outcome label from what was
// logged; the office's reply (stored, logged without its words, sent by the enquiry-reply job, put
// back when it fails) and "Close without a reply"; WhatsApp's window at exactly 24 hours; the
// 90-day purge clearing a question's link; no postcode beyond the district; another firm's
// messages. No Twilio and no real AI: a capturing transport and a fake AI. Numbers are from
// Ofcom's drama range (07700 900400-900599 for the firms' lines here).

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

const sid = () => `SM${randomBytes(16).toString("hex")}`;
const HOUR = 3_600_000;

let nextLine = Math.floor(Math.random() * 200);
async function freshLine(): Promise<string> {
  nextLine = (nextLine + 1) % 200;
  const line = `+447700900${400 + nextLine}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  return line;
}

async function enquiryFirm() {
  const f = await bookingFirm(su, withFirm);
  const line = await freshLine();
  await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
  const zoe = await f.worker({ first: "Zoe" });
  const { rows } = await su.query<{ mobile: string; name: string }>(
    `select w.mobile_e164 as mobile, f.name from workers w join firms f on f.id = w.firm_id
      where w.id = $1`,
    [zoe],
  );
  const mobile = rows[0]?.mobile ?? "";
  const firmName = rows[0]?.name ?? "";
  const resourcer = await f.office("resourcer");
  // One capturing transport for the firm's automatic replies: its ids count up, as a provider's
  // are unique.
  const line_ = captureTransport();
  const deps = (transport: MessagingTransport, ai: AiClient = noAi) => ({
    transport,
    ai,
    baseDomain: "shiftdesk.test",
    aiTimeoutMs: 200,
  });
  // A WhatsApp (or text) stored as the webhook would, then (unless `answer` is false) the shifts
  // line's job answers it. Returns the message's id.
  const incoming = async (
    body: string | null,
    o: {
      from?: string;
      sms?: boolean;
      transport?: MessagingTransport;
      ai?: AiClient;
      answer?: boolean;
    } = {},
  ) => {
    const messageSid = sid();
    const m = { messageSid, from: o.from ?? mobile, to: line, body };
    if (o.sms) await receiveSms(f.firmId, { ...m, twilioOptOut: null }, { run: withFirm });
    else await receiveWhatsApp(f.firmId, m, { run: withFirm });
    const { rows: found } = await su.query<{ id: string }>(
      "select id::text as id from messages where firm_id = $1 and provider_message_id = $2",
      [f.firmId, messageSid],
    );
    const messageId = found[0]?.id ?? "";
    if (o.answer !== false) {
      await runInboundMessage(
        { firmId: f.firmId, messageId, idempotencyKey: `inbound-message:${messageId}` },
        withFirm,
        deps(o.transport ?? line_.transport, o.ai),
      );
    }
    return messageId;
  };
  const ctx = (now = new Date(), officeUserId = resourcer) => ({
    firm: { id: f.firmId },
    officeUserId,
    run: withFirm,
    clock: { now: () => now },
  });
  const eventsOf = async (like: string) =>
    (
      await su.query<{ action: string; actor_type: string; data: Record<string, unknown> }>(
        "select action, actor_type, data from events where firm_id = $1 and action like $2 order by id",
        [f.firmId, like],
      )
    ).rows;
  const replyJob = async (replyId: string) => {
    const { rows: jobs } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'replyId' = $2",
      [ENQUIRY_REPLY_QUEUE, replyId],
    );
    expect(jobs).toHaveLength(1);
    return jobs[0]?.data as { firmId: string; idempotencyKey: string; replyId: string };
  };
  const createdAt = async (messageId: string) =>
    new Date(
      (
        await su.query<{ at: Date }>("select created_at as at from messages where id = $1", [
          messageId,
        ])
      ).rows[0]?.at ?? 0,
    );
  const load = (view: "all" | "person" | "pay", now = new Date()) =>
    withFirm(f.firmId, (tx) => loadEnquiries(tx, view, now));
  const detail = (messageId: string, now = new Date()) =>
    withFirm(f.firmId, (tx) => loadEnquiry(tx, messageId, now));
  return {
    f,
    line,
    zoe,
    mobile,
    firmName,
    resourcer,
    incoming,
    ctx,
    eventsOf,
    replyJob,
    createdAt,
    load,
    detail,
  };
}

// A number that isn't one of the firm's casuals' (07700 900900-900999, never Zoe's).
const strangerFor = (casual: string) => {
  for (;;) {
    const n = `+447700900${900 + Math.floor(Math.random() * 100)}`;
    if (n !== casual) return n;
  }
};

describe("the loader joins a message to its replies, its question and the log", () => {
  it("a question for the office: linked by message_id, its reply on the conversation, waiting for a person", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("Is parking free at the festival?");
    // The question points at the message (S5), and the payload no longer holds its id.
    const { rows: q } = await su.query<{ id: string; message_id: string; payload: unknown }>(
      "select id::text as id, message_id::text as message_id, payload from requests where firm_id = $1",
      [t.f.firmId],
    );
    expect(q).toEqual([
      {
        id: expect.any(String),
        message_id: asked,
        payload: { note: "Is parking free at the festival?", via: "whatsapp" },
      },
    ]);
    const e = await t.detail(asked);
    expect(e).toMatchObject({
      outcome: "person_waiting",
      waiting: true,
      forAPerson: true,
      who: { kind: "casual", name: "Zoe Booker", workerId: t.zoe },
      question: { requestId: q[0]?.id, status: "open" },
      ref: q[0]?.id.slice(0, 8).toUpperCase(),
    });
    expect(e?.conversation.map((c) => [c.direction, c.text])).toEqual([
      ["in", "Is parking free at the festival?"],
      [
        "out",
        `The office will see this and get back to you. Ref ${q[0]?.id.slice(0, 8).toUpperCase()}. Automatic reply. Send OFFICE to reach a person. — ${t.firmName} Shift Team`,
      ],
    ]);
    expect(e?.timeline).toMatchObject({
      received: { channel: "whatsapp" },
      sorted: { how: "person", why: "not_sorted" },
      reply: { how: "automatic", intent: "office" },
      sent: { how: "sent", channel: "whatsapp", fellBackFrom: null },
      then: [],
    });
    expect((await t.load("person")).rows.map((r) => r.messageId)).toEqual([asked]);
    expect((await t.load("all")).needPerson.count).toBe(1);
  });

  it("a reply sent by text after WhatsApp refused it, and a reply that failed", async () => {
    const t = await enquiryFirm();
    const refusing: MessagingTransport = {
      name: "refuses-whatsapp",
      async send(m) {
        if (m.channel === "whatsapp") throw new ChannelRefusedError("whatsapp");
        return { providerMessageId: `text-${Date.now()}` };
      },
    };
    const byText = await t.incoming("shifts please", { transport: refusing });
    const e = await t.detail(byText);
    expect(e?.timeline.sent).toMatchObject({
      how: "sent",
      channel: "sms",
      fellBackFrom: "whatsapp",
    });
    expect(e?.conversation.map((c) => [c.direction, c.channel])).toEqual([
      ["in", "whatsapp"],
      ["out", "sms"],
    ]);
    expect(e?.outcome).toBe("keyword");

    const broken: MessagingTransport = {
      name: "broken",
      async send() {
        throw new Error("network down");
      },
    };
    const lost = await t.incoming("my pay please", { transport: broken });
    const f = await t.detail(lost);
    expect(f?.timeline.sent).toMatchObject({ how: "failed", channel: "whatsapp" });
    expect(f?.conversation.map((c) => c.direction)).toEqual(["in"]); // nothing stored as sent
    expect(f).toMatchObject({ outcome: "pay", pay: true });
    expect((await t.load("pay")).rows.map((r) => r.messageId)).toEqual([lost]);
  });
});

describe("each outcome label comes from what was logged", () => {
  it("keyword, AI, pay, a person, done in the app, not understood", async () => {
    const t = await enquiryFirm();
    const keyword = await t.incoming("any shifts this weekend?");
    const ai = await t.incoming("cant make tmrw, car broke down", {
      ai: createFakeAi(() => "cancel"),
    });
    const pay = await t.incoming("when do I get paid");
    const person = await t.incoming("office please");
    const unsorted = await t.incoming("hello?", { answer: false });
    // Zoe took a shift in the app after the keyword reply (logged as the booking code logs it).
    const shift = await t.f.shift();
    await su.query(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data)
       values ($1, 'worker', $2, 'shift.assigned', 'assignment', gen_random_uuid(), $3)`,
      [t.f.firmId, t.zoe, JSON.stringify({ by: "worker", shiftId: shift, workerId: t.zoe })],
    );
    const rows = (await t.load("all")).rows;
    const outcome = (id: string) => rows.find((r) => r.messageId === id)?.outcome;
    // Every message after the keyword one is within a day of the booking too, but only shifts
    // and cancel replies can be "done in the app".
    expect([keyword, ai, pay, person, unsorted].map(outcome)).toEqual([
      "in_app",
      "in_app",
      "pay",
      "person_waiting",
      "not_understood",
    ]);
    const k = await t.detail(keyword);
    expect(k?.timeline.sorted).toEqual({ how: "keyword", intent: "shifts" });
    expect(k?.timeline.then).toMatchObject([
      { kind: "in_app", action: "booked", shift: { shiftId: shift, role: "door_supervisor" } },
    ]);
    expect((await t.detail(ai))?.timeline.sorted).toEqual({ how: "ai", intent: "cancel" });
    expect((await t.detail(person))?.timeline.sorted).toEqual({ how: "person", why: "asked" });
    expect((await t.detail(unsorted))?.timeline.sorted).toEqual({ how: "not_yet" });

    // A booking by the office doesn't count as done in the app.
    const other = await enquiryFirm();
    const asked = await other.incoming("any shifts?");
    await su.query(
      `insert into events (firm_id, actor_type, actor_id, action, entity_type, entity_id, data)
       values ($1, 'office', $2, 'shift.assigned', 'assignment', gen_random_uuid(), $3)`,
      [
        other.f.firmId,
        other.resourcer,
        JSON.stringify({ by: "firm", shiftId: await other.f.shift(), workerId: other.zoe }),
      ],
    );
    expect((await other.load("all")).rows.find((r) => r.messageId === asked)?.outcome).toBe(
      "keyword",
    );
  });

  it("why the AI didn't sort it, through the shifts line's job: logged, then on the page", async () => {
    const t = await enquiryFirm();
    // The helper gives the AI 200 ms (deps' aiTimeoutMs).
    const slow = createFakeAi(
      () => new Promise<string>((done) => setTimeout(() => done("cancel"), 1_000)),
    );
    const broken = createFakeAi(() => {
      throw new Error("the AI service failed");
    });
    const odd = createFakeAi(() => "banana");
    const cases = [
      [await t.incoming("question about my uniform", { ai: slow }), "no_answer"],
      [await t.incoming("question about my badge", { ai: broken }), "no_answer"],
      [await t.incoming("question about parking", { ai: odd }), "not_a_label"],
      [await t.incoming("question about the rota", { ai: noAi }), "not_connected"],
    ] as const;
    const received = await t.eventsOf("message.received");
    for (const [id, ai] of cases) {
      expect((await t.detail(id))?.timeline.sorted, ai).toEqual({
        how: "person",
        why: "not_sorted",
        ai,
      });
    }
    expect(received.map((e) => e.data.aiFallback)).toEqual([
      "no_answer",
      "no_answer",
      "not_a_label",
      "not_connected",
    ]);
    // A photo with no words is never shown to the AI: "no_text", whatever the AI would say.
    let asked = 0;
    const photo = await t.incoming(null, {
      ai: createFakeAi(() => {
        asked += 1;
        return "cancel";
      }),
    });
    expect(asked).toBe(0);
    expect((await t.eventsOf("message.received")).at(-1)?.data.aiFallback).toBe("no_text");
    expect((await t.detail(photo))?.timeline.sorted).toEqual({ how: "person", why: "no_text" });
  });
});

describe("the office's reply", () => {
  it("an unknown number: stored with reply_to and no casual, logged without the words, sent by the job; it leaves Need a person", async () => {
    const t = await enquiryFirm();
    const stranger = strangerFor(t.mobile);
    const asked = await t.incoming("Hi it's Sam, new phone", { from: stranger });
    expect(await withFirm(t.f.firmId, (tx) => needPersonCount(tx, new Date()))).toBe(1);
    expect((await t.detail(asked))?.who).toEqual({ kind: "unknown", from: stranger });

    const words = "Thanks Sam, we'll update your number now.";
    expect(await replyToEnquiry(t.ctx(), asked, `  ${words}\n`)).toEqual({
      status: "queued",
      channel: "whatsapp",
      form: "free_text",
    });
    const { rows: out } = await su.query<{
      id: string;
      direction: string;
      worker_id: string | null;
      reply_to: string;
      from_e164: string;
      to_e164: string;
      body: string;
      provider_message_id: string;
    }>(
      `select id::text as id, direction, worker_id::text as worker_id, reply_to::text as reply_to,
              from_e164, to_e164, body, provider_message_id
         from messages where firm_id = $1 and reply_to = $2 and provider_message_id like 'office-reply:%'`,
      [t.f.firmId, asked],
    );
    expect(out).toEqual([
      {
        id: expect.any(String),
        direction: "out",
        worker_id: null,
        reply_to: asked,
        from_e164: t.line,
        to_e164: stranger,
        body: `${words} — ${t.firmName} Shift Team`,
        provider_message_id: expect.stringMatching(/^office-reply:[0-9a-f-]{36}$/),
      },
    ]);
    const replyId = out[0]?.id ?? "";
    const answered = await t.eventsOf("enquiry.%");
    expect(answered).toEqual([
      {
        action: "enquiry.answered",
        actor_type: "office",
        data: { replyId, channel: "whatsapp", form: "free_text" },
      },
    ]);
    expect(JSON.stringify(answered)).not.toContain("Thanks Sam");
    expect(await withFirm(t.f.firmId, (tx) => needPersonCount(tx, new Date()))).toBe(0);

    // The job sends it once, from the line, and the row gets the provider's id (its own ids, apart
    // from the automatic replies' capture: a provider's ids are unique).
    const capture = captureTransport();
    const sent = capture.sent;
    const transport: MessagingTransport = {
      name: "capture",
      send: async (m) => ({
        providerMessageId: `job-${(await capture.transport.send(m)).providerMessageId}`,
      }),
    };
    const payload = await t.replyJob(replyId);
    expect(await runEnquiryReply(payload, withFirm, { transport })).toEqual({
      status: "sent",
      channel: "whatsapp",
    });
    expect(await runEnquiryReply(payload, withFirm, { transport })).toEqual({ status: "already" });
    expect(sent).toEqual([
      {
        channel: "whatsapp",
        to: stranger,
        from: t.line,
        body: `${words} — ${t.firmName} Shift Team`,
      },
    ]);
    const { rows: after } = await su.query<{ provider_message_id: string }>(
      "select provider_message_id from messages where id = $1",
      [replyId],
    );
    expect(after[0]?.provider_message_id).toBe("job-capture-1");
    expect((await t.eventsOf("enquiry.%")).map((e) => e.action)).toEqual([
      "enquiry.answered",
      "enquiry.reply_sending",
      "enquiry.reply_sent",
    ]);
    const e = await t.detail(asked);
    expect(e).toMatchObject({ outcome: "person_answered", waiting: false });
    expect(e?.conversation.at(-1)).toMatchObject({
      direction: "out",
      officeReply: { by: "Office Person", state: "sent" },
    });
    expect(e?.timeline.then).toMatchObject([
      { kind: "office_reply", by: "Office Person", state: "sent", form: "free_text" },
    ]);
    // Answered already: a second reply or a close is refused.
    expect(await replyToEnquiry(t.ctx(), asked, "Again")).toEqual({ status: "not_waiting" });
    expect(await closeEnquiry(t.ctx(), asked, "spam")).toEqual({ status: "not_waiting" });
  });

  it("outside the window: the template; a question answered; a failed send puts it back", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("Can I bring a friend?");
    const later = new Date((await t.createdAt(asked)).getTime() + 25 * HOUR);
    expect(await replyToEnquiry(t.ctx(later), asked, "Sorry, no plus-ones.")).toMatchObject({
      form: "template",
      channel: "whatsapp",
    });
    const { rows: q } = await su.query<{
      id: string;
      status: string;
      resolution_note: string;
      resolved_by: string;
    }>(
      "select id::text as id, status, resolution_note, resolved_by::text as resolved_by from requests where firm_id = $1",
      [t.f.firmId],
    );
    expect(q[0]).toMatchObject({
      status: "approved",
      resolution_note: "Sorry, no plus-ones.",
      resolved_by: t.resourcer,
    });
    const ref = q[0]?.id.slice(0, 8).toUpperCase();
    const { rows: out } = await su.query<{ id: string; body: string }>(
      "select id::text as id, body from messages where reply_to = $1 and provider_message_id like 'office-reply:%'",
      [asked],
    );
    expect(out[0]?.body).toBe(
      `Your request (question, ref ${ref}) is answered. The office says: Sorry, no plus-ones. — ${t.firmName} Shift Team`,
    );
    expect(await withFirm(t.f.firmId, (tx) => needPersonCount(tx, later))).toBe(0);

    const broken: MessagingTransport = {
      name: "broken",
      async send() {
        throw new Error("network down");
      },
    };
    const payload = await t.replyJob(out[0]?.id ?? "");
    expect(await runEnquiryReply(payload, withFirm, { transport: broken })).toMatchObject({
      status: "failed",
    });
    expect((await t.eventsOf("enquiry.reply_failed"))[0]?.data).toMatchObject({
      replyId: out[0]?.id,
      requestId: q[0]?.id,
      code: expect.any(String),
    });
    // The question is open again and the message back in Need a person.
    const { rows: reopened } = await su.query<{ status: string; resolved_by: string | null }>(
      "select status, resolved_by from requests where id = $1",
      [q[0]?.id],
    );
    expect(reopened[0]).toEqual({ status: "open", resolved_by: null });
    expect(await withFirm(t.f.firmId, (tx) => needPersonCount(tx, later))).toBe(1);
    const e = await t.detail(asked, later);
    expect(e).toMatchObject({ outcome: "person_waiting", waiting: true });
    expect(e?.timeline.then).toMatchObject([{ kind: "office_reply", state: "failed" }]);
    expect(e?.conversation.at(-1)).toMatchObject({ officeReply: { state: "failed" } });
    // So it can be answered again.
    expect(await replyToEnquiry(t.ctx(later), asked, "Sorry, no plus-ones.")).toMatchObject({
      status: "queued",
    });
  });

  it("WhatsApp's window at exactly 24 hours: free text a moment before, the template at 24 hours", async () => {
    const t = await enquiryFirm();
    const first = await t.incoming("office: a question");
    const second = await t.incoming("office: another question");
    const at = await t.createdAt(second); // their latest WhatsApp: the window runs from it
    expect(
      await replyToEnquiry(t.ctx(new Date(at.getTime() + WHATSAPP_WINDOW_MS - 1)), first, "Yes."),
    ).toMatchObject({ form: "free_text" });
    expect(
      await replyToEnquiry(t.ctx(new Date(at.getTime() + WHATSAPP_WINDOW_MS)), second, "Yes."),
    ).toMatchObject({ form: "template" });
  });

  it("a text: by text in their words, never after STOP; two people at once: one reply", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("office: I'll be late", { sms: true });
    const both = await Promise.all([
      replyToEnquiry(t.ctx(), asked, "Thanks for letting us know."),
      replyToEnquiry(t.ctx(new Date(), await t.f.office("admin")), asked, "Noted."),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual(["not_waiting", "queued"]);
    expect(both.find((r) => r.status === "queued")).toMatchObject({
      channel: "sms",
      form: "free_text",
    });
    const { rows } = await su.query<{ body: string }>(
      "select body from messages where reply_to = $1 and provider_message_id like 'office-reply:%'",
      [asked],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toMatch(new RegExp(` - ${t.firmName} Shift Team$`));

    const stopped = await t.incoming("office: call me", { sms: true });
    await su.query("update workers set sms_opted_out_at = now() where id = $1", [t.zoe]);
    expect(await replyToEnquiry(t.ctx(), stopped, "Will do.")).toEqual({ status: "texts_off" });
  });

  it("refuses an empty or long reply, payroll, and another firm's message", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("office please");
    expect(await replyToEnquiry(t.ctx(), asked, " \n ")).toEqual({ status: "empty" });
    expect(await replyToEnquiry(t.ctx(), asked, "x".repeat(501))).toEqual({ status: "too_long" });
    expect(
      await replyToEnquiry(t.ctx(new Date(), await t.f.office("payroll")), asked, "Hi"),
    ).toEqual({ status: "not_allowed" });
    const other = await enquiryFirm();
    expect(await replyToEnquiry(other.ctx(), asked, "Hi")).toEqual({ status: "not_found" });
    expect(await closeEnquiry(other.ctx(), asked, "spam")).toEqual({ status: "not_found" });
    // Another firm's list and detail never show it.
    expect((await other.load("all")).rows.map((r) => r.messageId)).not.toContain(asked);
    expect(await other.detail(asked)).toBeNull();
    expect(await t.eventsOf("enquiry.%")).toEqual([]);
  });
});

describe("Close without a reply", () => {
  it("an unknown number closed as spam: a code in the log, never typed text; it leaves Need a person", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("WIN A PRIZE click here", { from: strangerFor(t.mobile) });
    expect(await closeEnquiry(t.ctx(), asked, "spam")).toEqual({ status: "closed" });
    expect(await t.eventsOf("enquiry.%")).toEqual([
      { action: "enquiry.closed", actor_type: "office", data: { reason: "spam" } },
    ]);
    expect(await withFirm(t.f.firmId, (tx) => needPersonCount(tx, new Date()))).toBe(0);
    const e = await t.detail(asked);
    expect(e).toMatchObject({ outcome: "person_answered", waiting: false });
    expect(e?.timeline.then).toMatchObject([
      { kind: "closed", by: "Office Person", reason: "spam" },
    ]);
    // No reply went, and nothing more to close.
    const { rows } = await su.query(
      "select 1 from messages where reply_to = $1 and provider_message_id like 'office-reply:%'",
      [asked],
    );
    expect(rows).toHaveLength(0);
    expect(await closeEnquiry(t.ctx(), asked, "other")).toEqual({ status: "not_waiting" });
    // Only the fixed codes.
    const another = await t.incoming("hello", { from: strangerFor(t.mobile) });
    expect(await closeEnquiry(t.ctx(), another, "because I said so" as unknown as "spam")).toEqual({
      status: "invalid",
    });
  });

  it("a casual's question closed as dealt with by phone: answered, and nobody is messaged", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("office: ring me please");
    expect(await closeEnquiry(t.ctx(), asked, "by_phone")).toEqual({ status: "closed" });
    const { rows } = await su.query<{ id: string; status: string; resolution_note: string | null }>(
      "select id::text as id, status, resolution_note from requests where message_id = $1",
      [asked],
    );
    expect(rows[0]).toMatchObject({ status: "approved", resolution_note: null });
    expect(await t.eventsOf("enquiry.%")).toEqual([
      {
        action: "enquiry.closed",
        actor_type: "office",
        data: { reason: "by_phone", workerId: t.zoe, requestId: rows[0]?.id },
      },
    ]);
    const { rows: jobs } = await su.query(
      "select 1 from pgboss.job where name in ('enquiry-reply', 'request-update') and data ->> 'firmId' = $1",
      [t.f.firmId],
    );
    expect(jobs).toHaveLength(0);
  });
});

describe("what the office can see", () => {
  it("never more of a casual's home than the district (here: nothing of it)", async () => {
    const t = await enquiryFirm();
    await su.query(
      `insert into worker_travel (firm_id, worker_id, start_postcode, lat, lng, modes, max_minutes,
                                  privacy_notice_version, updated_at)
       values ($1, $2, 'ZZ9 9ZZ', 53.83, -1.53, 'both', 45, 'travel-v1', now())`,
      [t.f.firmId, t.zoe],
    );
    const asked = await t.incoming("any shifts near me?");
    await t.incoming("office: where do I park?");
    const out = JSON.stringify([
      await t.load("all"),
      await t.load("person"),
      await t.detail(asked),
    ]);
    expect(out).toContain("Zoe Booker");
    expect(out).not.toContain("ZZ9 9");
    expect(out).not.toContain("ZZ9");
  });

  it("a voicemail from a withheld number can only be closed", async () => {
    const t = await enquiryFirm();
    const { rows } = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, to_e164, body,
                             handled_at, handled_as, intent)
       values ($1, 'in', 'voice', $2, $3, 'Call me back about Saturday', now(), 'office', 'office')
       returning id::text as id`,
      [t.f.firmId, `RE${randomBytes(16).toString("hex")}`, t.line],
    );
    const asked = rows[0]?.id ?? "";
    const e = await t.detail(asked);
    expect(e).toMatchObject({
      who: { kind: "withheld" },
      voicemail: true,
      waiting: true,
      plan: { ok: false, why: "withheld" },
    });
    expect(e?.timeline.sorted).toEqual({ how: "person", why: "voicemail" });
    expect(await replyToEnquiry(t.ctx(), asked, "Hi")).toEqual({ status: "withheld" });
    expect(await closeEnquiry(t.ctx(), asked, "other")).toEqual({ status: "closed" });
  });

  it("a bare call isn't an enquiry; a message older than 90 days isn't shown", async () => {
    const t = await enquiryFirm();
    await su.query(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164, handled_at)
       values ($1, 'in', 'voice', $2, $3, $4, now())`,
      [t.f.firmId, `CA${randomBytes(16).toString("hex")}`, t.mobile, t.line],
    );
    const old = await t.incoming("office: old question");
    await su.query("update messages set created_at = now() - interval '91 days' where id = $1", [
      old,
    ]);
    expect((await t.load("all")).rows).toEqual([]);
    expect(await t.detail(old)).toBeNull();
  });

  it("a firm that keeps messages longer: the office can reply and close for as long as it keeps them", async () => {
    const t = await enquiryFirm();
    await su.query(
      `update firms set settings = jsonb_set(settings, '{retention}', '{"message_days": 200}')
        where id = $1`,
      [t.f.firmId],
    );
    const age = (id: string, days: number) =>
      su.query(`update messages set created_at = now() - make_interval(days => $2) where id = $1`, [
        id,
        days,
      ]);
    const [toReply, toClose, tooOld] = [
      await t.incoming("office: an old question"),
      await t.incoming("office: another old question"),
      await t.incoming("office: a very old question"),
    ];
    await age(toReply, 120);
    await age(toClose, 120);
    await age(tooOld, 201);
    expect(await replyToEnquiry(t.ctx(), toReply, "Sorry for the wait.")).toMatchObject({
      status: "queued",
    });
    expect(await closeEnquiry(t.ctx(), toClose, "by_phone")).toEqual({ status: "closed" });
    // Past the firm's 200 days it isn't waiting any more (off the list too): neither.
    expect(await replyToEnquiry(t.ctx(), tooOld, "Sorry.")).toEqual({ status: "not_waiting" });
    expect(await closeEnquiry(t.ctx(), tooOld, "spam")).toEqual({ status: "not_waiting" });
  });

  it("a firm that keeps messages longer: shown for as long as it keeps them", async () => {
    const t = await enquiryFirm();
    await su.query(
      `update firms set settings = jsonb_set(settings, '{retention}', '{"message_days": 200}')
        where id = $1`,
      [t.f.firmId],
    );
    const old = await t.incoming("office: an old question");
    const age = (days: number) =>
      su.query(`update messages set created_at = now() - make_interval(days => $2) where id = $1`, [
        old,
        days,
      ]);
    const badge = () => withFirm(t.f.firmId, (tx) => needPersonCount(tx, new Date()));
    await age(120);
    expect((await t.load("all")).rows.map((r) => r.messageId)).toEqual([old]);
    expect((await t.load("person")).rows.map((r) => r.messageId)).toEqual([old]);
    expect((await t.detail(old))?.messageId).toBe(old);
    expect(await badge()).toBe(1);
    // Past the firm's 200 days: gone from Enquiries too.
    await age(201);
    expect((await t.load("all")).rows).toEqual([]);
    expect(await t.detail(old)).toBeNull();
    expect(await badge()).toBe(0);
  });
});

describe("where a reply goes from, and who never gets one", () => {
  it("from the firm's shifts line now, never the number an old message came in on", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("office: about my old shift");
    // The firm moves to a new line (the old number may go to another firm).
    const newLine = await freshLine();
    await su.query("update firms set shifts_line_e164 = $2 where id = $1", [t.f.firmId, newLine]);
    // Their WhatsApp was to the old line: no window on the new one, so the template.
    expect((await t.detail(asked))?.plan).toEqual({
      ok: true,
      channel: "whatsapp",
      form: "template",
    });
    expect(await replyToEnquiry(t.ctx(), asked, "Sorted now.")).toMatchObject({
      form: "template",
    });
    const { rows } = await su.query<{ from_e164: string; to_e164: string }>(
      "select from_e164, to_e164 from messages where reply_to = $1 and provider_message_id like 'office-reply:%'",
      [asked],
    );
    expect(rows).toEqual([{ from_e164: newLine, to_e164: t.mobile }]);

    // No line at all: no reply.
    const other = await enquiryFirm();
    const q = await other.incoming("office: hello");
    await su.query("update firms set shifts_line_e164 = null where id = $1", [other.f.firmId]);
    expect(await replyToEnquiry(other.ctx(), q, "Hi")).toEqual({ status: "no_line" });
  });

  it("a number that isn't a casual's and texted STOP is never texted; a caller we don't know never messaged", async () => {
    const t = await enquiryFirm();
    const stranger = strangerFor(t.mobile);
    await t.incoming("STOP", { from: stranger, sms: true });
    const asked = await t.incoming("is this the shifts line?", { from: stranger, sms: true });
    expect((await t.detail(asked))?.plan).toEqual({ ok: false, why: "texts_off" });
    expect(await replyToEnquiry(t.ctx(), asked, "Yes it is.")).toEqual({ status: "texts_off" });
    // START again: texts allowed.
    await t.incoming("START", { from: stranger, sms: true });
    expect(await replyToEnquiry(t.ctx(), asked, "Yes it is.")).toMatchObject({
      status: "queued",
      channel: "sms",
    });

    // A voicemail from a number nobody here has: the office phones back instead.
    const caller = strangerFor(t.mobile);
    const { rows } = await su.query<{ id: string }>(
      `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164,
                             body, handled_at, handled_as)
       values ($1, 'in', 'voice', $2, $3, $4, 'Ring me about work', now(), 'unknown')
       returning id::text as id`,
      [t.f.firmId, `RE${randomBytes(16).toString("hex")}`, caller, t.line],
    );
    const voicemail = rows[0]?.id ?? "";
    expect((await t.detail(voicemail))?.plan).toEqual({ ok: false, why: "unknown_caller" });
    expect(await replyToEnquiry(t.ctx(), voicemail, "Hi")).toEqual({ status: "unknown_caller" });
    expect(await closeEnquiry(t.ctx(), voicemail, "by_phone")).toEqual({ status: "closed" });
  });

  it("closing a casual's question as not for us: sorted (never a bare Declined), nobody messaged", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("office: can you lend me a tenner");
    expect(await closeEnquiry(t.ctx(), asked, "not_for_us")).toEqual({ status: "closed" });
    const { rows } = await su.query<{ status: string; resolved_by: string }>(
      "select status, resolved_by::text as resolved_by from requests where message_id = $1",
      [asked],
    );
    expect(rows).toEqual([{ status: "auto_resolved", resolved_by: t.resourcer }]);
  });

  it("a reply still sending 15 minutes on reads as not confirmed", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("office: a question");
    await replyToEnquiry(t.ctx(), asked, "Answer.");
    const soon = await t.detail(asked, new Date(Date.now() + 60_000));
    expect(soon?.timeline.then).toMatchObject([{ kind: "office_reply", state: "sending" }]);
    const later = await t.detail(asked, new Date(Date.now() + 16 * 60_000));
    expect(later?.timeline.then).toMatchObject([{ kind: "office_reply", state: "unconfirmed" }]);
    expect(later?.conversation.at(-1)).toMatchObject({ officeReply: { state: "unconfirmed" } });
    // Still answered: never sent twice.
    expect(later?.waiting).toBe(false);
  });
});

describe("the 90-day purge and a question's link (S5)", () => {
  it("deleting the message clears requests.message_id only: the question stays", async () => {
    const t = await enquiryFirm();
    const asked = await t.incoming("office: is there parking?");
    await su.query(
      "update messages set created_at = now() - interval '100 days' where reply_to = $1 or id = $1",
      [asked],
    );
    const purged = await withFirm(t.f.firmId, async (tx) => {
      const { rows } = await tx.execute<{ n: number }>(
        // The app role calls the owner's purge, as the nightly job does.
        sql`select app_purge_old_messages() as n`,
      );
      return rows[0]?.n;
    });
    expect(purged).toBe(2); // the message and its reply
    const { rows } = await su.query<{ message_id: string | null; payload: unknown }>(
      "select message_id, payload from requests where firm_id = $1",
      [t.f.firmId],
    );
    expect(rows).toEqual([
      { message_id: null, payload: { note: "office: is there parking?", via: "whatsapp" } },
    ]);
  });
});

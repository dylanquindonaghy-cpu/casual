import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, noAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import { createLineDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import {
  OFFICE_ALERTS_COMBINED_QUEUE,
  runOfficeAlertsCombined,
} from "@/lib/inbound/alerts-combined";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import { receiveWhatsApp } from "@/lib/inbound/receive";
import { runInboundMessage } from "@/lib/inbound/reply";
import { loadEnquiries, loadEnquiry } from "@/lib/office/enquiries";
import { twilioSignature } from "@/lib/inbound/twilio-signature";
import { handleTwilioWhatsApp, MAX_WEBHOOK_BYTES } from "@/lib/inbound/webhook";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// WhatsApps on the shifts line (Phase 7): Twilio's webhook (src/lib/inbound/webhook.ts) and the
// reply job (src/lib/inbound/reply.ts), on the real database as the app role. No Twilio and no
// real AI: signed requests are built with a test key, replies go to a capturing transport, and a
// fake AI acts out the classifier. Numbers are from Ofcom's drama range (07700 900600-900999 for
// the firms' lines here, so the seed's line and other tests' never clash).

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

const TOKEN = "test-twilio-auth-token-0123456789";
const WEBHOOK = "https://shiftdesk.test/api/webhooks/twilio/whatsapp";
const sid = () => `SM${randomBytes(16).toString("hex")}`;

let nextLine = Math.floor(Math.random() * 400);
async function freshLine(): Promise<string> {
  nextLine = (nextLine + 1) % 400;
  const line = `+447700900${600 + nextLine}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  return line;
}

// `repliesOff`: the firm's own default since P4.7 (nothing set: no automatic replies).
async function lineFirm(o: { repliesOff?: true } = {}) {
  // Automatic replies on: what these tests are about (off by default since P4.7).
  const f = await bookingFirm(su, withFirm, {
    settings: o.repliesOff ? {} : { auto_replies: true },
  });
  const line = await freshLine();
  await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
  const ann = await f.worker({ first: "Ann" });
  const { rows } = await su.query<{ mobile: string; slug: string; name: string }>(
    `select w.mobile_e164 as mobile, f.slug, f.name from workers w join firms f on f.id = w.firm_id
      where w.id = $1`,
    [ann],
  );
  const { mobile = "", slug = "", name = "" } = rows[0] ?? {};
  const messageRows = async () =>
    (
      await su.query<{
        id: string;
        direction: string;
        worker_id: string | null;
        from_e164: string;
        to_e164: string;
        body: string | null;
        handled_as: string | null;
        intent: string | null;
        reply_to: string | null;
      }>(
        `select id::text as id, direction, worker_id::text as worker_id, from_e164, to_e164, body,
                handled_as, intent, reply_to::text as reply_to
           from messages where firm_id = $1 order by created_at, direction`,
        [f.firmId],
      )
    ).rows;
  const jobs = async () =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
        [INBOUND_MESSAGE_QUEUE, f.firmId],
      )
    ).rows.map((r) => r.data);
  const eventsOf = async (like: string) =>
    (
      await su.query<{ action: string; actor_type: string; data: Record<string, unknown> }>(
        "select action, actor_type, data from events where firm_id = $1 and action like $2 order by id",
        [f.firmId, like],
      )
    ).rows;
  // A WhatsApp stored as the webhook would, and the job queued for that very message.
  const incoming = async (body: string | null, from = mobile) => {
    const messageSid = sid();
    await receiveWhatsApp(f.firmId, { messageSid, from, to: line, body }, { run: withFirm });
    const { rows: queued } = await su.query<{ data: Record<string, unknown> }>(
      `select j.data from pgboss.job j
         join messages m on m.id::text = j.data ->> 'messageId'
        where j.name = $1 and m.firm_id = $2 and m.provider_message_id = $3`,
      [INBOUND_MESSAGE_QUEUE, f.firmId, messageSid],
    );
    if (queued.length !== 1) throw new Error("expected one job for the message");
    return queued[0]?.data ?? {};
  };
  return { f, line, ann, mobile, slug, name, messageRows, jobs, eventsOf, incoming };
}

// A form post signed as Twilio would sign it.
function signedRequest(
  fields: Record<string, string>,
  opts: { token?: string; url?: string; signature?: string | null; type?: string } = {},
) {
  const body = new URLSearchParams(fields).toString();
  const headers: Record<string, string> = {
    "content-type": opts.type ?? "application/x-www-form-urlencoded",
  };
  const signature =
    opts.signature === undefined
      ? twilioSignature(opts.token ?? TOKEN, opts.url ?? WEBHOOK, fields)
      : opts.signature;
  if (signature !== null) headers["x-twilio-signature"] = signature;
  return new Request(WEBHOOK, { method: "POST", headers, body });
}

describe("the WhatsApp webhook", () => {
  const deps = (authToken: string | undefined = TOKEN) => ({
    authToken,
    webhookUrl: WEBHOOK,
    resolveFirmByLine: createLineDirectory(app),
    receive: (firmId: string, m: Parameters<typeof receiveWhatsApp>[1]) =>
      receiveWhatsApp(firmId, m, { run: withFirm }),
  });

  it("a signed WhatsApp to a firm's line: one message stored, one job, an empty TwiML 200; a repeat stores nothing", async () => {
    const t = await lineFirm();
    const fields = {
      MessageSid: sid(),
      AccountSid: `AC${randomBytes(16).toString("hex")}`,
      From: `whatsapp:${t.mobile}`,
      To: `whatsapp:${t.line}`,
      Body: "shifts",
      NumMedia: "0",
    };
    const res = await handleTwilioWhatsApp(signedRequest(fields), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(await t.messageRows()).toEqual([
      expect.objectContaining({
        direction: "in",
        from_e164: t.mobile,
        to_e164: t.line,
        body: "shifts",
        handled_as: null,
      }),
    ]);
    expect(await t.jobs()).toHaveLength(1);
    // Twilio sends the same webhook again: still one row, one job.
    expect((await handleTwilioWhatsApp(signedRequest(fields), deps())).status).toBe(200);
    expect(await t.messageRows()).toHaveLength(1);
    expect(await t.jobs()).toHaveLength(1);
  });

  it("refuses what isn't from Twilio or isn't a WhatsApp, and stores nothing", async () => {
    const t = await lineFirm();
    const fields = {
      MessageSid: sid(),
      From: `whatsapp:${t.mobile}`,
      To: `whatsapp:${t.line}`,
      Body: "shifts",
    };
    const status = async (req: Request, token?: string) =>
      (await handleTwilioWhatsApp(req, deps(token))).status;
    expect(await status(signedRequest(fields), "")).toBe(503); // no auth token configured
    expect(await status(signedRequest(fields, { signature: null }))).toBe(403);
    expect(await status(signedRequest(fields, { token: "another-token-0123456789" }))).toBe(403);
    expect(await status(signedRequest(fields, { url: "https://evil.test/hook" }))).toBe(403);
    expect(await status(signedRequest(fields, { type: "application/json" }))).toBe(415);
    const big = { ...fields, Body: "x".repeat(MAX_WEBHOOK_BYTES) };
    expect(await status(signedRequest(big))).toBe(413);
    // Signed, but not a WhatsApp message.
    for (const bad of [
      { ...fields, MessageSid: "not-a-sid" },
      { ...fields, From: t.mobile }, // no "whatsapp:"
      { ...fields, To: "whatsapp:07700900000" },
    ]) {
      expect(await status(signedRequest(bad))).toBe(400);
    }
    expect(await t.messageRows()).toEqual([]);
    expect(await t.jobs()).toEqual([]);
    // Too big by its declared length: refused before the body is read.
    const declared = signedRequest(fields);
    const huge = new Request(WEBHOOK, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(MAX_WEBHOOK_BYTES + 1),
        "x-twilio-signature": declared.headers.get("x-twilio-signature") ?? "",
      },
      body: new URLSearchParams(fields).toString(),
    });
    expect(await status(huge)).toBe(413);
  });

  it("a long WhatsApp is kept, cut to the 1,600 characters we store; nothing from a message is logged", async () => {
    const t = await lineFirm();
    const lines: string[] = [];
    const logger = {
      info: (msg: string, data?: unknown) => lines.push(`${msg} ${JSON.stringify(data ?? {})}`),
      warn: (msg: string, data?: unknown) => lines.push(`${msg} ${JSON.stringify(data ?? {})}`),
      error: (msg: string, data?: unknown) => lines.push(`${msg} ${JSON.stringify(data ?? {})}`),
      child: () => logger,
    } as unknown as NonNullable<Parameters<typeof handleTwilioWhatsApp>[1]["logger"]>;
    const long = `${"x".repeat(1600)}END`;
    const res = await handleTwilioWhatsApp(
      signedRequest({
        MessageSid: sid(),
        From: `whatsapp:${t.mobile}`,
        To: `whatsapp:${t.line}`,
        Body: long,
      }),
      { ...deps(), logger },
    );
    expect(res.status).toBe(200);
    expect((await t.messageRows())[0]?.body).toBe("x".repeat(1600));
    // An emoji across the cut (13.5): the 1,600th character, kept whole; never half of one ("�").
    await handleTwilioWhatsApp(
      signedRequest({
        MessageSid: sid(),
        From: `whatsapp:${t.mobile}`,
        To: `whatsapp:${t.line}`,
        Body: `${"y".repeat(1599)}😀END`,
      }),
      deps(),
    );
    // A flag (two characters) across it: left out whole.
    await handleTwilioWhatsApp(
      signedRequest({
        MessageSid: sid(),
        From: `whatsapp:${t.mobile}`,
        To: `whatsapp:${t.line}`,
        Body: `${"z".repeat(1599)}🇬🇧END`,
      }),
      deps(),
    );
    const bodies = (await t.messageRows()).map((r) => r.body);
    expect(bodies).toContain(`${"y".repeat(1599)}😀`);
    expect(bodies).toContain("z".repeat(1599));
    expect(bodies.join("")).not.toContain("\uFFFD");
    // A signed request with a bad field: the field's name is logged, never its value.
    await handleTwilioWhatsApp(
      signedRequest({
        MessageSid: sid(),
        From: t.mobile,
        To: `whatsapp:${t.line}`,
        Body: "secret words",
      }),
      { ...deps(), logger },
    );
    const logged = lines.join("\n");
    expect(logged).toContain('"fields":["From"]');
    expect(logged).not.toContain(t.mobile.slice(3));
    expect(logged).not.toContain("secret words");
    expect(logged).not.toContain("xxxxxxxx");
  });

  it("a number no firm has: 200 and nothing stored anywhere", async () => {
    const t = await lineFirm();
    const res = await handleTwilioWhatsApp(
      signedRequest({
        MessageSid: sid(),
        From: `whatsapp:${t.mobile}`,
        To: "whatsapp:+447700900599",
        Body: "shifts",
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(await t.messageRows()).toEqual([]);
  });
});

describe("replying (the inbound-message job)", () => {
  const replyDeps = (transport: MessagingTransport, ai: AiClient = noAi, now?: Date) => ({
    transport,
    ai,
    baseDomain: "shiftdesk.test",
    aiTimeoutMs: 30,
    ...(now ? { clock: { now: () => now } } : {}),
  });
  const run = (
    job: Record<string, unknown>,
    transport: MessagingTransport,
    ai: AiClient = noAi,
    now?: Date,
  ) =>
    runInboundMessage(
      job as Parameters<typeof runInboundMessage>[0],
      withFirm,
      replyDeps(transport, ai, now),
    );
  const onlyBody = (sent: OutboundMessage[]) => sent.map((m) => ("body" in m ? m.body : ""));

  it("keywords: open shifts, cancelling and pay get their reply, from the firm's line, signed; logged without the text", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    const portal = `https://${t.slug}.shiftdesk.test`;
    const automatic = "Automatic reply. Send OFFICE to reach a person.";
    // Shifts and cancel: her personal reply (12D.2; tests/integration/personal-reply.test.ts has the
    // lists); Ann has no shifts to take and none booked. Pay: the link, never a list.
    for (const [text, body] of [
      [
        "Any shifts this weekend?",
        `Hi Ann, there's nothing you can take at the weekend right now. We'll message you if something comes up. All open shifts: ${portal}/shifts/open\n${automatic}\n— ${t.name} Shift Team`,
      ],
      [
        "Can I cancel my shift on Saturday",
        `Hi Ann, you have no shifts booked, so there's nothing to cancel. ${automatic}\n— ${t.name} Shift Team`,
      ],
      [
        "When do wages go in",
        `Your hours, rates and pay dates: ${portal}/pay (you'll get a code to log in). ${automatic} — ${t.name} Shift Team`,
      ],
    ] as const) {
      expect(await run(await t.incoming(text), transport)).toMatchObject({
        status: "replied",
        handledAs: "keyword",
      });
      expect(sent.at(-1)).toEqual({ channel: "whatsapp", to: t.mobile, from: t.line, body });
    }
    const rows = await t.messageRows();
    expect(rows.filter((r) => r.direction === "in").map((r) => [r.handled_as, r.intent])).toEqual([
      ["keyword", "shifts"],
      ["keyword", "cancel"],
      ["keyword", "pay"],
    ]);
    // Each reply is stored, answering its message.
    const replies = rows.filter((r) => r.direction === "out");
    expect(replies).toHaveLength(3);
    for (const r of replies) {
      expect(rows.find((m) => m.id === r.reply_to)?.direction).toBe("in");
      expect(r).toMatchObject({ from_e164: t.line, to_e164: t.mobile, worker_id: t.ann });
    }
    const logged = await t.eventsOf("message.%");
    expect(logged.map((e) => [e.action, e.data.intent])).toEqual([
      ["message.received", "shifts"],
      ["message.replied", "shifts"],
      ["message.received", "cancel"],
      ["message.replied", "cancel"],
      ["message.received", "pay"],
      ["message.replied", "pay"],
    ]);
    // How the two personal replies were built, for the office's Enquiries page: no words of hers.
    const built = await t.eventsOf("enquiry.checks");
    expect(built.map((e) => [e.data.template, e.data.sent, e.data.channel])).toEqual([
      ["shifts_none", true, "whatsapp"],
      ["cancel_none", true, "whatsapp"],
    ]);
    const text = JSON.stringify([...logged, ...built]);
    expect(text).not.toMatch(/weekend|Saturday|wages/);
    expect(text).not.toContain(t.mobile);
  });

  it("asking for the office: a request for the office with the message as its note, and its reference in the reply", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    await run(await t.incoming("I need to talk to someone about my DBS"), transport);
    const { rows } = await su.query<{
      id: string;
      type: string;
      status: string;
      shift_id: string | null;
      payload: Record<string, unknown>;
      worker_id: string;
      message_id: string | null;
    }>(
      `select id::text as id, type, status, shift_id, payload, worker_id::text as worker_id,
              message_id::text as message_id
         from requests where firm_id = $1`,
      [t.f.firmId],
    );
    expect(rows).toEqual([
      {
        id: expect.any(String),
        type: "general",
        status: "open",
        shift_id: null,
        worker_id: t.ann,
        payload: { note: "I need to talk to someone about my DBS", via: "whatsapp" },
        // Linked to the message it came from (12D.1, S5), no longer by an id in the payload.
        message_id: (await t.messageRows())[0]?.id,
      },
    ]);
    const ref = (rows[0]?.id ?? "").slice(0, 8).toUpperCase();
    expect(onlyBody(sent)).toEqual([
      `The office will see this and get back to you. Ref ${ref}. Automatic reply. Send OFFICE to reach a person. — ${t.name} Shift Team`,
    ]);
    expect((await t.eventsOf("request.created"))[0]).toMatchObject({
      actor_type: "worker",
      data: { type: "general", shiftId: null, via: "whatsapp", workerId: t.ann },
    });
  });

  it("no keyword: the AI's label picks the reply; anything else, a failure or no answer goes to the office; the words are always ours", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    const asked: AiRequest[] = [];
    const answering = (answer: string) =>
      createFakeAi((r) => {
        asked.push(r);
        return answer;
      });
    // The AI says "cancel": the cancel reply (her own: she has nothing booked), handled by AI.
    expect(
      await run(await t.incoming("running late, can't make it"), transport, answering("cancel")),
    ).toMatchObject({ status: "replied", intent: "cancel", handledAs: "ai" });
    expect(onlyBody(sent).at(-1)).toMatch(/^Hi Ann, you have no shifts booked/);
    expect(asked[0]).toMatchObject({
      purpose: "classify_message",
      prompt: "running late, can't make it",
    });
    // A pay question the AI labels "pay": the pay link, never an answer.
    await run(await t.incoming("why was I short changed last week"), transport, answering("pay"));
    expect(onlyBody(sent).at(-1)).toMatch(/^Your hours, rates and pay dates: https:/);
    // Whatever else the AI writes is never sent: the office gets the message.
    for (const ai of [
      answering("You'll get £40 extra on Friday."),
      createFakeAi(() => {
        throw new Error("down");
      }),
      createFakeAi(() => new Promise<string>(() => undefined)),
      noAi,
    ]) {
      expect(await run(await t.incoming("hmm"), transport, ai)).toMatchObject({
        status: "replied",
        intent: "office",
        handledAs: "office",
      });
      expect(onlyBody(sent).at(-1)).toMatch(/^The office will see this and get back to you\./);
    }
    expect(onlyBody(sent).join(" ")).not.toContain("£40");
  });

  it("a photo with no text goes to the office", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    await run(await t.incoming(null), transport);
    expect(onlyBody(sent)).toEqual([expect.stringMatching(/^The office will see this/)]);
    const { rows } = await su.query<{ note: string }>(
      "select payload ->> 'note' as note from requests where firm_id = $1",
      [t.f.firmId],
    );
    expect(rows.map((r) => r.note)).toEqual(["(A photo or file, with no text.)"]);
  });

  it("a number we don't know: the polite reply from the firm's line, and the office's admins and resourcers emailed (no number, no message); shown on Enquiries", async () => {
    const t = await lineFirm();
    const admin = await t.f.office("admin");
    const resourcer = await t.f.office("resourcer");
    await t.f.office("payroll");
    await t.f.office("admin", "disabled");
    const emailOf = async (id: string) =>
      (await su.query<{ email: string }>("select email from office_users where id = $1", [id]))
        .rows[0]?.email;
    const stranger = "+447700900998";
    const { transport, sent } = captureTransport();
    expect(await run(await t.incoming("Hi, it's Sam, new phone", stranger), transport)).toEqual({
      status: "unknown_sender",
      reply: "sent",
      alerted: 2,
    });
    const whatsapps = sent.filter((m) => m.channel === "whatsapp");
    expect(whatsapps).toEqual([
      {
        channel: "whatsapp",
        to: stranger,
        from: t.line,
        body: `Thanks for your message. We don't recognise this number. If you work with ${t.name}, reply with your full name and the office will get back to you. Automatic reply. Send OFFICE to reach a person. — ${t.name} Shift Team`,
      },
    ]);
    const emails = sent.filter(
      (m): m is Extract<OutboundMessage, { channel: "email" }> => m.channel === "email",
    );
    expect(emails.map((m) => m.to).sort()).toEqual(
      [await emailOf(admin), await emailOf(resourcer)].sort(),
    );
    expect(emails[0]?.subject).toBe(`${t.name}: a message from a number we don't know`);
    expect(emails[0]?.body).toContain(
      `See it in Enquiries, under Need a person: https://${t.slug}.shiftdesk.test/office/enquiries?view=person`,
    );
    expect(emails[0]?.body).not.toContain("900998");
    expect(emails[0]?.body).not.toContain("Sam");
    expect(emails[0]?.body).toContain("We asked them for their full name.");
    // The reply is stored; the log has labels and counts only.
    expect((await t.messageRows()).map((r) => [r.direction, r.handled_as, r.worker_id])).toEqual([
      ["in", "unknown", null],
      ["out", null, null],
    ]);
    const logged = await t.eventsOf("message.%");
    expect(logged.map((e) => [e.action, e.data])).toEqual([
      [
        "message.received",
        { channel: "whatsapp", handledAs: "unknown", repeat: false, formerWorker: false },
      ],
      [
        "message.replied",
        { channel: "whatsapp", reply: "unknown_number", replyId: expect.any(String) },
      ],
      [
        "message.office_alerted",
        { reason: "unknown_number", recipients: 2, failed: 0, skipped: 0 },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/900998|Sam/);
    // Enquiries shows it to the office, waiting for a person.
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows).toEqual([
      expect.objectContaining({
        channel: "whatsapp",
        who: { kind: "unknown", from: stranger },
        text: "Hi, it's Sam, new phone",
      }),
    ]);
  });

  it("from the same number again within 24 hours: stored and on Enquiries, but no second reply or email (no loops)", async () => {
    const t = await lineFirm();
    await t.f.office("admin");
    const stranger = "+447700900997";
    const { transport, sent } = captureTransport();
    await run(await t.incoming("hello?", stranger), transport);
    const before = sent.length;
    expect(await run(await t.incoming("Sam Smith", stranger), transport)).toEqual({
      status: "unknown_sender",
      reply: "none",
      alerted: 0,
    });
    expect(sent).toHaveLength(before);
    expect((await t.eventsOf("message.received")).at(-1)?.data).toMatchObject({ repeat: true });
    // Need a person lists the oldest first.
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows.map((u) => u.text)).toEqual(["hello?", "Sam Smith"]);
    // Another number is its own first message.
    expect(await run(await t.incoming("hi", "+447700900996"), transport)).toMatchObject({
      reply: "sent",
      alerted: 1,
    });
  });

  it("a worker who has left: no 'we don't recognise this number'; the office is alerted, and Enquiries names them", async () => {
    const t = await lineFirm();
    await t.f.office("resourcer");
    await su.query("update workers set status = 'inactive' where id = $1", [t.ann]);
    const { transport, sent } = captureTransport();
    expect(await run(await t.incoming("shifts"), transport)).toEqual({
      status: "unknown_sender",
      reply: "none",
      alerted: 1,
    });
    expect(sent.map((m) => m.channel)).toEqual(["email"]);
    // The email doesn't claim we asked for their name.
    const alert = sent[0] as Extract<OutboundMessage, { channel: "email" }>;
    expect(alert.body).toContain("We haven't replied to them.");
    expect((await t.messageRows())[0]).toMatchObject({ handled_as: "unknown", worker_id: t.ann });
    expect((await t.eventsOf("message.office_alerted"))[0]?.data).toMatchObject({
      reason: "former_worker",
    });
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows[0]?.who).toMatchObject({
      kind: "casual",
      name: "Ann Booker",
      active: false,
    });
  });

  it("two messages from one stranger handled at once: one reply and one set of emails", async () => {
    const t = await lineFirm();
    await t.f.office("admin");
    const stranger = "+447700900989";
    const [one, two] = [await t.incoming("hello", stranger), await t.incoming("anyone?", stranger)];
    const { transport, sent } = captureTransport();
    // The first run's claim holds its transaction open for a moment after deciding (as a slow
    // commit would); the second starts inside that moment. Without the per-number lock the second
    // wouldn't see the first's claim and would answer too. The second's look for older messages
    // finds none: the first message's webhook hadn't committed when it looked (two webhooks at
    // once commit in either order), so nothing but the lock puts the two claims in turn.
    let claimed = () => {};
    const firstClaimed = new Promise<void>((resolve) => (claimed = resolve));
    let calls = 0;
    const slowCommit: WithFirm = (firmId, fn) =>
      withFirm(firmId, async (tx) => {
        const result = await fn(tx);
        calls += 1;
        // The 3rd: (1) a sender's older unanswered messages, (2) the read, (3) the claim.
        if (calls === 3) {
          claimed();
          await new Promise((r) => setTimeout(r, 300));
        }
        return result;
      });
    const first = runInboundMessage(
      one as Parameters<typeof runInboundMessage>[0],
      slowCommit,
      replyDeps(transport),
    );
    await firstClaimed;
    let secondCalls = 0;
    const olderNotYetCommitted: WithFirm = (firmId, fn) => {
      secondCalls += 1;
      if (secondCalls === 1) return Promise.resolve([] as never);
      return withFirm(firmId, fn);
    };
    const second = runInboundMessage(
      two as Parameters<typeof runInboundMessage>[0],
      olderNotYetCommitted,
      replyDeps(transport),
    );
    const results = await Promise.all([first, second]);
    expect(results.map((r) => ("reply" in r ? r.reply : r.status))).toEqual(["sent", "none"]);
    expect(sent.map((m) => m.channel).sort()).toEqual(["email", "whatsapp"]);
  });

  it("at most one reply and one alert in any 24 hours, counted from the last one answered", async () => {
    const t = await lineFirm();
    await t.f.office("admin");
    const stranger = "+447700900988";
    const { transport, sent } = captureTransport();
    await run(await t.incoming("hello", stranger), transport);
    // A day and a bit later (the first one's answer moved back 25 hours): answered again.
    await su.query(
      `update events set created_at = now() - interval '25 hours'
        where firm_id = $1 and action = 'message.received'`,
      [t.f.firmId],
    );
    expect(await run(await t.incoming("hello again", stranger), transport)).toMatchObject({
      reply: "sent",
      alerted: 1,
    });
    expect(sent.filter((m) => m.channel === "whatsapp")).toHaveLength(2);
  });

  it("other firms: a worker there is a stranger here; a stranger's message there doesn't make one here a repeat", async () => {
    const t = await lineFirm();
    const other = await lineFirm();
    await t.f.office("admin");
    const { transport, sent } = captureTransport();
    // Ann at the other firm (an active worker there) writes to this firm's line.
    expect(await run(await t.incoming("shifts", other.mobile), transport)).toEqual({
      status: "unknown_sender",
      reply: "sent",
      alerted: 1,
    });
    expect((await t.messageRows())[0]).toMatchObject({ handled_as: "unknown", worker_id: null });
    // A stranger writes to the other firm first, then here: here it's still their first.
    const stranger = "+447700900987";
    await run(await other.incoming("hi", stranger), transport);
    const before = sent.filter((m) => m.channel === "whatsapp").length;
    expect(await run(await t.incoming("hi", stranger), transport)).toMatchObject({
      reply: "sent",
    });
    expect(sent.filter((m) => m.channel === "whatsapp")).toHaveLength(before + 1);
  });

  it("a failed reply or failed emails are logged, never retried; no office user to email is fine", async () => {
    const t = await lineFirm();
    const broken: MessagingTransport = {
      name: "broken",
      send: async () => {
        throw new Error("provider down");
      },
    };
    // Nobody in the office: the reply still goes, nobody is emailed, and the log says so.
    const { transport, sent } = captureTransport();
    expect(await run(await t.incoming("hi", "+447700900995"), transport)).toEqual({
      status: "unknown_sender",
      reply: "sent",
      alerted: 0,
    });
    expect(sent.map((m) => m.channel)).toEqual(["whatsapp"]);
    expect(await t.eventsOf("message.office_alert%")).toEqual([
      expect.objectContaining({
        action: "message.office_alert_skipped",
        data: { reason: "unknown_number", skipped: 0 },
      }),
    ]);
    await t.f.office("admin");
    const job = await t.incoming("hi", "+447700900994");
    expect(await run(job, broken)).toEqual({
      status: "unknown_sender",
      reply: "failed",
      alerted: 0,
    });
    expect(await run(job, transport)).toEqual({ status: "already" });
    const failures = (await t.eventsOf("message.%_failed")).map((e) => [e.action, e.data]);
    expect(failures).toEqual([
      ["message.reply_failed", { channel: "whatsapp", reply: "unknown_number", code: "Error" }],
      [
        "message.office_alert_failed",
        { reason: "unknown_number", recipients: 0, failed: 1, skipped: 0 },
      ],
    ]);
  });

  it("at most once: a second run does nothing; a failed send is logged and never retried", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    const job = await t.incoming("shifts");
    await run(job, transport);
    expect(await run(job, transport)).toEqual({ status: "already" });
    expect(sent).toHaveLength(1);

    const broken: MessagingTransport = {
      name: "broken",
      send: async () => {
        throw new Error("provider down");
      },
    };
    const job2 = await t.incoming("pay");
    expect(await run(job2, broken)).toEqual({
      status: "reply_failed",
      intent: "pay",
      code: "Error",
    });
    expect(await run(job2, transport)).toEqual({ status: "already" });
    expect(sent).toHaveLength(1);
    expect((await t.eventsOf("message.reply_failed"))[0]?.data).toMatchObject({
      channel: "whatsapp",
      intent: "pay",
      code: "Error",
    });
    expect((await t.messageRows()).filter((r) => r.direction === "out")).toHaveLength(1);
  });

  it("nothing is written before the claim: a failure before the reply is retried and answered once", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    const job = await t.incoming("help please");
    let calls = 0;
    // The second transaction (the claim, the office's request, the event) fails once.
    const failing: WithFirm = (firmId, fn) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error("worker stopped"));
      return withFirm(firmId, fn);
    };
    await expect(
      runInboundMessage(
        job as Parameters<typeof runInboundMessage>[0],
        failing,
        replyDeps(transport),
      ),
    ).rejects.toThrow("worker stopped");
    expect((await t.messageRows())[0]?.handled_as).toBeNull();
    expect(await t.eventsOf("message.%")).toEqual([]);
    // The retry answers it, once, with one request for the office.
    expect(await run(job, transport)).toMatchObject({ status: "replied", intent: "office" });
    expect(await run(job, transport)).toEqual({ status: "already" });
    expect(sent).toHaveLength(1);
    const { rows } = await su.query("select 1 from requests where firm_id = $1", [t.f.firmId]);
    expect(rows).toHaveLength(1);
  });

  it("one number at two firms: each firm's line answers its own worker, with its own links", async () => {
    const t = await lineFirm();
    const other = await lineFirm();
    await su.query("update workers set mobile_e164 = $2 where id = $1", [other.ann, t.mobile]);
    const { transport, sent } = captureTransport();
    await run(await t.incoming("shifts"), transport);
    await run(await other.incoming("shifts", t.mobile), transport);
    expect(sent.map((m) => ("from" in m ? m.from : null))).toEqual([t.line, other.line]);
    expect(sent.map((m) => ("body" in m ? m.body : ""))).toEqual([
      expect.stringContaining(`https://${t.slug}.shiftdesk.test/shifts/open`),
      expect.stringContaining(`https://${other.slug}.shiftdesk.test/shifts/open`),
    ]);
    expect((await other.messageRows())[0]?.worker_id).toBe(other.ann);
  });

  it("another firm's message is invisible to this firm's job", async () => {
    const t = await lineFirm();
    const other = await lineFirm();
    const job = await other.incoming("shifts");
    const { transport, sent } = captureTransport();
    expect(await run({ ...job, firmId: t.f.firmId }, transport)).toEqual({ status: "gone" });
    expect(sent).toEqual([]);
    expect((await other.messageRows())[0]?.handled_as).toBeNull();
  });
});

// Decisions 11 and 12 (PLAN.md "Connecting the firm's systems"; P4.7): nothing goes back by
// WhatsApp or text unless the firm switches automatic replies on, and at most 5 unknown-number
// alert emails per firm an hour.
describe("automatic replies off (a firm's default since P4.7), and the unknown-number alert limit", () => {
  const replyDeps = (transport: MessagingTransport, now?: Date, ai: AiClient = noAi) => ({
    transport,
    ai,
    baseDomain: "shiftdesk.test",
    aiTimeoutMs: 30,
    ...(now ? { clock: { now: () => now } } : {}),
  });
  const run = (
    job: Record<string, unknown>,
    transport: MessagingTransport,
    now?: Date,
    ai?: AiClient,
  ) =>
    runInboundMessage(
      job as Parameters<typeof runInboundMessage>[0],
      withFirm,
      replyDeps(transport, now, ai),
    );

  it("a worker's WhatsApps: sorted and logged as before, each made the office's question (Need a person), nothing sent back", async () => {
    const t = await lineFirm({ repliesOff: true });
    const { transport, sent } = captureTransport();
    // Sorted as before (a keyword here), then the office's: a cancel, a pay or a shifts question
    // must never sit as answered when nothing went (decision 11).
    for (const [text, sortedAs] of [
      ["When do wages go in", "pay"],
      ["Can I cancel my shift on Saturday", "cancel"],
      ["I need to talk to someone about my DBS", "office"],
    ] as const) {
      expect(await run(await t.incoming(text), transport)).toEqual({
        status: "held",
        intent: "office",
        sortedAs,
        handledAs: "keyword",
      });
    }
    expect(sent).toEqual([]);
    expect((await t.messageRows()).map((r) => [r.direction, r.handled_as, r.intent])).toEqual([
      ["in", "keyword", "office"],
      ["in", "keyword", "office"],
      ["in", "keyword", "office"],
    ]);
    // Each a question for the office, with the message as its note.
    const { rows: asked } = await su.query<{ type: string; payload: Record<string, unknown> }>(
      "select type, payload from requests where firm_id = $1 order by created_at",
      [t.f.firmId],
    );
    expect(asked).toEqual([
      { type: "general", payload: { note: "When do wages go in", via: "whatsapp" } },
      { type: "general", payload: { note: "Can I cancel my shift on Saturday", via: "whatsapp" } },
      {
        type: "general",
        payload: { note: "I need to talk to someone about my DBS", via: "whatsapp" },
      },
    ]);
    // Logged as received, with what it was sorted as and the reply held; no reply, no personal
    // reply built.
    const logged = await t.eventsOf("message.%");
    expect(logged.map((e) => [e.action, e.data.intent, e.data.sortedAs, e.data.replyHeld])).toEqual(
      [
        ["message.received", "office", "pay", true],
        ["message.received", "office", "cancel", true],
        ["message.received", "office", "office", true],
      ],
    );
    expect(await t.eventsOf("enquiry.checks")).toEqual([]);
    // All three wait in Need a person.
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows.map((r) => r.text).sort()).toEqual(
      [
        "Can I cancel my shift on Saturday",
        "I need to talk to someone about my DBS",
        "When do wages go in",
      ].sort(),
    );
    // Each says why it waited (Phase 25.3): what it was sorted as, and that replies are off; one
    // that asked for a person reads as before. The pay question is in the Pay view, marked pay.
    const detail = async (text: string) => {
      const id = (await t.messageRows()).find((r) => r.body === text)?.id ?? "";
      const d = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, id, new Date()));
      if (!d) throw new Error(`no enquiry for ${text}`);
      return d;
    };
    const wages = await detail("When do wages go in");
    expect(wages.timeline.sorted).toEqual({ how: "held", by: "keyword", intent: "pay" });
    expect(wages.timeline.reply).toEqual({ how: "held" });
    expect(wages.pay).toBe(true);
    expect((await detail("Can I cancel my shift on Saturday")).timeline.sorted).toEqual({
      how: "held",
      by: "keyword",
      intent: "cancel",
    });
    const dbs = await detail("I need to talk to someone about my DBS");
    expect(dbs.timeline.sorted).toEqual({ how: "person", why: "asked" });
    expect(dbs.timeline.reply).toEqual({ how: "held" });
    expect(dbs.pay).toBe(false);
    const pay = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "pay", new Date()));
    expect(pay.rows.map((r) => r.text)).toEqual(["When do wages go in"]);
  });

  it("a 'shifts' keyword and a message the AI sorts: the office's too, no personal reply read, nothing sent", async () => {
    const t = await lineFirm({ repliesOff: true });
    const { transport, sent } = captureTransport();
    expect(await run(await t.incoming("Any shifts this week?"), transport)).toEqual({
      status: "held",
      intent: "office",
      sortedAs: "shifts",
      handledAs: "keyword",
    });
    const asked: AiRequest[] = [];
    const cancelling = createFakeAi((r) => {
      asked.push(r);
      return "cancel";
    });
    expect(
      await run(await t.incoming("running late, can't make it"), transport, undefined, cancelling),
    ).toEqual({ status: "held", intent: "office", sortedAs: "cancel", handledAs: "ai" });
    // The AI still sorts it (only labels: golden rule 1), and its label stays in the log.
    expect(asked).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(
      (await t.eventsOf("message.received")).map((e) => [e.data.handledAs, e.data.sortedAs]),
    ).toEqual([
      ["keyword", "shifts"],
      ["ai", "cancel"],
    ]);
    expect(await t.eventsOf("enquiry.checks")).toEqual([]);
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows.map((r) => r.text).sort()).toEqual(
      ["Any shifts this week?", "running late, can't make it"].sort(),
    );
    // The AI's label, and that replies are off (Phase 25.3).
    const late = (await t.messageRows()).find((r) => r.body === "running late, can't make it");
    const d = await withFirm(t.f.firmId, (tx) => loadEnquiry(tx, late?.id ?? "", new Date()));
    expect(d?.timeline.sorted).toEqual({ how: "held", by: "ai", intent: "cancel" });
    expect(d?.timeline.reply).toEqual({ how: "held" });
    // Neither is a pay question.
    const pay = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "pay", new Date()));
    expect(pay.rows).toEqual([]);
  });

  it("a worker who has left, with replies off: no reply anyway (never 'held'), and the office alerted", async () => {
    const t = await lineFirm({ repliesOff: true });
    await t.f.office("admin");
    await su.query("update workers set status = 'inactive' where id = $1", [t.ann]);
    const { transport, sent } = captureTransport();
    expect(await run(await t.incoming("Hi it's Ann, back again?"), transport)).toEqual({
      status: "unknown_sender",
      reply: "none",
      alerted: 1,
    });
    expect(sent.filter((m) => m.channel === "whatsapp")).toEqual([]);
    expect((await t.eventsOf("message.received"))[0]?.data).toMatchObject({
      formerWorker: true,
    });
    expect((await t.eventsOf("message.received"))[0]?.data.replyHeld).toBeUndefined();
  });

  it("a number we don't know: no polite reply, and the office still emailed (it doesn't say we asked their name)", async () => {
    const t = await lineFirm({ repliesOff: true });
    await t.f.office("admin");
    const stranger = "+441632960901";
    const { transport, sent } = captureTransport();
    expect(await run(await t.incoming("Hi, it's Sam, new phone", stranger), transport)).toEqual({
      status: "unknown_sender",
      reply: "held",
      alerted: 1,
    });
    expect(sent.filter((m) => m.channel === "whatsapp")).toEqual([]);
    const emails = sent.filter(
      (m): m is Extract<OutboundMessage, { channel: "email" }> => m.channel === "email",
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]?.body).not.toContain("We asked them for their full name.");
    expect((await t.eventsOf("message.%")).map((e) => [e.action, e.data])).toEqual([
      [
        "message.received",
        {
          channel: "whatsapp",
          handledAs: "unknown",
          repeat: false,
          formerWorker: false,
          replyHeld: true,
        },
      ],
      [
        "message.office_alerted",
        { reason: "unknown_number", recipients: 1, failed: 0, skipped: 0 },
      ],
    ]);
  });

  it("at most 5 unknown-number alert emails per firm an hour: the 6th number waits on Enquiries; the next hour alerts again", async () => {
    const t = await lineFirm();
    await t.f.office("admin");
    const { transport, sent } = captureTransport();
    const hour = new Date("2026-11-02T09:20:00Z");
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(await run(await t.incoming("Hello?", `+44163296091${i}`), transport, hour));
    }
    expect(
      results.map((r) => (r.status === "unknown_sender" ? [r.alerted, r.alertHeld] : r)),
    ).toEqual([
      [1, undefined],
      [1, undefined],
      [1, undefined],
      [1, undefined],
      [1, undefined],
      [0, true],
    ]);
    // The polite replies still go (this firm has them on): only the emails are limited.
    expect(sent.filter((m) => m.channel === "whatsapp")).toHaveLength(6);
    expect(sent.filter((m) => m.channel === "email")).toHaveLength(5);
    const received = (await t.eventsOf("message.received")).map((e) => e.data.alertHeld);
    expect(received).toEqual([undefined, undefined, undefined, undefined, undefined, true]);
    // The 6th's alert was held, not tried: no alerted, failed or skipped line for it.
    expect(await t.eventsOf("message.office_alert%")).toHaveLength(5);
    // It's on Enquiries with the rest.
    const person = await withFirm(t.f.firmId, (tx) => loadEnquiries(tx, "person", new Date()));
    expect(person.rows).toHaveLength(6);
    // The 6th's job again: already handled, and its hour's count unchanged (counted in the claim).
    const hits = async () =>
      (
        await su.query<{ hits: number }>(
          "select coalesce(sum(hits), 0)::int as hits from auth_throttle where firm_id = $1 and bucket like 'alert:unknown_number:%'",
          [t.f.firmId],
        )
      ).rows[0]?.hits;
    expect(await hits()).toBe(6);
    const { rows: sixth } = await su.query<{ id: string }>(
      `select id::text as id from messages where firm_id = $1 and from_e164 = '+441632960915'`,
      [t.f.firmId],
    );
    expect(
      await run(
        {
          firmId: t.f.firmId,
          messageId: sixth[0]?.id,
          idempotencyKey: `inbound-message:${sixth[0]?.id}`,
        },
        transport,
        hour,
      ),
    ).toEqual({ status: "already" });
    expect(await hits()).toBe(6);
    // The next hour, a new number alerts again.
    const later = new Date(hour.getTime() + 60 * 60_000);
    expect(await run(await t.incoming("Hello?", "+441632960919"), transport, later)).toMatchObject({
      status: "unknown_sender",
      alerted: 1,
    });
  });

  it("another firm's alerts don't count against this firm's 5", async () => {
    const t = await lineFirm();
    const other = await lineFirm();
    await t.f.office("admin");
    await other.f.office("admin");
    const { transport } = captureTransport();
    const hour = new Date("2026-11-02T10:20:00Z");
    for (let i = 0; i < 5; i += 1) {
      await run(await other.incoming("Hello?", `+44163296092${i}`), transport, hour);
    }
    expect(await run(await t.incoming("Hello?", "+441632960929"), transport, hour)).toMatchObject({
      status: "unknown_sender",
      alerted: 1,
    });
  });

  // Phase 25.3 (docs/messaging-templates.md `unknown_numbers_combined`).
  it("past the hour's 5: one email for the rest at the hour's end, to each admin and resourcer, once", async () => {
    const t = await lineFirm();
    const other = await lineFirm();
    const admin = await t.f.office("admin");
    const resourcer = await t.f.office("resourcer");
    await t.f.office("payroll"); // not emailed
    await other.f.office("admin");
    const emailsOf = async (ids: string[]) =>
      (
        await su.query<{ email: string }>(
          "select email from office_users where id = any($1::uuid[]) order by email",
          [ids],
        )
      ).rows.map((r) => r.email);
    const { transport, sent } = captureTransport();
    const hour = new Date("2026-11-02T09:20:00Z"); // 09:20 London (GMT)
    for (let i = 0; i < 7; i += 1) {
      await run(await t.incoming("Hello?", `+44163296093${i}`), transport, hour);
    }
    // Another firm's, past its own 5 the same hour: never counted here.
    for (let i = 0; i < 6; i += 1) {
      await run(await other.incoming("Hello?", `+44163296094${i}`), transport, hour);
    }
    // The 6th and 7th: held, with their hour.
    const held = (await t.eventsOf("message.received"))
      .map((e) => e.data)
      .filter((d) => d.alertHeld === true);
    expect(held.map((d) => d.alertHour)).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ]);
    // The hour's job: queued once, a minute after the hour ends; ids only.
    const { rows: jobs } = await su.query<{ data: Record<string, unknown>; start_after: Date }>(
      "select data, start_after from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [OFFICE_ALERTS_COMBINED_QUEUE, t.f.firmId],
    );
    const hourStart = "2026-11-02T09:00:00.000Z";
    const payload = {
      firmId: t.f.firmId,
      idempotencyKey: `alerts-combined:${Date.parse(hourStart)}`,
      hourStart,
    };
    // (Two only if the test ran across a real hour's edge: pg-boss's slot is by its own clock.)
    expect(jobs.length === 1 || jobs.length === 2).toBe(true);
    for (const j of jobs) {
      expect(j.data).toEqual(payload);
      expect(j.start_after).toEqual(new Date("2026-11-02T10:01:00Z"));
    }
    sent.length = 0;
    const deps = { transport, baseDomain: "localhost:3000" };
    expect(await runOfficeAlertsCombined(payload, withFirm, deps)).toEqual({
      status: "sent",
      messages: 2,
      emailed: 2,
      failed: 0,
    });
    const emails = sent.filter(
      (m): m is Extract<OutboundMessage, { channel: "email" }> => m.channel === "email",
    );
    expect(emails.map((m) => m.to).sort()).toEqual(await emailsOf([admin, resourcer]));
    expect(emails[0]?.subject).toBe(`${t.name}: 2 more messages from numbers we don't know`);
    expect(emails[0]?.body).toBe(
      [
        "2 more messages came to the shifts line between 09:00 and 10:00 from numbers that aren't your active staff.",
        "We send at most 5 of these emails an hour, so this one covers the rest.",
        `See them in Enquiries, under Need a person: http://${t.slug}.localhost:3000/office/enquiries?view=person`,
        `— ${t.name} Shift Team`,
      ].join("\n\n"),
    );
    // Neither the numbers nor the messages.
    for (const m of emails) {
      expect(`${m.subject} ${m.body}`).not.toMatch(/1632|Hello/);
    }
    expect((await t.eventsOf("message.office_alerts_combined")).map((e) => e.data)).toEqual([
      { hourStart, from: "09:00", to: "10:00", messages: 2, recipients: 2, failed: 0, skipped: 0 },
    ]);
    // Again (a retry, or the second copy): nothing more.
    sent.length = 0;
    expect(await runOfficeAlertsCombined(payload, withFirm, deps)).toEqual({ status: "already" });
    expect(sent).toEqual([]);
    expect(await t.eventsOf("message.office_alerts_combined")).toHaveLength(1);
    // The other firm's own hour: its 1 held message, its own email.
    const theirs = { ...payload, firmId: other.f.firmId };
    expect(await runOfficeAlertsCombined(theirs, withFirm, deps)).toMatchObject({
      status: "sent",
      messages: 1,
    });
    expect(sent.map((m) => ("subject" in m ? m.subject : ""))).toEqual([
      `${other.name}: 1 more message from numbers we don't know`,
    ]);
    // An hour with none held: nothing sent or logged.
    const next = new Date(Date.parse(hourStart) + 3_600_000).toISOString();
    expect(
      await runOfficeAlertsCombined(
        { ...payload, hourStart: next, idempotencyKey: `alerts-combined:${Date.parse(next)}` },
        withFirm,
        deps,
      ),
    ).toEqual({ status: "none" });
    expect(await t.eventsOf("message.office_alerts_combined")).toHaveLength(1);
  });

  it("the hour's email: a send that fails is counted; with nobody to email, it's logged and nothing goes", async () => {
    const t = await lineFirm();
    const admin = await t.f.office("admin");
    await t.f.office("resourcer");
    const { transport } = captureTransport();
    const hour = new Date("2026-11-02T13:05:00Z");
    for (let i = 0; i < 6; i += 1) {
      await run(await t.incoming("Hello?", `+44163296095${i}`), transport, hour);
    }
    const hourStart = "2026-11-02T13:00:00.000Z";
    const payload = {
      firmId: t.f.firmId,
      idempotencyKey: `alerts-combined:${Date.parse(hourStart)}`,
      hourStart,
    };
    const adminEmail = (
      await su.query<{ email: string }>("select email from office_users where id = $1", [admin])
    ).rows[0]?.email;
    const failing: MessagingTransport = {
      name: "failing",
      async send(m) {
        if (m.channel === "email" && m.to === adminEmail) throw new Error("smtp down");
        return { providerMessageId: "ok" };
      },
    };
    expect(
      await runOfficeAlertsCombined(payload, withFirm, { transport: failing, baseDomain: "x" }),
    ).toEqual({ status: "sent", messages: 1, emailed: 1, failed: 1 });
    expect((await t.eventsOf("message.office_alerts_combined")).map((e) => e.data)).toEqual([
      { hourStart, from: "13:00", to: "14:00", messages: 1, recipients: 1, failed: 1, skipped: 0 },
    ]);

    // Another firm whose office was switched off after its 6th: logged, nothing sent.
    const u = await lineFirm();
    const only = await u.f.office("admin");
    for (let i = 0; i < 6; i += 1) {
      await run(await u.incoming("Hello?", `+44163296096${i}`), transport, hour);
    }
    await su.query("update office_users set status = 'disabled' where id = $1", [only]);
    const { transport: none, sent } = captureTransport();
    expect(
      await runOfficeAlertsCombined({ ...payload, firmId: u.f.firmId }, withFirm, {
        transport: none,
        baseDomain: "x",
      }),
    ).toEqual({ status: "no_recipients", messages: 1 });
    expect(sent).toEqual([]);
    expect((await u.eventsOf("message.office_alerts_combined")).map((e) => e.data)).toEqual([
      { hourStart, from: "13:00", to: "14:00", messages: 1, recipients: 0, failed: 0, skipped: 0 },
    ]);
  });
});

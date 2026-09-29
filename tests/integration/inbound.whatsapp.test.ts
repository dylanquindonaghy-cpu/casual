import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAi, noAi, type AiClient, type AiRequest } from "@/lib/ai/client";
import { createLineDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import { receiveWhatsApp } from "@/lib/inbound/receive";
import { runInboundMessage } from "@/lib/inbound/reply";
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

async function lineFirm() {
  const f = await bookingFirm(su, withFirm);
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
  const replyDeps = (transport: MessagingTransport, ai: AiClient = noAi) => ({
    transport,
    ai,
    baseDomain: "shiftdesk.test",
    aiTimeoutMs: 30,
  });
  const run = (job: Record<string, unknown>, transport: MessagingTransport, ai: AiClient = noAi) =>
    runInboundMessage(
      job as Parameters<typeof runInboundMessage>[0],
      withFirm,
      replyDeps(transport, ai),
    );
  const onlyBody = (sent: OutboundMessage[]) => sent.map((m) => ("body" in m ? m.body : ""));

  it("keywords: open shifts, cancelling and pay get their link, from the firm's line, signed; logged without the text", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    const portal = `https://${t.slug}.shiftdesk.test`;
    for (const [text, reply] of [
      ["Any shifts this weekend?", `Open shifts you're eligible for: ${portal}/shifts/open`],
      [
        "Can I cancel my shift on Saturday",
        `To cancel a shift, tap here and choose the shift: ${portal}/. It's recorded instantly.`,
      ],
      [
        "When do wages go in",
        `Your hours, rates and pay dates: ${portal}/pay (you'll get a code to log in).`,
      ],
    ] as const) {
      expect(await run(await t.incoming(text), transport)).toMatchObject({
        status: "replied",
        handledAs: "keyword",
      });
      expect(sent.at(-1)).toEqual({
        channel: "whatsapp",
        to: t.mobile,
        from: t.line,
        body: `${reply} — ${t.name} Shift Team`,
      });
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
    const text = JSON.stringify(logged);
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
    }>(
      `select id::text as id, type, status, shift_id, payload, worker_id::text as worker_id
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
        payload: {
          note: "I need to talk to someone about my DBS",
          via: "whatsapp",
          messageId: (await t.messageRows())[0]?.id,
        },
      },
    ]);
    const ref = (rows[0]?.id ?? "").slice(0, 8).toUpperCase();
    expect(onlyBody(sent)).toEqual([
      `The office will see this and get back to you. Ref ${ref}. — ${t.name} Shift Team`,
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
    // The AI says "cancel": the cancel reply, handled by AI.
    expect(
      await run(await t.incoming("running late, can't make it"), transport, answering("cancel")),
    ).toMatchObject({ status: "replied", intent: "cancel", handledAs: "ai" });
    expect(onlyBody(sent).at(-1)).toMatch(/^To cancel a shift, tap here/);
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

  it("a photo with no text goes to the office; a sender who isn't a worker (or has left) gets no reply here", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    await run(await t.incoming(null), transport);
    expect(onlyBody(sent)).toEqual([expect.stringMatching(/^The office will see this/)]);
    const { rows } = await su.query<{ note: string }>(
      "select payload ->> 'note' as note from requests where firm_id = $1",
      [t.f.firmId],
    );
    expect(rows.map((r) => r.note)).toEqual(["(A photo or file, with no text.)"]);

    expect(await run(await t.incoming("shifts", "+447700900998"), transport)).toEqual({
      status: "unknown_sender",
    });
    await su.query("update workers set status = 'inactive' where id = $1", [t.ann]);
    expect(await run(await t.incoming("shifts"), transport)).toEqual({ status: "unknown_sender" });
    expect(sent).toHaveLength(1);
    expect(
      (await t.messageRows()).filter((r) => r.handled_as === "unknown").map((r) => r.worker_id),
    ).toEqual([null, null]);
    expect((await t.eventsOf("message.received")).at(-1)).toMatchObject({
      actor_type: "system",
      data: { channel: "whatsapp", handledAs: "unknown" },
    });
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

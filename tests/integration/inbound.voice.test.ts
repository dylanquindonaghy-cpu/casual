import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noAi } from "@/lib/ai/client";
import { requestWorkerLoginLink } from "@/lib/auth/worker-login";
import { SEND_PORTAL_LINK_QUEUE } from "@/lib/auth/send-portal-link";
import { createLineDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import { runInboundMessage } from "@/lib/inbound/reply";
import { twilioSignature } from "@/lib/inbound/twilio-signature";
import {
  callTwiml,
  handleTwilioTranscription,
  handleTwilioVoice,
  handleTwilioVoiceDone,
} from "@/lib/inbound/voice";
import type { CallLink } from "@/lib/messaging/templates";
import type { MessagingTransport, OutboundMessage } from "@/lib/messaging/transport";
import { loadToday } from "@/lib/office/today";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Calls to the shifts line (Phase 7, call-to-text): Twilio's voice, transcription and "done"
// webhooks (src/lib/inbound/voice.ts) and a voicemail becoming a request for the office
// (src/lib/inbound/reply.ts), on the real database as the app role. No Twilio: signed requests
// are built with a test key and messages go to a capturing transport. Numbers are from Ofcom's
// drama range (07700 900700-900999 for the firms' lines here, freed before use).

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
const BASE = "https://shiftdesk.test/api/webhooks/twilio/voice";
const URLS = { voice: BASE, transcription: `${BASE}/transcription`, done: `${BASE}/done` };
const hex = () => randomBytes(16).toString("hex");
const callSid = () => `CA${hex()}`;
const recordingSid = () => `RE${hex()}`;
const STRANGER = "+447700900997";
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8"?><Response>`;

let nextLine = Math.floor(Math.random() * 300);
async function freshLine(): Promise<string> {
  nextLine = (nextLine + 1) % 300;
  const line = `+447700900${700 + nextLine}`;
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
        direction: string;
        channel: string;
        provider_message_id: string | null;
        from_e164: string | null;
        to_e164: string;
        body: string | null;
        handled: boolean;
        handled_as: string | null;
        intent: string | null;
        worker_id: string | null;
      }>(
        `select direction, channel, provider_message_id, from_e164, to_e164, body,
                handled_at is not null as handled, handled_as, intent, worker_id::text as worker_id
           from messages where firm_id = $1 order by created_at, direction`,
        [f.firmId],
      )
    ).rows;
  const jobsOf = async (queue: string) =>
    (
      await su.query<{ data: Record<string, unknown> }>(
        "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2 order by created_on",
        [queue, f.firmId],
      )
    ).rows.map((r) => r.data);
  const eventsOf = async (like: string) =>
    (
      await su.query<{
        action: string;
        actor_type: string;
        entity_type: string;
        entity_id: string | null;
        data: Record<string, unknown>;
      }>(
        `select action, actor_type, entity_type, entity_id::text as entity_id, data from events
          where firm_id = $1 and action like $2 order by id`,
        [f.firmId, like],
      )
    ).rows;
  return { f, line, ann, mobile, slug, name, messageRows, jobsOf, eventsOf };
}

// A form post signed as Twilio would sign it for the given address.
function signed(
  url: string,
  fields: Record<string, string>,
  opts: { token?: string; signature?: string | null } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  const signature =
    opts.signature === undefined
      ? twilioSignature(opts.token ?? TOKEN, url, fields)
      : opts.signature;
  if (signature !== null) headers["x-twilio-signature"] = signature;
  return new Request(url, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

const voiceDeps = () => ({
  authToken: TOKEN as string | undefined,
  voiceUrl: URLS.voice,
  transcriptionUrl: URLS.transcription,
  doneUrl: URLS.done,
  resolveFirmByLine: createLineDirectory(app),
  // The route's own call (src/app/api/webhooks/twilio/voice/route.ts), on the test pool.
  requestLink: (firm: { id: string }, mobile: string) =>
    requestWorkerLoginLink(
      { firm: { id: firm.id }, clientIp: `call:${mobile}`, run: withFirm, secret: "x".repeat(32) },
      mobile,
    ),
  run: withFirm,
});
const transcriptionDeps = () => ({
  authToken: TOKEN as string | undefined,
  webhookUrl: URLS.transcription,
  resolveFirmByLine: createLineDirectory(app),
  run: withFirm,
});

const callFields = (t: { line: string }, from: string | null, sid = callSid()) => ({
  CallSid: sid,
  AccountSid: `AC${hex()}`,
  ...(from === null ? {} : { From: from }),
  To: t.line,
  CallStatus: "ringing",
  Direction: "inbound",
});

const spoken = (t: { name: string }, link: CallLink) =>
  `${XML_HEAD}${callTwiml(
    { name: t.name, signOff: `${t.name} Shift Team` },
    { link, transcriptionUrl: URLS.transcription, doneUrl: URLS.done },
  )}</Response>`;

describe("the voice webhook", () => {
  it("a worker rings the firm's line: the spoken message and a voicemail, the call stored once, and their login link sent; a repeat does nothing more", async () => {
    const t = await lineFirm();
    const fields = callFields(t, t.mobile);
    const res = await handleTwilioVoice(signed(URLS.voice, fields), voiceDeps());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(await res.text()).toBe(spoken(t, "sent"));
    expect(await t.messageRows()).toEqual([
      {
        direction: "in",
        channel: "voice",
        provider_message_id: fields.CallSid,
        from_e164: t.mobile,
        to_e164: t.line,
        body: null,
        handled: true, // a call itself needs no reply job
        handled_as: null,
        intent: null,
        worker_id: null,
      },
    ]);
    expect(await t.jobsOf(INBOUND_MESSAGE_QUEUE)).toEqual([]);
    // The login page's own request: its event, and the job that sends Ann her link.
    expect(await t.jobsOf(SEND_PORTAL_LINK_QUEUE)).toEqual([
      expect.objectContaining({ purpose: "worker_login", subjectId: t.ann }),
    ]);
    expect((await t.eventsOf("auth.link_requested")).map((e) => e.data)).toEqual([
      { kind: "worker", matched: true },
    ]);
    const calls = await t.eventsOf("call.%");
    const { rows: callRow } = await su.query<{ id: string }>(
      "select id::text as id from messages where firm_id = $1",
      [t.f.firmId],
    );
    expect(calls).toEqual([
      {
        action: "call.received",
        actor_type: "system",
        entity_type: "call",
        entity_id: callRow[0]?.id, // the stored call
        data: { linkRequested: true, withheld: false },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain(fields.CallSid);

    // Twilio retries the same call: the same answer, nothing new.
    const again = await handleTwilioVoice(signed(URLS.voice, fields), voiceDeps());
    expect(await again.text()).toBe(spoken(t, "sent"));
    expect(await t.messageRows()).toHaveLength(1);
    expect(await t.jobsOf(SEND_PORTAL_LINK_QUEUE)).toHaveLength(1);
    expect(await t.eventsOf("call.%")).toHaveLength(1);
  });

  it("a number that isn't a worker's hears exactly the same, and nobody is sent anything (the login page's answer)", async () => {
    const t = await lineFirm();
    const res = await handleTwilioVoice(signed(URLS.voice, callFields(t, STRANGER)), voiceDeps());
    expect(await res.text()).toBe(spoken(t, "sent"));
    expect((await t.messageRows()).map((r) => [r.channel, r.from_e164])).toEqual([
      ["voice", STRANGER],
    ]);
    // The same job, with nobody to send to (src/lib/auth/send-portal-link.ts sends nothing).
    expect(await t.jobsOf(SEND_PORTAL_LINK_QUEUE)).toEqual([
      expect.objectContaining({ purpose: "worker_login", subjectId: null }),
    ]);
    expect((await t.eventsOf("auth.link_requested")).map((e) => e.data)).toEqual([
      { kind: "worker", matched: false },
    ]);
  });

  it("a withheld number: no link promised or asked for; the call stored once by its CallSid, without a number", async () => {
    const t = await lineFirm();
    // Twilio's "anonymous", no From at all, junk, and its placeholder numbers for a hidden ID.
    const hidden = ["anonymous", null, "+44", "+266696687", "+7378742833"];
    const sids = hidden.map(() => callSid());
    for (const [i, from] of hidden.entries()) {
      const res = await handleTwilioVoice(
        signed(URLS.voice, callFields(t, from, sids[i])),
        voiceDeps(),
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(spoken(t, "withheld"));
    }
    // Twilio retries the first: nothing new.
    await handleTwilioVoice(signed(URLS.voice, callFields(t, "anonymous", sids[0])), voiceDeps());
    const rows = await t.messageRows();
    expect(rows.map((r) => [r.provider_message_id, r.from_e164, r.channel, r.handled])).toEqual(
      sids.map((sid) => [sid, null, "voice", true]),
    );
    expect(await t.jobsOf(SEND_PORTAL_LINK_QUEUE)).toEqual([]);
    expect((await t.eventsOf("call.%")).map((e) => e.data)).toEqual(
      hidden.map(() => ({ linkRequested: false, withheld: true })),
    );
  });

  it("no link just now (the login limits, or asking failed): the caller isn't promised one, and the voicemail is still taken", async () => {
    const t = await lineFirm();
    // The login page's limit: 3 links per number every 15 minutes, whoever's number it is.
    for (let i = 0; i < 3; i += 1) {
      const res = await handleTwilioVoice(signed(URLS.voice, callFields(t, t.mobile)), voiceDeps());
      expect(await res.text()).toBe(spoken(t, "sent"));
    }
    const fourth = await handleTwilioVoice(
      signed(URLS.voice, callFields(t, t.mobile)),
      voiceDeps(),
    );
    expect(await fourth.text()).toBe(spoken(t, "not_now"));
    expect(await t.jobsOf(SEND_PORTAL_LINK_QUEUE)).toHaveLength(3);
    expect((await t.eventsOf("auth.rate_limited")).map((e) => e.data)).toEqual([
      { limit: "login:mobile" },
    ]);
    // Asking fails (a database error, say): still 200 with the voicemail, the call stored.
    const failing = {
      ...voiceDeps(),
      requestLink: async (): Promise<{ status: string }> => {
        throw new Error("connection reset");
      },
    };
    const fields = callFields(t, STRANGER);
    const res = await handleTwilioVoice(signed(URLS.voice, fields), failing);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(spoken(t, "not_now"));
    expect((await t.messageRows()).map((r) => r.provider_message_id)).toContain(fields.CallSid);
  });

  it("a number no firm has: 'not in use', and nothing stored or sent anywhere", async () => {
    const t = await lineFirm();
    const res = await handleTwilioVoice(
      signed(URLS.voice, { ...callFields(t, t.mobile), To: "+447700900499" }),
      voiceDeps(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      `${XML_HEAD}<Say language="en-GB">Sorry, this number isn&apos;t in use.</Say><Hangup/></Response>`,
    );
    const { rows } = await su.query(
      "select 1 from messages where to_e164 = '+447700900499' and channel = 'voice'",
    );
    expect(rows).toEqual([]);
    expect(await t.jobsOf(SEND_PORTAL_LINK_QUEUE)).toEqual([]);
  });

  it("refuses what isn't from Twilio or isn't a call, and stores nothing", async () => {
    const t = await lineFirm();
    const fields = callFields(t, t.mobile);
    const cases: [Request, ReturnType<typeof voiceDeps>, number][] = [
      [signed(URLS.voice, fields, { signature: null }), voiceDeps(), 403],
      [signed(URLS.voice, fields, { token: "someone-else's-token-0123456789" }), voiceDeps(), 403],
      // Signed for another webhook's address: not valid here.
      [
        new Request(URLS.voice, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-twilio-signature": twilioSignature(TOKEN, URLS.transcription, fields),
          },
          body: new URLSearchParams(fields).toString(),
        }),
        voiceDeps(),
        403,
      ],
      [signed(URLS.voice, fields), { ...voiceDeps(), authToken: undefined }, 503],
      [signed(URLS.voice, { ...fields, CallSid: "SM0123" }), voiceDeps(), 400],
      [signed(URLS.voice, { ...fields, To: "07700 900700" }), voiceDeps(), 400],
    ];
    for (const [request, deps, status] of cases) {
      expect((await handleTwilioVoice(request, deps)).status).toBe(status);
    }
    expect(await t.messageRows()).toEqual([]);
    // (The fixture's own event, its credential pack, isn't one of these.)
    for (const like of ["call.%", "message.%", "auth.%"])
      expect(await t.eventsOf(like)).toEqual([]);
    expect(await t.jobsOf(SEND_PORTAL_LINK_QUEUE)).toEqual([]);
  });

  it("another firm's line: its call is stored there, invisible here", async () => {
    const t = await lineFirm();
    const other = await lineFirm();
    await handleTwilioVoice(signed(URLS.voice, callFields(other, STRANGER)), voiceDeps());
    expect(await t.messageRows()).toEqual([]);
    expect(await other.messageRows()).toHaveLength(1);
    const seen = await withFirm(t.f.firmId, (tx) =>
      tx.execute("select count(*)::int as n from messages where channel = 'voice'"),
    );
    expect(seen.rows).toEqual([{ n: 0 }]);
  });
});

describe("the messages table", () => {
  it("only an incoming voice row may have no sender; any other sender must be E.164", async () => {
    const t = await lineFirm();
    const insert = (direction: string, channel: string, from: string | null) =>
      su.query(
        `insert into messages (firm_id, direction, channel, provider_message_id, from_e164, to_e164)
         values ($1, $2, $3, $4, $5, $6)`,
        [t.f.firmId, direction, channel, `SM${hex()}`, from, t.line],
      );
    for (const [direction, channel] of [
      ["in", "whatsapp"],
      ["in", "sms"],
      ["out", "whatsapp"],
      ["out", "voice"],
    ]) {
      await expect(insert(direction ?? "", channel ?? "", null)).rejects.toMatchObject({
        code: "23514",
      });
    }
    await expect(insert("in", "voice", "07700 900123")).rejects.toMatchObject({ code: "23514" });
    await insert("in", "voice", null);
    expect(await t.messageRows()).toHaveLength(1);
  });
});

describe("the 'done' webhook (after the voicemail)", () => {
  it("says goodbye and hangs up; unsigned is refused", async () => {
    const fields = { CallSid: callSid(), RecordingSid: recordingSid(), RecordingDuration: "12" };
    const deps = { authToken: TOKEN, webhookUrl: URLS.done };
    const res = await handleTwilioVoiceDone(signed(URLS.done, fields), deps);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      `${XML_HEAD}<Say language="en-GB">Thank you. Goodbye.</Say><Hangup/></Response>`,
    );
    expect(
      (await handleTwilioVoiceDone(signed(URLS.done, fields, { signature: "nope" }), deps)).status,
    ).toBe(403);
    expect(
      (await handleTwilioVoiceDone(signed(URLS.done, fields), { ...deps, authToken: undefined }))
        .status,
    ).toBe(503);
  });
});

// A voicemail's text as Twilio's transcription callback sends it.
const transcription = (
  t: { line: string },
  from: string | null,
  o: { status?: string; text?: string; recording?: string } = {},
) => ({
  CallSid: callSid(),
  RecordingSid: o.recording ?? recordingSid(),
  RecordingUrl: "https://api.twilio.test/recording",
  TranscriptionSid: `TR${hex()}`,
  TranscriptionStatus: o.status ?? "completed",
  ...(o.text === undefined ? {} : { TranscriptionText: o.text }),
  ...(from === null ? {} : { From: from }),
  To: t.line,
});

describe("the transcription webhook", () => {
  it("stores the voicemail's text once, with one reply job; a repeat does nothing more", async () => {
    const t = await lineFirm();
    const fields = transcription(t, t.mobile, { text: "Running late for Saturday, sorry" });
    const res = await handleTwilioTranscription(
      signed(URLS.transcription, fields),
      transcriptionDeps(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`${XML_HEAD}</Response>`);
    await handleTwilioTranscription(signed(URLS.transcription, fields), transcriptionDeps());
    expect(await t.messageRows()).toEqual([
      {
        direction: "in",
        channel: "voice",
        provider_message_id: fields.RecordingSid,
        from_e164: t.mobile,
        to_e164: t.line,
        body: "Running late for Saturday, sorry",
        handled: false,
        handled_as: null,
        intent: null,
        worker_id: null,
      },
    ]);
    expect(await t.jobsOf(INBOUND_MESSAGE_QUEUE)).toHaveLength(1);
  });

  it("no text when Twilio couldn't make any; a withheld number is kept without one", async () => {
    const t = await lineFirm();
    for (const fields of [
      transcription(t, t.mobile, { status: "failed", text: "garbled" }),
      transcription(t, t.mobile, { text: "   " }),
      transcription(t, "anonymous", { text: "It's Ann, my phone hides my number" }),
    ]) {
      await handleTwilioTranscription(signed(URLS.transcription, fields), transcriptionDeps());
    }
    expect((await t.messageRows()).map((r) => [r.from_e164, r.body])).toEqual([
      [t.mobile, null],
      [t.mobile, null],
      [null, "It's Ann, my phone hides my number"],
    ]);
    expect(await t.jobsOf(INBOUND_MESSAGE_QUEUE)).toHaveLength(3);
  });

  it("refuses unsigned or malformed callbacks; a number no firm has is 200 with nothing stored", async () => {
    const t = await lineFirm();
    const fields = transcription(t, t.mobile, { text: "hello" });
    expect(
      (
        await handleTwilioTranscription(
          signed(URLS.transcription, fields, { signature: null }),
          transcriptionDeps(),
        )
      ).status,
    ).toBe(403);
    // Signed for the voice webhook's address: not valid here.
    const elsewhere = new Request(URLS.transcription, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": twilioSignature(TOKEN, URLS.voice, fields),
      },
      body: new URLSearchParams(fields).toString(),
    });
    expect((await handleTwilioTranscription(elsewhere, transcriptionDeps())).status).toBe(403);
    expect(
      (
        await handleTwilioTranscription(signed(URLS.transcription, fields), {
          ...transcriptionDeps(),
          authToken: undefined,
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await handleTwilioTranscription(
          signed(URLS.transcription, { ...fields, RecordingSid: "RE-not-an-id" }),
          transcriptionDeps(),
        )
      ).status,
    ).toBe(400);
    const nobody = await handleTwilioTranscription(
      signed(URLS.transcription, { ...fields, To: "+447700900499" }),
      transcriptionDeps(),
    );
    expect(nobody.status).toBe(200);
    expect(await t.messageRows()).toEqual([]);
    expect(await t.jobsOf(INBOUND_MESSAGE_QUEUE)).toEqual([]);
  });
});

describe("a voicemail (the inbound-message job)", () => {
  const run = (job: Record<string, unknown>, transport: MessagingTransport) =>
    runInboundMessage(job as Parameters<typeof runInboundMessage>[0], withFirm, {
      transport,
      ai: noAi,
      baseDomain: "shiftdesk.test",
      aiTimeoutMs: 30,
    });
  // Stored as Twilio's callback would store it; the job for that very voicemail.
  const voicemail = async (
    t: Awaited<ReturnType<typeof lineFirm>>,
    from: string | null,
    o: { status?: string; text?: string } = {},
  ) => {
    const fields = transcription(t, from, o);
    await handleTwilioTranscription(signed(URLS.transcription, fields), transcriptionDeps());
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      `select j.data from pgboss.job j
         join messages m on m.id::text = j.data ->> 'messageId'
        where j.name = $1 and m.firm_id = $2 and m.provider_message_id = $3`,
      [INBOUND_MESSAGE_QUEUE, t.f.firmId, fields.RecordingSid],
    );
    if (rows.length !== 1) throw new Error("expected one job for the voicemail");
    return rows[0]?.data ?? {};
  };
  const requestsOf = async (firmId: string) =>
    (
      await su.query<{
        id: string;
        type: string;
        worker_id: string;
        payload: Record<string, unknown>;
      }>(
        `select id::text as id, type, worker_id::text as worker_id, payload from requests
          where firm_id = $1 order by created_at`,
        [firmId],
      )
    ).rows;

  it("a worker's voicemail is a request for the office (never a keyword), answered by WhatsApp from the line", async () => {
    const t = await lineFirm();
    const { transport, sent } = captureTransport();
    // "cancel" and "shifts" would be keywords in a WhatsApp: a voicemail goes to the office.
    const job = await voicemail(t, t.mobile, { text: "I need to cancel my shifts next week" });
    expect(await run(job, transport)).toEqual({
      status: "replied",
      intent: "office",
      handledAs: "office",
    });
    const requests = await requestsOf(t.f.firmId);
    expect(requests).toEqual([
      {
        id: expect.any(String),
        type: "general",
        worker_id: t.ann,
        payload: {
          note: "I need to cancel my shifts next week",
          via: "voicemail",
          messageId: job.messageId,
        },
      },
    ]);
    const ref = (requests[0]?.id ?? "").slice(0, 8).toUpperCase();
    expect(sent).toEqual([
      {
        channel: "whatsapp",
        to: t.mobile,
        from: t.line,
        body: `Thanks for your voicemail. The office will see it and get back to you. Ref ${ref}. — ${t.name} Shift Team`,
      },
    ]);
    expect(
      (await t.messageRows()).map((r) => [r.direction, r.channel, r.handled_as, r.intent]),
    ).toEqual([
      ["in", "voice", "office", "office"],
      ["out", "whatsapp", null, "office"],
    ]);
    const logged = (await t.eventsOf("%")).filter((e) => /^(request|message)\./.test(e.action));
    expect(logged.map((e) => [e.action, e.data])).toEqual([
      ["request.created", { type: "general", shiftId: null, via: "voicemail", workerId: t.ann }],
      [
        "message.received",
        { channel: "voice", handledAs: "office", intent: "office", workerId: t.ann },
      ],
      [
        "message.replied",
        { channel: "whatsapp", intent: "office", workerId: t.ann, replyId: expect.any(String) },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/cancel my|next week/);
    // A second run does nothing.
    expect(await run(job, transport)).toEqual({ status: "already" });
    expect(sent).toHaveLength(1);
  });

  it("a worker who chose texts gets the answer by SMS; a voicemail with no text says so in the request", async () => {
    const t = await lineFirm();
    await su.query("update workers set notify_channel = 'sms' where id = $1", [t.ann]);
    const { transport, sent } = captureTransport();
    await run(await voicemail(t, t.mobile, { status: "failed" }), transport);
    expect((await requestsOf(t.f.firmId)).map((r) => r.payload.note)).toEqual([
      "(A voicemail we couldn't turn into text.)",
    ]);
    expect(sent).toEqual([expect.objectContaining({ channel: "sms", to: t.mobile, from: t.line })]);
    expect((await t.messageRows()).map((r) => [r.direction, r.channel])).toEqual([
      ["in", "voice"],
      ["out", "sms"],
    ]);
  });

  it("a caller we don't know: no message to them, the office alerted, the voicemail on Today", async () => {
    const t = await lineFirm();
    await t.f.office("admin");
    const { transport, sent } = captureTransport();
    expect(
      await run(await voicemail(t, STRANGER, { text: "Hi it's Jo, about work" }), transport),
    ).toEqual({ status: "unknown_sender", reply: "none", alerted: 1 });
    expect(sent.map((m) => m.channel)).toEqual(["email"]);
    const email = sent[0] as Extract<OutboundMessage, { channel: "email" }>;
    expect(email.body).not.toMatch(/900997|Jo/);
    expect(await requestsOf(t.f.firmId)).toEqual([]);
    expect((await t.eventsOf("message.%")).map((e) => [e.action, e.data])).toEqual([
      [
        "message.received",
        { channel: "voice", handledAs: "unknown", repeat: false, formerWorker: false },
      ],
      [
        "message.office_alerted",
        { reason: "unknown_number", recipients: 1, failed: 0, skipped: 0 },
      ],
    ]);
    const today = await withFirm(t.f.firmId, (tx) => loadToday(tx, new Date()));
    expect(today.unknownMessages).toEqual([
      {
        messageId: expect.any(String),
        channel: "voice",
        from: STRANGER,
        text: "Hi it's Jo, about work",
        receivedAt: expect.any(Date),
        formerWorker: null,
        formerWorkerActive: false,
      },
    ]);
  });

  it("a withheld number: no message to anyone but the office, each voicemail alerted (there's no number to match), on Today without a number", async () => {
    const t = await lineFirm();
    await t.f.office("resourcer");
    const { transport, sent } = captureTransport();
    for (const text of ["It's Ann, can someone call me", "Ann again"]) {
      expect(await run(await voicemail(t, null, { text }), transport)).toEqual({
        status: "unknown_sender",
        reply: "none",
        alerted: 1,
      });
    }
    expect(sent.map((m) => m.channel)).toEqual(["email", "email"]);
    expect(await requestsOf(t.f.firmId)).toEqual([]);
    const today = await withFirm(t.f.firmId, (tx) => loadToday(tx, new Date()));
    expect(today.unknownMessages.map((m) => [m.channel, m.from, m.text]).sort()).toEqual([
      ["voice", null, "Ann again"],
      ["voice", null, "It's Ann, can someone call me"],
    ]);
  });
});

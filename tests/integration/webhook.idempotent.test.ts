import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noAi } from "@/lib/ai/client";
import { SEND_PORTAL_LINK_QUEUE } from "@/lib/auth/send-portal-link";
import { requestWorkerLoginLink } from "@/lib/auth/worker-login";
import { createLineDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { INBOUND_MESSAGE_QUEUE } from "@/lib/inbound/job";
import { receiveSms, receiveWhatsApp } from "@/lib/inbound/receive";
import { runInboundMessage } from "@/lib/inbound/reply";
import { twilioSignature } from "@/lib/inbound/twilio-signature";
import {
  handleTwilioTranscription,
  handleTwilioVoice,
  handleTwilioVoiceDone,
} from "@/lib/inbound/voice";
import { handleTwilioSms, handleTwilioWhatsApp } from "@/lib/inbound/webhook";
import { captureTransport } from "../helpers/auth";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// webhook.idempotent (docs/testing.md; golden rule 3): Twilio delivers a webhook again when it
// thinks the first try failed (a timeout, say), and anyone holding a captured request can replay
// it (the signature has no timestamp). Whatever arrives twice, or ten times at once, is stored once
// by Twilio's own id and gets one job; and the job run twice at once replies once. On the real
// database as the app role, through the real handlers; no Twilio (signed with a made-up token).

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(12); // room for ten copies at once
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const TOKEN = "idempotent-test-token-0123456789";
const BASE = "https://shiftdesk.test/api/webhooks/twilio";
const hex = () => randomBytes(16).toString("hex");
const COPIES = 10;

let nextLine = Math.floor(Math.random() * 400);
async function lineFirm() {
  // Automatic replies on: what these tests are about (off by default since P4.7).
  const f = await bookingFirm(su, withFirm, { settings: { auto_replies: true } });
  nextLine = (nextLine + 1) % 400;
  const line = `+447700900${600 + nextLine}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
  const ann = await f.worker({ first: "Ann" });
  const { rows } = await su.query<{ mobile: string }>(
    "select mobile_e164 as mobile from workers where id = $1",
    [ann],
  );
  const count = async (sql: string) =>
    Number((await su.query<{ n: string }>(sql, [f.firmId])).rows[0]?.n ?? "0");
  return {
    f,
    line,
    mobile: rows[0]?.mobile ?? "",
    messages: () =>
      count("select count(*) as n from messages where firm_id = $1 and direction = 'in'"),
    jobs: (queue: string) =>
      count(
        `select count(*) as n from pgboss.job where name = '${queue}' and data ->> 'firmId' = $1`,
      ),
    events: (action: string) =>
      count(`select count(*) as n from events where firm_id = $1 and action = '${action}'`),
  };
}

function signed(url: string, fields: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioSignature(TOKEN, url, fields),
    },
    body: new URLSearchParams(fields).toString(),
  });
}

const directory = () => createLineDirectory(app);
const whatsappDeps = () => ({
  authToken: TOKEN,
  webhookUrl: `${BASE}/whatsapp`,
  resolveFirmByLine: directory(),
  receive: (firmId: string, m: Parameters<typeof receiveWhatsApp>[1]) =>
    receiveWhatsApp(firmId, m, { run: withFirm }),
});
const smsDeps = () => ({
  authToken: TOKEN,
  webhookUrl: `${BASE}/sms`,
  resolveFirmByLine: directory(),
  receive: (firmId: string, m: Parameters<typeof receiveSms>[1]) =>
    receiveSms(firmId, m, { run: withFirm }),
});
const voiceDeps = () => ({
  authToken: TOKEN,
  voiceUrl: `${BASE}/voice`,
  transcriptionUrl: `${BASE}/voice/transcription`,
  doneUrl: `${BASE}/voice/done`,
  resolveFirmByLine: directory(),
  requestLink: (firm: { id: string }, mobile: string) =>
    requestWorkerLoginLink(
      { firm: { id: firm.id }, clientIp: `call:${mobile}`, run: withFirm, secret: "x".repeat(32) },
      mobile,
    ),
  run: withFirm,
});
const transcriptionDeps = () => ({
  authToken: TOKEN,
  webhookUrl: `${BASE}/voice/transcription`,
  resolveFirmByLine: directory(),
  run: withFirm,
});

// Every connection opened first, so copies sent together really overlap (with a cold pool the
// first finishes while the others are still connecting, and "at once" would prove nothing).
const warm = () =>
  Promise.all(Array.from({ length: COPIES + 2 }, () => app.query("select pg_sleep(0.05)")));

// The same delivery, twice in a row and then ten times at once: every copy answered 200.
async function deliver(send: () => Promise<Response>) {
  const statuses = [(await send()).status, (await send()).status];
  await warm();
  const together = await Promise.all(Array.from({ length: COPIES }, () => send()));
  return [...statuses, ...together.map((r) => r.status)];
}
const all200 = Array.from({ length: COPIES + 2 }, () => 200);

describe("webhook.idempotent: the same Twilio id again stores nothing more", () => {
  it("WhatsApp: the same MessageSid → one messages row, one job", async () => {
    const t = await lineFirm();
    const fields = {
      MessageSid: `SM${hex()}`,
      From: `whatsapp:${t.mobile}`,
      To: `whatsapp:${t.line}`,
      Body: "Any shifts?",
    };
    expect(
      await deliver(() => handleTwilioWhatsApp(signed(`${BASE}/whatsapp`, fields), whatsappDeps())),
    ).toEqual(all200);
    expect(await t.messages()).toBe(1);
    expect(await t.jobs(INBOUND_MESSAGE_QUEUE)).toBe(1);
  });

  it("text: the same MessageSid → one messages row, one job", async () => {
    const t = await lineFirm();
    const fields = { MessageSid: `SM${hex()}`, From: t.mobile, To: t.line, Body: "STOP" };
    expect(await deliver(() => handleTwilioSms(signed(`${BASE}/sms`, fields), smsDeps()))).toEqual(
      all200,
    );
    expect(await t.messages()).toBe(1);
    expect(await t.jobs(INBOUND_MESSAGE_QUEUE)).toBe(1);
  });

  it("a call: the same CallSid → one row, one call.received, one login link; every copy hears the message", async () => {
    const t = await lineFirm();
    const fields = { CallSid: `CA${hex()}`, From: t.mobile, To: t.line, CallStatus: "ringing" };
    const answers: string[] = [];
    expect(
      await deliver(async () => {
        const res = await handleTwilioVoice(signed(`${BASE}/voice`, fields), voiceDeps());
        answers.push(await res.clone().text());
        return res;
      }),
    ).toEqual(all200);
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toContain("We&apos;ve just sent a link");
    expect(await t.messages()).toBe(1);
    expect(await t.events("call.received")).toBe(1);
    expect(await t.jobs(SEND_PORTAL_LINK_QUEUE)).toBe(1);
  });

  it("a withheld call: the same CallSid → one row, one call.received, no link", async () => {
    const t = await lineFirm();
    const fields = { CallSid: `CA${hex()}`, From: "anonymous", To: t.line };
    expect(
      await deliver(() => handleTwilioVoice(signed(`${BASE}/voice`, fields), voiceDeps())),
    ).toEqual(all200);
    expect(await t.messages()).toBe(1);
    expect(await t.events("call.received")).toBe(1);
    expect(await t.jobs(SEND_PORTAL_LINK_QUEUE)).toBe(0);
  });

  it("a voicemail's text: the same RecordingSid → one row, one job", async () => {
    const t = await lineFirm();
    const fields = {
      CallSid: `CA${hex()}`,
      RecordingSid: `RE${hex()}`,
      TranscriptionStatus: "completed",
      TranscriptionText: "Please call me back",
      From: t.mobile,
      To: t.line,
    };
    expect(
      await deliver(() =>
        handleTwilioTranscription(
          signed(`${BASE}/voice/transcription`, fields),
          transcriptionDeps(),
        ),
      ),
    ).toEqual(all200);
    expect(await t.messages()).toBe(1);
    expect(await t.jobs(INBOUND_MESSAGE_QUEUE)).toBe(1);
  });

  it("the goodbye after a voicemail stores nothing: every copy gets the same answer", async () => {
    const t = await lineFirm();
    const fields = { CallSid: `CA${hex()}`, RecordingSid: `RE${hex()}` };
    const answers = new Set<string>();
    expect(
      await deliver(async () => {
        const res = await handleTwilioVoiceDone(signed(`${BASE}/voice/done`, fields), {
          authToken: TOKEN,
          webhookUrl: `${BASE}/voice/done`,
        });
        answers.add(await res.clone().text());
        return res;
      }),
    ).toEqual(all200);
    expect([...answers]).toEqual([
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-GB">Thank you. Goodbye.</Say><Hangup/></Response>',
    ]);
    expect(await t.messages()).toBe(0);
  });

  it("a different id is a different message (the key is Twilio's id, not the words)", async () => {
    const t = await lineFirm();
    for (let i = 0; i < 2; i += 1) {
      const fields = { MessageSid: `SM${hex()}`, From: t.mobile, To: t.line, Body: "Any shifts?" };
      await handleTwilioSms(signed(`${BASE}/sms`, fields), smsDeps());
    }
    expect(await t.messages()).toBe(2);
    expect(await t.jobs(INBOUND_MESSAGE_QUEUE)).toBe(2);
  });
});

describe("webhook.idempotent: the job for a message, run more than once, replies once", () => {
  it("the reply job run ten times at once for one message: one reply sent and stored", async () => {
    const t = await lineFirm();
    const fields = {
      MessageSid: `SM${hex()}`,
      From: `whatsapp:${t.mobile}`,
      To: `whatsapp:${t.line}`,
      Body: "Any shifts this weekend?",
    };
    await handleTwilioWhatsApp(signed(`${BASE}/whatsapp`, fields), whatsappDeps());
    const { rows } = await su.query<{ data: Record<string, unknown> }>(
      "select data from pgboss.job where name = $1 and data ->> 'firmId' = $2",
      [INBOUND_MESSAGE_QUEUE, t.f.firmId],
    );
    const job = rows[0]?.data ?? {};
    const { transport, sent } = captureTransport();
    await warm(); // so the ten runs really overlap
    const results = await Promise.all(
      Array.from({ length: COPIES }, () =>
        runInboundMessage(job as Parameters<typeof runInboundMessage>[0], withFirm, {
          transport,
          ai: noAi,
          baseDomain: "shiftdesk.test",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "replied")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already")).toHaveLength(COPIES - 1);
    expect(sent).toHaveLength(1);
    const { rows: out } = await su.query<{ n: string }>(
      "select count(*) as n from messages where firm_id = $1 and direction = 'out'",
      [t.f.firmId],
    );
    expect(Number(out[0]?.n)).toBe(1);
    expect(await t.events("message.replied")).toBe(1);
  });
});

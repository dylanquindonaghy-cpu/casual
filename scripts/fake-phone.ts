import { randomBytes } from "node:crypto";
import { twilioSignature } from "../src/lib/inbound/twilio-signature";
import { platformUrl } from "../src/lib/tenancy/portal-url";

// A fake phone for trying the shifts line on your own computer (Phase 10 task 20,
// docs/walkthrough.md): a WhatsApp, a text or a call to a firm's line, posted to the local web
// app's webhooks exactly as Twilio would post them, signed with the made-up TWILIO_AUTH_TOKEN in
// your .env (the webhooks refuse anything unsigned). Replies go through the console transport:
// they show in the `npm run dev` terminal. Only ever a local server: an address that isn't
// localhost is refused, so this can't post to a real one. `npm run sim:*` (scripts/sim.ts) and the
// walkthrough's browser test (tests/e2e/walkthrough.spec.ts) both use it.

export interface FakePhoneTarget {
  baseDomain: string; // APP_BASE_DOMAIN, e.g. localhost:3000
  authToken: string; // TWILIO_AUTH_TOKEN
}

export interface Answer {
  status: number;
  body: string;
}

const hex = () => randomBytes(16).toString("hex");

// localhost, or a name under it, with an optional port.
export function isLocalBaseDomain(baseDomain: string): boolean {
  return /^([a-z0-9-]+\.)*localhost(:\d{1,5})?$/.test(baseDomain);
}

async function post(
  target: FakePhoneTarget,
  path: string,
  fields: Record<string, string>,
): Promise<Answer> {
  if (!isLocalBaseDomain(target.baseDomain)) {
    throw new Error(
      `the fake phone only talks to a local server (APP_BASE_DOMAIN is ${target.baseDomain})`,
    );
  }
  const url = platformUrl(target.baseDomain, path);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioSignature(target.authToken, url, fields),
    },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, body: await res.text() };
}

// A WhatsApp from `from` to the firm's line `to` (both E.164).
export function fakeWhatsApp(
  target: FakePhoneTarget,
  message: { from: string; to: string; text: string },
): Promise<Answer> {
  return post(target, "/api/webhooks/twilio/whatsapp", {
    MessageSid: `SM${hex()}`,
    From: `whatsapp:${message.from}`,
    To: `whatsapp:${message.to}`,
    Body: message.text,
    NumMedia: "0",
  });
}

// A text from `from` to the firm's line `to`.
export function fakeSms(
  target: FakePhoneTarget,
  message: { from: string; to: string; text: string },
): Promise<Answer> {
  return post(target, "/api/webhooks/twilio/sms", {
    MessageSid: `SM${hex()}`,
    From: message.from,
    To: message.to,
    Body: message.text,
  });
}

export interface CallAnswer {
  answer: Answer;
  heard: string[]; // what the caller hears, in order
  voicemail?: Answer; // the transcription's post, when a voicemail was left
  goodbye?: Answer;
}

// The words the caller hears, from the server's TwiML.
export function spokenWords(twiml: string): string[] {
  return [...twiml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)].map((m) =>
    (m[1] ?? "")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}

// A call from `from` (null: a withheld number) to the firm's line `to`: what the caller hears,
// then, if `voicemail` is given, the message they leave after the tone, as Twilio's transcription
// posts it, and the call's end.
export async function fakeCall(
  target: FakePhoneTarget,
  call: { from: string | null; to: string; voicemail?: string },
): Promise<CallAnswer> {
  const base = "/api/webhooks/twilio/voice";
  const callSid = `CA${hex()}`;
  const answer = await post(target, base, {
    CallSid: callSid,
    AccountSid: `AC${hex()}`,
    From: call.from ?? "anonymous",
    To: call.to,
    CallStatus: "ringing",
    Direction: "inbound",
  });
  const result: CallAnswer = { answer, heard: spokenWords(answer.body) };
  if (call.voicemail === undefined || answer.status !== 200) return result;
  const recordingSid = `RE${hex()}`;
  result.voicemail = await post(target, `${base}/transcription`, {
    CallSid: callSid,
    RecordingSid: recordingSid,
    TranscriptionStatus: "completed",
    TranscriptionText: call.voicemail,
    ...(call.from ? { From: call.from } : {}),
    To: call.to,
  });
  result.goodbye = await post(target, `${base}/done`, {
    CallSid: callSid,
    RecordingSid: recordingSid,
  });
  return result;
}

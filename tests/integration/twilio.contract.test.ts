import { createHmac, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestWorkerLoginLink } from "@/lib/auth/worker-login";
import { createLineDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { receiveSms, receiveWhatsApp } from "@/lib/inbound/receive";
import { twilioSignature } from "@/lib/inbound/twilio-signature";
import {
  handleTwilioTranscription,
  handleTwilioVoice,
  handleTwilioVoiceDone,
} from "@/lib/inbound/voice";
import { handleTwilioSms, handleTwilioWhatsApp } from "@/lib/inbound/webhook";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Signature contract tests (Phase 7; docs/testing.md): requests as Twilio sends them, to each of
// our webhooks, on the real database as the app role.
// - The signer here is written from Twilio's published algorithm ("Validating signatures from
//   Twilio": the full URL, then each POST field's name and value sorted by name, HMAC-SHA1 keyed
//   with the auth token, base64), not taken from our code, and it reproduces Twilio's own
//   documented example first. So our checker (src/lib/inbound/twilio-signature.ts) is held to
//   Twilio's algorithm, not to itself.
// - The requests carry every field Twilio documents for each webhook (not only the ones we read),
//   sent as raw form bodies encoded the way a browser or Twilio does ("+" as %2B, spaces as "+" or
//   %20, UTF-8 for emoji and "£"). Twilio signs the decoded values, so we must decode before
//   checking.
// No Twilio account: the token is made up. When Twilio is connected, a few captured real requests
// (token changed) should be added here (PLAN.md Parking lot).

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

const TOKEN = "contract-test-token-0123456789abcd";
const BASE = "https://shiftdesk.test/api/webhooks/twilio";
const hex = () => randomBytes(16).toString("hex");
const ACCOUNT = `AC${hex()}`;

// Twilio's algorithm, as published.
function referenceSignature(token: string, url: string, params: [string, string][]): string {
  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const data = url + sorted.map(([name, value]) => name + value).join("");
  return createHmac("sha1", token).update(data, "utf8").digest("base64");
}

// A raw form body: each value percent-encoded as UTF-8, spaces as "+" (a browser form, and
// Twilio's usual) or %20.
function formBody(params: [string, string][], spaces: "+" | "%20" = "+"): string {
  const encode = (s: string) =>
    encodeURIComponent(s)
      .replace(/%20/g, spaces)
      .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return params.map(([name, value]) => `${encode(name)}=${encode(value)}`).join("&");
}

function twilioRequest(
  url: string,
  params: [string, string][],
  o: { spaces?: "+" | "%20"; type?: string; signature?: string } = {},
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": o.type ?? "application/x-www-form-urlencoded",
      "x-twilio-signature": o.signature ?? referenceSignature(TOKEN, url, params),
      "user-agent": "TwilioProxy/1.1",
      "i-twilio-idempotency-token": randomBytes(16).toString("hex"),
    },
    body: formBody(params, o.spaces),
  });
}

let nextLine = Math.floor(Math.random() * 400);
async function lineFirm() {
  const f = await bookingFirm(su, withFirm);
  nextLine = (nextLine + 1) % 400;
  const line = `+447700900${600 + nextLine}`;
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [line]);
  await su.query("update firms set shifts_line_e164 = $2 where id = $1", [f.firmId, line]);
  const ann = await f.worker({ first: "Ann" });
  const { rows } = await su.query<{ mobile: string; name: string }>(
    `select w.mobile_e164 as mobile, f.name from workers w join firms f on f.id = w.firm_id
      where w.id = $1`,
    [ann],
  );
  const stored = async () =>
    (
      await su.query<{
        channel: string;
        provider_message_id: string;
        from_e164: string | null;
        to_e164: string;
        body: string | null;
        twilio_opt_out: string | null;
      }>(
        `select channel, provider_message_id, from_e164, to_e164, body, twilio_opt_out
           from messages where firm_id = $1 and direction = 'in' order by created_at`,
        [f.firmId],
      )
    ).rows;
  return { f, line, ann, mobile: rows[0]?.mobile ?? "", name: rows[0]?.name ?? "", stored };
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

// The fields Twilio documents for each webhook, as a UK number's requests carry them.
const whatsappText = (t: { line: string; mobile: string }, body: string): [string, string][] => {
  const sid = `SM${hex()}`;
  return [
    ["SmsMessageSid", sid],
    ["NumMedia", "0"],
    ["ProfileName", "Ann 🌟 O'Brien"],
    ["MessageType", "text"],
    ["SmsSid", sid],
    ["WaId", t.mobile.slice(1)],
    ["SmsStatus", "received"],
    ["Body", body],
    ["To", `whatsapp:${t.line}`],
    ["NumSegments", "1"],
    ["ReferralNumMedia", "0"],
    ["MessageSid", sid],
    ["AccountSid", ACCOUNT],
    ["From", `whatsapp:${t.mobile}`],
    ["ApiVersion", "2010-04-01"],
  ];
};

const smsText = (t: { line: string; mobile: string }, body: string): [string, string][] => {
  const sid = `SM${hex()}`;
  return [
    ["ToCountry", "GB"],
    ["ToState", ""],
    ["SmsMessageSid", sid],
    ["NumMedia", "0"],
    ["ToCity", ""],
    ["FromZip", ""],
    ["SmsSid", sid],
    ["FromState", ""],
    ["SmsStatus", "received"],
    ["FromCity", ""],
    ["Body", body],
    ["FromCountry", "GB"],
    ["To", t.line],
    ["ToZip", ""],
    ["NumSegments", "1"],
    ["MessageSid", sid],
    ["AccountSid", ACCOUNT],
    ["From", t.mobile],
    ["ApiVersion", "2010-04-01"],
  ];
};

const incomingCall = (t: { line: string }, from: string, callSid: string): [string, string][] => [
  ["Called", t.line],
  ["ToState", ""],
  ["CallerCountry", "GB"],
  ["Direction", "inbound"],
  ["CallerState", ""],
  ["ToZip", ""],
  ["CallSid", callSid],
  ["To", t.line],
  ["CallerZip", ""],
  ["ToCountry", "GB"],
  ["CalledZip", ""],
  ["ApiVersion", "2010-04-01"],
  ["CalledCity", ""],
  ["CallStatus", "ringing"],
  ["From", from],
  ["AccountSid", ACCOUNT],
  ["CalledCountry", "GB"],
  ["CallerCity", ""],
  ["ToCity", ""],
  ["FromCountry", "GB"],
  ["Caller", from],
  ["FromCity", ""],
  ["CalledState", ""],
  ["FromZip", ""],
  ["FromState", ""],
];

describe("the signer these tests use is Twilio's algorithm", () => {
  it("reproduces Twilio's documented example, and agrees with ours on every request below", () => {
    // "Validating signatures from Twilio": auth token 12345.
    const example: [string, string][] = [
      ["CallSid", "CA1234567890ABCDE"],
      ["Caller", "+12349013030"],
      ["Digits", "1234"],
      ["From", "+12349013030"],
      ["To", "+18005551212"],
    ];
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    expect(referenceSignature("12345", url, example)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    const t = { line: "+447700900600", mobile: "+447700900123" };
    for (const [url2, params] of [
      [`${BASE}/whatsapp`, whatsappText(t, "Hi + £5 & 😀\nthanks")],
      [`${BASE}/sms`, smsText(t, "STOP")],
      [`${BASE}/voice`, incomingCall(t, t.mobile, `CA${hex()}`)],
    ] as const) {
      expect(twilioSignature(TOKEN, url2, Object.fromEntries(params))).toBe(
        referenceSignature(TOKEN, url2, [...params]),
      );
    }
  });
});

describe("WhatsApp, as Twilio sends it", () => {
  it("a text with every field Twilio sends: accepted, the words exactly as written ('+', '£', '&', emoji, a new line)", async () => {
    const t = await lineFirm();
    const words = "Hi + can I get shifts? £5 & 50% off 😀\nThanks, Ann";
    const params = whatsappText(t, words);
    for (const spaces of ["+", "%20"] as const) {
      const res = await handleTwilioWhatsApp(
        twilioRequest(`${BASE}/whatsapp`, params, { spaces }),
        whatsappDeps(),
      );
      expect(res.status).toBe(200);
    }
    expect(await t.stored()).toEqual([
      {
        channel: "whatsapp",
        provider_message_id: Object.fromEntries(params).MessageSid,
        from_e164: t.mobile,
        to_e164: t.line,
        body: words,
        twilio_opt_out: null,
      },
    ]);
  });

  it("a photo with no text (Twilio's media fields): accepted, no text stored", async () => {
    const t = await lineFirm();
    const params = whatsappText(t, "").map(([k, v]): [string, string] =>
      k === "NumMedia" ? [k, "1"] : k === "MessageType" ? [k, "image"] : [k, v],
    );
    params.push(
      ["MediaContentType0", "image/jpeg"],
      [
        "MediaUrl0",
        `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/MM${hex()}/Media/ME${hex()}`,
      ],
    );
    const res = await handleTwilioWhatsApp(
      twilioRequest(`${BASE}/whatsapp`, params),
      whatsappDeps(),
    );
    expect(res.status).toBe(200);
    expect((await t.stored()).map((m) => [m.channel, m.body])).toEqual([["whatsapp", null]]);
  });

  it("Twilio's content type with a charset is fine; anything that isn't Twilio's exact signing is refused", async () => {
    const t = await lineFirm();
    const params = whatsappText(t, "Any shifts this weekend?");
    const url = `${BASE}/whatsapp`;
    expect(
      (
        await handleTwilioWhatsApp(
          twilioRequest(url, params, { type: "application/x-www-form-urlencoded; charset=UTF-8" }),
          whatsappDeps(),
        )
      ).status,
    ).toBe(200);
    // Signed over the still-encoded values ("%2B44…"): not what Twilio signs.
    const encoded = params.map(([k, v]): [string, string] => [k, encodeURIComponent(v)]);
    const wrong = referenceSignature(TOKEN, url, encoded);
    // Signed for http rather than https, or for the SMS webhook's address.
    const http = referenceSignature(TOKEN, url.replace("https:", "http:"), params);
    const elsewhere = referenceSignature(TOKEN, `${BASE}/sms`, params);
    // A field dropped after signing (a proxy trimming it).
    const signedFull = referenceSignature(TOKEN, url, params);
    for (const [signature, sent] of [
      [wrong, params],
      [http, params],
      [elsewhere, params],
      [signedFull, params.filter(([k]) => k !== "ProfileName")],
    ] as const) {
      const res = await handleTwilioWhatsApp(
        twilioRequest(url, [...sent], { signature }),
        whatsappDeps(),
      );
      expect(res.status).toBe(403);
    }
    expect(await t.stored()).toHaveLength(1);
  });
});

describe("texts, as Twilio sends them", () => {
  it("a text with every field Twilio sends (empty ones too): accepted, stored as written", async () => {
    const t = await lineFirm();
    const params = smsText(t, "When do wages go in?");
    const res = await handleTwilioSms(twilioRequest(`${BASE}/sms`, params), smsDeps());
    expect(res.status).toBe(200);
    expect(await t.stored()).toEqual([
      {
        channel: "sms",
        provider_message_id: Object.fromEntries(params).MessageSid,
        from_e164: t.mobile,
        to_e164: t.line,
        body: "When do wages go in?",
        twilio_opt_out: null,
      },
    ]);
  });

  it("a STOP Twilio's opt-out handling acted on (OptOutType): kept as Twilio's", async () => {
    const t = await lineFirm();
    const params: [string, string][] = [...smsText(t, "Stop"), ["OptOutType", "STOP"]];
    const res = await handleTwilioSms(
      twilioRequest(`${BASE}/sms`, params, { spaces: "%20" }),
      smsDeps(),
    );
    expect(res.status).toBe(200);
    expect((await t.stored()).map((m) => [m.body, m.twilio_opt_out])).toEqual([["Stop", "stop"]]);
  });
});

describe("calls, as Twilio sends them", () => {
  it("an incoming call with every field Twilio sends: the spoken message, and the call stored", async () => {
    const t = await lineFirm();
    const callSid = `CA${hex()}`;
    const res = await handleTwilioVoice(
      twilioRequest(`${BASE}/voice`, incomingCall(t, t.mobile, callSid)),
      voiceDeps(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`We&apos;ve just sent a link to your phone`);
    expect(await t.stored()).toEqual([
      {
        channel: "voice",
        provider_message_id: callSid,
        from_e164: t.mobile,
        to_e164: t.line,
        body: null,
        twilio_opt_out: null,
      },
    ]);
  });

  it("a hidden caller ID, as Twilio's placeholder number: no link promised, stored without a number", async () => {
    const t = await lineFirm();
    const res = await handleTwilioVoice(
      twilioRequest(`${BASE}/voice`, incomingCall(t, "+266696687", `CA${hex()}`)),
      voiceDeps(),
    );
    expect(await res.text()).toContain("We can&apos;t see your number");
    expect((await t.stored()).map((m) => m.from_e164)).toEqual([null]);
  });

  it("the transcription callback and the recording's action, with Twilio's fields", async () => {
    const t = await lineFirm();
    const callSid = `CA${hex()}`;
    const recordingSid = `RE${hex()}`;
    const recording = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Recordings/${recordingSid}`;
    const transcription: [string, string][] = [
      ["TranscriptionSid", `TR${hex()}`],
      ["TranscriptionText", "Hi it's Ann, I'm running 20 minutes late for Saturday's shift."],
      ["TranscriptionStatus", "completed"],
      [
        "TranscriptionUrl",
        `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Transcriptions/TR${hex()}`,
      ],
      ["TranscriptionType", "fast"],
      ["RecordingSid", recordingSid],
      ["RecordingUrl", recording],
      ["CallSid", callSid],
      ["AccountSid", ACCOUNT],
      ["From", t.mobile],
      ["To", t.line],
      ["CallStatus", "completed"],
      ["ApiVersion", "2010-04-01"],
      ["Direction", "inbound"],
      ["url", `${BASE}/voice/transcription`],
    ];
    const stored = await handleTwilioTranscription(
      twilioRequest(`${BASE}/voice/transcription`, transcription),
      {
        authToken: TOKEN,
        webhookUrl: `${BASE}/voice/transcription`,
        resolveFirmByLine: directory(),
        run: withFirm,
      },
    );
    expect(stored.status).toBe(200);
    expect((await t.stored()).map((m) => [m.channel, m.provider_message_id, m.body])).toEqual([
      ["voice", recordingSid, "Hi it's Ann, I'm running 20 minutes late for Saturday's shift."],
    ]);
    const action: [string, string][] = [
      ...incomingCall(t, t.mobile, callSid).map(([k, v]): [string, string] =>
        k === "CallStatus" ? [k, "completed"] : [k, v],
      ),
      ["RecordingUrl", recording],
      ["RecordingDuration", "7"],
      ["RecordingSid", recordingSid],
      ["Digits", "hangup"],
    ];
    const bye = await handleTwilioVoiceDone(twilioRequest(`${BASE}/voice/done`, action), {
      authToken: TOKEN,
      webhookUrl: `${BASE}/voice/done`,
    });
    expect(await bye.text()).toContain("Thank you. Goodbye.");
  });
});

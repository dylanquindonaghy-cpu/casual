import { randomBytes } from "node:crypto";
import { twilioSignature } from "../../src/lib/inbound/twilio-signature";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// A call to Acme's shifts line, as Twilio would post it (signed with the e2e run's made-up key) to
// the platform's voice webhook: the real web app answers with what the caller hears, and the real
// job worker sends the caller's login link, which logs them in. Then the voicemail's text, as
// Twilio's transcription callback posts it, becomes a request for the office, and the worker gets
// its reference. A seeded Acme worker no other spec uses.

const base = "http://localhost:3100/api/webhooks/twilio/voice";
const worker = "+447700900114";
const acmeLine = "+447700900000";
const acme = "http://acme.localhost:3100";
const hex = () => randomBytes(16).toString("hex");
const sign = (url: string, fields: Record<string, string>) => ({
  "x-twilio-signature": twilioSignature(E2E_TWILIO_AUTH_TOKEN, url, fields),
});

test("a worker rings the shifts line: they hear the message, get their login link, and a voicemail reaches the office", async ({
  page,
  request,
}) => {
  const call = { CallSid: `CA${hex()}`, From: worker, To: acmeLine, CallStatus: "ringing" };
  const asked = new Date(Date.now() - 1000);
  const res = await request.post(base, { form: call, headers: sign(base, call) });
  expect(res.status()).toBe(200);
  const twiml = await res.text();
  expect(twiml).toContain(
    `<Say language="en-GB">Thanks for calling Acme Events. We&apos;ve just sent a link to your phone`,
  );
  expect(twiml).toContain(`transcribeCallback="${base}/transcription" action="${base}/done"/>`);

  // The link arrives and logs them in.
  const link = await loginLinkSentTo(worker, asked);
  expect(link.startsWith(`${acme}/l#`)).toBe(true);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
  await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();

  // Their voicemail, turned into text by Twilio: the office's request, and its reference to them.
  const voicemail = {
    CallSid: call.CallSid,
    RecordingSid: `RE${hex()}`,
    TranscriptionStatus: "completed",
    TranscriptionText: "Hi, it's about my shift on Saturday, please call me back (e2e)",
    From: worker,
    To: acmeLine,
  };
  const left = new Date(Date.now() - 1000);
  const stored = await request.post(`${base}/transcription`, {
    form: voicemail,
    headers: sign(`${base}/transcription`, voicemail),
  });
  expect(stored.status()).toBe(200);
  expect(
    await sentTo(
      worker,
      left,
      /(Thanks for your voicemail\. The office will see it and get back to you\. Ref [0-9A-F]{8}\. — Acme Events Shift Team)/,
    ),
  ).toBeTruthy();

  // After the recording: a goodbye. Unsigned posts are refused.
  const done = { CallSid: call.CallSid, RecordingSid: voicemail.RecordingSid };
  const bye = await request.post(`${base}/done`, {
    form: done,
    headers: sign(`${base}/done`, done),
  });
  expect(await bye.text()).toContain(`<Say language="en-GB">Thank you. Goodbye.</Say><Hangup/>`);
  for (const url of [base, `${base}/transcription`, `${base}/done`]) {
    expect((await request.post(url, { form: call })).status()).toBe(403);
  }
});

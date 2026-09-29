import { randomBytes } from "node:crypto";
import { twilioSignature } from "../../src/lib/inbound/twilio-signature";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// A WhatsApp to Acme's shifts line, as Twilio would post it (signed with the e2e run's made-up key)
// to the platform's webhook: the real web app stores it, the real job worker answers, and the
// reply reaches the outbox from Acme's line. A seeded Acme worker no other spec uses.

const webhook = "http://localhost:3100/api/webhooks/twilio/whatsapp";
const worker = "+447700900112";
const acmeLine = "+447700900000";

test("a worker's WhatsApp to the shifts line gets the open shifts link at once", async ({
  request,
}) => {
  const fields = {
    MessageSid: `SM${randomBytes(16).toString("hex")}`,
    From: `whatsapp:${worker}`,
    To: `whatsapp:${acmeLine}`,
    Body: "Any shifts this weekend?",
    NumMedia: "0",
  };
  const asked = new Date(Date.now() - 1000);
  const res = await request.post(webhook, {
    form: fields,
    headers: { "x-twilio-signature": twilioSignature(E2E_TWILIO_AUTH_TOKEN, webhook, fields) },
  });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("<Response></Response>");
  const reply = await sentTo(
    worker,
    asked,
    /(Open shifts you're eligible for: http:\/\/acme\.localhost:3100\/shifts\/open — Acme Events Shift Team)/,
  );
  expect(reply).toBeTruthy();

  // An unsigned post is refused.
  const refused = await request.post(webhook, { form: fields });
  expect(refused.status()).toBe(403);
});

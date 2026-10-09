import { randomBytes } from "node:crypto";
import { twilioSignature } from "../../src/lib/inbound/twilio-signature";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// A WhatsApp to Acme's shifts line, as Twilio would post it (signed with the e2e run's made-up key)
// to the platform's webhook: the real web app stores it, the real job worker answers, and the
// reply reaches the outbox from Acme's line. A seeded Acme worker no other spec uses; then a number
// nobody here has, which gets the polite reply while the office is alerted and sees it on Today.

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

test("a WhatsApp from a number we don't know gets the polite reply, and the office sees it on Today", async ({
  page,
  request,
}) => {
  // A different drama-range number each attempt (07700 900940-900979: no seeded worker has one),
  // so a retry within 24 hours isn't a repeat.
  const stranger = `+4477009009${40 + Math.floor(Math.random() * 40)}`;
  const email = "unknown.admin@example.com";
  await addOfficeUser("acme", { email, name: "Unknown Admin", role: "admin" });
  const fields = {
    MessageSid: `SM${randomBytes(16).toString("hex")}`,
    From: `whatsapp:${stranger}`,
    To: `whatsapp:${acmeLine}`,
    Body: "Hi it's Sam Smith, new phone (e2e)",
    NumMedia: "0",
  };
  const asked = new Date(Date.now() - 1000);
  const res = await request.post(webhook, {
    form: fields,
    headers: { "x-twilio-signature": twilioSignature(E2E_TWILIO_AUTH_TOKEN, webhook, fields) },
  });
  expect(res.status()).toBe(200);
  expect(
    await sentTo(
      stranger,
      asked,
      /(Thanks for your message\. We don't recognise this number\. If you work with Acme Events, reply with your full name and the office will get back to you\. — Acme Events Shift Team)/,
    ),
  ).toBeTruthy();
  // The office alert (no number, no message in it), then Today shows the message.
  await sentTo(
    email,
    asked,
    /(See the message on the office dashboard: http:\/\/acme\.localhost:3100\/office)/,
  );
  const loginAsked = new Date(Date.now() - 1000);
  await page.goto("http://acme.localhost:3100/office/login");
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await sentTo(email, loginAsked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/));
  await page.getByRole("button", { name: "Log me in" }).click();
  const unknown = page.getByRole("region", { name: "Messages from numbers we don't know" });
  await expect(unknown.getByText(new RegExp(`^\\+44 7700 ${stranger.slice(7)} · `))).toBeVisible();
  await expect(unknown.getByText("“Hi it's Sam Smith, new phone (e2e)”")).toBeVisible();
});

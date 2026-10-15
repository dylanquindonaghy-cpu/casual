import { randomBytes } from "node:crypto";
import { twilioSignature } from "../../src/lib/inbound/twilio-signature";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// A WhatsApp to Acme's shifts line, as Twilio would post it (signed with the e2e run's made-up key)
// to the platform's webhook: the real web app stores it, the real job worker answers, and the
// reply reaches the outbox from Acme's line. A seeded Acme worker no other spec uses; then a number
// nobody here has, which gets the polite reply while the office is alerted and sees it on
// Enquiries, waiting for a person (on Today until 12E.1).

const webhook = "http://localhost:3100/api/webhooks/twilio/whatsapp";
const worker = "+447700900112";
const acmeLine = "+447700900000";

test("a worker's WhatsApp to the shifts line gets her personal shifts reply at once", async ({
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
    // Her own reply (12D.2): what's in it depends on the seed's shifts and today's date; its frame
    // never does.
    /^(Hi [A-Za-z'-]+, [\s\S]*(?:Take one here|All open shifts): http:\/\/acme\.localhost:3100\/shifts\/open\nAutomatic reply\. Send OFFICE to reach a person\.\n— Acme Events Shift Team)$/,
  );
  expect(reply).toBeTruthy();

  // An unsigned post is refused.
  const refused = await request.post(webhook, { form: fields });
  expect(refused.status()).toBe(403);
});

test("a WhatsApp from a number we don't know gets the polite reply, and the office sees it on Enquiries", async ({
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
      /(Thanks for your message\. We don't recognise this number\. If you work with Acme Events, reply with your full name and the office will get back to you\. Automatic reply\. Send OFFICE to reach a person\. — Acme Events Shift Team)/,
    ),
  ).toBeTruthy();
  // The office alert (no number, no message in it), then Enquiries shows the message.
  await sentTo(
    email,
    asked,
    /(See it in Enquiries, under Need a person: http:\/\/acme\.localhost:3100\/office\/enquiries\?view=person)/,
  );
  const loginAsked = new Date(Date.now() - 1000);
  await page.goto("http://acme.localhost:3100/office/login");
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await sentTo(email, loginAsked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL("http://acme.localhost:3100/office");
  await page.goto("http://acme.localhost:3100/office/enquiries?view=person");
  const row = page
    .getByRole("region", { name: "Need a person" })
    .getByRole("listitem")
    .filter({ hasText: "“Hi it's Sam Smith, new phone (e2e)”" });
  await expect(row).toContainText("Unknown number");
  await expect(row).toContainText("Passed to a person, waiting");
});

import { randomBytes } from "node:crypto";
import { twilioSignature } from "../../src/lib/inbound/twilio-signature";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import { expect, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// A worker texts STOP to Acme's shifts line, as Twilio would post it (signed with the e2e run's
// made-up key) to the platform's SMS webhook: the real job worker turns their texts off and
// confirms by text, their profile says texts are off, and START turns them back on. A seeded Acme
// worker no other spec uses.

const webhook = "http://localhost:3100/api/webhooks/twilio/sms";
const worker = "+447700900115";
const acmeLine = "+447700900000";
const acme = "http://acme.localhost:3100";
const note = "Texts are off: you replied STOP to one of our texts.";

async function text(request: import("@playwright/test").APIRequestContext, body: string) {
  const fields = {
    MessageSid: `SM${randomBytes(16).toString("hex")}`,
    From: worker,
    To: acmeLine,
    Body: body,
  };
  const res = await request.post(webhook, {
    form: fields,
    headers: { "x-twilio-signature": twilioSignature(E2E_TWILIO_AUTH_TOKEN, webhook, fields) },
  });
  expect(res.status()).toBe(200);
}

test("a worker texts STOP: texts are off, confirmed by text, shown on their profile; START turns them back on", async ({
  page,
  request,
}) => {
  const stopped = new Date(Date.now() - 1000);
  await text(request, "STOP");
  expect(
    await sentTo(
      worker,
      stopped,
      /(You won't get texts from Acme Events now\. Reply START to turn them back on\. - Acme Events Shift Team)/,
    ),
  ).toBeTruthy();

  // Their profile says so.
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900115");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(worker, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
  await page.goto(`${acme}/profile`);
  await expect(page.getByRole("note")).toContainText(note);

  // START: back on, confirmed, and the note goes.
  const started = new Date(Date.now() - 1000);
  await text(request, "start");
  expect(
    await sentTo(
      worker,
      started,
      /(Texts from Acme Events are back on\. Reply STOP to turn them off\. - Acme Events Shift Team)/,
    ),
  ).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("heading", { name: "How we reach you" })).toBeVisible();
  await expect(page.getByText(note)).toHaveCount(0);

  // An unsigned post is refused.
  expect((await request.post(webhook, { form: { Body: "STOP" } })).status()).toBe(403);
});

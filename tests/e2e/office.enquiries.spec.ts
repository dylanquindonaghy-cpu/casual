import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { APIRequestContext, Page } from "@playwright/test";
import { twilioSignature } from "../../src/lib/inbound/twilio-signature";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import { addOfficeUser, cancelOwnShift, personalReplyScene } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Enquiries in a real browser (docs/office-v2.md 3.6; docs/screens.md `/office/enquiries`; 12D.1),
// at phone width: two WhatsApps from numbers nobody here has reach Acme's shifts line (signed as
// Twilio would, with the e2e run's made-up key) and the real worker answers each. A resourcer of
// this spec's own sees them in Need a person (the menu's badge, the honest banner), opens one, reads
// how it was answered, and replies: the reply reaches that number from Acme's line and the message
// leaves Need a person. The other is closed with a reason, with no reply. Numbers: 07700
// 900980-900998, which no seeded casual has.

const acme = "http://acme.localhost:3100";
const webhook = "http://localhost:3100/api/webhooks/twilio/whatsapp";
const acmeLine = "+447700900000";

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

// A WhatsApp to Acme's line, signed as Twilio would; returns the moment just before, for the outbox.
async function post(request: APIRequestContext, from: string, body: string): Promise<Date> {
  const fields = {
    MessageSid: `SM${randomBytes(16).toString("hex")}`,
    From: `whatsapp:${from}`,
    To: `whatsapp:${acmeLine}`,
    Body: body,
    NumMedia: "0",
  };
  const asked = new Date(Date.now() - 1000);
  const res = await request.post(webhook, {
    form: fields,
    headers: { "x-twilio-signature": twilioSignature(E2E_TWILIO_AUTH_TOKEN, webhook, fields) },
  });
  expect(res.status()).toBe(200);
  return asked;
}

async function whatsApp(request: APIRequestContext, from: string, body: string) {
  const asked = await post(request, from, body);
  // The worker has answered it: the polite reply to a number we don't know.
  await sentTo(from, asked, /^(Thanks for your message\. We don't recognise this number\.)/);
}

async function logIn(page: Page, email: string, name: string) {
  await addOfficeUser("acme", { email, name, role: "resourcer" });
  const loginAsked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await sentTo(email, loginAsked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

test("Need a person: reply to one unknown number, close another with a reason", async ({
  page,
  request,
}) => {
  // Two different numbers each attempt, so a retry within 24 hours isn't a repeat.
  const n = 980 + Math.floor(Math.random() * 9) * 2;
  const pat = `+447700900${n}`;
  const wrong = `+447700900${n + 1}`;
  const tag = randomBytes(3).toString("hex");
  const patWords = `Hello, I'm Pat, starting Saturday (e2e ${tag})`;
  const wrongWords = `Wrong number, sorry (e2e ${tag})`;
  await whatsApp(request, pat, patWords);
  await whatsApp(request, wrong, wrongWords);

  await logIn(page, "enquiries.resourcer@example.com", "Enquiries Resourcer");

  // The menu's Enquiries link carries the Need a person count (outside the link's name).
  const link = await menuLink(page, "Enquiries");
  await expect(link).toContainText(/\d+/);
  await link.click();
  await expect(page).toHaveURL(`${acme}/office/enquiries`);
  await expect(page.getByRole("heading", { name: "Enquiries", level: 1 })).toBeVisible();
  await expect(
    page.getByText("AI sorting isn't connected yet: messages without a keyword go to a person."),
  ).toBeVisible();
  await expect(
    page.getByText(/^\d+ enquir(y|ies) today · \d+ needs? a person, the oldest /),
  ).toBeVisible();
  await noSidewaysScroll(page);

  await page.getByRole("link", { name: /^Need a person \(\d+\)$/ }).click();
  await expect(page).toHaveURL(`${acme}/office/enquiries?view=person`);
  await expect(page.getByRole("link", { name: /^Need a person/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const waiting = page.getByRole("region", { name: "Need a person" });
  const patRow = waiting.getByRole("listitem").filter({ hasText: patWords });
  await expect(patRow).toContainText("Unknown number");
  await expect(patRow).toContainText("Passed to a person, waiting");
  await expect(patRow).toContainText(`“${patWords}”`);
  await patRow.getByRole("link", { name: "Unknown number" }).click();

  // The message's page: the conversation, how it was answered, and the answer box.
  await expect(page.getByRole("heading", { name: "Message from an unknown number" })).toBeVisible();
  const talk = page.getByRole("region", { name: "The conversation" });
  await expect(talk.getByText(patWords)).toBeVisible();
  await expect(
    talk.getByText(/^Thanks for your message\. We don't recognise this number\./),
  ).toBeVisible();
  const how = page.getByRole("region", { name: "How it was answered" });
  await expect(how.getByRole("listitem").nth(0)).toContainText(
    `from ${pat}, a number that isn't one of your casuals'`,
  );
  await expect(how).toContainText("Not one of your casuals' numbers: passed to a person.");
  await expect(how).toContainText("Checks made by code: No checks recorded.");
  await expect(how).toContainText("The reply asking a number we don't know for their full name.");
  await expect(how).toContainText("Then: Waiting for a person.");
  await expect(page.getByRole("region", { name: "Considered but not offered" })).toContainText(
    "No checks recorded.",
  );
  const answer = page.getByRole("region", { name: "Answer it" });
  await expect(
    answer.getByText("Inside WhatsApp's 24-hour window: your words go as they are."),
  ).toBeVisible();
  await noSidewaysScroll(page);

  const replyWords = `Welcome Pat, we'll add your number now (e2e ${tag}).`;
  const replied = new Date(Date.now() - 1000);
  await answer.getByLabel("Reply").fill(replyWords);
  await answer.getByRole("button", { name: "Send reply" }).click();
  await expect(answer.getByRole("status")).toHaveText(
    "Your reply is on its way: it goes on WhatsApp in a moment.",
  );
  // The worker sends it from Acme's line, signed.
  const escaped = replyWords.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await sentTo(pat, replied, new RegExp(`^(${escaped} — Acme Events Shift Team)$`));
  // Once sent, the page says so, and it isn't waiting any more.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Passed to a person, answered")).toBeVisible({ timeout: 1000 });
    await expect(how).toContainText(
      /Enquiries Resourcer replied at .* \(on WhatsApp, in their own words\): sent\./,
      {
        timeout: 1000,
      },
    );
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Answer it" })).toHaveCount(0);

  // The other one: closed with a reason, no reply.
  await page.goto(`${acme}/office/enquiries?view=person`);
  const wrongRow = page
    .getByRole("region", { name: "Need a person" })
    .getByRole("listitem")
    .filter({ hasText: wrongWords });
  await wrongRow.getByRole("link", { name: "Unknown number" }).click();
  const closeBox = page.getByRole("region", { name: "Answer it" });
  await closeBox.getByLabel("Why close it?").selectOption({ label: "Not for us" });
  const closedAt = new Date(Date.now() - 1000);
  await closeBox.getByRole("button", { name: "Close without a reply" }).click();
  await expect(closeBox.getByRole("status")).toHaveText("Closed. No reply was sent.");
  await page.reload();
  await expect(page.getByRole("region", { name: "How it was answered" })).toContainText(
    /Enquiries Resourcer closed it at .* without a reply: not for us\./,
  );
  await page.goto(`${acme}/office/enquiries?view=person`);
  const left = page.getByRole("region", { name: "Need a person" });
  await expect(left.getByText(patWords)).toHaveCount(0);
  await expect(left.getByText(wrongWords)).toHaveCount(0);
  // Nothing went to that number after it was closed (closing queues no message: give the worker a
  // moment anyway).
  await page.waitForTimeout(1500);
  const outbox = (await readFile(".dev/e2e-outbox.jsonl", "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { at: string; to: string });
  expect(outbox.filter((l) => l.to === wrong && new Date(l.at) >= closedAt)).toEqual([]);

  // "Requests from the app" is the old Requests page.
  await page.getByRole("link", { name: "Requests from the app" }).click();
  await expect(page).toHaveURL(`${acme}/office/enquiries?view=app`);
  await expect(page.getByRole("region", { name: "Waiting for an answer" })).toBeVisible();
});

// Personal replies (12D.2; docs/office-v2.md 3.6, 5.7): two casuals of this spec's own ask Acme's
// line for shifts (tests/e2e/db.ts personalReplyScene: response team lead sessions nobody else can
// see). Zoe, who holds CSAS, gets two sessions listed, the CSAS one marked; Noor, who doesn't, gets
// one. On Zoe's message the office reads each check made by code with its figures, the sessions
// the reply listed, and the one left out: "Response team lead: needs first aid at work …"; on
// Noor's, the CSAS session left out. Numbers 07700 900631 and 900632, which nothing else uses.
const ZOE = { firstName: "Zoe", lastName: "Marsh", mobileE164: "+447700900631" };
const NOOR = { firstName: "Noor", lastName: "Hale", mobileE164: "+447700900632" };
const DATE = /\d{1,2} [A-Z][a-z]{2}( \d{4})?/.source;

test("a casual's personal shift list: each check, the sessions listed and the one left out", async ({
  page,
  request,
}) => {
  const scene = await personalReplyScene("acme", ZOE, NOOR);
  const [eventName = "", siteName = ""] = scene.names;
  try {
    // Zoe's reply: both sessions she can take, the CSAS one marked, and nothing more.
    const zoeAsked = await post(request, ZOE.mobileE164, "Any shifts?");
    const zoeReply = await sentTo(
      ZOE.mobileE164,
      zoeAsked,
      /^(Hi Zoe, shifts you can take:[\s\S]*)$/,
    );
    const line = `Response team lead · ${eventName}, ${siteName} · `;
    expect(zoeReply).toContain(`1. ${line}`);
    expect(zoeReply).toMatch(
      / · £14\.50\/h · Main gate\n {3}\d+\.\d miles · 20 min by car · no public transport by \d\d:\d\d\n/,
    );
    expect(zoeReply).toMatch(/\n2\. Response team lead · [^\n]* · you hold CSAS\n/);
    expect(zoeReply).not.toContain("\n3. ");
    expect(zoeReply).not.toContain("ZZ");
    expect(zoeReply).toMatch(
      /Take one here: http:\/\/acme\.localhost:3100\/shifts\/open\nAutomatic reply\. Send OFFICE to reach a person\.\n— Acme Events Shift Team$/,
    );
    // Noor's: only the plain one (no CSAS).
    const noorAsked = await post(request, NOOR.mobileE164, "Any shifts?");
    const noorReply = await sentTo(
      NOOR.mobileE164,
      noorAsked,
      /^(Hi Noor, shifts you can take:[\s\S]*)$/,
    );
    expect(noorReply).toContain(`1. ${line}`);
    expect(noorReply).not.toContain("\n2. ");
    expect(noorReply).not.toContain("CSAS");

    await logIn(page, "replies.resourcer@example.com", "Replies Resourcer");
    await page.goto(`${acme}/office/enquiries`);
    await page.getByRole("link", { name: "Zoe Marsh" }).first().click();
    await expect(page.getByRole("heading", { name: "Message from Zoe Marsh" })).toBeVisible();
    const how = page.getByRole("region", { name: "How it was answered" });
    // Each check made by code, with its figures, for both sessions.
    const checks = how.getByRole("listitem").filter({ hasText: "Checks made by code:" });
    await expect(checks).toContainText(`Response team lead · ${eventName}, ${siteName}, `);
    await expect(checks).toContainText("Has the response team lead role ✓");
    await expect(checks).toContainText(
      new RegExp(`SIA door supervisor licence valid to ${DATE} ✓`),
    );
    await expect(checks).toContainText("Rest gap 16 h ✓");
    await expect(checks).toContainText("Clash: none ✓");
    await expect(checks).toContainText(/Weekly hours \d+\/48 ✓/);
    await expect(checks).toContainText("Not a day off ✓");
    await expect(checks).toContainText("Site allowed ✓");
    await expect(checks).toContainText("Showing to casuals ✓");
    await expect(checks).toContainText("Inside travel area (20 min by car, limit 45 min) ✓");
    await expect(checks).toContainText(
      new RegExp(`CSAS accreditation valid to ${DATE} \\(this session needs it\\) ✓`),
    );
    // The sessions the reply listed, each a link to the session.
    const built = how.getByRole("listitem").filter({ hasText: "Reply built:" });
    await expect(built).toContainText("The personal shift list, with 2 sessions:");
    // (The scene's names are letters, digits and spaces only: safe in a pattern as they are.)
    const listed = new RegExp(`^Response team lead · ${eventName}, ${siteName}, `);
    await expect(built.getByRole("link", { name: listed })).toHaveCount(2);
    await expect(built.getByRole("link").first()).toHaveAttribute(
      "href",
      `/office/shifts/${scene.plain}`,
    );
    // Left out: the session that also needs first aid.
    const left = page.getByRole("region", { name: "Considered but not offered" });
    await expect(left).toContainText(
      "Response team lead: needs first aid at work certificate (none on file)",
    );
    await expect(left.getByRole("listitem")).toHaveCount(1);
    await noSidewaysScroll(page);

    // Noor's message: the CSAS session is left out for her.
    await page.goto(`${acme}/office/enquiries`);
    await page.getByRole("link", { name: "Noor Hale" }).first().click();
    const noorLeft = page.getByRole("region", { name: "Considered but not offered" });
    await expect(noorLeft).toContainText(
      "Response team lead: needs CSAS accreditation (none on file)",
    );
    await expect(noorLeft).toContainText(
      "Response team lead: needs first aid at work certificate (none on file)",
    );
    await expect(
      page
        .getByRole("region", { name: "How it was answered" })
        .getByRole("listitem")
        .filter({ hasText: "Reply built:" }),
    ).toContainText("The personal shift list, with 1 session:");
  } finally {
    for (const id of [scene.plain, scene.firstAid, scene.csas, scene.booked]) {
      await cancelOwnShift("acme", id);
    }
  }
});

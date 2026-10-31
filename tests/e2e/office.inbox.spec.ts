import { randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { signedHeaders } from "../../src/lib/integrations/sign";
import { E2E_EMAIL_INBOUND_SECRET } from "../../playwright.config";
import { addOfficeUser, emailSorted, inboxScene } from "./db";
import { expect, test } from "./fixtures";
import { emailSentTo, readOutbox, sentTo } from "./outbox";

// The staffing inbox in Enquiries (P7.4, P7.5; Phase 25.5; docs/screens.md "The staffing inbox in
// Enquiries"), in a real browser at phone width and beside the list on a laptop: Acme gets an inbox
// address, and a made-up casual of this spec's own has an email address on file. Two emails come in
// as the provider would send them (signed with the e2e run's made-up key): the casual's, which the
// real worker sorts (no keyword and no AI: for a person), and one from an address that isn't a
// casual's (left for the firm's own inbox). A resourcer sees both on Enquiries, opens the casual's
// email, and replies by email: it goes to the address on file, with Acme's inbox as its Reply-To,
// and the email leaves Need a person. Made-up people and addresses only (number 07700 900971).

const acme = "http://acme.localhost:3100";
const webhook = "http://localhost:3100/api/webhooks/email";
const inbox = "staffing.acme@inbound.example.test";
const casual = "ira.inbox@example.com";
const key = Buffer.from(E2E_EMAIL_INBOUND_SECRET.slice("whsec_".length), "base64");

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

// An email to Acme's inbox, signed as the provider would; returns its Message-ID.
async function email(
  request: APIRequestContext,
  o: { from: string; subject: string; text: string },
): Promise<string> {
  const messageId = `<${randomBytes(8).toString("hex")}@mail.example.test>`;
  const body = JSON.stringify({
    message_id: messageId,
    from: o.from,
    to: [inbox],
    authenticated: true,
    subject: o.subject,
    text: o.text,
  });
  const id = `msg_${randomBytes(6).toString("hex")}`;
  const res = await request.post(webhook, {
    data: body,
    headers: { ...signedHeaders(key, id, Math.floor(Date.now() / 1000), body) },
  });
  expect(res.status()).toBe(200);
  // The worker has sorted it.
  await expect.poll(() => emailSorted("acme", messageId), { timeout: 20_000 }).toBe(true);
  return messageId;
}

async function logIn(page: Page, address: string, name: string) {
  await addOfficeUser("acme", { email: address, name, role: "resourcer" });
  const loginAsked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(address);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(
    await sentTo(address, loginAsked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/),
  );
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

test("an email in Enquiries: the casual's answered by email, another left for the inbox", async ({
  page,
  request,
}) => {
  await inboxScene("acme", {
    inbox,
    firstName: "Ira",
    lastName: "Inbox",
    mobileE164: "+447700900971",
    email: casual,
  });
  const tag = randomBytes(3).toString("hex");
  const subject = `Briefing ${tag}`;
  await email(request, {
    from: casual,
    subject,
    text: `Is the briefing on Tuesday still at nine? (e2e ${tag})`,
  });
  await email(request, {
    from: "venue.manager@example.org",
    subject: `Invoice ${tag}`,
    text: "Please see attached.",
  });

  await logIn(page, "inbox.resourcer@example.com", "Inbox Resourcer");
  await page.goto(`${acme}/office/enquiries`);

  // The casual's email: the envelope's word, their name, the chip, the subject, their words.
  const theirs = page.getByRole("listitem").filter({ hasText: subject });
  await expect(theirs).toContainText("Email:");
  await expect(theirs).toContainText("Ira Inbox");
  await expect(theirs).toContainText("Passed to a person, waiting");
  await expect(theirs).toContainText(`“Is the briefing on Tuesday still at nine? (e2e ${tag})”`);
  // The other: left for the inbox, its words never kept here.
  const other = page
    .getByRole("listitem")
    .filter({ hasText: "Unknown address" })
    .filter({ hasText: "Left for your inbox" })
    .first();
  await expect(other).toContainText(
    "(Not from one of your casuals: its words aren't kept. It's in your own inbox.)",
  );
  await expect(page.getByText(`Invoice ${tag}`)).toHaveCount(0);
  await noSidewaysScroll(page);

  // Its own page.
  await theirs.getByRole("link", { name: "Ira Inbox" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Email from Ira Inbox" })).toBeVisible();
  await expect(page.getByText(`Subject: ${subject}`)).toBeVisible();
  // How it was answered, from logged facts (no AI in the e2e run).
  await expect(
    page.getByRole("listitem").filter({
      hasText: /^Received: Email at \d\d:\d\d on .+, from Ira Inbox's address\.$/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({
      hasText: "Sorted: AI not available: passed to a person (not connected).",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Then: Waiting for a person." }),
  ).toBeVisible();
  // No AI in the e2e run: an empty box, no draft.
  const box = page.getByLabel("Reply by email");
  await expect(box).toHaveValue("");
  await expect(
    page.getByText(
      `It goes to Ira's email address on file, signed "Acme Events Shift Team". Their reply comes back here.`,
    ),
  ).toBeVisible();
  await noSidewaysScroll(page);

  const sentAfter = new Date(Date.now() - 1000);
  const words = `Yes, nine o'clock as planned (e2e ${tag}).`;
  await box.fill(words);
  await page.getByRole("button", { name: "Send reply by email" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your reply is on its way: it goes by email in a moment." }),
  ).toBeVisible();

  // It goes to the address on file, with the inbox as its Reply-To.
  const sent = await emailSentTo(casual, sentAfter, new RegExp(`^Re: Briefing ${tag}$`));
  expect(sent.body).toBe(`Hi Ira,\n\n${words}\n\n— Acme Events Shift Team`);
  const raw = (await readOutbox<{ to: string; subject: string; replyTo?: string }>()).filter(
    (l) => l.to === casual && l.subject === `Re: ${subject}`,
  );
  expect(raw.at(-1)?.replyTo).toBe(inbox);

  // Out of Need a person, and on a laptop beside the list with what came of it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${acme}/office/enquiries?view=person`);
  await expect(page.getByRole("listitem").filter({ hasText: subject })).toHaveCount(0);
  await page.goto(`${acme}/office/enquiries`);
  await page.getByRole("listitem").filter({ hasText: subject }).getByRole("link").click();
  const pane = page.locator("section[data-chosen-message]");
  await expect(pane.getByRole("heading", { name: "Email from Ira Inbox" })).toBeVisible();
  await expect(pane.getByText("Passed to a person, answered")).toBeVisible();
  await expect(pane.getByText(words)).toBeVisible();
  await expect(
    pane.getByText(/Inbox Resourcer replied at .+ \(by email, in their own words\)/),
  ).toBeVisible();
  await noSidewaysScroll(page);
});

import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { addOfficeUser, messagesScene } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// Messages in the app (P8; Phase 25.6; docs/screens.md "Messages: the in-app chat"), in a real
// browser on a phone: a made-up casual of this spec's own opens the new Messages tab, asks about
// pay and is answered at once in the app (the real worker sorts it: a keyword), then asks the
// office something no keyword matches (no AI in the e2e run: for a person) and is told so. A
// resourcer finds it on Enquiries with the speech bubbles, in the app, and replies; back on her
// phone the Messages tab counts the reply, she opens it, and the count is gone. Nothing goes by
// WhatsApp or text. Made-up people only (number 07700 900972).

const acme = "http://acme.localhost:3100";
const KAY = { firstName: "Kay", lastName: "Messager", mobileE164: "+447700900972" };

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

test("Messages: answered at once in the app, then the office's reply, counted on the tab", async ({
  page,
  browser,
}) => {
  await messagesScene("acme", KAY);
  const tag = randomBytes(3).toString("hex");
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900972");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(KAY.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: "Hi Kay" })).toBeVisible();

  // The fifth tab.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link")).toHaveText([
    "Home",
    "Shifts",
    "Messages",
    "Pay",
    /Profile$/,
  ]);
  await tabs.getByRole("link", { name: "Messages" }).click();
  await expect(page).toHaveURL(`${acme}/messages`);
  await expect(page.getByRole("heading", { level: 1, name: "Messages" })).toBeVisible();
  await expect(
    page.getByText(
      "Write to the office here. Questions about your shifts, cancelling or pay are answered at once.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No messages yet. Ask about your shifts, cancelling or pay, or write to the office.",
    ),
  ).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Messages" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await noSidewaysScroll(page);

  const box = page.getByLabel("Write to the office");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await send.click();
  await expect(page.getByRole("alert").filter({ hasText: "Write a message first." })).toBeVisible();

  // Pay: answered at once, in the app, with the link to the pay page (a link: it's the firm's own).
  await box.fill(`When do I get paid? (e2e ${tag})`);
  await send.click();
  const thread = page.getByRole("list", { name: "Your messages" });
  await expect(
    thread.getByRole("listitem").filter({ hasText: `When do I get paid? (e2e ${tag})` }),
  ).toBeVisible();
  const payAnswer = thread
    .getByRole("listitem")
    .filter({ hasText: "Your hours, rates and pay dates:" });
  await expect(payAnswer).toBeVisible({ timeout: 20_000 });
  await expect(payAnswer).toContainText("Automatic reply. Send OFFICE to reach a person.");
  await expect(payAnswer).toContainText("— Acme Events Shift Team");
  await expect(payAnswer.getByRole("link", { name: `${acme}/pay` })).toHaveAttribute(
    "href",
    `${acme}/pay`,
  );
  await expect(box).toHaveValue("");

  // A question for the office: "Sent. The answer comes here.", then the reference.
  const question = `Can I bring my own radio? (e2e ${tag})`;
  await box.fill(question);
  await send.click();
  await expect(thread.getByRole("listitem").filter({ hasText: question })).toBeVisible();
  const officeAnswer = thread
    .getByRole("listitem")
    .filter({ hasText: "The office will see this and get back to you. Ref" });
  await expect(officeAnswer).toBeVisible({ timeout: 20_000 });
  await noSidewaysScroll(page);

  // The office: on Enquiries with the speech bubbles, in the app; replied to there.
  const office = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const desk = await office.newPage();
  const address = `messages.resourcer.${tag}@example.com`;
  await addOfficeUser("acme", { email: address, name: "Messages Resourcer", role: "resourcer" });
  const loginAsked = new Date(Date.now() - 1000);
  await desk.goto(`${acme}/office/login`);
  await desk.getByLabel("Your work email").fill(address);
  await desk.getByRole("button", { name: "Send me a link" }).click();
  await desk.goto(
    await sentTo(address, loginAsked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/),
  );
  await desk.getByRole("button", { name: "Log me in" }).click();
  await expect(desk).toHaveURL(`${acme}/office`);
  await desk.goto(`${acme}/office/enquiries?view=person`);
  const row = desk.getByRole("listitem").filter({ hasText: question });
  await expect(row).toContainText("In the app:");
  await expect(row).toContainText("Kay Messager");
  await expect(row).toContainText("Passed to a person, waiting");
  await row.getByRole("link", { name: "Kay Messager" }).click();
  await expect(
    desk.getByRole("heading", { level: 1, name: "Message from Kay Messager" }),
  ).toBeVisible();
  await expect(
    desk.getByRole("listitem").filter({
      hasText: /^Received: In the app at \d\d:\d\d on .+, from Kay Messager\.$/,
    }),
  ).toBeVisible();
  await expect(
    desk.getByRole("listitem").filter({ hasText: /^Sent: Shown in the app at \d\d:\d\d on .+\.$/ }),
  ).toBeVisible();
  await expect(
    desk.getByText("In the app: your words go as they are, and they get a notification."),
  ).toBeVisible();
  const words = `Yes, bring it charged (e2e ${tag}).`;
  await desk.getByLabel("Reply").fill(words);
  await desk.getByRole("button", { name: "Send reply" }).click();
  await expect(
    desk
      .getByRole("status")
      .filter({ hasText: "Your reply is on its way: it shows in their app in a moment." }),
  ).toBeVisible();
  await noSidewaysScroll(desk);
  await office.close();

  // Back on her phone: the tab counts it; opening Messages shows it and clears the count.
  await page.goto(`${acme}/`);
  const counted = tabs.getByRole("link", { name: "Messages, 1 new reply" });
  await expect(counted).toBeVisible();
  await counted.click();
  const reply = thread.getByRole("listitem").filter({ hasText: words });
  await expect(reply).toContainText(`${words} — Acme Events Shift Team`);
  await expect(reply).toContainText("From the office");
  await expect(tabs.getByRole("link", { name: "Messages", exact: true })).toBeVisible();
  await expect(page.locator("[data-messages-count]")).toHaveCount(0);

  // On a laptop too: nothing sideways.
  await page.setViewportSize({ width: 1280, height: 900 });
  await noSidewaysScroll(page);
});

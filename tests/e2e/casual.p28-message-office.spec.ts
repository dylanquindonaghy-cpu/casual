import { randomBytes } from "node:crypto";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo, sentTo } from "./outbox";
import { messageOfficeScene, P28_6_CASUAL, P28_6_TYPED } from "./p28/28-6-data";
import { payFromMessages } from "./p29/29-1-data";

// Phase 28, 28.6 (docs/screens.md "### 28.6"; docs/messaging-templates.md "Messages in the app"):
// Message the office about a shift, in a real browser. A made-up casual of this spec's own
// (tests/e2e/p28/28-6-data.ts) opens 28.2's link, /messages?shift={id}&about=late, for the shift
// she's booked on: the About line sits above "Your message", and the box holds the ready sentence.
// She finishes it and sends it: "Sent. The office will answer here.", the address loses the shift
// and the About line goes. The real worker passes it to a person, never the automatic sorter (no
// automatic answer). A resourcer finds it in Need a person; its page says "About: Steward, {day}
// {time}", linked to the session, and why it went to a person. A link the app doesn't make (an
// unknown topic) shows no About line. Then screenshots of both pages on a phone (390px) and on
// Dylan's laptop (1,280px at 150%), light and dark, attached to the run's report.

const acme = "http://acme.localhost:3100";
const IP = { "x-real-ip": "10.240.28.6" };
const NAME = `${P28_6_CASUAL.firstName} ${P28_6_CASUAL.lastName}`;

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

async function logInCasual(page: Page): Promise<void> {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(P28_6_TYPED);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(P28_6_CASUAL.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: `Hi ${P28_6_CASUAL.firstName}` })).toBeVisible();
}

async function logInOffice(browser: Browser, tag: string): Promise<BrowserContext> {
  const office = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: IP,
  });
  const desk = await office.newPage();
  const address = `p28-6.resourcer.${tag}@example.com`;
  await addOfficeUser("acme", {
    email: address,
    name: "Message Office Resourcer",
    role: "resourcer",
  });
  const asked = new Date(Date.now() - 1000);
  await desk.goto(`${acme}/office/login`);
  await desk.getByLabel("Your work email").fill(address);
  await desk.getByRole("button", { name: "Send me a link" }).click();
  await desk.goto(await sentTo(address, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/));
  await desk.getByRole("button", { name: "Log me in" }).click();
  await expect(desk).toHaveURL(`${acme}/office`);
  await desk.close();
  return office;
}

test("Message the office about a shift: the About line and a ready sentence, sent to a person, named on Enquiries", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const tag = randomBytes(3).toString("hex");
  const scene = await messageOfficeScene(tag);
  await logInCasual(page);
  const casual: Session = await page.context().storageState();

  // A link the app doesn't make (an unknown topic): no About line, an empty box, as before.
  await page.goto(`${acme}/messages?shift=${scene.shiftId}&about=dispute`);
  await expect(page.getByRole("heading", { level: 1, name: "Messages" })).toBeVisible();
  await expect(page.locator("[data-about-shift]")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your message", exact: true })).toHaveValue("");

  // 28.2's link for running late.
  const link = `${acme}/messages?shift=${scene.shiftId}&about=late`;
  await page.goto(link);
  await expect(
    page.getByText(
      "Ask about shifts, cancelling or pay for an answer straight away, or ask the office anything else. If your pay looks wrong, raise a pay query on the Pay page: it goes to payroll.",
    ),
  ).toBeVisible();
  await expect(page.getByText("No messages yet.")).toBeVisible();
  const aboutLine = page.locator("[data-about-shift]");
  await expect(aboutLine).toBeVisible();
  await expect(aboutLine).toHaveText(/^About: Steward · \w{3} \d{1,2} \w{3}, \d\d:\d\d$/);
  // By role and name: the ready sentence is inside the box's <label>, so a label-text match
  // would read "Your message I'm running late…"; the accessible name is "Your message".
  const box = page.getByRole("textbox", { name: "Your message", exact: true });
  await expect(box).toHaveValue("I'm running late. I'll be there about …");
  // Screen readers hear the About line with the box.
  await expect(box).toHaveAccessibleDescription(/^About: Steward · /);
  // The About line sits above the box.
  const lineBox = await aboutLine.boundingBox();
  const fieldBox = await box.boundingBox();
  expect(lineBox && fieldBox && lineBox.y + lineBox.height <= fieldBox.y).toBe(true);
  await noSidewaysScroll(page);

  // She finishes the sentence and sends it.
  const words = `I'm running late. I'll be there about 10:45 (e2e ${tag})`;
  await box.fill(words);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sent. The office will answer here." }),
  ).toBeVisible();
  const thread = page.getByRole("list", { name: "Your messages" });
  await expect(thread.getByRole("listitem").filter({ hasText: words })).toBeVisible();
  // The address loses the shift, and the About line goes: her next message is about nothing.
  await expect(page).toHaveURL(`${acme}/messages`);
  await expect(page.locator("[data-about-shift]")).toHaveCount(0);
  await expect(box).toHaveValue("");

  // The office: a person's question in Need a person (the worker has handled it by then).
  const office = await logInOffice(browser, tag);
  const desk = await office.newPage();
  const row = desk.getByRole("listitem").filter({ hasText: words });
  await expect(async () => {
    await desk.goto(`${acme}/office/enquiries?view=person`);
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(row).toContainText("In the app:");
  await expect(row).toContainText(NAME);
  await expect(row).toContainText("Passed to a person, waiting");
  const href = await row.getByRole("link", { name: NAME }).getAttribute("href");
  expect(href).toMatch(/^\/office\/enquiries\/[0-9a-f-]{36}$/);
  await row.getByRole("link", { name: NAME }).click();
  await expect(desk.getByRole("heading", { level: 1, name: `Message from ${NAME}` })).toBeVisible();
  const about = desk.locator("[data-about-session]");
  await expect(about).toHaveText(/^About: Steward, \w{3} \d{1,2} \w{3} \d\d:\d\d$/);
  await expect(about.getByRole("link")).toHaveAttribute("href", `/office/shifts/${scene.shiftId}`);
  await expect(
    desk.getByRole("listitem").filter({
      hasText: "Sorted: About a session: passed to a person, never sorted.",
    }),
  ).toBeVisible();
  await expect(
    desk.getByRole("listitem").filter({ hasText: /^Reply sent: No automatic reply\.$/ }),
  ).toBeVisible();
  await expect(
    desk.getByText("In the app: your words go as they are, and they get a notification."),
  ).toBeVisible();
  await noSidewaysScroll(desk);
  const officeSession: Session = await office.storageState();
  await office.close();

  // Back on her phone: no automatic answer came (the worker handled it before the office saw it).
  await page.goto(`${acme}/messages`);
  await expect(thread.getByRole("listitem").filter({ hasText: words })).toBeVisible();
  await expect(thread.getByRole("listitem").filter({ hasText: "Automatic reply" })).toHaveCount(0);

  // Screenshots: Messages opened about the shift, and the office's message page, on a phone and a
  // laptop, light and dark.
  for (const size of SIZES)
    for (const theme of THEMES) {
      const where = (what: string) =>
        `${what} at ${size.name} (${size.viewport.width}px), ${theme}`;
      const look = {
        viewport: size.viewport,
        deviceScaleFactor: size.scale,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        colorScheme: theme,
        locale: "en-GB",
        extraHTTPHeaders: IP,
      };
      const phone = await browser.newContext({ ...look, storageState: casual });
      try {
        const p = await phone.newPage();
        await p.goto(link);
        await expect(p.locator("[data-about-shift]"), where("About line")).toBeVisible();
        await expect(
          p.getByRole("textbox", { name: "Your message", exact: true }),
          where("ready sentence"),
        ).toHaveValue("I'm running late. I'll be there about …");
        await noSidewaysScroll(p);
        await shoot(p, testInfo, `28.6 messages about a shift ${size.name} ${theme}`);
      } finally {
        await phone.close();
      }
      const laptop = await browser.newContext({ ...look, storageState: officeSession });
      try {
        const d = await laptop.newPage();
        await d.goto(`${acme}${href}`);
        await expect(d.locator("[data-about-session]"), where("office About")).toBeVisible();
        await noSidewaysScroll(d);
        await shoot(d, testInfo, `28.6 office message about a session ${size.name} ${theme}`);
      } finally {
        await laptop.close();
      }
    }
});

// 28.10's guardrails review, and Phase 29.1 (Dylan's decision 20; docs/screens.md "### 29.1"):
// Pay's and the pay query's "Message the office" open /messages?about=pay. What she sends there is
// a pay query for payroll's digest (golden rule 9), never the automatic pay link (which would send
// her back to the Pay page that can't take the question) and never an office request: the whole
// path, from the page through the composer and its action to the database, Enquiries and her Pay
// page. (Until 29.1 this test expected it in Enquiries' Need a person: the behaviour changed on
// purpose.)
test("From Pay: Messages about her pay goes to payroll as a pay query, never the automatic pay answer", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const tag = randomBytes(3).toString("hex");
  const scene = await messageOfficeScene(tag);
  await logInCasual(page);

  await page.goto(`${acme}/messages?about=pay`);
  await expect(page.locator("[data-about-shift]")).toHaveText("About: your pay");
  await expect(
    page.getByText(
      "This goes to payroll, not the automatic answers. You'll see their answer on your Pay page.",
    ),
  ).toBeVisible();
  const box = page.getByRole("textbox", { name: "Your message", exact: true });
  await expect(box).toHaveValue("");
  // Words the sorter would take as a pay question anywhere else.
  const words = `When do I get paid for my October shifts? My pay looks short (e2e ${tag})`;
  await box.fill(words);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Sent. Payroll will look at it. You'll see the answer on your Pay page.",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${acme}/messages`);

  // One pay query for payroll (Something else, no shift, open) and no office request.
  const stored = await payFromMessages(scene.workerId, tag);
  expect(stored.requests).toBe(0);
  expect(stored.queries).toHaveLength(1);
  const query = stored.queries[0];
  expect(query).toMatchObject({ issue: "other", status: "open", shiftId: null });
  const ref = query?.ref ?? "";

  // The office: not in Need a person; under Pay, "Pay: sent to payroll".
  const office = await logInOffice(browser, tag);
  const desk = await office.newPage();
  const row = desk.getByRole("listitem").filter({ hasText: words });
  await expect(async () => {
    await desk.goto(`${acme}/office/enquiries?view=pay`);
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(row).toContainText("Pay: sent to payroll");
  await desk.goto(`${acme}/office/enquiries?view=person`);
  await expect(desk.getByRole("listitem").filter({ hasText: words })).toHaveCount(0);
  await office.close();

  // On her phone: no automatic answer came, and her message says it went to payroll.
  await page.goto(`${acme}/messages`);
  const thread = page.getByRole("list", { name: "Your messages" });
  const mine = thread.getByRole("listitem").filter({ hasText: words });
  await expect(mine).toBeVisible();
  await expect(mine).toContainText("Sent to payroll.");
  await expect(thread.getByRole("listitem").filter({ hasText: "Automatic reply" })).toHaveCount(0);

  // "See it on your Pay page": after the code, "Your pay queries" lists it with its reference.
  await mine.getByRole("link", { name: "See it on your Pay page" }).click();
  await expect(page).toHaveURL(`${acme}/pay`);
  const asked = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(await codeSentTo(P28_6_CASUAL.mobileE164, asked));
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Your pay queries" })).toBeVisible();
  const listed = page.getByRole("listitem").filter({ hasText: `Reference ${ref}` });
  await expect(listed).toBeVisible();
  await expect(listed).toContainText("Something else");
  await expect(listed).toContainText("With payroll");
});

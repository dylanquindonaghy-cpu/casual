import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { bookingRuleLines, bookingRules, whyNotLines } from "../../src/lib/portal/help-facts";
import { strikeSettings } from "../../src/lib/strikes/settings";
import { travelSettings } from "../../src/lib/travel/settings";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import {
  bookFarOff,
  bookStartingIn,
  endSession,
  firmSettingsOf,
  helpCancelCasual,
  P28_12_CASUAL,
  P28_12_TYPED,
} from "./p28/28-12-data";

// Phase 28, 28.12 (docs/screens.md "The casual app, Phase 28" 28.12): Help states the firm's own
// rules for taking shifts, each from the rules' own parsers, and why a shift may not show; every
// "Message the office" on it goes somewhere; and the cancel sheet's words and look. In a real
// browser, as a made-up casual of this spec's own (tests/e2e/p28/28-12-data.ts):
// - /help: the two new topics with Acme's own numbers (worked out here from its settings by the
//   same parsers), each "Message the office" link opening a page (no not-found), "Back to my
//   shifts" to /shifts;
// - a booking 5 days ahead, cancelled: "No strike." and no "tell us what happened";
// - a booking that starts while she has the page open: "Can't make it?" then says "This shift has
//   already started." with "Message the office" to /messages?shift=…&about=started;
// - Help and the cancel sheet at 390px and 1,280px (at 150%), light and dark, kept with the run.

const acme = "http://acme.localhost:3100";
const IP = "10.240.28.12";

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

async function logIn(
  browser: Browser,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P28_12_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_12_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function shoot(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("Help states the firm's rules and why a shift may not show; the cancel sheet says No strike without 'tell us what happened', and a started shift links to Messages", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const workerId = await helpCancelCasual();
  const settings = await firmSettingsOf();
  const strikes = strikeSettings(settings);
  const expectedRules = bookingRuleLines(bookingRules(settings), {
    on: strikes.enabled,
    noticeHours: strikes.noticeHours,
  });
  const expectedWhy = whyNotLines({
    travelOn: travelSettings(settings).enabled,
    rules: bookingRules(settings),
  });
  const session = await logIn(browser);
  const context = await browser.newContext({
    storageState: session,
    viewport: SIZES[0].viewport,
    deviceScaleFactor: SIZES[0].scale,
    isMobile: true,
    hasTouch: true,
    locale: "en-GB",
    extraHTTPHeaders: { "x-real-ip": IP },
  });
  const stamp = Date.now().toString(36);
  try {
    const page = await context.newPage();

    // Help: the two topics, in the contents and on the page, with the firm's own numbers.
    await page.goto(`${acme}/help`);
    const contents = page.getByRole("navigation", { name: "On this page" });
    await expect(
      contents.getByRole("link", { name: "The firm's rules for taking shifts" }),
    ).toHaveAttribute("href", "#firm-rules");
    await expect(contents.getByRole("link", { name: "Why can't I see a shift?" })).toHaveAttribute(
      "href",
      "#why-not",
    );
    const rules = page.locator("#firm-rules");
    await expect(rules.getByRole("heading", { level: 2 })).toHaveText(
      "The firm's rules for taking shifts",
    );
    await expect(rules.getByRole("listitem")).toHaveText(expectedRules);
    // Acme runs fair rotation (the seed): the small group's own minutes.
    await expect(rules).toContainText("A small group gets first go for");
    await expect(rules).not.toContainText(/runs? out|expire/i);
    const why = page.locator("#why-not");
    await expect(why.getByRole("listitem")).toHaveText(expectedWhy);
    await expect(page.getByText(/contact the office/i)).toHaveCount(0);

    // Every "Message the office" on Help goes to a page that opens.
    const links = page.getByRole("link", { name: /^message the office$/i });
    expect(await links.count()).toBeGreaterThanOrEqual(3);
    const hrefs = new Set<string>();
    for (const link of await links.all()) {
      const href = await link.getAttribute("href");
      if (!href) throw new Error("a Message the office link with no address");
      expect(href).toMatch(/^\/messages(\?about=pay)?$/);
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      hrefs.add(href);
    }
    for (const href of hrefs) {
      const res = await page.goto(`${acme}${href}`);
      expect(res?.status(), href).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("We can't find that page.")).toHaveCount(0);
    }
    await page.goto(`${acme}/help`);
    await expect(page.getByRole("link", { name: "Back to my shifts" })).toHaveAttribute(
      "href",
      "/shifts",
    );

    // A booking 5 days ahead, cancelled: "No strike." and nothing to explain.
    const far = await bookFarOff("acme", workerId, `P28.12 Far Hall ${stamp}`);
    await page.goto(`${acme}/shifts`);
    await expect(page.getByText(`P28.12 Far Hall ${stamp}`).first()).toBeVisible();
    await page.getByRole("button", { name: "Can't make it?" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Can't make it?" });
    const note = sheet.getByRole("note");
    await expect(note).toHaveAttribute("data-slip", "done");
    await expect(note).toHaveText(/Cancelling now doesn't give you a strike\.$/);
    await expect(
      sheet.getByText(
        "Your cancellation is recorded the moment you tap Cancel this shift. Nobody needs to approve it.",
      ),
    ).toBeVisible();
    // The reasons are choice cards: 56px tall, 8px round.
    const reason = sheet.getByText("Travel problem", { exact: true }).locator("..");
    await expect(reason).toHaveCSS("border-top-left-radius", "8px");
    expect((await reason.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
    await sheet.getByLabel("Travel problem").check();
    await expect(reason).toHaveCSS("border-top-width", "2px");
    await sheet.getByRole("button", { name: "Cancel this shift" }).click();
    await expect(
      sheet.getByText(/^Cancelled\. Reference [0-9A-F]{8}\. No strike\.$/),
    ).toBeVisible();
    await expect(sheet.locator('[data-slip="done"][role="status"]')).toBeVisible();
    await expect(sheet.getByText(/tell us what happened/i)).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Send to the office" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    expect(far.shiftId).toMatch(/^[0-9a-f-]{36}$/);
    // Her cancel reopened its place: end the session, so no later spec sees an open shift there.
    await endSession("acme", far.shiftId);

    // A booking that starts while her page is open: "Can't make it?" can no longer cancel it.
    const soon = await bookStartingIn("acme", workerId, `P28.12 Soon Hall ${stamp}`, 75);
    await page.goto(`${acme}/shifts`);
    await expect(page.getByText(`P28.12 Soon Hall ${stamp}`).first()).toBeVisible();
    const opener = page.getByRole("button", { name: "Can't make it?" }).first();
    await expect(opener).toBeEnabled();
    const wait = soon.startsAt.getTime() - Date.now() + 2_000;
    if (wait > 0) await page.waitForTimeout(wait);
    await opener.click();
    await expect(sheet.getByRole("alert")).toHaveText("This shift has already started.");
    const office = sheet.getByRole("link", { name: "Message the office" });
    await expect(office).toHaveAttribute("href", `/messages?shift=${soon.shiftId}&about=started`);
    expect((await office.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await office.click();
    await expect(page).toHaveURL(`${acme}/messages?shift=${soon.shiftId}&about=started`);
    await expect(page.getByText("We can't find that page.")).toHaveCount(0);
    // Off Booked again, so the next booking is the pass's.
    await endSession("acme", soon.shiftId);
  } finally {
    await context.close();
  }

  // Help and the cancel sheet at each size and theme, for the record. A booking of its own to open
  // the sheet on (kept: "Keep my shift" closes it).
  await bookFarOff("acme", workerId, `P28.12 Look Hall ${stamp}`);
  for (const size of SIZES) {
    for (const theme of THEMES) {
      const look = await browser.newContext({
        storageState: session,
        viewport: size.viewport,
        deviceScaleFactor: size.scale,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        colorScheme: theme,
        locale: "en-GB",
        extraHTTPHeaders: { "x-real-ip": IP },
      });
      try {
        const page = await look.newPage();
        await page.goto(`${acme}/help`);
        await expect(page.locator("#firm-rules")).toBeVisible();
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        await shoot(page, testInfo, `help-${size.name}-${theme}`);
        await page.locator("#firm-rules").scrollIntoViewIfNeeded();
        await shoot(page, testInfo, `help-rules-${size.name}-${theme}`, false);

        await page.goto(`${acme}/shifts`);
        await expect(page.getByText(`P28.12 Look Hall ${stamp}`).first()).toBeVisible();
        await page.getByRole("button", { name: "Can't make it?" }).first().click();
        const sheet = page.getByRole("dialog", { name: "Can't make it?" });
        await expect(sheet.getByRole("note")).toBeVisible();
        await sheet.getByLabel("I'm unwell").check();
        await sheet.evaluate((d) =>
          Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)),
        );
        await shoot(page, testInfo, `cancel-sheet-${size.name}-${theme}`, false);
        await sheet.getByRole("button", { name: "Keep my shift" }).click();
        await expect(sheet).toBeHidden();
      } finally {
        await look.close();
      }
    }
  }
});

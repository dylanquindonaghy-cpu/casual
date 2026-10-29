import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test as base } from "./fixtures";
import { codeSentTo, loginLinkSentTo } from "./outbox";

// The casual app as round 7 of the canvas has it (Phase 24, 24.6; docs/mockups/phase-24/README.md
// "The casual app (390px)"), in a real browser on a phone, as the demo story's Zoe Adeyemi and Ben
// Fraser (the seed's made-up people). With JavaScript: the firm's bar stays at the top and frosts
// once the page scrolls under it; the tab bar, a floating glass capsule, shrinks to its icons while
// you scroll down and opens again when you scroll up or tap it. Without JavaScript: the bar stays
// in the page, the tab bar whole, every tab a plain link; the pass's Details and Open shifts' "Site
// and role" still open. Then Pay: the week's total only when payroll gave every gross.
// Zoe logs in once for the file (her session is every test's): her number gets 3 login links every
// 15 minutes, and a login a test, with CI's retry of one, ran out (CI, 2026-10-29).

const acme = "http://acme.localhost:3100";
const ZOE = { typed: "07700 900400", e164: "+447700900400" };
const BEN = { typed: "07700 900402", e164: "+447700900402" };

async function login(page: Page, who: { typed: string; e164: string }) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(who.typed);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(who.e164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
}

type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;
const test = base.extend<object, { zoeSession: Session }>({
  // Once per test worker (a retry starts a new one, and logs in again).
  zoeSession: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({
        extraHTTPHeaders: { "x-real-ip": "10.240.24.5" },
      });
      const page = await context.newPage();
      await login(page, ZOE);
      const session = await context.storageState();
      await context.close();
      await provide(session);
    },
    { scope: "worker" },
  ],
  storageState: async ({ zoeSession }, provide) => provide(zoeSession),
});

const capsuleOf = (page: Page) =>
  page.getByRole("navigation", { name: "Main" }).locator(":scope > div");
const heightOf = async (box: Locator) => Math.round((await box.boundingBox())?.height ?? 0);
const scrollTo = (page: Page, y: number) => page.evaluate((to) => window.scrollTo(0, to), y);
const edgeOpacity = (page: Page) =>
  page.getByTestId("brand-bar").evaluate((bar) => getComputedStyle(bar, "::before").opacity);
// A tab's word: shown (in the flow) or kept for screen readers only (sr-only: position absolute).
const wordShown = (page: Page, word: string) =>
  page
    .getByRole("navigation", { name: "Main" })
    .getByText(word, { exact: true })
    .evaluate((el) => getComputedStyle(el).position !== "absolute");

test("with JavaScript: the bar stays at the top and frosts; the tab bar shrinks scrolling down, opens scrolling up or on a tap", async ({
  page,
}) => {
  await page.goto(`${acme}/`);
  await expect(page.getByRole("heading", { name: "Hi Zoe" })).toBeVisible();
  // Open shifts: long enough to scroll (a card a shift).
  await page.goto(`${acme}/shifts/open`);
  await expect(page.getByRole("heading", { level: 1, name: "Open shifts" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
  ).toBeGreaterThan(700);
  const html = page.locator("html");
  const capsule = capsuleOf(page);
  await expect(html).toHaveAttribute("data-js", "");
  // At the top: the capsule whole (68px), every word shown; the bar's frost hidden.
  await expect.poll(() => heightOf(capsule)).toBe(68);
  expect(await wordShown(page, "Home")).toBe(true);
  await expect(page.getByTestId("brand-bar")).toHaveCSS("position", "sticky");
  await expect.poll(() => edgeOpacity(page)).toBe("0");

  // Scrolling down: the page under the bar (its frost in), the tab bar its icons (54px).
  await scrollTo(page, 400);
  await expect(html).toHaveAttribute("data-scrolled", "");
  await expect(html).toHaveAttribute("data-tabs-mini", "");
  await expect.poll(() => heightOf(capsule)).toBe(54);
  expect(await wordShown(page, "Home")).toBe(false);
  await expect.poll(() => edgeOpacity(page)).toBe("1");
  expect(Math.round((await page.getByTestId("brand-bar").boundingBox())?.y ?? -1)).toBe(0);
  // Still a link with its name.
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pay" }),
  ).toBeVisible();

  // Scrolling up opens it again.
  await scrollTo(page, 300);
  await expect(html).not.toHaveAttribute("data-tabs-mini");
  await expect.poll(() => heightOf(capsule)).toBe(68);
  // Down again, then a tap on the bar opens it.
  await scrollTo(page, 600);
  await expect(html).toHaveAttribute("data-tabs-mini", "");
  await capsule.dispatchEvent("pointerdown");
  await expect(html).not.toHaveAttribute("data-tabs-mini");
  await expect.poll(() => heightOf(capsule)).toBe(68);
  // Back at the top: no frost.
  await scrollTo(page, 0);
  await expect(html).not.toHaveAttribute("data-scrolled");

  // The tabs go where they say.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Shifts" })
    .click();
  await expect(page).toHaveURL(`${acme}/shifts`);
});

test("without JavaScript: the bar in the page, the tab bar whole and plain links, Details and Site and role still open", async ({
  page,
  browser,
}) => {
  const plain = await noScript(browser, page);
  const home = await plain.newPage();
  await home.goto(`${acme}/`);
  await expect(home.getByRole("heading", { name: "Hi Zoe" })).toBeVisible();
  const html = home.locator("html");
  await expect(html).not.toHaveAttribute("data-js");
  // The firm's bar stays in the page (nothing scrolls under words with no frost behind them).
  await expect(home.getByTestId("brand-bar")).toHaveCSS("position", "relative");
  // Scrolling changes nothing: the capsule whole, its words shown.
  await scrollTo(home, 500);
  await expect(html).not.toHaveAttribute("data-tabs-mini");
  expect(await heightOf(capsuleOf(home))).toBe(68);
  expect(await wordShown(home, "Profile")).toBe(true);
  // The pass's Details opens its card (a <details>).
  await scrollTo(home, 0);
  const pass = home.getByRole("region", { name: "Your next shift" });
  await expect(home.locator("#pass-details")).toBeHidden();
  await tapWhenStill(pass.locator("[data-pass-more] summary"));
  await expect(home.locator("#pass-details")).toBeVisible();
  await expect(home.locator("#pass-details")).toContainText("Getting there, from your home area");

  // Every tab a plain link: Open shifts through Shifts, "Site and role" opening the filters.
  await tapWhenStill(
    home.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shifts" }),
  );
  await expect(home).toHaveURL(`${acme}/shifts`);
  await tapWhenStill(home.getByRole("link", { name: "Open", exact: true }));
  await expect(home).toHaveURL(`${acme}/shifts/open`);
  const filters = home.getByRole("form", { name: "Choose a day, site or role" });
  await expect(filters).toBeHidden();
  await tapWhenStill(home.locator("[data-filters] summary"));
  await expect(filters).toBeVisible();
  await filters.getByLabel("Role").selectOption({ label: "Steward" });
  await tapWhenStill(filters.getByRole("button", { name: "Show shifts" }));
  await expect(home).toHaveURL(/\/shifts\/open\?.*role=steward/);
  // The choice shows: the filters open, the role chosen.
  await expect(filters).toBeVisible();
  await expect(filters.getByLabel("Role")).toHaveValue("steward");
  await plain.close();
});

test("Pay: Zoe's newest week totals £324.00 over a row per rate; Ben's has no total, a line payroll gave no gross for", async ({
  page,
}) => {
  await page.goto(`${acme}/`);
  await openPay(page, ZOE);
  const latest = page.getByRole("region", { name: /^Mon \d{1,2} [A-Z][a-z]{2} to Sun / });
  await expect(latest.getByText("Gross pay", { exact: true })).toBeVisible();
  await expect(latest.locator("[data-pay-total]")).toHaveText("Gross pay: £324.00");
  await expect(latest.locator("[data-pay-line]")).toHaveText([
    "16 hours at £12.50 an hour",
    "8 hours at £15.50 an hour",
  ]);
  await expect(latest.getByText(/^Pay date: Fri \d{1,2} [A-Z][a-z]{2}$/)).toBeVisible();
  // Earlier weeks, one row a week, each with its total.
  const earlier = page.getByRole("region", { name: "Earlier weeks" });
  await expect(earlier.locator("[data-pay-total]")).toHaveText([
    "Gross pay: £200.00",
    "Gross pay: £300.00",
    "Gross pay: £124.00",
    "Gross pay: £200.00",
  ]);
  await expect(earlier.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByText("The last 8 weeks, from Acme Events' payroll.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

  // Ben: payroll gave no gross for one line of his newest week, so it has no total.
  await page.context().clearCookies();
  await login(page, BEN);
  await openPay(page, BEN);
  const bens = page.getByRole("region", { name: /^Mon \d{1,2} [A-Z][a-z]{2} to Sun / });
  await expect(bens.locator("[data-pay-total]")).toHaveCount(0);
  await expect(bens.locator("[data-pay-line]")).toHaveText([
    "12 hours at £12.60 an hour Gross pay: £151.20",
    "4 hours at £15.50 an hour",
  ]);
  await expect(
    page.getByRole("region", { name: "Earlier weeks" }).locator("[data-pay-total]"),
  ).toHaveText(["Gross pay: £75.60"]);
});

// A context like this one (the phone, the session), with JavaScript switched off.
async function noScript(browser: Browser, page: Page) {
  const device = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    ua: navigator.userAgent,
  }));
  return browser.newContext({
    storageState: await page.context().storageState(),
    javaScriptEnabled: false,
    viewport: { width: device.width, height: device.height },
    userAgent: device.ua,
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { "x-real-ip": "10.240.24.6" },
  });
}

// A tap on a page with JavaScript off, once nothing on it moves. Playwright's click waits for its
// target to hold still across two frames; with JavaScript off, a click that starts while an
// entrance animation is moving the target never completes (CI's trace: the button moved, then the
// page drew no more frames for the click to wait on; the same locally, 3 tries of 3). A person taps
// a still button; so does this.
async function tapWhenStill(target: Locator) {
  const page = target.page();
  await expect
    .poll(() =>
      page.evaluate(() => document.getAnimations().every((a) => a.playState === "finished")),
    )
    .toBe(true);
  await target.click();
}

async function openPay(page: Page, who: { e164: string }) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pay" }).click();
  await expect(page).toHaveURL(`${acme}/pay`);
  await expect(page.getByRole("heading", { level: 1, name: "Pay" })).toBeVisible();
  const asked = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Send me a code" }).click();
  const code = await codeSentTo(who.e164, asked);
  await page.getByLabel("Your code").fill(code);
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByText(/^The last 8 weeks, from /)).toBeVisible();
}

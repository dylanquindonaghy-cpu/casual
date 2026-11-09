import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  STAFF_LOGIN_PASSWORD,
  WALKTHROUGH_PORT,
  WALKTHROUGH_SITE_PASSWORD,
} from "../../playwright.walkthrough.config";
import { DEMO_CASUAL_ID, STAFF_LOGIN_NAME } from "../../src/lib/demo/staff-login";
import { CASUAL_WELCOME } from "../../src/lib/tour/casual-copy";
import { casualTour, setCasualTourSeen } from "./db";

// The staffing demo (Phase 31), on the walkthrough's production build in demo mode
// (playwright.walkthrough.config.ts), after the Demo phone's own test: the staffing login (with this
// run's own password; the web app has only its hash), "Choose a view" and both views, and the quick
// guide, at a phone's width and a laptop's, light and dark, with no sideways scroll.

test.describe.configure({ mode: "serial" });

const acme = `http://acme.localhost:${WALKTHROUGH_PORT}`;
const northline = `http://northline.localhost:${WALKTHROUGH_PORT}`;

let ip = 0;
async function windowOf(
  browser: Browser,
  size: "phone" | "laptop",
  colorScheme: "light" | "dark" = "light",
): Promise<Page> {
  ip += 1;
  const context = await browser.newContext({
    viewport: size === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    ...(size === "phone" ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
    colorScheme,
    locale: "en-GB",
    httpCredentials: { username: "demo", password: WALKTHROUGH_SITE_PASSWORD },
    extraHTTPHeaders: { "x-real-ip": `10.31.9.${ip}` },
  });
  return context.newPage();
}

async function logIn(page: Page, password = STAFF_LOGIN_PASSWORD) {
  await page.goto(`${acme}/start/login`);
  await expect(page.getByRole("heading", { name: "Staffing demo login", level: 1 })).toBeVisible();
  await page.getByLabel("Email").fill(STAFF_LOGIN_NAME.toLowerCase());
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

async function noSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, `${where}: sideways scroll`).toBeLessThanOrEqual(0);
}

test("the Demo phone and the office login link to the staffing login; a wrong password says so", async ({
  browser,
}) => {
  const page = await windowOf(browser, "laptop");
  await page.goto(`${acme}/office/login`);
  await page.getByRole("link", { name: "Demo: log in with the staffing account" }).click();
  await expect(page).toHaveURL(`${acme}/start/login`);
  await page.goto(`${acme}/demo`);
  await expect(
    page.getByRole("link", { name: "Demo: log in with the staffing account" }),
  ).toHaveAttribute("href", "/start/login");

  await logIn(page, `${STAFF_LOGIN_PASSWORD}-not`);
  // Filtered by its words: a production build also has Next's empty route announcer (role "alert").
  await expect(
    page.getByRole("alert").filter({ hasText: "That email and password don't match." }),
  ).toHaveText("That email and password don't match.");
  await expect(page).toHaveURL(`${acme}/start/login`);
  // Only on Acme: Northline has no staffing login, nor a link to one.
  const other = await page.goto(`${northline}/start/login`);
  expect(other?.status()).toBe(404);
  await page.goto(`${northline}/office/login`);
  await expect(page.getByRole("link", { name: /staffing account/ })).toHaveCount(0);
});

test("on a laptop: log in, choose the office, then the casual's phone view", async ({
  browser,
}) => {
  const page = await windowOf(browser, "laptop");
  await logIn(page);
  await expect(page.getByRole("heading", { name: "Choose a view", level: 1 })).toBeVisible();
  await expect(page.getByText("Logged in as Staffing (demo).")).toBeVisible();

  await page.getByRole("link", { name: /Staffing and resourcing view/ }).click();
  await expect(page).toHaveURL(`${acme}/office`);
  await expect(page.getByRole("button", { name: "Staffing (demo) Admin" })).toBeVisible();

  await page.goto(`${acme}/start`);
  await page.getByRole("button", { name: /Casual mobile view/ }).click();
  await expect(page).toHaveURL(`${acme}/start/phone`);
  await expect(page.getByRole("heading", { name: "Casual mobile view", level: 1 })).toBeVisible();
  const frame = page.frameLocator('iframe[title="The casual app"]');
  // Phase 32 (32.2): the page is "Home"; her name is in the top bar.
  await expect(frame.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({
    timeout: 20_000,
  });
  await expect(frame.locator("[data-you]")).toContainText("Zoe");
  const box = await page.locator('iframe[title="The casual app"]').boundingBox();
  expect(box?.width).toBe(390);
  expect(box?.height).toBe(844);
  await expect(page.getByRole("link", { name: "Open full screen" })).toHaveAttribute("href", "/");
  await page.getByRole("link", { name: "Back to choose a view" }).click();
  await expect(page).toHaveURL(`${acme}/start`);
});

test("the quick guide: its five sections, and its links work", async ({ browser }) => {
  const page = await windowOf(browser, "laptop");
  await logIn(page);
  await expect(page).toHaveURL(`${acme}/start`);
  await page.getByRole("link", { name: "Quick guide: where everything lives" }).click();
  await expect(page).toHaveURL(`${acme}/start/guide`);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "What ShiftDesk is",
    "It isn't a CRM",
    "How it works with the API",
    "Where everything lives",
    "Golden rules, in short",
  ]);
  await expect(
    page.getByRole("figure", { name: "How the planner, ShiftDesk and casuals connect" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /^Integrations/ }).click();
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: /^Events & sessions/ }).click();
  await expect(page).toHaveURL(`${acme}/office/events`);
  await page.goBack();
  await page.getByRole("link", { name: "How-to guide", exact: true }).click();
  await expect(page).toHaveURL(`${acme}/office/guide`);
  await page.goBack();
  await page.getByRole("link", { name: "Back to choose a view" }).click();
  await expect(page).toHaveURL(`${acme}/start`);
});

test("on a phone: Casual mobile view opens the casual app itself", async ({ browser }) => {
  const page = await windowOf(browser, "phone");
  await logIn(page);
  await expect(page.getByRole("heading", { name: "Choose a view", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Casual mobile view/ }).click();
  await expect(page).toHaveURL(`${acme}/`);
  // Phase 32 (32.2): the page is "Home"; her name is in the top bar.
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.locator("[data-you]")).toContainText("Zoe");
  // The frame's page sends a phone on to the app too.
  await page.goto(`${acme}/start/phone`);
  await expect(page).toHaveURL(`${acme}/`);
});

// Phase 33.3: the casuals' first-login tour shows in the Casual mobile view as it would for Zoe
// (staff want to see it), but finishing or skipping it there is the office's look, not Zoe's: her
// tour isn't marked seen and nothing is logged as her. Zoe starts unseen here, and is put back as
// the run left her (seen: tests/e2e/prepare-db.ts) after.
test("on a phone: the casual's tour shows in the Casual mobile view, and skipping it there doesn't mark Zoe's", async ({
  browser,
}) => {
  const since = new Date(Date.now() - 1000);
  await setCasualTourSeen("acme", DEMO_CASUAL_ID, null);
  try {
    const page = await windowOf(browser, "phone");
    await logIn(page);
    await page.getByRole("button", { name: /Casual mobile view/ }).click();
    await expect(page).toHaveURL(`${acme}/`);
    const welcome = page.locator("dialog[data-tour-welcome]");
    await expect(welcome).toBeVisible();
    await expect(
      welcome.getByRole("heading", { name: "Welcome to Acme Events' shifts" }),
    ).toBeVisible();
    await welcome.getByRole("button", { name: CASUAL_WELCOME.skipVideo }).click();
    const tip = page.locator("[data-tour-tip]");
    await expect(tip).toContainText("Step 1 of 7");
    await tip.getByRole("button", { name: "Skip" }).click();
    await expect(page.locator("dialog[data-tour-walk]")).toHaveCount(0);
    // Give the browser's call time to land, then: Zoe's row and the log untouched.
    await page.waitForTimeout(1500);
    expect(await casualTour("acme", DEMO_CASUAL_ID, since)).toEqual({ seenAt: null, events: [] });
    // Not again in this view's login either.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(welcome).toHaveCount(0);
    expect((await casualTour("acme", DEMO_CASUAL_ID, since)).seenAt).toBeNull();
  } finally {
    await setCasualTourSeen("acme", DEMO_CASUAL_ID, new Date());
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const size of ["phone", "laptop"] as const) {
    test(`no sideways scroll at a ${size}'s width, ${colorScheme}`, async ({ browser }) => {
      const page = await windowOf(browser, size, colorScheme);
      await page.goto(`${acme}/start/login`);
      await noSidewaysScroll(page, "/start/login");
      await logIn(page);
      await expect(page.getByRole("heading", { name: "Choose a view", level: 1 })).toBeVisible();
      await noSidewaysScroll(page, "/start");
      await page.goto(`${acme}/start/guide`);
      await expect(page.getByRole("heading", { name: "Quick guide", level: 1 })).toBeVisible();
      await noSidewaysScroll(page, "/start/guide");
      if (size === "laptop") {
        await page.goto(`${acme}/start/phone`);
        await expect(page.getByRole("heading", { name: "Casual mobile view" })).toBeVisible();
        await noSidewaysScroll(page, "/start/phone");
      }
      // Every link and button on the chooser is at least 44px tall.
      await page.goto(`${acme}/start`);
      for (const target of await page.locator("main a, main button").all()) {
        const box = await target.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  }
}

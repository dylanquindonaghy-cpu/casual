import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { OFFICE_TOUR_STEPS, OFFICE_WELCOME, TOUR_MENU } from "../../src/lib/tour/office-copy";
import { addOfficeUser, officeTour } from "./db";
import { DASHBOARD_HEADING, expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office's first-login tour (Phase 33.1 and 33.2; docs/screens.md "## Phase 33") in a real
// browser, for this spec's own office users who haven't seen theirs (every other spec's users have:
// tests/e2e/prepare-db.ts): the welcome window at the first login, the walkthrough on the real
// dashboard (Next, Back, the keyboard, focus kept in the tip), Skip marking it seen so it doesn't
// open again, "Not now" not marking it, "Take the tour again" in the name menu, and no sideways
// scroll on a laptop (1280px) or a phone (390px). The video isn't needed to play.

const acme = "http://acme.localhost:3100";
const SHOTS = process.env.TOUR_SHOTS_DIR;
const LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

async function context(browser: Browser, id: string, phone: boolean): Promise<BrowserContext> {
  const h = createHash("sha256").update(id).digest();
  return browser.newContext({
    ...(phone ? devices["Pixel 7"] : {}),
    viewport: phone ? PHONE : LAPTOP,
    locale: "en-GB",
    colorScheme: "dark",
    extraHTTPHeaders: { "x-real-ip": `10.${h[0]}.${h[1]}.${h[2]}` },
  });
}

async function officeLogin(page: Page, email: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

const welcome = (page: Page) => page.locator("dialog[data-tour-welcome]");
const tip = (page: Page) => page.locator("[data-tour-tip]");
const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
// The step showing: its number and its title.
async function atStep(page: Page, n: number) {
  const step = OFFICE_TOUR_STEPS[n - 1];
  if (!step) throw new Error(`no step ${n}`);
  await expect(tip(page)).toContainText(`Step ${n} of ${OFFICE_TOUR_STEPS.length}`);
  await expect(tip(page).getByRole("heading", { name: step.title })).toBeVisible();
  await expect(page.locator(`[data-tour-spot="${step.anchor}"]`)).toBeVisible();
}
const focusInTip = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest("[data-tour-tip]") !== null);

test("on a laptop: the welcome window, the walkthrough, Skip, and Take the tour again", async ({
  browser,
}, testInfo) => {
  const email = `tour.laptop${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Tia Tour", role: "admin", tourSeen: false });
  const ctx = await context(browser, `${testInfo.testId}:laptop`, false);
  const page = await ctx.newPage();
  try {
    await officeLogin(page, email);
    // First thing at the first login: the welcome window over the dashboard.
    await expect(welcome(page)).toBeVisible();
    await expect(
      welcome(page).getByRole("heading", { name: "Welcome to Acme Events' office" }),
    ).toBeVisible();
    await expect(welcome(page).getByText(OFFICE_WELCOME.intro)).toBeVisible();
    // A muted video with its captions, never playing with sound by itself.
    const video = welcome(page).locator("video");
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    await expect(video.locator('track[kind="captions"][default]')).toHaveAttribute(
      "src",
      "/tour/office.en.vtt",
    );
    await noSidewaysScroll(page);
    await page.waitForTimeout(500);
    await shot(page, "welcome-1280");

    // Every step's part is on the real dashboard.
    for (const s of OFFICE_TOUR_STEPS)
      expect(await page.locator(`[data-tour="${s.anchor}"]`).count(), s.anchor).toBeGreaterThan(0);

    await welcome(page).getByRole("button", { name: OFFICE_WELCOME.skipVideo }).click();
    await expect(welcome(page)).toHaveCount(0);
    await atStep(page, 1);
    expect(await focusInTip(page)).toBe(true);
    await noSidewaysScroll(page);
    await page.waitForTimeout(400);
    await shot(page, "step1-counts-1280");

    // Next, the arrow keys and Back.
    await tip(page).getByRole("button", { name: "Next" }).click();
    await atStep(page, 2);
    await page.keyboard.press("ArrowRight");
    await atStep(page, 3);
    await page.keyboard.press("ArrowLeft");
    await atStep(page, 2);
    await tip(page).getByRole("button", { name: "Back" }).click();
    await atStep(page, 1);
    // The first step has no Back. Focus goes round inside the tip.
    await expect(tip(page).getByRole("button", { name: "Back" })).toHaveCount(0);
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Tab");
      expect(await focusInTip(page)).toBe(true);
    }
    // On to the session card.
    for (let n = 2; n <= 4; n += 1) await page.keyboard.press("ArrowRight");
    await atStep(page, 4);
    await page.waitForTimeout(400);
    await shot(page, "step4-session-card-1280");

    // Esc skips: seen, logged once with ids only, and it doesn't open by itself again.
    expect((await officeTour("acme", email)).seenAt).toBeNull();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-tour-walk]")).toHaveCount(0);
    await expect.poll(async () => (await officeTour("acme", email)).seenAt).not.toBeNull();
    expect((await officeTour("acme", email)).events).toEqual([
      { action: "tour.skipped", data: { kind: "office" } },
    ]);
    await page.reload();
    await expect(page.getByRole("heading", { name: DASHBOARD_HEADING })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(welcome(page)).toHaveCount(0);

    // Take the tour again, from the name menu: the welcome window, then every step to Done.
    await page.locator('button[popovertarget="office-account-menu"]').click();
    const menu = page.locator("#office-account-menu");
    await expect(menu.getByRole("link", { name: TOUR_MENU.quickGuide })).toHaveAttribute(
      "href",
      "/start/guide",
    );
    await menu.getByRole("button", { name: TOUR_MENU.again }).click();
    await expect(welcome(page)).toBeVisible();
    await welcome(page).getByRole("button", { name: OFFICE_WELCOME.start }).click();
    await atStep(page, 1);
    for (let n = 2; n <= OFFICE_TOUR_STEPS.length; n += 1) {
      await tip(page).getByRole("button", { name: "Next" }).click();
      await atStep(page, n);
    }
    await tip(page).getByRole("button", { name: "Done" }).click();
    await expect(page.locator("[data-tour-walk]")).toHaveCount(0);
    // Already seen: nothing more is logged.
    expect((await officeTour("acme", email)).events).toHaveLength(1);
  } finally {
    await ctx.close();
  }
});

test("on a phone: Not now doesn't mark it seen; Skip does, at every login after", async ({
  browser,
}, testInfo) => {
  const email = `tour.phone${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Pat Phone", role: "resourcer", tourSeen: false });
  const first = await context(browser, `${testInfo.testId}:phone-1`, true);
  const page = await first.newPage();
  try {
    await officeLogin(page, email);
    await expect(welcome(page)).toBeVisible();
    await noSidewaysScroll(page);
    await page.waitForTimeout(500);
    await shot(page, "welcome-390");
    await welcome(page).getByRole("button", { name: OFFICE_WELCOME.notNow }).click();
    await expect(welcome(page)).toHaveCount(0);
    expect((await officeTour("acme", email)).seenAt).toBeNull();
    // Not again in this login (a reload)...
    await page.reload();
    await expect(page.getByRole("heading", { name: DASHBOARD_HEADING })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(welcome(page)).toHaveCount(0);
  } finally {
    await first.close();
  }

  // ...but again at the next login.
  const second = await context(browser, `${testInfo.testId}:phone-2`, true);
  const again = await second.newPage();
  try {
    await officeLogin(again, email);
    await expect(welcome(again)).toBeVisible();
    await welcome(again).getByRole("button", { name: OFFICE_WELCOME.skipVideo }).click();
    // On a phone the counts are the row over the page; the tip spans the window under it.
    await atStep(again, 1);
    await noSidewaysScroll(again);
    await again.waitForTimeout(400);
    await shot(again, "step1-counts-390");
    await tip(again).getByRole("button", { name: "Next" }).click();
    await atStep(again, 2);
    await again.waitForTimeout(400);
    await shot(again, "step2-tabs-390");
    await tip(again).getByRole("button", { name: "Skip" }).click();
    await expect(again.locator("[data-tour-walk]")).toHaveCount(0);
    await expect.poll(async () => (await officeTour("acme", email)).seenAt).not.toBeNull();
  } finally {
    await second.close();
  }

  // Seen: a new login doesn't open it.
  const third = await context(browser, `${testInfo.testId}:phone-3`, true);
  const later = await third.newPage();
  try {
    await officeLogin(later, email);
    await expect(later.getByRole("heading", { name: DASHBOARD_HEADING })).toBeVisible();
    await later.waitForTimeout(1000);
    await expect(welcome(later)).toHaveCount(0);
    expect((await officeTour("acme", email)).events).toEqual([
      { action: "tour.skipped", data: { kind: "office" } },
    ]);
  } finally {
    await third.close();
  }
});

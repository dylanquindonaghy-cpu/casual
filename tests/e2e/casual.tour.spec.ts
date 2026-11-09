import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { OFFLINE_CACHE } from "../../src/lib/portal/offline";
import {
  CASUAL_TOUR_AGAIN,
  CASUAL_TOUR_STEPS,
  CASUAL_WELCOME,
} from "../../src/lib/tour/casual-copy";
import { TOUR_STORE } from "../../src/lib/tour/steps";
import { casualTour } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import { P33_CASUALS, p33Cleanup, p33Scene, type P33Scene, type P33Who } from "./p33/33-3-data";

// The casuals' first-login tour (Phase 33.3; docs/screens.md "## Phase 33", "### 33.3") in a real
// browser, for this spec's own casuals who haven't seen theirs (every other spec's have:
// tests/e2e/prepare-db.ts and the helpers that add casuals): the welcome window with the portrait
// video at the first login (filling a phone's screen), the walkthrough on the real Home (its counts,
// next shift, Directions, "Can't make it?", then Shifts, Pay and Profile on the tab bar at 390px and
// on the rail at 1,280px), Skip and Done marking it seen so it doesn't open again (a reload, a new
// login), "Not now" not marking it, "Take the tour again" on Profile and on Help, never opening in
// the copy kept for no signal, and no sideways scroll. The video isn't needed to play. The demo's
// "Casual mobile view" is tests/e2e/demo.staff-login.spec.ts's (it runs only in demo mode).

const acme = "http://acme.localhost:3100";
const SHOTS = process.env.TOUR_SHOTS_DIR;
const LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

let scene: P33Scene;
let since: Date;
test.beforeAll(async () => {
  since = new Date(Date.now() - 1000);
  scene = await p33Scene();
});
test.afterAll(async () => {
  await p33Cleanup();
});

async function context(browser: Browser, id: string, phone: boolean): Promise<BrowserContext> {
  const h = createHash("sha256").update(id).digest();
  return browser.newContext({
    ...(phone ? devices["Pixel 7"] : {}),
    viewport: phone ? PHONE : LAPTOP,
    locale: "en-GB",
    colorScheme: "light",
    extraHTTPHeaders: { "x-real-ip": `10.${h[0]}.${h[1]}.${h[2]}` },
  });
}

async function logIn(page: Page, who: P33Who) {
  const c = P33_CASUALS[who];
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(c.typed);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(c.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
}

const welcome = (page: Page) => page.locator("dialog[data-tour-welcome]");
const walk = (page: Page) => page.locator("dialog[data-tour-walk]");
const tip = (page: Page) => page.locator("[data-tour-tip]");
const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
async function rect(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} not on screen`);
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
}
// The step showing: its number, its title, and its outline round its part.
async function atStep(page: Page, n: number) {
  const step = CASUAL_TOUR_STEPS[n - 1];
  if (!step) throw new Error(`no step ${n}`);
  await expect(tip(page)).toContainText(`Step ${n} of ${CASUAL_TOUR_STEPS.length}`);
  await expect(tip(page).getByRole("heading", { name: step.title })).toBeVisible();
  await expect(page.locator(`[data-tour-spot="${step.anchor}"]`)).toBeVisible();
}
const next = (page: Page) => tip(page).getByRole("button", { name: "Next" }).click();
// The outline sits round the tab's link (the spotlight's padding outside it).
async function outlines(page: Page, tab: "shifts" | "pay" | "profile") {
  const spot = await rect(page, `[data-tour-spot="tab-${tab}"]`);
  const link = await rect(page, `nav[data-tab-bar] [data-tab="${tab}"]`);
  expect(spot.x).toBeLessThanOrEqual(link.x);
  expect(spot.y).toBeLessThanOrEqual(link.y);
  expect(spot.right).toBeGreaterThanOrEqual(link.right);
  expect(spot.bottom).toBeGreaterThanOrEqual(link.bottom);
  return link;
}
const nothingOpens = async (page: Page) => {
  await page.waitForTimeout(1200);
  await expect(welcome(page)).toHaveCount(0);
  await expect(walk(page)).toHaveCount(0);
};

test("on a phone: the welcome window fills the screen, the walkthrough, Skip, and taking it again", async ({
  browser,
}, testInfo) => {
  const ctx = await context(browser, `${testInfo.testId}:${testInfo.retry}:1`, true);
  const page = await ctx.newPage();
  try {
    await logIn(page, "phone");
    // First thing at the first login: the welcome window over Home, the whole screen.
    await expect(welcome(page)).toBeVisible();
    await expect(
      welcome(page).getByRole("heading", { name: "Welcome to Acme Events' shifts" }),
    ).toBeVisible();
    await expect(welcome(page).getByText(CASUAL_WELCOME.intro)).toBeVisible();
    const dialog = await rect(page, "dialog[data-tour-welcome]");
    expect(dialog.x).toBe(0);
    expect(dialog.y).toBe(0);
    expect(dialog.width).toBe(PHONE.width);
    expect(dialog.height).toBe(PHONE.height);
    // The portrait video at its own shape (9:16), not a strip in a wide box; muted, captions on.
    const box = await rect(page, "[data-tour-video]");
    expect(box.height / box.width).toBeCloseTo(16 / 9, 1);
    expect(box.width).toBeGreaterThan(220);
    const video = welcome(page).locator("video");
    expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    await expect(video.locator('track[kind="captions"][default]')).toHaveAttribute(
      "src",
      "/tour/casual.en.vtt",
    );
    await expect(video).toHaveAttribute("poster", "/tour/casual.jpg");
    // Its buttons all on the screen, none under the fold.
    for (const name of [CASUAL_WELCOME.start, CASUAL_WELCOME.skipVideo, CASUAL_WELCOME.notNow]) {
      const b = await welcome(page).getByRole("button", { name }).boundingBox();
      expect(b && b.y + b.height <= PHONE.height, name).toBe(true);
    }
    await noSidewaysScroll(page);
    await page.waitForTimeout(500);
    await shot(page, "welcome-390");

    // Every step's part is on her Home.
    for (const s of CASUAL_TOUR_STEPS)
      expect(await page.locator(`[data-tour="${s.anchor}"]`).count(), s.anchor).toBeGreaterThan(0);

    await welcome(page).getByRole("button", { name: CASUAL_WELCOME.skipVideo }).click();
    await expect(welcome(page)).toHaveCount(0);
    // Step 1: her counts, the row under the title on a phone.
    await atStep(page, 1);
    const counts = await rect(page, "[data-home-counts]");
    const spot = await rect(page, '[data-tour-spot="counts"]');
    expect(spot.y).toBeLessThanOrEqual(counts.y);
    await noSidewaysScroll(page);
    await page.waitForTimeout(400);
    await shot(page, "step1-counts-390");

    // Next, Back and the arrow keys.
    await next(page);
    await atStep(page, 2);
    await page.waitForTimeout(400);
    await shot(page, "step2-next-shift-390");
    await page.keyboard.press("ArrowRight");
    await atStep(page, 3);
    await tip(page).getByRole("button", { name: "Back" }).click();
    await atStep(page, 2);
    await next(page);
    await atStep(page, 3);
    await expect(page.locator('[data-tour-spot="directions"]')).toBeVisible();
    await next(page);
    await atStep(page, 4);
    // Steps 5 to 7: the tab bar at the foot of the screen.
    await next(page);
    await atStep(page, 5);
    const shifts = await outlines(page, "shifts");
    expect(shifts.y).toBeGreaterThan(PHONE.height - 140);
    await noSidewaysScroll(page);
    await page.waitForTimeout(400);
    await shot(page, "step5-shifts-390");
    await next(page);
    await atStep(page, 6);
    await outlines(page, "pay");
    await next(page);
    await atStep(page, 7);
    await outlines(page, "profile");
    await expect(tip(page).getByRole("button", { name: "Done" })).toBeVisible();

    // Skip: seen, logged once with ids only.
    expect((await casualTour("acme", scene.phone, since)).seenAt).toBeNull();
    await tip(page).getByRole("button", { name: "Skip" }).click();
    await expect(walk(page)).toHaveCount(0);
    await expect
      .poll(async () => (await casualTour("acme", scene.phone, since)).seenAt)
      .not.toBeNull();
    expect((await casualTour("acme", scene.phone, since)).events).toEqual([
      { action: "tour.skipped", data: { kind: "casual" } },
    ]);
    // It doesn't open by itself again.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await nothingOpens(page);

    // Take the tour again, on Profile: the welcome window, then the walkthrough on Home.
    await page.goto(`${acme}/profile`);
    const again = page.getByRole("button", { name: new RegExp(`^${CASUAL_TOUR_AGAIN.title}`) });
    await expect(again).toContainText(CASUAL_TOUR_AGAIN.sub);
    await again.click();
    await expect(welcome(page)).toBeVisible();
    await welcome(page).getByRole("button", { name: CASUAL_WELCOME.start }).click();
    await expect(page).toHaveURL(`${acme}/`);
    await atStep(page, 1);
    await page.keyboard.press("Escape");
    await expect(walk(page)).toHaveCount(0);

    // And on Help.
    await page.goto(`${acme}/help`);
    await page.getByRole("button", { name: new RegExp(`^${CASUAL_TOUR_AGAIN.title}`) }).click();
    await expect(welcome(page)).toBeVisible();
    await welcome(page).getByRole("button", { name: CASUAL_WELCOME.skipVideo }).click();
    await expect(page).toHaveURL(`${acme}/`);
    await atStep(page, 1);
    for (let n = 2; n <= CASUAL_TOUR_STEPS.length; n += 1) {
      await next(page);
      await atStep(page, n);
    }
    await tip(page).getByRole("button", { name: "Done" }).click();
    await expect(walk(page)).toHaveCount(0);
    // Already seen: nothing more is logged.
    expect((await casualTour("acme", scene.phone, since)).events).toHaveLength(1);
  } finally {
    await ctx.close();
  }

  // A new login: still seen, so it doesn't open.
  const later = await context(browser, `${testInfo.testId}:${testInfo.retry}:2`, true);
  const again = await later.newPage();
  try {
    await logIn(again, "phone");
    await expect(again.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await nothingOpens(again);
  } finally {
    await later.close();
  }
});

test("Help shows Take the tour again only to a logged-in casual", async ({ browser }, testInfo) => {
  const ctx = await context(browser, `${testInfo.testId}:${testInfo.retry}`, true);
  const page = await ctx.newPage();
  try {
    await page.goto(`${acme}/help`);
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByRole("button", { name: CASUAL_TOUR_AGAIN.title })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("on a laptop: the window beside its words, steps 5 to 7 on the rail, Done", async ({
  browser,
}, testInfo) => {
  const ctx = await context(browser, `${testInfo.testId}:${testInfo.retry}`, false);
  const page = await ctx.newPage();
  try {
    await logIn(page, "laptop");
    await expect(welcome(page)).toBeVisible();
    // A window over the page (not the whole screen), the portrait video beside the words.
    const dialog = await rect(page, "dialog[data-tour-welcome]");
    expect(dialog.width).toBeLessThan(LAPTOP.width - 200);
    expect(dialog.height).toBeLessThanOrEqual(LAPTOP.height);
    const box = await rect(page, "[data-tour-video]");
    expect(box.height / box.width).toBeCloseTo(16 / 9, 1);
    const title = await rect(page, "#tour-welcome-title");
    expect(title.x).toBeGreaterThan(box.right);
    await noSidewaysScroll(page);
    await page.waitForTimeout(500);
    await shot(page, "welcome-1280");

    await welcome(page).getByRole("button", { name: CASUAL_WELCOME.start }).click();
    // Step 1: her counts in the top bar.
    await atStep(page, 1);
    const top = await rect(page, "header[data-casual-top]");
    const spot = await rect(page, '[data-tour-spot="counts"]');
    expect(spot.y).toBeLessThan(top.bottom);
    await page.waitForTimeout(400);
    await shot(page, "step1-counts-1280");
    for (let n = 2; n <= 4; n += 1) {
      await next(page);
      await atStep(page, n);
    }
    // Steps 5 to 7: the rail at the window's left.
    await next(page);
    await atStep(page, 5);
    expect((await outlines(page, "shifts")).right).toBeLessThan(130);
    await noSidewaysScroll(page);
    await page.waitForTimeout(400);
    await shot(page, "step5-shifts-1280");
    await next(page);
    await atStep(page, 6);
    expect((await outlines(page, "pay")).right).toBeLessThan(130);
    await next(page);
    await atStep(page, 7);
    expect((await outlines(page, "profile")).right).toBeLessThan(130);
    await tip(page).getByRole("button", { name: "Done" }).click();
    await expect(walk(page)).toHaveCount(0);
    await expect
      .poll(async () => (await casualTour("acme", scene.laptop, since)).seenAt)
      .not.toBeNull();
    expect((await casualTour("acme", scene.laptop, since)).events).toEqual([
      { action: "tour.finished", data: { kind: "casual" } },
    ]);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await nothingOpens(page);
  } finally {
    await ctx.close();
  }
});

test("Not now doesn't mark it seen: not again in this login, again at the next", async ({
  browser,
}, testInfo) => {
  const first = await context(browser, `${testInfo.testId}:${testInfo.retry}:1`, true);
  const page = await first.newPage();
  try {
    await logIn(page, "notNow");
    await expect(welcome(page)).toBeVisible();
    await welcome(page).getByRole("button", { name: CASUAL_WELCOME.notNow }).click();
    await expect(welcome(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await nothingOpens(page);
    expect(await casualTour("acme", scene.notNow, since)).toEqual({ seenAt: null, events: [] });
  } finally {
    await first.close();
  }
  const second = await context(browser, `${testInfo.testId}:${testInfo.retry}:2`, true);
  const again = await second.newPage();
  try {
    await logIn(again, "notNow");
    await expect(welcome(again)).toBeVisible();
    // Esc is "Not now" too.
    await again.keyboard.press("Escape");
    await expect(welcome(again)).toHaveCount(0);
    expect((await casualTour("acme", scene.notNow, since)).seenAt).toBeNull();
  } finally {
    await second.close();
  }
});

test("never in the copy kept for no signal", async ({ browser }, testInfo) => {
  const ctx = await context(browser, `${testInfo.testId}:${testInfo.retry}`, true);
  const page = await ctx.newPage();
  try {
    await logIn(page, "offline");
    // Not seen: it opens on the live page...
    await expect(welcome(page)).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(
            async (name) => !!(await (await caches.open(name)).match("/")),
            OFFLINE_CACHE,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    // ...but the page kept for no signal carries none of it.
    const kept = await page.evaluate(
      async (name) => (await (await caches.open(name)).match("/"))?.text() ?? "",
      OFFLINE_CACHE,
    );
    expect(kept).toContain("data-offline-notice");
    expect(kept).not.toContain("data-tour-welcome");
    expect(kept).not.toContain("data-tour-walk");
    // A walkthrough under way in this tab, then no signal: the kept copy opens neither.
    await page.evaluate(
      (key) => sessionStorage.setItem(key, JSON.stringify({ id: "casual", step: 0 })),
      TOUR_STORE,
    );
    await ctx.setOffline(true);
    await page.reload();
    await expect(page.getByText("No signal.")).toBeVisible();
    await nothingOpens(page);
    await noSidewaysScroll(page);
    expect((await casualTour("acme", scene.offline, since)).seenAt).toBeNull();
    await ctx.setOffline(false);
  } finally {
    await ctx.close();
  }
});

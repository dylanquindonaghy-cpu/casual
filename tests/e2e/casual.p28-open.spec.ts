import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import {
  openScene,
  P28_8_CASUAL,
  P28_8_EMPTY_CASUAL,
  P28_8_EMPTY_ROLE,
  P28_8_EMPTY_TYPED,
  P28_8_TYPED,
} from "./p28/28-8-data";

// Phase 28, 28.8 (docs/screens.md "The casual app, Phase 28", 28.8): Open shifts and the urgent
// board grouped as the office's event card, in a real browser, as made-up casuals of this spec's
// own (tests/e2e/p28/28-8-data.ts). At 390px it measures every day tile at 44px wide or more (48px,
// 8px apart) and every shift's link at 44px tall or more; one glass section holds a day's shifts,
// the places left are a tag (the urgent chip when urgent), the card's pay and travel words are
// 28.8's, both Open shifts empty states and the urgent board's are the one empty box (no dashed
// frame), and the board's "Back to my shifts" goes to /shifts. Home's pass says the same travel
// sentence (line-copy.ts) in its details while the time isn't worked out, not figure tiles. Then
// screenshots of both pages on a phone (390px) and a laptop (1,280px at 150%), light and dark,
// attached to the run's report.

const acme = "http://acme.localhost:3100";

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;
const IP = "10.240.28.8";

type Casual = { firstName: string; mobileE164: string };

async function logIn(
  browser: Browser,
  who: Casual,
  typed: string,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(typed);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(who.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function phone(
  browser: Browser,
  session: Awaited<ReturnType<BrowserContext["storageState"]>>,
  theme: (typeof THEMES)[number] = "light",
  size: (typeof SIZES)[number] = SIZES[0],
) {
  return browser.newContext({
    storageState: session,
    viewport: size.viewport,
    deviceScaleFactor: size.scale,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    colorScheme: theme,
    locale: "en-GB",
    extraHTTPHeaders: { "x-real-ip": IP },
  });
}

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

// A shift's own link (not a day of the strip, not the filters' "Show all open shifts").
const shiftLinks = (scope: Locator | Page) =>
  scope.locator('a[href^="/shifts/"]:not([href^="/shifts/open"])');

// The one empty state (`emptyBox`): clear glass, 8px round, no dashed frame.
async function expectEmptyBox(box: Locator) {
  await expect(box).toBeVisible();
  await expect(box).toHaveClass(/(^| )glass-tile( |$)/);
  await expect(box).toHaveClass(/(^| )rounded-row( |$)/);
  const look = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return { radius: s.borderTopLeftRadius, style: s.borderTopStyle };
  });
  expect(look.radius).toBe("8px");
  expect(look.style).not.toBe("dashed");
}

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

test("Open shifts and the urgent board: grouped lists, 48px day tiles, tags, 28.8's words, the empty box, screenshots", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene = await openScene();
  const ola = await logIn(browser, P28_8_CASUAL, P28_8_TYPED);
  const noor = await logIn(browser, P28_8_EMPTY_CASUAL, P28_8_EMPTY_TYPED);

  const context = await phone(browser, ola);
  try {
    const page = await context.newPage();
    await page.goto(`${acme}/shifts/open`);
    await expect(page.getByRole("heading", { level: 1, name: "Open shifts" })).toBeVisible();

    // The strip: a tile only for a day with something on it (her urgent, open and booked days),
    // each 44px wide or more, 8px apart; the key names the three marks on screen.
    const strip = page.getByRole("region", { name: "Your next 8 days" });
    const tiles = strip.getByRole("listitem");
    await expect(tiles).toHaveCount(4);
    const boxes = await tiles.evaluateAll((items) =>
      items.map((li) => {
        const r = (li.firstElementChild ?? li).getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, height: r.height };
      }),
    );
    for (const b of boxes) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    for (let i = 1; i < boxes.length; i++)
      expect(Math.round(boxes[i]!.left - boxes[i - 1]!.right)).toBeGreaterThanOrEqual(8);
    await expect(strip.getByRole("link", { name: /: 1 urgent shift$/ })).toHaveCount(1);
    await expect(strip.getByRole("link", { name: /: 2 open shifts$/ })).toHaveCount(1);
    await expect(strip.getByRole("img", { name: /: you're booked$/ })).toHaveCount(1);
    await expect(strip).toContainText("Red number: urgent shifts that day");
    await expect(strip).toContainText("Grey number: open shifts that day");
    await expect(strip).toContainText("You're booked");
    await expect(strip).not.toContainText("nothing open");

    // Two grouped lists, each one glass section (12px round) with its heading and count inside.
    const urgent = page.getByRole("region", { name: "Urgent, needed now" });
    const more = page.getByRole("region", { name: "More shifts you can take" });
    for (const [section, n] of [
      [urgent, 1],
      [more, 3],
    ] as const) {
      await expect(section).toHaveClass(/(^| )glass( |$)/);
      expect(await section.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("12px");
      await expect(shiftLinks(section)).toHaveCount(n);
      // The count: the office's grey pill beside the heading (its words are for screen readers).
      await expect(section.locator(':scope > div > span[aria-hidden="true"]')).toHaveText(
        String(n),
      );
    }
    // The urgent heading's mark: the office's 18px leaf.
    const leaf = await urgent.locator("svg").first().boundingBox();
    expect(leaf && Math.round(leaf.width)).toBe(18);
    // Every shift's link is its whole tile: 44px tall or more, 8px round.
    for (const link of await shiftLinks(page.getByRole("main")).all()) {
      const box = await link.boundingBox();
      expect(box && box.height).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("8px");
    }

    // The urgent tile: the urgent chip for its places, 28.8's pay and travel words.
    const urgentTile = urgent.getByRole("listitem");
    await expect(urgentTile).toContainText(scene.urgentSite);
    await expect(urgentTile.getByText("1 place left")).toHaveClass(/bg-urgent-soft/);
    await expect(urgentTile).toContainText("Pay not given yet");
    await expect(urgentTile).toContainText(
      /About \d+ miles? away\. Travel time isn't worked out yet\./,
    );
    await expect(urgentTile).not.toContainText("straight line");
    // A paid tile: its places as a tag (a glass pill), its rate; the unpaid one says so.
    const paid = more.getByRole("listitem").filter({ hasText: scene.paidSite });
    const places = paid.getByText("3 places left");
    await expect(places).toHaveClass(/(^| )glass-button( |$)/);
    await expect(places).toHaveClass(/(^| )rounded-full( |$)/);
    await expect(paid).toContainText("£13.00/hour");
    await expect(more.getByRole("listitem").filter({ hasText: scene.unpaidSite })).toContainText(
      "Pay not given yet",
    );
    await expect(page.getByText("Pay: ask the office")).toHaveCount(0);
    await noSidewaysScroll(page);

    // The day with two open shifts: one glass section holds both.
    await strip.getByRole("link", { name: /: 2 open shifts$/ }).click();
    await expect(page).toHaveURL(/\/shifts\/open\?day=\d{4}-\d{2}-\d{2}$/);
    const theDay = page.getByRole("region", { name: "Shifts you can take", exact: true });
    await expect(shiftLinks(theDay)).toHaveCount(2);
    await expect(shiftLinks(page.getByRole("main"))).toHaveCount(2);

    // Only the urgent shift that day: the other list's one empty state.
    await page.goto(`${acme}/shifts/open?day=${scene.urgentDay}`);
    await expect(shiftLinks(page.getByRole("region", { name: "Urgent, needed now" }))).toHaveCount(
      1,
    );
    await expectEmptyBox(
      page
        .getByRole("region", { name: "More shifts you can take" })
        .getByText(/^Nothing else open right now\. /),
    );
    // Filters that match nothing: the first empty state, and "Show all open shifts" to clear them.
    await page.goto(`${acme}/shifts/open?role=${P28_8_EMPTY_ROLE}`);
    await expectEmptyBox(page.getByText("No open shifts match."));
    await expect(page.getByRole("link", { name: "Show all open shifts" })).toHaveAttribute(
      "href",
      "/shifts/open",
    );

    // The urgent board: the same grouped list, and "Back to my shifts" to the Shifts tab.
    await page.goto(`${acme}/urgent`);
    await expect(page.getByRole("heading", { level: 1, name: "Urgent shifts" })).toBeVisible();
    const board = page.getByRole("region", { name: "Urgent, needed now" });
    await expect(board).toHaveClass(/(^| )glass( |$)/);
    await expect(shiftLinks(board)).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(1);
    const tile = await shiftLinks(board).first().boundingBox();
    expect(tile && tile.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("link", { name: "Back to my shifts" })).toHaveAttribute(
      "href",
      "/shifts",
    );
    await noSidewaysScroll(page);

    // Home's pass (her booking, its time not worked out yet): the travel line's one sentence in
    // its details, not "1 mile in a straight line" and "Not known travel time yet" as figures.
    await page.goto(`${acme}/`);
    const pass = page.locator("[data-pass]");
    await expect(pass).toContainText(scene.bookedSite);
    await pass.locator("[data-pass-more] summary").click();
    const there = page.locator("#pass-details [data-travel-line]");
    await expect(there).toBeVisible();
    await expect(there).toContainText(/About \d+ miles? away\. Travel time isn't worked out yet\./);
    await expect(there).not.toContainText("straight line");
    await expect(there).not.toContainText("Not known");
    await noSidewaysScroll(page);
  } finally {
    await context.close();
  }

  // A casual with nothing open: both pages' empty states are the one empty box.
  const empty = await phone(browser, noor);
  try {
    const page = await empty.newPage();
    await page.goto(`${acme}/shifts/open`);
    await expectEmptyBox(page.getByText(/^Nothing open right now\. /));
    await expect(page.getByRole("region", { name: "Your next 8 days" })).toHaveCount(0);
    await page.goto(`${acme}/urgent`);
    await expectEmptyBox(page.getByText("No urgent shifts right now.").locator(".."));
    await expect(page.getByRole("link", { name: "See open shifts" })).toHaveAttribute(
      "href",
      "/shifts/open",
    );
    await expect(page.getByText("gaps")).toHaveCount(0);
    await page.getByRole("link", { name: "Back to my shifts" }).click();
    await expect(page).toHaveURL(`${acme}/shifts`);
  } finally {
    await empty.close();
  }

  // Screenshots: both pages, phone and laptop, light and dark.
  for (const size of SIZES)
    for (const theme of THEMES) {
      const shots = await phone(browser, ola, theme, size);
      try {
        const page = await shots.newPage();
        await page.goto(`${acme}/shifts/open`);
        await expect(page.getByRole("region", { name: "Urgent, needed now" })).toBeVisible();
        await noSidewaysScroll(page);
        await shoot(page, testInfo, `28.8 open-shifts ${size.name} ${theme}`);
        await page.goto(`${acme}/urgent`);
        await expect(page.getByRole("region", { name: "Urgent, needed now" })).toBeVisible();
        await shoot(page, testInfo, `28.8 urgent ${size.name} ${theme}`);
      } finally {
        await shots.close();
      }
    }
});

import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import { addP30_2Casual } from "./p30/30-2-data";

// Phase 30, 30.2 (docs/screens.md "### 30.2"): on a laptop (1,024px and wider) the casual app has
// the office's left rail instead of the phone's floating tab bar; below that the bar is as it was.
// One nav named "Main" at every size, the same five links and counts, the page right of the rail.
// As a made-up casual of this spec's own (tests/e2e/p30/30-2-data.ts), dark and light.

const acme = "http://acme.localhost:3100";
const IP = "10.240.30.2";
const RUN = Date.now().toString(36);
const FIRM_INITIAL = "A"; // Acme Events

const LAPTOP = { viewport: { width: 1280, height: 800 }, scale: 1.5 } as const;
const PHONE = { viewport: { width: 390, height: 844 }, scale: 2 } as const;
const THEMES = ["dark", "light"] as const;
const WORDS = ["Home", "Shifts", "Messages", "Pay", "Profile"];

type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;
type Scene = Awaited<ReturnType<typeof addP30_2Casual>>;

async function logIn(browser: Browser, scene: Scene): Promise<Session> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(scene.typed);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(scene.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${acme}/`);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function open(
  browser: Browser,
  session: Session,
  size: typeof LAPTOP | typeof PHONE,
  theme: (typeof THEMES)[number],
) {
  const phone = size === PHONE;
  return browser.newContext({
    storageState: session,
    viewport: size.viewport,
    deviceScaleFactor: size.scale,
    isMobile: phone,
    hasTouch: phone,
    colorScheme: theme,
    locale: "en-GB",
    extraHTTPHeaders: { "x-real-ip": IP },
  });
}

const main = (page: Page) => page.getByRole("navigation", { name: "Main" });

// Each link's name as a screen reader hears it (its count's words with it).
const names = (page: Page) =>
  main(page)
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((a) => a.getAttribute("aria-label") ?? (a.textContent ?? "").trim()),
    );

// The pages with the bar, the tab lit on each; and a shift's own page (the rail alone).
function pagesOf(scene: Scene) {
  return [
    { path: "/", tab: "Home" },
    { path: "/shifts", tab: "Shifts" },
    { path: "/shifts/open", tab: "Shifts" },
    { path: "/messages", tab: "Messages" },
    { path: "/pay", tab: "Pay" },
    { path: "/profile", tab: "Profile" },
    { path: "/requests", tab: "Profile" },
    { path: `/shifts/${scene.shiftId}`, tab: "Shifts", railOnly: true },
  ];
}

// The height of the room kept for the floating bar: the empty div just before the nav.
const spaceHeight = (page: Page) =>
  main(page).evaluate((nav) => {
    const space = nav.previousElementSibling;
    if (!space?.matches('div[aria-hidden="true"]:empty')) return -1;
    return Math.round(space.getBoundingClientRect().height);
  });

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.describe.configure({ mode: "serial" });

let scene: Scene;
let session: Session;
let phoneNames: string[] = [];

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  scene = await addP30_2Casual(testInfo.retry, RUN);
  session = await logIn(browser, scene);
});

test("at 390px the floating bar at the foot as before, no rail; a shift's own page has neither", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  for (const theme of THEMES) {
    const context = await open(browser, session, PHONE, theme);
    try {
      const page = await context.newPage();
      for (const p of pagesOf(scene)) {
        await page.goto(`${acme}${p.path}`);
        await expect(page.locator("main").first()).toBeVisible();
        const where = `${p.path} at 390px, ${theme}`;
        if (p.railOnly) {
          await expect(main(page), where).toHaveCount(0);
          expect(await sideways(page), where).toBe(0);
          continue;
        }
        await expect(main(page), where).toHaveCount(1);
        await expect(main(page), where).toBeVisible();
        // The capsule: 12px from the screen's sides and its foot, five tabs across.
        const look = await main(page).evaluate((nav) => {
          const box = nav.querySelector(":scope > div")!.getBoundingClientRect();
          return {
            left: Math.round(box.left),
            right: Math.round(innerWidth - box.right),
            foot: Math.round(innerHeight - box.bottom),
          };
        });
        expect(look, where).toEqual({ left: 12, right: 12, foot: 12 });
        // No mark on the bar (the firm's bar names the firm).
        await expect(main(page).locator("[data-rail-mark]"), where).toBeHidden();
        await expect(main(page).getByRole("link"), where).toHaveCount(5);
        await expect(main(page).locator('a[aria-current="page"]'), where).toContainText(p.tab);
        // The room for the bar at the page's end is still there (112px).
        expect(await spaceHeight(page), where).toBe(112);
        expect(await sideways(page), where).toBe(0);
        if (p.path === "/" && theme === "dark") phoneNames = await names(page);
      }
    } finally {
      await context.close();
    }
  }
  expect(phoneNames).toHaveLength(5);
});

test("at 1,280px the office's rail at the left: five links, the current one lit, the same counts, the page beside it", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const theme of THEMES) {
    const context = await open(browser, session, LAPTOP, theme);
    try {
      const page = await context.newPage();
      for (const p of pagesOf(scene)) {
        await page.goto(`${acme}${p.path}`);
        await expect(page.locator("main").first()).toBeVisible();
        const where = `${p.path} at 1,280px, ${theme}`;
        // Exactly one navigation named Main: the rail (never the rail and the bar).
        await expect(page.getByRole("navigation", { name: "Main" }), where).toHaveCount(1);
        const nav = main(page);
        await expect(nav, where).toBeVisible();
        const rail = await nav.evaluate((el) => {
          const column = el.getBoundingClientRect();
          const box = el.querySelector(":scope > div")!.getBoundingClientRect();
          // Phase 32 (32.1): the current link's round button is the solid ink.
          const current = el.querySelector('a[aria-current="page"] [data-tab-circle]')!;
          const probe = document.createElement("i");
          probe.style.backgroundColor = "var(--color-ink)";
          document.body.append(probe);
          const ink = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const links = [...el.querySelectorAll("a")].map((a) => {
            const r = a.getBoundingClientRect();
            const word = a.lastElementChild!.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, wordW: word.width };
          });
          return {
            left: Math.round(column.left),
            top: Math.round(column.top),
            right: column.right,
            width: Math.round(column.width),
            capsule: Math.round(box.width),
            capsuleLeft: Math.round(box.left),
            fill: getComputedStyle(current).backgroundColor,
            ink,
            links,
          };
        });
        // At the window's left edge, 12px in and 16px down, 96px wide, as the office's; since
        // Phase 32 (32.1) the links in a 76px capsule in its middle, under the firm's mark.
        expect([rail.left, rail.top, rail.width], where).toEqual([12, 16, 96]);
        expect([rail.capsule, rail.capsuleLeft], where).toEqual([76, 22]);
        // The five links one under the other, each at least 44px each way with its word shown.
        expect(rail.links, where).toHaveLength(5);
        for (const [i, l] of rail.links.entries()) {
          expect(l.h, `${where}: link ${i}`).toBeGreaterThanOrEqual(44);
          expect(l.w, `${where}: link ${i}`).toBeGreaterThanOrEqual(44);
          expect(l.wordW, `${where}: link ${i}'s word`).toBeGreaterThan(1);
          if (i > 0) expect(l.y, `${where}: link ${i}`).toBeGreaterThan(rail.links[i - 1]!.y);
        }
        for (const word of WORDS)
          await expect(nav.getByText(word, { exact: true }), `${where}: ${word}`).toBeVisible();
        // The current one: aria-current, solid ink.
        await expect(nav.locator('a[aria-current="page"]'), where).toHaveCount(1);
        await expect(nav.locator('a[aria-current="page"]'), where).toContainText(p.tab);
        expect(rail.fill, where).toBe(rail.ink);
        // The firm's mark at its top.
        await expect(nav.locator("[data-rail-mark]"), where).toBeVisible();
        await expect(nav.locator("[data-rail-mark]"), where).toHaveText(FIRM_INITIAL);
        // The page starts right of the rail, never under it; and nothing to scroll sideways.
        const content = await page.evaluate(() => {
          const xs = [
            ...document.querySelectorAll(
              "main, [data-testid=brand-bar] > div, [data-casual-top] > div",
            ),
          ]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0)
            .map((r) => r.left);
          return Math.min(...xs);
        });
        expect(content, where).toBeGreaterThanOrEqual(rail.right + 12);
        expect(await sideways(page), where).toBe(0);
        // The bar's room at the page's end (the empty div just before the nav) goes.
        if (!p.railOnly) expect(await spaceHeight(page), where).toBe(0);
        // Scrolling down never shrinks the rail (the phone bar's mini state changes nothing).
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(400);
        expect(
          await nav.evaluate((el) =>
            Math.round(el.querySelector(":scope > div")!.getBoundingClientRect().width),
          ),
          where,
        ).toBe(76);
        for (const word of WORDS)
          await expect(
            nav.getByText(word, { exact: true }),
            `${where}: ${word}, scrolled`,
          ).toBeVisible();
        // The same names (and counts) as the bar's on a phone.
        if (p.path === "/" && theme === "dark")
          expect(await names(page), where).toEqual(phoneNames);
      }
    } finally {
      await context.close();
    }
  }
});

test("at 1,280px the keyboard reaches the rail's links with the focus ring, and a rail link opens its page", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  for (const theme of THEMES) {
    const context = await open(browser, session, LAPTOP, theme);
    try {
      const page = await context.newPage();
      await page.goto(`${acme}/pay`);
      await expect(main(page)).toBeVisible();
      let inRail = false;
      for (let i = 0; i < 120 && !inRail; i++) {
        await page.keyboard.press("Tab");
        inRail = await page.evaluate(() => !!document.activeElement?.closest("nav[data-tab-bar]"));
      }
      expect(inRail, `Tab reaches the rail, ${theme}`).toBe(true);
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const s = getComputedStyle(el);
        return {
          matches: el.matches(":focus-visible"),
          style: s.outlineStyle,
          width: s.outlineWidth,
          visible: el.getBoundingClientRect().width > 0,
        };
      });
      expect(ring, theme).toEqual({ matches: true, style: "solid", width: "2px", visible: true });
      // Each rail link is a plain link: Shifts opens Shifts, lit there.
      await main(page).getByRole("link", { name: "Shifts", exact: true }).click();
      await expect(page).toHaveURL(`${acme}/shifts`);
      await expect(main(page).locator('a[aria-current="page"]')).toContainText("Shifts");
    } finally {
      await context.close();
    }
  }
});

// "Skip to the menu" (src/app/skip-to-menu.tsx): at 1,280px the first Tab lands on it, it shows
// with the focus ring, and Enter takes the keyboard to the rail, whose first link is the next Tab.
// On a phone it's never reached: the first Tab goes into the page.
test("at 1,280px the first Tab is 'Skip to the menu', shown on focus, and it takes the keyboard to the rail; never on a phone", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  for (const theme of THEMES) {
    const context = await open(browser, session, LAPTOP, theme);
    try {
      const page = await context.newPage();
      await page.goto(`${acme}/pay`);
      await expect(main(page)).toBeVisible();
      const skip = page.locator("a[data-skip-menu]");
      // Hidden until it has focus: screen-reader only (sr-only), 1px and clipped.
      const before = await skip.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, clip: getComputedStyle(el).clipPath };
      });
      expect(before.w <= 1 && before.h <= 1, `${theme} ${JSON.stringify(before)}`).toBe(true);
      await page.keyboard.press("Tab");
      const first = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          skip: el.matches("a[data-skip-menu]"),
          text: el.textContent?.trim(),
          shown: r.width > 40 && r.height > 20,
          ring: el.matches(":focus-visible") && s.outlineStyle === "solid",
        };
      });
      expect(first, theme).toEqual({
        skip: true,
        text: "Skip to the menu",
        shown: true,
        ring: true,
      });
      await expect(skip).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`${acme}/pay#casual-menu`);
      await page.keyboard.press("Tab");
      const next = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const nav = el.closest("nav[data-tab-bar]");
        return {
          inRail: !!nav,
          firstLink: nav ? nav.querySelector("a") === el : false,
          name: el.textContent?.replace(/\s+/g, " ").trim(),
        };
      });
      expect(next, theme).toEqual({ inRail: true, firstLink: true, name: "Home" });
    } finally {
      await context.close();
    }
  }
  const phone = await open(browser, session, PHONE, "dark");
  try {
    const page = await phone.newPage();
    await page.goto(`${acme}/pay`);
    await expect(main(page)).toBeVisible();
    await expect(page.locator("a[data-skip-menu]")).toBeHidden();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement?.matches("a[data-skip-menu]") ?? false),
    ).toBe(false);
  } finally {
    await phone.close();
  }
});

test("with no JavaScript the rail is the same at 1,280px", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: session,
    viewport: LAPTOP.viewport,
    javaScriptEnabled: false,
    locale: "en-GB",
    extraHTTPHeaders: { "x-real-ip": IP },
  });
  try {
    const page = await context.newPage();
    await page.goto(`${acme}/profile`);
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
    const box = await main(page).locator(":scope > div").boundingBox();
    // (Phase 32, 32.1: the links' capsule, 76px wide under the firm's mark in the 96px column.)
    expect([Math.round(box!.x), Math.round(box!.y), Math.round(box!.width)]).toEqual([22, 80, 76]);
    await expect(main(page).locator('a[aria-current="page"]')).toContainText("Profile");
    for (const word of WORDS)
      await expect(main(page).getByText(word, { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

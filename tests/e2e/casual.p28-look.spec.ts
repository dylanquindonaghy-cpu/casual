import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import { lookScene, P28_1_CASUAL, P28_1_TYPED } from "./p28/28-1-data";

// Phase 28, 28.1 (docs/screens.md "The casual app, Phase 28"; docs/ui-design.md "Phase 28"): the
// casual app in the office's look, through the shared parts only. In a real browser, as a made-up
// casual of this spec's own (tests/e2e/p28/28-1-data.ts), on a phone (390px) and on Dylan's laptop
// (1,280px at 150%), light and dark: Home, Booked, Open shifts, a shift and Profile, each with a
// screenshot kept with the run (test-results, and attached to the report). On each page the
// current tab is solid ink (its computed fill is --color-ink itself), the tab bar a 12px capsule
// 12px from the screen's sides and foot; the main button has no gradient (one flat colour); and
// the browser's own date field reads dd/mm/yyyy (en-GB, every run's locale since Phase 28).

const acme = "http://acme.localhost:3100";

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

async function logIn(
  browser: Browser,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "10.240.28.1" } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P28_1_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_1_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { name: `Hi ${P28_1_CASUAL.firstName}` })).toBeVisible();
    return await context.storageState();
  } finally {
    await context.close();
  }
}

// What the look test reads off a page: the current tab's fill and --color-ink's (worked out by the
// browser through a probe), the capsule's corner and its gaps to the screen's sides and foot.
async function tabBar(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]');
    const capsule = nav?.querySelector(":scope > div");
    const current = nav?.querySelector('a[aria-current="page"]');
    if (!nav || !capsule || !current) return null;
    const probe = document.createElement("i");
    probe.style.backgroundColor = "var(--color-ink)";
    probe.style.color = "var(--color-on-ink)";
    document.body.append(probe);
    const ink = getComputedStyle(probe).backgroundColor;
    const onInk = getComputedStyle(probe).color;
    probe.remove();
    const box = capsule.getBoundingClientRect();
    return {
      fill: getComputedStyle(current).backgroundColor,
      words: getComputedStyle(current).color,
      image: getComputedStyle(current).backgroundImage,
      ink,
      onInk,
      corner: getComputedStyle(capsule).borderTopLeftRadius,
      tabCorner: getComputedStyle(current).borderTopLeftRadius,
      left: Math.round(box.left),
      top: Math.round(box.top),
      right: Math.round(innerWidth - box.right),
      foot: Math.round(innerHeight - box.bottom),
      width: Math.round(box.width),
      sideways: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

test("the casual app in the office's look: Home, Booked, Open shifts, a shift and Profile, phone and laptop, light and dark", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene = await lookScene();
  const session = await logIn(browser);

  for (const size of SIZES)
    for (const theme of THEMES) {
      const context = await browser.newContext({
        storageState: session,
        viewport: size.viewport,
        deviceScaleFactor: size.scale,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        colorScheme: theme,
        locale: "en-GB",
        extraHTTPHeaders: { "x-real-ip": "10.240.28.1" },
      });
      try {
        const page = await context.newPage();
        const where = (what: string) =>
          `${what} at ${size.name} (${size.viewport.width}px), ${theme}`;
        const pages: { name: string; open: () => Promise<void>; tab: string }[] = [
          {
            name: "home",
            tab: "Home",
            open: async () => {
              await page.goto(`${acme}/`);
              await expect(
                page.getByRole("heading", { name: `Hi ${P28_1_CASUAL.firstName}` }),
              ).toBeVisible();
            },
          },
          {
            name: "booked",
            tab: "Shifts",
            open: async () => {
              await page.goto(`${acme}/shifts`);
              await expect(
                page.getByRole("heading", { level: 1, name: "Booked shifts" }),
              ).toBeVisible();
              await expect(page.getByRole("region", { name: "Your next shift" })).toBeVisible();
            },
          },
          {
            name: "open-shifts",
            tab: "Shifts",
            open: async () => {
              await page.goto(`${acme}/shifts/open`);
              await expect(
                page.getByRole("heading", { level: 1, name: "Open shifts" }),
              ).toBeVisible();
            },
          },
          {
            name: "profile",
            tab: "Profile",
            open: async () => {
              await page.goto(`${acme}/profile`);
              await expect(
                page.getByRole("heading", {
                  level: 1,
                  name: `${P28_1_CASUAL.firstName} ${P28_1_CASUAL.lastName}`,
                }),
              ).toBeVisible();
            },
          },
        ];
        for (const p of pages) {
          await p.open();
          const look = await tabBar(page);
          expect(look, where(p.name)).not.toBeNull();
          // The current tab is solid ink with its words on it (the office rail's lit item): no
          // lens, no firm's colour, no gradient.
          expect(look!.fill, where(p.name)).toBe(look!.ink);
          expect(look!.words, where(p.name)).toBe(look!.onInk);
          expect(look!.image, where(p.name)).toBe("none");
          expect(look!.tabCorner, where(p.name)).toBe("8px");
          // The capsule: 12px round, 12px from the sides on a phone and 12px over the foot. On a
          // laptop (30.2: from 1024px) it's the office's rail instead: 12px from the window's top
          // and left, 96px wide.
          expect(look!.corner, where(p.name)).toBe("12px");
          if (size.mobile) {
            expect(look!.foot, where(p.name)).toBe(12);
            expect([look!.left, look!.right], where(p.name)).toEqual([12, 12]);
          } else expect([look!.left, look!.top, look!.width], where(p.name)).toEqual([12, 12, 96]);
          expect(look!.sideways, where(p.name)).toBe(0);
          await expect(
            page.getByRole("navigation", { name: "Main" }).locator('a[aria-current="page"]'),
          ).toContainText(p.tab);
          await shoot(page, testInfo, `28.1 ${p.name} ${size.name} ${theme}`);
        }

        // A shift's own page (no tab bar: its own bar and Take shift at the foot): its main button
        // is one flat colour, the firm's, with no gradient.
        await page.goto(`${acme}/shifts/open`);
        const site = scene.urgent.site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        await page
          .getByRole("link", { name: new RegExp(site) })
          .first()
          .click();
        await expect(page).toHaveURL(/\/shifts\/[0-9a-f-]{36}$/);
        const take = page.getByRole("button", { name: "Take shift" });
        await expect(take).toBeVisible();
        const button = await take.evaluate((el) => {
          const s = getComputedStyle(el);
          return { fill: s.backgroundColor, image: s.backgroundImage };
        });
        const stops = [...button.image.matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0]);
        expect(
          button.image === "none" || (stops.length === 2 && stops.every((s) => s === button.fill)),
          `${where("Take shift")}: ${button.image}`,
        ).toBe(true);
        await shoot(page, testInfo, `28.1 shift ${size.name} ${theme}`);

        // The browser's own date field reads dd/mm/yyyy: the page's language is en-GB.
        await page.goto(`${acme}/profile`);
        // (Days you can't work is folded since 28.11: a tap opens it.)
        await page.getByRole("region", { name: "Days you can't work" }).locator("summary").click();
        await expect(page.getByLabel("A day you can't work")).toBeVisible();
        expect(
          await page.evaluate(() => ({
            language: navigator.language,
            date: new Date(2026, 10, 7).toLocaleDateString(),
          })),
          where("the date field"),
        ).toEqual({ language: "en-GB", date: "07/11/2026" });
      } finally {
        await context.close();
      }
    }
});

// The run's own locale (playwright.config.ts `use.locale`, Phase 28): en-GB for every test, not
// only the contexts this file makes.
test("every run's browser is en-GB, so date fields read dd/mm/yyyy", async ({ page }) => {
  await page.goto(`${acme}/login`);
  expect(
    await page.evaluate(() => ({
      language: navigator.language,
      date: new Date(2026, 10, 7).toLocaleDateString(),
    })),
  ).toEqual({ language: "en-GB", date: "07/11/2026" });
});

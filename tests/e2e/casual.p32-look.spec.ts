import type { Browser, BrowserContext, Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { OFFLINE_CACHE } from "../../src/lib/portal/offline";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import { P32_MINA, P32_NOOR, p32Cleanup, p32Scene, type P32Scene } from "./p32/32-data";

// Phase 32 (docs/screens.md "## Phase 32"; Dylan's approved mock-up, "the casual app in the
// office's look"): the office's frame on every casual page (the top bar with her counts, the bell,
// the light or dark switch and her name and role; the lime mark; the rail's 44px round buttons with
// their words; the phone's tab bar kept), Home's next shift on the street map (her shift's pin and
// the pins of the shifts open to her, the tabs filtering them, the card over the map; nothing
// booked: the nearest she can take), the saved copy for no signal showing the card without the
// map, the office's lime and soft badges; no sideways scroll at 390px or 1,280px. As made-up
// casuals of this spec's own (tests/e2e/p32/32-data.ts), in a role of its own.

const acme = "http://acme.localhost:3100";
const IP = "10.240.32.1";
const LAPTOP = { viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false } as const;
const PHONE = { viewport: { width: 390, height: 844 }, scale: 3, mobile: true } as const;
const LIME = "rgb(233, 248, 111)";
// Screenshots of the built Home, for comparing with the mock-up (P32_SHOTS: a folder to keep them
// in as well as the run's report).
const SHOTS = process.env.P32_SHOTS;

type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

test.describe.configure({ mode: "serial" });

let scene: P32Scene;
let mina: Session;
let noor: Session;

async function logIn(browser: Browser, who: { typed: string; mobileE164: string }) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(who.typed);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(who.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${acme}/`);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

function open(browser: Browser, session: Session, size: typeof LAPTOP | typeof PHONE) {
  return browser.newContext({
    storageState: session,
    viewport: size.viewport,
    deviceScaleFactor: size.scale,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    colorScheme: "dark",
    locale: "en-GB",
    extraHTTPHeaders: { "x-real-ip": IP },
  });
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} not on screen`);
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
}
const pins = (page: Page) => page.locator("[data-home-map] [data-map-pin]");

async function shoot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: false, animations: "disabled" });
  await test.info().attach(name, { body, contentType: "image/png" });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" });
    await page.screenshot({ path: `${SHOTS}/${name}-full.png`, fullPage: true });
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  scene = await p32Scene();
  mina = await logIn(browser, P32_MINA);
  noor = await logIn(browser, P32_NOOR);
});
test.afterAll(async () => {
  await p32Cleanup();
});

test("1,280px: the office's top bar and rail; Home's card over the street map", async ({
  browser,
}) => {
  const context = await open(browser, mina, LAPTOP);
  try {
    const page = await context.newPage();
    await page.goto(`${acme}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    // The top bar: her counts (as Home counts them), the bell, the switch, her name and role.
    const top = page.locator("header[data-casual-top]");
    await expect(top).toBeVisible();
    await expect(page.getByTestId("brand-bar")).toBeHidden();
    const counts = top.getByRole("list", { name: "Your numbers" });
    await expect(counts.getByRole("link", { name: /^Booked/ })).toHaveText("Booked 1");
    await expect(counts.getByRole("link", { name: /^Open to you/ })).toHaveText("Open to you 3");
    await expect(counts.getByRole("link", { name: /^Urgent/ })).toHaveText("Urgent 1");
    for (const link of await counts.getByRole("link").all())
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const bell = top.getByRole("link", { name: /^Answers from the office/ });
    await expect(bell).toHaveAttribute("href", "/requests");
    await expect(top.getByRole("button", { name: /^Switch to (light|dark) mode$/ })).toBeVisible();
    await expect(top.locator("[data-you]")).toContainText(
      `${P32_MINA.firstName} ${P32_MINA.lastName}`,
    );
    await expect(top.locator("[data-you]")).toContainText("P32 map check");
    // Light and dark: the switch changes the page's look and says what it switches to next.
    await top.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(242, 242, 240)");
    await top.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The rail: the lime mark at its top; five links, each a 44px round button with its word under
    // it; the current one's button solid ink.
    const nav = page.getByRole("navigation", { name: "Main" });
    const mark = nav.locator("[data-rail-mark]");
    await expect(mark).toBeVisible();
    await expect(mark).toHaveCSS("background-color", LIME);
    const circles = nav.locator("[data-tab-circle]");
    await expect(circles).toHaveCount(5);
    for (const c of await circles.all()) {
      const b = await c.boundingBox();
      expect([Math.round(b?.width ?? 0), Math.round(b?.height ?? 0)]).toEqual([44, 44]);
    }
    for (const word of ["Home", "Shifts", "Messages", "Pay", "Profile"])
      await expect(nav.getByText(word, { exact: true })).toBeVisible();
    const lit = nav.locator('a[aria-current="page"] [data-tab-circle]');
    const ink = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.backgroundColor = "var(--color-ink)";
      document.body.append(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    });
    await expect(lit).toHaveCSS("background-color", ink);

    // The map, her shift's pin and one for each venue open to her with a point (not the one
    // without); the card in raised glass over the map's left.
    const map = page.locator("[data-home-map]");
    await expect(map).toBeVisible();
    await expect(pins(page)).toHaveCount(3);
    const mine = page.locator('[data-map-pin="mine"]');
    await expect(mine).toHaveAccessibleName(new RegExp(`^Your shift: ${scene.booked.site}, `));
    await expect(mine).toHaveAttribute("href", "/shifts");
    const urgent = page.locator('[data-map-pin="urgent"]');
    await expect(urgent).toHaveAccessibleName(
      new RegExp(`^${scene.urgent.site}: 1 shift you can take, 1 urgent, `),
    );
    await expect(urgent).toHaveAttribute("href", /^\/shifts\/open\?site=/);
    await expect(page.locator('[data-map-pin="open"]')).toHaveAccessibleName(
      new RegExp(`^${scene.later.site}: 1 shift you can take, `),
    );
    await expect(map).not.toContainText(scene.unplaced.site);
    const card = page.getByRole("region", { name: "Your next shift" });
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("backdrop-filter", /blur\(12px\)/);
    const [m, c] = [await box(page, "[data-home-map]"), await box(page, "[data-map-card]")];
    expect(c.x).toBeGreaterThan(m.x);
    expect(c.right).toBeLessThan(m.x + m.width / 2);
    expect(c.y).toBeGreaterThanOrEqual(m.y);
    // Every pin right of the card, never under it.
    for (const pin of await pins(page).all()) {
      const b = await pin.boundingBox();
      expect(b?.x ?? 0).toBeGreaterThanOrEqual(c.right);
    }
    await expect(card).toContainText("Gate 2");
    await expect(card.getByText(/^In \d+ days$/)).toHaveCSS("border-radius", /px/);
    const directions = card.getByRole("link", { name: "Directions" });
    await expect(directions).toHaveCSS("background-color", LIME);
    expect((await directions.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(card.locator("[data-card-tiles]")).toContainText("Your qualifications");
    await expect(card.locator("[data-card-tiles]")).toContainText("1 urgent");
    // Details opens the rest inside the card, as the pass did.
    await card.locator("[data-pass-more] summary").click();
    await expect(page.locator("#pass-details")).toBeVisible();
    await expect(page.locator("#pass-details")).toContainText("£13.50 an hour");
    await card.locator("[data-pass-more] summary").click();
    await expect(card.getByRole("button", { name: "Can't make it?" })).toBeVisible();
    // Body text stays 16px.
    await expect(page.locator("body")).toHaveCSS("font-size", "16px");
    expect(await sideways(page)).toBe(0);
    await shoot(page, "home-1280-dark");
    // Every other casual page has the frame too, with no sideways scroll.
    for (const path of ["/shifts", "/messages", "/profile", "/requests"]) {
      await page.goto(`${acme}${path}`);
      await expect(page.locator("header[data-casual-top]"), path).toBeVisible();
      await expect(page.getByTestId("brand-bar"), path).toBeHidden();
      expect(await sideways(page), path).toBe(0);
    }
  } finally {
    await context.close();
  }
});

test("1,280px: the tabs filter the pins, each with its count", async ({ browser }) => {
  const context = await open(browser, mina, LAPTOP);
  try {
    const page = await context.newPage();
    await page.goto(`${acme}/`);
    const tabs = page.getByRole("group", { name: "Show on the map" });
    const tab = (name: string) => tabs.getByRole("button", { name: new RegExp(`^${name} \\d+$`) });
    await expect(tab("All")).toHaveAttribute("aria-pressed", "true");
    // All: her shift and the three open to her (one with no point: counted, no pin).
    await expect(tab("All")).toHaveText("All 4");
    await expect(tab("Urgent")).toHaveText("Urgent 1");
    for (const name of ["All", "Urgent", "This week", "Next week"])
      expect((await tab(name).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The chosen tab's count in lime.
    await expect(tab("All").locator("span")).toHaveCSS("background-color", LIME);
    await expect(pins(page)).toHaveCount(3);
    await tab("Urgent").click();
    await expect(tab("Urgent")).toHaveAttribute("aria-pressed", "true");
    await expect(tab("Urgent").locator("span")).toHaveCSS("background-color", LIME);
    await expect(pins(page)).toHaveCount(1);
    await expect(page.locator('[data-map-pin="urgent"]')).toBeVisible();
    await expect(page.locator('[data-map-pin="mine"]')).toHaveCount(0);
    // This week and Next week between them hold what All does but the shift three weeks out
    // (none here): each pin shown only under its week.
    const thisWeek = Number((await tab("This week").innerText()).replace(/\D+/g, ""));
    const nextWeek = Number((await tab("Next week").innerText()).replace(/\D+/g, ""));
    expect(thisWeek + nextWeek).toBe(4);
    await tab("Next week").click();
    const shown = await pins(page).count();
    expect(shown).toBeLessThanOrEqual(nextWeek);
    await tab("All").click();
    await expect(pins(page)).toHaveCount(3);
  } finally {
    await context.close();
  }
});

test("390px: the top bar and the tab bar kept, the card over the map's foot", async ({
  browser,
}) => {
  const context = await open(browser, mina, PHONE);
  try {
    const page = await context.newPage();
    await page.goto(`${acme}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    const top = page.locator("header[data-casual-top]");
    await expect(top.getByTestId("top-mark")).toHaveCSS("background-color", LIME);
    await expect(top).toContainText("Acme Events");
    await expect(top.getByRole("link", { name: /^Answers from the office/ })).toBeVisible();
    // Her counts under the title on a phone, not in the bar; no switch there.
    await expect(top.getByRole("list", { name: "Your numbers" })).toBeHidden();
    await expect(page.locator("main").getByRole("list", { name: "Your numbers" })).toBeVisible();
    // The tab bar at the foot, raised glass, its words under the icons; no rail mark.
    const nav = page.getByRole("navigation", { name: "Main" });
    const capsule = nav.locator(":scope > div");
    await expect(capsule).toHaveCSS("backdrop-filter", /blur\(12px\)/);
    for (const word of ["Home", "Shifts", "Messages", "Pay", "Profile"])
      await expect(nav.getByText(word, { exact: true })).toBeVisible();
    await expect(nav.locator("[data-rail-mark]")).toBeHidden();
    for (const link of await nav.getByRole("link").all()) {
      const b = await link.boundingBox();
      expect(Math.min(b?.width ?? 0, b?.height ?? 0)).toBeGreaterThanOrEqual(44);
    }
    await expect(pins(page)).toHaveCount(3);
    await shoot(page, "home-390-dark");
    // The map, with the card over its foot; the pins above the card.
    await expect(pins(page)).toHaveCount(3);
    const [m, c] = [await box(page, "[data-home-map]"), await box(page, "[data-map-card]")];
    expect(c.bottom).toBeLessThanOrEqual(m.bottom);
    expect(c.y).toBeGreaterThan(m.y + 96);
    for (const pin of await pins(page).all()) {
      const b = await pin.boundingBox();
      expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(c.y);
    }
    expect(await sideways(page)).toBe(0);
    for (const path of ["/shifts", "/messages", "/profile"]) {
      await page.goto(`${acme}${path}`);
      await expect(page.locator("header[data-casual-top]"), path).toBeVisible();
      expect(await sideways(page), path).toBe(0);
    }
  } finally {
    await context.close();
  }
});

test("nothing booked: the shifts she can take on the map, the soonest, and See shifts you can take", async ({
  browser,
}) => {
  for (const size of [PHONE, LAPTOP]) {
    const context = await open(browser, noor, size);
    try {
      const page = await context.newPage();
      await page.goto(`${acme}/`);
      const card = page.getByRole("region", { name: "No shifts booked" });
      await expect(card).toBeVisible();
      await expect(card).toContainText("3 shifts you can take are on the map.");
      await expect(card.locator("[data-nearest]")).toContainText(/^Soonest: /);
      await expect(card.locator("[data-nearest]")).toContainText(scene.urgent.site);
      const see = card.getByRole("link", { name: "See shifts you can take" });
      await expect(see).toHaveAttribute("href", "/shifts/open");
      await expect(see).toHaveCSS("background-color", LIME);
      await expect(page.locator('[data-map-pin="mine"]')).toHaveCount(0);
      await expect(pins(page)).toHaveCount(2);
      expect(await sideways(page)).toBe(0);
      await shoot(page, `home-empty-${size.viewport.width}-dark`);
    } finally {
      await context.close();
    }
  }
});

test("no signal: the saved copy shows the card without the map", async ({ browser }) => {
  const context = await open(browser, mina, PHONE);
  try {
    const page = await context.newPage();
    await page.goto(`${acme}/`);
    await expect(pins(page)).toHaveCount(3);
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
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText("No signal.")).toBeVisible();
    const card = page.getByRole("region", { name: "Your next shift" });
    await expect(card).toBeVisible();
    await expect(card).toContainText(scene.booked.site);
    // No map, no tabs, no pins; "Offline" in the top bar.
    await expect(page.locator("[data-home-map]")).toBeHidden();
    await expect(page.getByRole("group", { name: "Show on the map" })).toBeHidden();
    await expect(page.locator("[data-map-pin]")).toHaveCount(0);
    await expect(
      page.locator("[data-casual-top]").getByText("Offline", { exact: true }),
    ).toBeVisible();
    expect(await sideways(page)).toBe(0);
    await context.setOffline(false);
  } finally {
    await context.close();
  }
});

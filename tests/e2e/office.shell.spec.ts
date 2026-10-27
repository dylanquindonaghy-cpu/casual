import type { Locator, Page } from "@playwright/test";
import { addOfficeUser, addWorker } from "./db";
import { accountMenu, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office shell in a real browser (docs/office-v2.md 3.1; PLAN.md 12A.2, 23.2 and 24.2), at
// phone width (the browser tests' Pixel 7) and on a wide screen: the menu drawer (opens with Menu;
// Escape, the backdrop and Close menu shut it; focus goes back to Menu; nothing in it can be tabbed
// to while it's shut), the top bar (on a phone the window's full width: Menu, the firm, the light
// or dark switch and you, whose account menu has your name and role, the same switch, How-to guide
// and Log out), the switch (at once, both saying the same, kept after a reload with no flash), and
// from 1024px (Phase 24, round 7) the rail at the left beside the page and three glass capsules
// over it: the counts, the search and you, with a frosted edge once the page scrolls under them.
// On a laptop with a mouse: the shut rail fits the window and its button opens it to names and
// counts (kept after a reload); a fold pressed while it's shut opens it; a red dot where a page
// needs you; a shut icon's name shows under the pointer and on focus and Escape puts it away; the
// lens moves to a link as it's picked; the counts open where they're worked and say what those
// pages say; the search finds a casual, a shift and a site (never another firm's); a press dips
// (and glass swells), nothing lifts, no round button breaks onto two lines, and the keyboard never
// leaves a control hidden under the top bar. Everything on a phone runs with the device set to
// light and again set to dark.

const acme = "http://acme.localhost:3100";
// The office's window (Phase 24, round 7): the wash on its base (the canvas), and on it what floats
// (the rail, the top bar on a phone and its capsules from 1024px) as floating glass; the page no
// card of its own. Round 3's white cards with their hairlines on a cool grey ground (Phase 23) and
// 24.1's menu card went.
const CANVAS = { light: "rgb(238, 241, 248)", dark: "rgb(7, 8, 12)" }; // #eef1f8, #07080c
const FLOAT = { light: "rgba(255, 255, 255, 0.78)", dark: "rgba(30, 30, 34, 0.8)" };
const NONE = "rgba(0, 0, 0, 0)";

// A surface's look: its colour, its edge on each side, its corners and any depth.
const surface = (el: Locator) =>
  el.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      bg: s.backgroundColor,
      image: s.backgroundImage,
      edges: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
      edge: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor],
      corners: [
        s.borderTopLeftRadius,
        s.borderTopRightRadius,
        s.borderBottomRightRadius,
        s.borderBottomLeftRadius,
      ],
      shadow: s.boxShadow,
      frost: s.backdropFilter,
    };
  });
// No surface at all: no fill, no edge, no corners, no depth (the page, Phase 24).
const bare = {
  bg: NONE,
  image: "none",
  edges: ["0px", "0px", "0px", "0px"],
  edge: expect.any(Array),
  corners: Array(4).fill("0px"),
  shadow: "none",
  frost: "none",
};

// Each test logs in as a resourcer of its own (the seeded users allow 3 login links per 15
// minutes, and this spec logs in six times).
async function officeLogin(
  page: Page,
  who: string,
  role: "resourcer" | "admin" | "payroll" = "resourcer",
) {
  const email = `shell.${who}@example.com`;
  await addOfficeUser("acme", { email, name: "Sam Rota", role });
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  // Payroll's home is the pay dashboard (12A.3).
  await expect(page).toHaveURL(role === "payroll" ? `${acme}/office/pay` : `${acme}/office`);
}

// Whether the focused element is inside the office menu or its drawer (a page may have its own
// <nav>).
const focusInMenu = (page: Page) =>
  page.evaluate(() =>
    Boolean(document.activeElement?.closest('nav[aria-label="Office menu"], #office-menu-drawer')),
  );

for (const device of ["light", "dark"] as const) {
  test.describe(`with the device set to ${device}`, () => {
    test.use({ colorScheme: device });

    test("the menu drawer: Menu opens it; Escape, the backdrop and Close menu shut it", async ({
      page,
    }) => {
      await officeLogin(page, `${device}.drawer`);
      const menuButton = page.getByRole("button", { name: "Menu", exact: true });
      const drawer = page.getByRole("dialog", { name: "Menu" });
      // Phone width: no menu card, and nothing of the menu can be reached with Tab while it's shut.
      await expect(menuButton).toBeEnabled();
      await expect(page.getByRole("navigation", { name: "Office menu" })).toHaveCount(0);
      await menuButton.focus();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        expect(await focusInMenu(page)).toBe(false);
      }

      // Escape shuts it, and focus goes back to Menu. Every row in it is a thumb's 44px tall, on
      // the brief's 390px phone (Phase 21), and so is every button in the top bar (Menu, the light
      // or dark switch and you: Phase 23).
      await page.setViewportSize({ width: 390, height: 844 });
      const bar = await page
        .getByRole("banner")
        .locator("button")
        .evaluateAll((els) =>
          els
            .filter((el) => el.checkVisibility())
            .map((el) => [el.textContent ?? "", Number.parseFloat(getComputedStyle(el).height)]),
        );
      expect(bar.length).toBeGreaterThanOrEqual(3);
      for (const [name, height] of bar) expect(height, String(name)).toBeGreaterThanOrEqual(44);
      await menuButton.click();
      await expect(drawer).toBeVisible();
      // Floating glass from the left edge, over the dimmed page, sliding in (Phase 24; white in
      // 23); the firm at its head in a plain box, not a second banner.
      await expect.poll(() => drawer.evaluate((el) => el.getBoundingClientRect().left)).toBe(0);
      const sheet = await surface(drawer);
      expect(sheet.bg).toBe(FLOAT[device]);
      expect(sheet.frost).toContain("blur(18px)");
      expect(sheet.shadow).not.toBe("none");
      expect(sheet.corners).toEqual(Array(4).fill("0px"));
      expect(await drawer.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe(
        "translate",
      );
      expect(await drawer.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.2s");
      await expect(drawer.getByText("Acme Events", { exact: true })).toBeVisible();
      await expect(drawer.locator("header")).toHaveCount(0);
      // (The folded group opened first, so its links are measured too.)
      const fold = drawer.locator('button[aria-expanded="false"]');
      if ((await fold.count()) > 0) await fold.click();
      const rows = drawer.locator("a, button:not([aria-label='Close menu'])");
      // Their laid-out height: the folded group's links slide in (a transform), and a box measured
      // mid-slide can read 43.99994px.
      const heights = await rows.evaluateAll((els) =>
        els
          .filter((el) => el.checkVisibility())
          .map((el) => Number.parseFloat(getComputedStyle(el).height)),
      );
      expect(heights.length).toBeGreaterThan(8);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
      await expect(
        drawer.getByRole("link", { name: "Events & sessions", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(menuButton).toBeFocused();

      // A tap on the dimmed page beside it shuts it.
      await menuButton.click();
      await expect(drawer).toBeVisible();
      const size = page.viewportSize();
      await page.mouse.click((size?.width ?? 412) - 10, (size?.height ?? 800) / 2);
      await expect(drawer).toBeHidden();

      // Close menu shuts it.
      await menuButton.click();
      await page.getByRole("button", { name: "Close menu" }).click();
      await expect(drawer).toBeHidden();
      await expect(menuButton).toBeFocused();

      // A link takes you there and the drawer shuts; reopened, that page is marked current.
      await (await menuLink(page, "Events & sessions")).click();
      await expect(page).toHaveURL(`${acme}/office/events`);
      await expect(drawer).toBeHidden();
      await expect(await menuLink(page, "Events & sessions")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.keyboard.press("Escape");

      // On a wide screen the menu is in the rail beside the page, and there's no Menu button.
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.getByRole("navigation", { name: "Office menu" })).toBeVisible();
      await expect(menuButton).toBeHidden();
    });

    test("the light or dark switches (the top bar's and your account menu's) change the theme at once, say the same, and keep it after a reload", async ({
      page,
    }) => {
      await officeLogin(page, `${device}.theme`);
      const other = device === "light" ? "dark" : "light";
      // The page's ground (the wash's base, on <body>) and the floating bar change with it.
      const shell = page.locator("body");
      const bar = page.getByRole("banner");
      await expect(shell).toHaveCSS("background-color", CANVAS[device]);
      await expect(bar).toHaveCSS("background-color", FLOAT[device]);
      // Its words say what it switches to (a row of the account menu since Phase 22; Phase 23 the
      // square moon or sun in the top bar too, named by the same words).
      const square = bar.getByRole("button", { name: `Switch to ${other} mode`, exact: true });
      await expect(square).toBeEnabled();
      const menu = await accountMenu(page);
      await menu.getByRole("button", { name: `Switch to ${other} mode`, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await expect(shell).toHaveCSS("background-color", CANVAS[other]);
      await expect(bar).toHaveCSS("background-color", FLOAT[other]);
      await expect(
        menu.getByRole("button", { name: `Switch to ${device} mode`, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      // The top bar's switch followed it: both say the same.
      const back = bar.getByRole("button", { name: `Switch to ${device} mode`, exact: true });
      await expect(back).toBeVisible();
      await expect(bar.getByRole("button", { name: /^Switch to (light|dark) mode$/ })).toHaveCount(
        1,
      );

      // And the other way: the top bar's switch, then the account menu's says the same.
      await back.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", device);
      await expect(shell).toHaveCSS("background-color", CANVAS[device]);
      await expect(square).toBeVisible();
      const again = await accountMenu(page);
      await expect(
        again.getByRole("button", { name: `Switch to ${other} mode`, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(again).toBeHidden();
      await square.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await expect(bar).toHaveCSS("background-color", FLOAT[other]);

      // Kept: the server sends the next page in that theme (no flash), and after a reload too.
      const sent = await page.request.get(`${acme}/office`);
      expect(await sent.text()).toMatch(new RegExp(`<html lang="en-GB" data-theme="${other}"`));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await expect(shell).toHaveCSS("background-color", CANVAS[other]);
      await expect(
        bar.getByRole("button", { name: `Switch to ${device} mode`, exact: true }),
      ).toBeVisible();
    });

    test("the top bar: on a phone the window's full width; from 1024px the rail beside the page and three glass capsules over it", async ({
      page,
    }) => {
      await officeLogin(page, `${device}.bar`);
      const bar = page.getByRole("banner");
      const card = page.locator("#main > div");
      const width = () => page.evaluate(() => document.documentElement.clientWidth);
      // On a phone: the page no card of its own, its sections glass on the wash (Phase 24; a white
      // card with its hairline in 23, a sheet with rounded top corners in 22).
      expect(await surface(card)).toEqual(bare);
      // The firm's own bar gives way to the top bar on logged-in office pages.
      await expect(page.getByTestId("brand-bar")).toBeHidden();
      await expect(bar.getByText("Acme Events", { exact: true })).toBeVisible();
      // The counts and the search wait for a wider window; the rail too.
      await expect(bar.getByRole("link", { name: /^To fill \d+$/ })).toBeHidden();
      await expect(bar.getByRole("searchbox")).toBeHidden();
      await expect(page.locator("#office-rail")).toBeHidden();
      // Floating glass (no hairline under it: its own edge), 56px tall, the window's full width.
      const glassBar = await surface(bar);
      expect(glassBar.bg).toBe(FLOAT[device]);
      expect(glassBar.frost).toContain("blur(18px)");
      expect(glassBar.edges).toEqual(["0px", "0px", "0px", "0px"]);
      expect(glassBar.shadow).not.toBe("none");
      expect(await bar.boundingBox()).toMatchObject({
        x: 0,
        y: 0,
        height: 56,
        width: await width(),
      });

      await expect(page.getByRole("button", { name: "Sam Rota Resourcer" })).toBeVisible();
      const menu = await accountMenu(page);
      await expect(menu.getByText("Sam Rota", { exact: true })).toBeVisible();
      await expect(menu.getByText("Resourcer", { exact: true })).toBeVisible();
      await expect(
        menu.getByRole("button", { name: /^Switch to (light|dark) mode$/ }),
      ).toBeVisible();
      await expect(menu.getByRole("link", { name: "How-to guide" })).toBeVisible();
      await expect(menu.getByRole("button", { name: "Log out" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      // On a tablet the name shows on the account button.
      const account = page.locator('button[popovertarget="office-account-menu"]');
      await page.setViewportSize({ width: 800, height: 900 });
      await expect(account.getByText("Sam Rota", { exact: true })).toBeVisible();

      // At 1280: the rail at the left, 12px from the window's corner (72px, the firm's mark at its
      // top); the bar beside it, no glass of its own, 68px tall: three capsules 12px down, each
      // floating glass 48px tall and round.
      await page.setViewportSize({ width: 1280, height: 900 });
      const wide = await width();
      const rail = page.locator("#office-rail");
      await expect(rail).toBeVisible();
      expect(await rail.boundingBox()).toMatchObject({ x: 12, y: 12, width: 72 });
      const own = await surface(bar);
      expect({ bg: own.bg, frost: own.frost, shadow: own.shadow }).toEqual({
        bg: NONE,
        frost: "none",
        shadow: "none",
      });
      expect(await bar.boundingBox()).toMatchObject({ x: 96, y: 0, height: 68, width: wide - 108 });
      const capsules = [
        bar.locator("[data-bar-counts]"),
        bar.getByRole("searchbox").locator("xpath=.."),
        account.locator("xpath=.."),
      ];
      for (const capsule of capsules) {
        const glass = await surface(capsule);
        expect(glass.bg).toBe(FLOAT[device]);
        expect(glass.frost).toContain("blur(18px)");
        expect(glass.shadow).not.toBe("none");
        expect(Number.parseFloat(glass.corners[0] ?? "0")).toBeGreaterThanOrEqual(24);
        expect(await capsule.boundingBox()).toMatchObject({ y: 12, height: 48 });
      }
      // In that order, left to right, the last 12px from the window's edge.
      const xs = await Promise.all(capsules.map(async (c) => (await c.boundingBox())!.x));
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
      const you = (await capsules[2]!.boundingBox())!;
      expect(Math.round(you.x + you.width)).toBe(wide - 12);
      // The firm is the rail's mark now, not the bar's.
      await expect(bar.getByText("Acme Events", { exact: true })).toBeHidden();
      await expect(rail.getByText("A", { exact: true })).toBeVisible();
      // A resourcer's counts (Pay queries are payroll's and admins'), and the search.
      for (const name of [/^To fill \d+$/, /^Urgent \d+$/, /^Offers out \d+$/, /^To check \d+\+?$/])
        await expect(bar.getByRole("link", { name })).toBeVisible();
      await expect(bar.getByRole("link", { name: /^Pay queries/ })).toHaveCount(0);
      await expect(
        bar.getByRole("searchbox", { name: "Find a casual, shift or site" }),
      ).toBeVisible();
      // No pay week and no shifts line (the dashboards and Settings have them).
      await expect(bar.getByText(/^Week \d/)).toHaveCount(0);
      await expect(bar.getByText("+44 7700 900000")).toHaveCount(0);
      // You: your initials on a pale blue disc, your name and your role.
      await expect(account.getByText("SR", { exact: true })).toBeVisible();
      await expect(account.getByText("Sam Rota", { exact: true })).toBeVisible();
      await expect(account.getByText("Resourcer", { exact: true })).toBeVisible();
      await expect(account).toHaveAccessibleName("Sam Rota Resourcer");
      // Its menu opens 8px under you, its right edge with yours. (Once it has grown out of its
      // corner.)
      const button = (await account.boundingBox())!;
      const opened = await accountMenu(page);
      const pop = async () => (await opened.boundingBox())!;
      await expect
        .poll(async () => Math.round((await pop()).y))
        .toBe(Math.round(button.y + button.height + 8));
      await expect
        .poll(async () => Math.round((await pop()).x + (await pop()).width))
        .toBe(Math.round(button.x + button.width));
      await page.keyboard.press("Escape");
      await expect(opened).toBeHidden();

      // The page beside the rail, under the capsules, no card of its own; the wash shows round
      // them: the shell paints no ground.
      expect(await surface(card)).toEqual(bare);
      // (Its box starts under the bar; its words 12px further down.)
      const pageBox = page.locator("#main > div > div");
      expect(await pageBox.boundingBox()).toMatchObject({ x: 96, y: 68, width: wide - 108 });
      await expect(pageBox).toHaveCSS("padding-top", "12px");
      await expect(page.locator('[data-shell="office"]')).toHaveCSS("background-color", NONE);
      await expect(page.locator("body")).toHaveCSS("background-color", CANVAS[device]);
      await expect(page.locator("#main")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

      // Once the page scrolls under the capsules, a soft frosted edge fades in behind them.
      const edge = () =>
        bar.evaluate((el) => {
          const s = getComputedStyle(el, "::before");
          return { opacity: s.opacity, frost: s.backdropFilter };
        });
      expect((await edge()).opacity).toBe("0");
      await page.evaluate(() => window.scrollTo(0, 400));
      await expect(bar).toHaveAttribute("data-scrolled", "");
      await expect.poll(async () => (await edge()).opacity).toBe("1");
      expect((await edge()).frost).toContain("blur(10px)");
      expect((await bar.boundingBox())?.y).toBe(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(bar).not.toHaveAttribute("data-scrolled", "");

      await (await accountMenu(page)).getByRole("link", { name: "How-to guide" }).click();
      await expect(page).toHaveURL(`${acme}/office/guide`);
    });
  });
}

// On a laptop with a mouse (Phase 22; Dylan: "a tacky scroll wheel on the left side", "subtle
// reactive on click responses"): the browser tests' phone has a touch screen, so this one doesn't.
test.describe("on a laptop window (1280 × 640) with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 640 }, hasTouch: false, isMobile: false });

  // Phase 24 (round 7): the rail, shut, is a column of round icons that fits the window; its own
  // button opens it to names and counts (kept in the sd-rail cookie, so a reload keeps it), a fold
  // pressed while it's shut opens it with that fold open (not kept), and a red dot marks each icon
  // whose page needs you: the same rows that show an amber count when it's open.
  test("the rail: icons that fit the window; its button opens it to names and counts, kept after a reload; a fold opens it", async ({
    page,
  }) => {
    await officeLogin(page, "rail", "admin");
    const rail = page.locator("#office-rail");
    const menu = page.getByRole("navigation", { name: "Office menu" });
    const toggle = rail.getByRole("button", { name: "Show the menu with names" });
    await expect(toggle).toBeEnabled();
    await expect(rail).toHaveAttribute("data-rail", "shut");
    // Floating glass, 24px round, 72px wide, 12px from the window's corner, all of it inside the
    // window.
    const glass = await surface(rail);
    expect(glass.bg).toBe(FLOAT.light);
    expect(glass.frost).toContain("blur(18px)");
    expect(glass.corners).toEqual(Array(4).fill("24px"));
    const box = (await rail.boundingBox())!;
    expect(box).toMatchObject({ x: 12, y: 12, width: 72 });
    expect(box.y + box.height).toBeLessThanOrEqual(640);
    // Its rows: round 48px icons, each named by its words alone.
    const rows = () =>
      menu.locator("a, button").evaluateAll((els) =>
        els
          .filter((el) => el.checkVisibility())
          .map((el) => {
            const r = el.getBoundingClientRect();
            const name = el.querySelector("span:not([aria-hidden])")?.textContent ?? "";
            return [name, Math.round(r.width), Math.round(r.height)] as const;
          }),
      );
    expect(await rows()).toEqual(
      [
        "Dashboard",
        "Needs attention",
        "Events & sessions",
        "Enquiries",
        "Cancellations",
        "Pay",
        "People",
        "Admin and records",
      ].map((n) => [n, 48, 48]),
    );
    // The page you're on, under the lens (white glass), its icon in the accent.
    const home = menu.getByRole("link", { name: "Dashboard", exact: true });
    await expect(home).toHaveAttribute("aria-current", "page");
    await expect(home).toHaveCSS("background-color", "rgba(255, 255, 255, 0.92)");
    await expect(home.locator("svg")).toHaveCSS("color", "rgb(29, 78, 216)");
    const dotted = await menu
      .locator("a:has([data-rail-dot]), button:has([data-rail-dot])")
      .evaluateAll((els) =>
        els.map((el) => el.querySelector("span:not([aria-hidden])")?.textContent ?? ""),
      );

    // Opened: 236px, names and counts, its button saying so.
    await toggle.click();
    await expect(rail).toHaveAttribute("data-rail", "open");
    await expect.poll(async () => (await rail.boundingBox())?.width).toBe(236);
    await expect(rail.getByRole("button", { name: "Show the menu as icons" })).toBeVisible();
    await expect(rail.getByText("Acme Events", { exact: true })).toBeVisible();
    await expect(menu.getByText("Events & sessions", { exact: true })).toBeVisible();
    for (const fold of ["Pay", "People", "Admin and records"]) {
      const button = menu.getByRole("button", { name: fold, exact: true });
      if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
    }
    // A dot where its count is amber (it needs you); on a fold where one of its pages' is.
    const amber = await menu.locator("a:has(.bg-hivis)").evaluateAll((els) =>
      els.map((el) => {
        const fold = el.closest("[id^='rail-']");
        const name = el.querySelector("span:not([aria-hidden])")?.textContent ?? "";
        return fold
          ? (document.querySelector(`button[aria-controls="${fold.id}"] span:not([aria-hidden])`)
              ?.textContent ?? "")
          : name;
      }),
    );
    expect(dotted.length).toBeGreaterThan(0);
    expect([...new Set(amber)].sort()).toEqual([...dotted].sort());
    // Its pages' rows: 38px, their names lined up with the fold's.
    const casuals = menu.getByRole("link", { name: "Casuals", exact: true });
    expect((await casuals.boundingBox())?.height).toBe(38);
    const label = async (el: Locator) =>
      Math.round((await el.locator("span:not([aria-hidden])").first().boundingBox())?.x ?? -1);
    expect(await label(casuals)).toBe(
      await label(menu.getByRole("button", { name: "People", exact: true })),
    );
    // Kept after a reload (the sd-rail cookie), and shut again the same way.
    await page.reload();
    await expect(rail).toHaveAttribute("data-rail", "open");
    await expect(menu.getByText("Events & sessions", { exact: true })).toBeVisible();
    await rail.getByRole("button", { name: "Show the menu as icons" }).click();
    await expect(rail).toHaveAttribute("data-rail", "shut");
    await page.reload();
    await expect(rail).toHaveAttribute("data-rail", "shut");

    // A fold pressed while the rail is shut opens the rail with that fold open; its pages are
    // there to pick. (Only the rail's own button is kept: a reload shuts it again.)
    await expect(menu.getByRole("button", { name: "People", exact: true })).toBeEnabled();
    await menu.getByRole("button", { name: "People", exact: true }).click();
    await expect(rail).toHaveAttribute("data-rail", "open");
    await expect(menu.getByRole("button", { name: "People", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(menu.getByRole("link", { name: "Casuals", exact: true })).toBeVisible();
    await page.reload();
    await expect(rail).toHaveAttribute("data-rail", "shut");
  });

  // Shut, an icon's name shows beside it under the pointer and on keyboard focus, with its count's
  // words; the pointer can move onto it; Escape puts it away (WCAG 1.4.13), and it comes back with
  // the next focus or pointer.
  test("a shut icon's name shows beside it under the pointer and on keyboard focus; Escape puts it away", async ({
    page,
  }) => {
    await officeLogin(page, "railtip", "admin");
    const menu = page.getByRole("navigation", { name: "Office menu" });
    const link = menu.getByRole("link", { name: "Events & sessions", exact: true });
    const tip = link.locator("xpath=..").locator("[data-rail-tip]");
    await expect(link).toBeVisible();
    await expect(tip).toBeHidden();
    await expect(tip).toHaveText("Events & sessions");
    await link.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveCSS("animation-name", "sd-pop");
    // 12px to the right of the icon, level with it.
    const at = (await link.boundingBox())!;
    const shown = async () => (await tip.boundingBox())!;
    await expect
      .poll(async () => Math.round((await shown()).x))
      .toBe(Math.round(at.x + at.width + 12));
    await expect
      .poll(async () => Math.round((await shown()).y + (await shown()).height / 2))
      .toBe(Math.round(at.y + at.height / 2));
    // The pointer moves across onto the words (the 12px between) and they stay; Escape puts
    // them away with the pointer still there.
    const words = await shown();
    await page.mouse.move(words.x + 8, words.y + words.height / 2, { steps: 8 });
    await expect.poll(() => tip.evaluate((el) => el.matches(":hover"))).toBe(true);
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    // Away and back: they show again; away, they go.
    await page.mouse.move(640, 400);
    await link.hover();
    await expect(tip).toBeVisible();
    await page.mouse.move(640, 400);
    await expect(tip).toBeHidden();
    // From the keyboard: Tab onto it from the icon above; Escape keeps the focus.
    await menu.getByRole("link", { name: "Needs attention", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await expect(link).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(menu.getByRole("link", { name: "Enquiries", exact: true })).toBeFocused();
    await expect(tip).toBeHidden();
    // A count's words beside its icon: Needs attention says how many there are to deal with.
    const needs = menu.getByRole("link", { name: "Needs attention", exact: true });
    await needs.hover();
    await expect(needs.locator("xpath=..").locator("[data-rail-tip]")).toHaveText(
      /^Needs attention(, \d+\+? to deal with)?$/,
    );
  });

  // The lens goes to a link as it's picked, before its page arrives (held back here), while the
  // page you're on is still marked current.
  test("the lens moves to a pick at once", async ({ page }) => {
    await officeLogin(page, "lens", "admin");
    const menu = page.getByRole("navigation", { name: "Office menu" });
    const lens = "rgba(255, 255, 255, 0.92)";
    const pick = menu.getByRole("link", { name: "Cancellations", exact: true });
    await expect(menu.getByRole("link", { name: "Dashboard", exact: true })).toHaveCSS(
      "background-color",
      lens,
    );
    await page.route(/\/office\/cancellations(\?|$)/, async (route) => {
      const request = route.request();
      if (request.headers()["rsc"] === "1" && request.headers()["next-router-prefetch"] !== "1")
        await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    await pick.click();
    await expect(pick).toHaveCSS("background-color", lens);
    await expect(menu.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page).toHaveURL(`${acme}/office/cancellations`);
    await expect(pick).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "Dashboard", exact: true })).not.toHaveCSS(
      "background-color",
      lens,
    );
  });

  // The counts (round 7's first capsule) open where each is worked, and say what those pages say.
  test("the counts open where they're worked, and say what those pages say", async ({ page }) => {
    await officeLogin(page, "counts", "admin");
    const bar = page.getByRole("banner");
    const menu = page.getByRole("navigation", { name: "Office menu" });
    const count = async (label: string) => {
      const link = bar.getByRole("link", { name: new RegExp(`^${label} \\d+\\+?$`) });
      await expect(link).toBeVisible();
      return Number(/(\d+)\+?$/.exec((await link.innerText()).trim())?.[1]);
    };
    // To check: Needs attention's own count, as the rail says it.
    const toCheck = await count("To check");
    const needs = menu.getByRole("link", { name: "Needs attention", exact: true });
    await needs.hover();
    await expect(needs.locator("xpath=..").locator("[data-rail-tip]")).toHaveText(
      toCheck > 0
        ? new RegExp(`^Needs attention, ${toCheck}\\+? to deal with$`)
        : "Needs attention",
    );
    // Urgent: the dashboard's urgent places.
    const urgent = await count("Urgent");
    await expect(
      page.getByRole("main").getByRole("link", { name: new RegExp(`^Urgent places ${urgent}\\b`) }),
    ).toBeVisible();
    // Pay queries: those waiting, as Pay's fold says them.
    const pay = await count("Pay queries");
    const fold = menu.getByRole("button", { name: "Pay", exact: true });
    await fold.hover();
    await expect(fold.locator("xpath=..").locator("[data-rail-tip]")).toHaveText(
      pay > 0 ? `Pay, ${pay} waiting` : "Pay",
    );
    // Offers out: the dashboard's offers chart.
    await bar.getByRole("link", { name: /^Offers out \d+$/ }).click();
    await expect(page).toHaveURL(`${acme}/office#offers-chart`);
    await expect(page.locator("#offers-chart")).toBeInViewport();
    // To fill: Events & sessions' places to fill, with sessions that need people.
    const toFill = await count("To fill");
    await bar.getByRole("link", { name: /^To fill \d+$/ }).click();
    await expect(page).toHaveURL(`${acme}/office/events?view=need`);
    await expect(page.getByRole("main")).toContainText(
      `${toFill} ${toFill === 1 ? "open place" : "open places"} across`,
    );
    await bar.getByRole("link", { name: /^Urgent \d+$/ }).click();
    await expect(page).toHaveURL(`${acme}/office/events?view=urgent`);
    await bar.getByRole("link", { name: /^To check \d+\+?$/ }).click();
    await expect(page).toHaveURL(`${acme}/office/needs-attention`);
    await bar.getByRole("link", { name: /^Pay queries \d+$/ }).click();
    await expect(page).toHaveURL(`${acme}/office/pay-queries`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  // The search (round 7's second capsule): ⌘K or Ctrl K from anywhere; what's typed goes to the
  // server as an action; casuals, shifts and sites, each a link; the keyboard moves through them;
  // never another firm's.
  test("the search finds a casual, a shift and a site; the keyboard moves through them; never another firm's", async ({
    page,
  }) => {
    const ours = await addWorker("acme", {
      firstName: "Quilla",
      lastName: "Searchfield",
      mobileE164: "+447700900761",
    });
    await addWorker("northline", {
      firstName: "Quilla",
      lastName: "Elsewhere",
      mobileE164: "+447700900762",
    });
    await officeLogin(page, "search");
    const bar = page.getByRole("banner");
    const box = bar.getByRole("searchbox", { name: "Find a casual, shift or site" });
    const panel = bar.locator("[data-search-panel]");
    const live = bar.locator('[aria-live="polite"]');
    await expect(box).toBeEnabled();
    await expect(box).toHaveAttribute("placeholder", "Search");
    await expect(bar.locator("kbd")).toHaveText(/^(⌘K|Ctrl K)$/);
    // From anywhere on the page.
    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(box).toBeFocused();
    await page.keyboard.type("quilla");
    await expect(panel.getByRole("link")).toHaveCount(1);
    const found = panel.getByRole("link", { name: /^Quilla Searchfield\b/ });
    await expect(found).toBeVisible();
    await expect(panel).not.toContainText("Elsewhere");
    await expect(live).toHaveText("1 found for “quilla”.");
    // Never in the address.
    expect(page.url()).not.toContain("quilla");
    // Down into the results, Escape back to the box (the panel shut).
    await page.keyboard.press("ArrowDown");
    await expect(found).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(box).toBeFocused();
    // The other firm's Quilla by her own mobile: nothing.
    await box.fill("07700 900762");
    await expect(panel).toContainText("Nothing found for “07700 900762”.");
    await expect(panel.getByRole("link")).toHaveCount(0);
    // Ours by hers; Enter opens the first.
    await box.fill("07700 900761");
    await expect(panel.getByRole("link", { name: /^Quilla Searchfield\b/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${acme}/office/casuals/${ours}`);
    await expect(box).toHaveValue("");
    // A site: Events & sessions at that site, with a way back to every site.
    await box.fill("demo arena");
    const site = panel.getByRole("link", { name: /^Acme Demo Arena\b/ });
    await expect(site).toBeVisible();
    await expect(panel.getByText("Sites", { exact: true })).toBeVisible();
    await site.click();
    await expect(page).toHaveURL(/\/office\/events\?site=[0-9a-f-]{36}$/);
    await expect(page.getByRole("main")).toContainText("At Acme Demo Arena.");
    await expect(
      page.getByRole("main").getByRole("link", { name: "Show every site" }),
    ).toBeVisible();
    // A shift: its page.
    await box.fill("door supervisor");
    await expect(panel.getByText("Shifts", { exact: true })).toBeVisible();
    const shift = panel.getByRole("link", { name: /^Door supervisor · / }).first();
    await shift.click();
    await expect(page).toHaveURL(/\/office\/shifts\/[0-9a-f-]{36}$/);
    // A click outside shuts it.
    await box.fill("quilla");
    await expect(panel).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(panel).toHaveCount(0);
  });

  // Phase 23 (flat): a dashboard card no longer lifts under the pointer (round 2's rose 2px); it
  // still dips when pressed. Phase 24 (round 7): a glass button swells instead.
  test("what you press dips (glass swells) and springs back; a dashboard card stays put under the pointer", async ({
    page,
  }) => {
    await officeLogin(page, "press", "admin");
    const card = page.getByRole("main").getByRole("link", { name: /^Waiting on others\b/ });
    await expect(card).toHaveCount(1);
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);
    await expect.poll(() => card.evaluate((el) => el.matches(":hover"))).toBe(true);
    // Longer than any of its transitions (150ms colours, 300ms spring): it hasn't moved.
    await page.waitForTimeout(400);
    expect(await card.evaluate((el) => getComputedStyle(el).translate)).toBe("none");
    await page.mouse.down();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).scale)).toBe("0.97");
    await page.mouse.move(box.x + 40, box.y + 400);
    await page.mouse.up();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).scale)).toBe("none");
    // A glass button swells a little and springs back (`press-glass`): a chart's "Numbers".
    const numbers = page.getByRole("main").getByRole("button", { name: "Numbers" }).first();
    await numbers.scrollIntoViewIfNeeded();
    const nb = (await numbers.boundingBox())!;
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await page.mouse.down();
    await expect.poll(() => numbers.evaluate((el) => getComputedStyle(el).scale)).toBe("1.04");
    await page.mouse.move(nb.x + nb.width / 2, nb.y + 300);
    await page.mouse.up();
    await expect.poll(() => numbers.evaluate((el) => getComputedStyle(el).scale)).toBe("none");
    await expect(numbers).toHaveAttribute("aria-pressed", "false");
    // A text link with its own 44px target dips too (in the office: `office:press`): a page's
    // way back (Needs attention's to the Dashboard), and `btn.link` (Office team's "Back to the
    // dashboard").
    for (const [path, name] of [
      ["/office/needs-attention", "Dashboard"],
      ["/office/team", "Back to the dashboard"],
    ] as const) {
      await page.goto(`${acme}${path}`);
      const link = page.getByRole("main").getByRole("link", { name, exact: true });
      await link.scrollIntoViewIfNeeded();
      const at = (await link.boundingBox())!;
      await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
      await page.mouse.down();
      await expect.poll(() => link.evaluate((el) => getComputedStyle(el).scale), path).toBe("0.97");
      await page.mouse.move(at.x + at.width / 2, at.y + 300);
      await page.mouse.up();
      await expect.poll(() => link.evaluate((el) => getComputedStyle(el).scale), path).toBe("none");
    }
  });

  // The top bar's light or dark switch is a moon or a sun alone (Phase 23): its words, its name,
  // show beside it under the pointer and on keyboard focus (docs/office-v2.md 3.1), and go again.
  // The pointer can move onto them, and Escape puts them away without switching (WCAG 1.4.13).
  test("the top bar's light or dark switch shows its words under the pointer and on keyboard focus", async ({
    page,
  }) => {
    await officeLogin(page, "tip", "admin");
    const bar = page.getByRole("banner");
    const square = bar.getByRole("button", { name: /^Switch to (light|dark) mode$/ });
    const tip = bar.locator("[data-theme-tip]");
    // (Ready: it waits for the page, and a disabled button can't be tabbed to.)
    await expect(square).toBeEnabled();
    const name = (await square.getAttribute("aria-label"))!;
    await expect(tip).toBeHidden();
    await expect(tip).toHaveText(name);
    await square.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveCSS("animation-name", "sd-pop");
    // Under the button, its right edge at the button's (once it has popped in).
    const at = (await square.boundingBox())!;
    const shown = async () => (await tip.boundingBox())!;
    await expect
      .poll(async () => Math.round((await shown()).y))
      .toBe(Math.round(at.y + at.height + 8));
    await expect
      .poll(async () => Math.round((await shown()).x + (await shown()).width))
      .toBe(Math.round(at.x + at.width));
    // The pointer moves down from the button onto them (across the 8px between) and they stay, to
    // be read; Escape puts them away with the pointer still there, and nothing switches.
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? "device");
    const before = await theme();
    const words = await shown();
    await page.mouse.move(words.x + words.width - 8, words.y + words.height / 2, { steps: 8 });
    await expect.poll(() => tip.evaluate((el) => el.matches(":hover"))).toBe(true);
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    expect(await theme()).toBe(before);
    await expect(square).toHaveAttribute("aria-label", name);
    // Away and back under the pointer: they show again; away, they go.
    await page.mouse.move(640, 400);
    await square.hover();
    await expect(tip).toBeVisible();
    await page.mouse.move(640, 400);
    await expect(tip).toBeHidden();
    // From the keyboard: Tab to it from the search box beside it, then on to you.
    await bar.getByRole("searchbox").focus();
    await page.keyboard.press("Tab");
    await expect(square).toBeFocused();
    await expect(tip).toBeVisible();
    // Escape puts them away while the button keeps focus, and the theme stays as it was.
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await expect(square).toBeFocused();
    await expect(square).toHaveAttribute("aria-label", name);
    expect(await theme()).toBe(before);
    // On to you, and back: they show again.
    await page.keyboard.press("Tab");
    await expect(tip).toBeHidden();
    await page.keyboard.press("Shift+Tab");
    await expect(square).toBeFocused();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(tip).toBeHidden();
  });

  // The top bar stays at the top (Phase 24: its capsules, 68px from the window's top): a control
  // the keyboard moves to just under it scrolls clear of it, never hidden behind it (WCAG 2.4.11;
  // the office's scroll padding, globals.css).
  test("a control the keyboard moves to just under the top bar scrolls clear of it", async ({
    page,
  }) => {
    await officeLogin(page, "under");
    const bar = page.getByRole("banner");
    const places = page.getByRole("region", { name: "Places to fill, next 2 weeks" });
    const numbers = places.getByRole("button", { name: "Numbers" });
    const first = places.locator("button[data-col]").first();
    await expect(first).toBeVisible();
    const under = await bar.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(under).toBe(68);
    // Scrolled (with a wheel or a trackpad) until Numbers sits under the bar, 8px from the top.
    await numbers.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 8));
    await expect
      .poll(() => numbers.evaluate((el) => Math.round(el.getBoundingClientRect().top)))
      .toBe(8);
    // The keyboard moves to it: Shift+Tab back from the chart's first day.
    await first.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press("Shift+Tab");
    await expect(numbers).toBeFocused();
    // All of it below the bar, and inside the window.
    const box = (await numbers.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(under);
    expect(box.y + box.height).toBeLessThanOrEqual(640);
  });

  // On every page in an admin's menu, and the guide: the how-to guide in your account menu (Phase
  // 22: it left the menu), and no round button broken onto two lines (one line, 44px, or it reads
  // as broken: at 1280px Needs attention's "Go to the Dashboard", beside the items when there are
  // urgent places, wrapped in a column 3 of 12 wide, so that column is 4 of 12, as on the
  // dashboard).
  test("on every page in the menu: the guide in your account menu; no round button on two lines", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await officeLogin(page, "pills", "admin");
    const hrefs = await page
      .locator("[data-shell] nav a[href^='/office']")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
    const pages = [...new Set([...hrefs, "/office/guide"])];
    expect(pages.length).toBeGreaterThanOrEqual(12);
    for (const path of pages) {
      await page.goto(`${acme}${path}`);
      await page.evaluate(() => document.fonts.ready);
      const broken = await page
        .locator("main")
        .locator("a.rounded-full, button.rounded-full, summary.rounded-full")
        .evaluateAll((els) =>
          els
            .filter((el) => el.checkVisibility() && el.getBoundingClientRect().height > 48)
            .map((el) => el.textContent?.trim()),
        );
      expect(broken, path).toEqual([]);
      const account = await accountMenu(page);
      await expect(account.getByRole("link", { name: "How-to guide" }), path).toHaveAttribute(
        "href",
        "/office/guide",
      );
      await page.keyboard.press("Escape");
      await expect(account).toBeHidden();
    }
  });

  // The other roles' menus too (each sees its own pages: office-menu.ts), the guide in the account
  // menu on each.
  for (const role of ["resourcer", "payroll"] as const) {
    test(`a ${role}: the guide in the account menu on every page in their menu`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await officeLogin(page, `guide.${role}`, role);
      const pages = await page
        .locator("[data-shell] nav a[href^='/office']")
        .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute("href")!))]);
      expect(pages.length).toBeGreaterThanOrEqual(role === "payroll" ? 3 : 8);
      for (const path of pages) {
        await page.goto(`${acme}${path}`);
        const account = await accountMenu(page);
        await expect(account.getByRole("link", { name: "How-to guide" }), path).toHaveAttribute(
          "href",
          "/office/guide",
        );
        await page.keyboard.press("Escape");
        await expect(account).toBeHidden();
      }
      await expect(
        page.getByRole("navigation", { name: "Office menu" }).getByRole("link", {
          name: "How-to guide",
        }),
      ).toHaveCount(0);
    });
  }

  // In a window too short for the rail: shut, it scrolls with no bar to its last icon; open, it
  // scrolls with no bar and fades at the edge that has more (menu-scroll.tsx, globals.css
  // `fade-edges`).
  test("in a shorter window the rail scrolls with no bar, fading at the edge that has more", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await officeLogin(page, "short", "admin");
    const rail = page.locator("#office-rail");
    const menu = page.getByRole("navigation", { name: "Office menu" });
    const shut = await rail.evaluate((el) => ({
      scrolls: el.scrollHeight > el.clientHeight,
      bar: getComputedStyle(el).scrollbarWidth,
      bottom: el.getBoundingClientRect().bottom,
    }));
    expect(shut).toMatchObject({ scrolls: true, bar: "none" });
    expect(shut.bottom).toBeLessThanOrEqual(480);
    const last = menu.getByRole("button", { name: "Admin and records", exact: true });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await rail.getByRole("button", { name: "Show the menu with names" }).click();
    await expect(rail).toHaveAttribute("data-rail", "open");
    const box = rail.locator("[data-menu-scroll]");
    const state = () =>
      box.evaluate((el) => ({
        scrolls: el.scrollHeight > el.clientHeight,
        bar: getComputedStyle(el).scrollbarWidth,
        taken: (el as HTMLElement).offsetWidth - el.clientWidth,
        mask: getComputedStyle(el).maskImage,
      }));
    await expect(box).toHaveAttribute("data-more", "below");
    const below = await state();
    expect(below).toMatchObject({ scrolls: true, bar: "none", taken: 0 });
    expect(below.mask).toMatch(
      /^linear-gradient\(rgb\(0, 0, 0\) calc\(100% - 24px\), rgba\(0, 0, 0, 0\)\)$/,
    );
    await box.evaluate((el) => el.scrollTo(0, 40));
    await expect(box).toHaveAttribute("data-more", "both");
    await box.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(box).toHaveAttribute("data-more", "above");
    const above = await state();
    // Fading out towards the top (Chrome writes the direction "to top" or "0deg").
    expect(above.mask).toMatch(
      /^linear-gradient\((?:to top|0deg), rgb\(0, 0, 0\) calc\(100% - 24px\), rgba\(0, 0, 0, 0\)\)$/,
    );
    // It ends inside the window.
    expect((await rail.boundingBox())!.y + (await rail.boundingBox())!.height).toBeLessThanOrEqual(
      480,
    );
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("nothing dips or lifts", async ({ page }) => {
      await officeLogin(page, "still", "admin");
      const card = page.getByRole("main").getByRole("link", { name: /^Waiting on others\b/ });
      await expect(card).toHaveCount(1);
      const box = (await card.boundingBox())!;
      await page.mouse.move(box.x + 40, box.y + 40);
      await page.mouse.down();
      await page.waitForTimeout(200);
      expect(await card.evaluate((el) => getComputedStyle(el).scale)).toBe("none");
      expect(await card.evaluate((el) => getComputedStyle(el).translate)).toBe("none");
      await page.mouse.up();
      // The rail opens at once, without its width sliding (globals.css: every transition 0ms with
      // reduced motion).
      expect(
        await page
          .locator("#office-rail")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
      ).toBe("0s");
    });
  });
});

// A page picked in the menu shows its skeleton in the page's place while it's on its way (Phase
// 21; docs/ui-design.md "States"), every page in an admin's menu: each page's answer is held back
// here so the wait is long enough to see. Then the page, and the skeleton gone. The dashboard has
// its own.
test("every page picked in the menu shows its skeleton while it's on its way", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  let held = 0;
  await page.route(/\/office(\/[^?#]*)?(\?|$)/, async (route) => {
    const request = route.request();
    if (request.headers()["rsc"] === "1" && request.headers()["next-router-prefetch"] !== "1") {
      held += 1;
      await new Promise((done) => setTimeout(done, 800));
    }
    await route.continue();
  });
  await officeLogin(page, "skeleton", "admin");
  const skeleton = page.locator("[data-skeleton]");
  await expect(skeleton).toHaveCount(0);

  // Every page, from the rail with its folds open.
  const menu = page.getByRole("navigation", { name: "Office menu" });
  for (const fold of ["Pay", "People", "Admin and records"]) {
    const button = menu.getByRole("button", { name: fold, exact: true });
    if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
  }
  const links = await menu
    .getByRole("link")
    .evaluateAll((els) =>
      els.map((el) => [
        el.getAttribute("href") ?? "",
        el.querySelector("span:not([aria-hidden])")?.textContent ?? "",
      ]),
    );
  expect(links.length).toBeGreaterThan(15);
  // From the dashboard to every other page, then back to the dashboard.
  for (const [href, name] of [
    ...links.filter(([h]) => h !== "/office"),
    ["/office", "Dashboard"],
  ]) {
    await (await menuLink(page, name!)).click();
    await expect(skeleton, href).toBeVisible();
    await expect(
      skeleton.getByText(href === "/office" ? "Loading the dashboard…" : "Loading the page…"),
    ).toBeAttached();
    // It pulses, slowly, rather than standing still (Phase 22: globals.css `animate-wait`).
    await expect(skeleton.locator(".animate-wait").first(), href).toHaveCSS(
      "animation-name",
      "sd-wait",
    );
    await expect(page).toHaveURL(`${acme}${href}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(skeleton, href).toHaveCount(0);
  }
  expect(held).toBeGreaterThanOrEqual(links.length);
});

// On a phone (the brief's 390px, in dark): a page picked in the drawer shuts the drawer at once and
// shows its skeleton while it's on its way, then the page (Phase 21).
test.describe("on a phone, in dark", () => {
  test.use({ colorScheme: "dark" });

  test("a page picked in the drawer: the drawer shuts and its skeleton shows", async ({ page }) => {
    await page.route(/\/office\/casuals(\?|$)/, async (route) => {
      const request = route.request();
      if (request.headers()["rsc"] === "1" && request.headers()["next-router-prefetch"] !== "1")
        await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    await officeLogin(page, "skeleton.phone");
    await page.setViewportSize({ width: 390, height: 844 });
    const drawer = page.getByRole("dialog", { name: "Menu" });
    const skeleton = page.locator("[data-skeleton]");
    await (await menuLink(page, "Casuals")).click();
    await expect(drawer).toBeHidden();
    await expect(skeleton).toBeVisible();
    await expect(skeleton.getByText("Loading the page…")).toBeAttached();
    // Pulsing here too, at 390px in dark (Phase 22).
    await expect(skeleton.locator(".animate-wait").first()).toHaveCSS("animation-name", "sd-wait");
    await expect(page.locator("body")).toHaveCSS("background-color", CANVAS.dark);
    await expect(page).toHaveURL(`${acme}/office/casuals`);
    await expect(page.getByRole("heading", { level: 1, name: "Casuals" })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    // Back on the dashboard, nothing left over: no skeleton, the page itself.
    await page.goBack();
    await expect(page).toHaveURL(`${acme}/office`);
    await expect(skeleton).toHaveCount(0);
  });
});

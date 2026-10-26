import type { Locator, Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { accountMenu, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office shell in a real browser (docs/office-v2.md 3.1; PLAN.md 12A.2 and 23.2), at phone
// width (the browser tests' Pixel 7) and on a wide screen: the menu drawer (opens with Menu;
// Escape, the backdrop and Close menu shut it; focus goes back to Menu; nothing in it can be tabbed
// to while it's shut), the top bar the window's full width at every width (Phase 23: the firm, the
// pay week with "This week", the shifts line, the square light or dark switch and you, whose
// account menu has your name and role, the same switch, How-to guide and Log out), the switch (at
// once, both saying the same, kept after a reload with no flash), and from 1024px the menu in its
// own card of glass under the bar beside the page (Phase 24: the page has no card of its own). On
// a laptop with a mouse (Phase 22): the whole menu fits with no scrollbar, the pill moves to a link
// as it's picked, a press dips (and glass swells), nothing lifts, no round button breaks onto two
// lines, the switch's words can be hovered and put away with Escape, and the keyboard never leaves
// a control hidden under the top bar. Everything runs with the device set to light and again set
// to dark.

const acme = "http://acme.localhost:3100";
// The office's window (Phase 24, round 7): the wash on its base (the canvas), and on it the top bar
// floating glass and the menu card a section of glass; the page no card of its own. Round 3's white
// cards with their hairlines on a cool grey ground (Phase 23) went.
const CANVAS = { light: "rgb(238, 241, 248)", dark: "rgb(7, 8, 12)" }; // #eef1f8, #07080c
const SECTION = { light: "rgba(255, 255, 255, 0.46)", dark: "rgba(26, 27, 34, 0.46)" };
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
// A section of glass: its fill, no edge (its lit rim is drawn, not a border), `radius` round,
// frosted, with its rim and drop.
async function expectSection(el: Locator, theme: "light" | "dark", radius: string) {
  const s = await surface(el);
  expect({ bg: s.bg, image: s.image, edges: s.edges, corners: s.corners, frost: s.frost }).toEqual({
    bg: SECTION[theme],
    image: "none",
    edges: ["0px", "0px", "0px", "0px"],
    corners: Array(4).fill(radius),
    frost: "blur(24px) saturate(1.8)",
  });
  expect(s.shadow).not.toBe("none");
}
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

      // On a wide screen the menu is in its card beside the page, and there's no Menu button.
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

    test("the top bar: the window's full width; the firm, the pay week, the shifts line, the switch and you; the menu and page cards under it", async ({
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
      // The pay week and the shifts line wait for a wider window.
      await expect(bar.getByText("This week", { exact: true })).toBeHidden();
      await expect(bar.getByText("+44 7700 900000")).toBeHidden();
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
      await expect(bar.getByText("This week", { exact: true })).toBeHidden();

      // From 1024px the pay week, but not yet its dates (read out, not shown) or the shifts line.
      const dates = bar.locator("p span.sr-only").filter({ hasText: " – " });
      await page.setViewportSize({ width: 1100, height: 900 });
      await expect(bar.getByText("This week", { exact: true })).toBeVisible();
      await expect(dates).toHaveCount(1);
      expect(await dates.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
      await expect(bar.getByText("+44 7700 900000")).toBeHidden();

      // At 1280: the bar the window's full width and 64px tall: the firm (its initial, its name,
      // "Office"), the pay week in words with "This week" in green, the shifts line, the square
      // light or dark switch (44px), and you at its right end.
      await page.setViewportSize({ width: 1280, height: 900 });
      const wide = await width();
      expect(await bar.boundingBox()).toMatchObject({ x: 0, y: 0, height: 64, width: wide });
      await expect(bar.getByText("Acme Events", { exact: true })).toBeVisible();
      await expect(bar.getByText("Office", { exact: true })).toBeVisible();
      const week = bar.locator("p").filter({ hasText: "This week" });
      await expect(week).toHaveCount(1);
      await expect(week).toBeVisible();
      expect(await dates.evaluate((el) => getComputedStyle(el).position)).toBe("static");
      expect((await week.innerText()).replace(/\s+/g, " ").trim()).toMatch(
        /^Week \d{1,2} · \d{1,2} [A-Z][a-z]{2} – \d{1,2} [A-Z][a-z]{2} · Pay [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} This week$/,
      );
      // Words, not a button: nothing in it to press.
      await expect(week.locator("a, button")).toHaveCount(0);
      await expect(bar.getByText("+44 7700 900000")).toBeVisible();
      const square = bar.getByRole("button", { name: /^Switch to (light|dark) mode$/ });
      expect(await square.boundingBox()).toMatchObject({ width: 44, height: 44 });
      // Clear glass: its gradient and rim, 14px round, no edge.
      const clear = await surface(square);
      expect(clear.image).toMatch(/^linear-gradient\(/);
      expect(clear.edges).toEqual(["0px", "0px", "0px", "0px"]);
      expect(clear.corners).toEqual(Array(4).fill("14px"));
      expect(clear.shadow).not.toBe("none");
      await expect(
        page
          .getByRole("navigation", { name: "Office menu" })
          .getByText("Acme Events", { exact: true }),
      ).toHaveCount(0);
      await expect(account.getByText("SR", { exact: true })).toBeVisible();
      await expect(account.getByText("Sam Rota", { exact: true })).toBeVisible();
      await expect(account).toHaveAccessibleName("Sam Rota Resourcer");
      const box = (await account.boundingBox())!;
      expect(Math.round(box.x + box.width)).toBe(wide - 24);
      expect(box.y).toBeLessThan(64);
      // Its menu opens at the top right, 8px under the bar, its right edge under you.
      // (Once it has grown out of its corner.)
      const opened = await accountMenu(page);
      const pop = async () => (await opened.boundingBox())!;
      await expect.poll(async () => Math.round((await pop()).y)).toBe(72);
      await expect
        .poll(async () => Math.round((await pop()).x + (await pop()).width))
        .toBe(wide - 24);
      await page.keyboard.press("Escape");
      await expect(opened).toBeHidden();

      // Under the bar, 16px from it and from the window's edges: the menu in its own card of
      // glass (284px wide from 1280px, 24px round), and the page beside it, 16px apart, no card of
      // its own. The wash shows round them: the shell paints no ground.
      const menuCard = page.locator("[data-shell] [data-menu-scroll]").locator("xpath=..");
      await expectSection(menuCard, device, "24px");
      expect(await menuCard.boundingBox()).toMatchObject({ x: 16, y: 80, width: 284 });
      expect(await surface(card)).toEqual(bare);
      expect(await card.boundingBox()).toMatchObject({ x: 316, y: 80, width: wide - 332 });
      await expect(page.locator('[data-shell="office"]')).toHaveCSS("background-color", NONE);
      await expect(page.locator("body")).toHaveCSS("background-color", CANVAS[device]);
      await expect(page.locator("#main")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await (await accountMenu(page)).getByRole("link", { name: "How-to guide" }).click();
      await expect(page).toHaveURL(`${acme}/office/guide`);
    });
  });
}

// On a laptop with a mouse (Phase 22; Dylan: "a tacky scroll wheel on the left side", "subtle
// reactive on click responses"): the browser tests' phone has a touch screen, so this one doesn't.
test.describe("on a laptop window (1280 × 640) with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 640 }, hasTouch: false, isMobile: false });

  // Phase 23: under the 64px top bar, in its own card 16px under it, the whole menu still fits:
  // nothing to scroll to, and the card ends inside the window.
  test("an admin's whole menu fits with no scrollbar, its rows 34px; the pill moves to a pick at once", async ({
    page,
  }) => {
    await officeLogin(page, "laptop", "admin");
    const menu = page.getByRole("navigation", { name: "Office menu" });
    const scroll = page.locator("[data-shell] [data-menu-scroll]");
    const fit = await scroll.evaluate((box) => {
      const rows = [...box.querySelectorAll("nav a, nav button")].filter((el) =>
        el.checkVisibility(),
      );
      return {
        rows: rows.length,
        heights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
        last: rows.at(-1)!.getBoundingClientRect().bottom,
        bottom: box.getBoundingClientRect().bottom,
        more: box.scrollHeight - box.clientHeight,
        bar: getComputedStyle(box).scrollbarWidth,
        // A scrollbar would take room from the box's width.
        taken: (box as HTMLElement).offsetWidth - box.clientWidth,
        card: box.parentElement!.getBoundingClientRect().bottom,
        // The office's own top bar (the casual app's brand bar is hidden under the shell).
        banner: document.querySelector("[data-shell] > header")!.getBoundingClientRect().bottom,
        top: box.parentElement!.getBoundingClientRect().top,
      };
    });
    expect(fit.rows).toBeGreaterThanOrEqual(12);
    expect(fit.heights).toEqual([34]);
    expect(fit.last).toBeLessThanOrEqual(fit.bottom);
    expect(fit.more).toBe(0);
    expect(fit.bar).toBe("none");
    expect(fit.taken).toBe(0);
    expect(await scroll.getAttribute("data-more")).toBeNull();
    expect(fit.banner).toBe(64);
    expect(fit.top).toBe(80);
    expect(fit.card).toBeLessThanOrEqual(640);

    // The page you're on: the pale blue pill under its row. Picked, another link has the pill at
    // once, before its page arrives (held back here), while the page you're on is still marked
    // current.
    const pill = page.locator("[data-menu-pill]");
    const top = async (name: string) =>
      Math.round((await menu.getByRole("link", { name, exact: true }).boundingBox())?.y ?? -1);
    await expect
      .poll(async () => Math.round((await pill.boundingBox())?.y ?? 0))
      .toBe(await top("Dashboard"));
    await page.route(/\/office\/casuals(\?|$)/, async (route) => {
      const request = route.request();
      if (request.headers()["rsc"] === "1" && request.headers()["next-router-prefetch"] !== "1")
        await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    // It slides there on the spring (400ms), rather than jumping.
    expect(await pill.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe(
      "translate, width, height, opacity",
    );
    expect(await pill.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe(
      "0.4s, 0.2s, 0.2s, 0.15s",
    );
    await menu.getByRole("link", { name: "Casuals", exact: true }).click();
    await expect
      .poll(async () => Math.round((await pill.boundingBox())?.y ?? 0))
      .toBe(await top("Casuals"));
    await expect(menu.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page).toHaveURL(`${acme}/office/casuals`);
    await expect(menu.getByRole("link", { name: "Casuals", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
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
    // From the keyboard: Tab to it from the skip link (Menu is hidden on a wide screen, and the pay
    // week and the shifts line are words), then on to you.
    await page.locator('a[href="#main"]').focus();
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

  // Phase 23's top bar is sticky across the window's full width (before, from 1024px, it sat over
  // the menu only): a control the keyboard moves to just under it scrolls clear of it, never
  // hidden behind it (WCAG 2.4.11; the office's scroll padding, globals.css).
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
    expect(under).toBe(64);
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

  // In a window too short for the menu: it scrolls, with no bar, and fades at the edge that has
  // more (menu-scroll.tsx, globals.css `fade-edges`).
  test("in a shorter window the menu scrolls with no bar, fading at the edge that has more", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await officeLogin(page, "short", "admin");
    const box = page.locator("[data-shell] [data-menu-scroll]");
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
      // The menu's pill moves to a pick at once, without sliding (globals.css: every transition
      // 0ms with reduced motion).
      expect(
        await page
          .locator("[data-menu-pill]")
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

  const menu = page.getByRole("navigation", { name: "Office menu" });
  await menu.locator('button[aria-expanded="false"]').click();
  const links = await menu
    .getByRole("link")
    .evaluateAll((els) =>
      els.map((el) => [el.getAttribute("href") ?? "", el.querySelector("span")?.textContent ?? ""]),
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

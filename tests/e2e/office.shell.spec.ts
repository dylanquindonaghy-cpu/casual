import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { accountMenu, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office shell in a real browser (docs/office-v2.md 3.1; PLAN.md 12A.2), at phone width (the
// browser tests' Pixel 7) and on a wide screen: the menu drawer (opens with Menu; Escape, the
// backdrop and Close menu shut it; focus goes back to Menu; nothing in it can be tabbed to while
// it's shut), and the account menu (name, role, the light/dark switch: at once, kept after a reload
// with no flash; How-to guide; Log out), which from 1024px sits over the menu with the firm, with
// no top bar (Phases 20 and 22). On a laptop with a mouse (Phase 22): the whole menu fits with no
// scrollbar, the white pill moves to a link as it's picked, a press dips, and no round button
// breaks onto two lines. Everything runs with the device set to light and again set to dark.

const acme = "http://acme.localhost:3100";
// The office's window (Phase 22, round 2): a warm grey (a near-black in dark), the menu on it at
// every width; the page a warm off-white sheet set into it (Phase 21: one off-white ground).
const CANVAS = { light: "rgb(231, 229, 223)", dark: "rgb(8, 9, 11)" }; // #e7e5df, #08090b
const SHEET = { light: "rgb(249, 248, 245)", dark: "rgb(17, 18, 21)" }; // #f9f8f5, #111215

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
      // Phone width: no sidebar, and nothing of the menu can be reached with Tab while it's shut.
      await expect(menuButton).toBeEnabled();
      await expect(page.getByRole("navigation", { name: "Office menu" })).toHaveCount(0);
      await menuButton.focus();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        expect(await focusInMenu(page)).toBe(false);
      }

      // Escape shuts it, and focus goes back to Menu. Every row in it is a thumb's 44px tall, on
      // the brief's 390px phone (Phase 21), and so is every button in the top bar.
      await page.setViewportSize({ width: 390, height: 844 });
      const bar = await page
        .getByRole("banner")
        .locator("button")
        .evaluateAll((els) =>
          els
            .filter((el) => el.checkVisibility())
            .map((el) => [el.textContent ?? "", Number.parseFloat(getComputedStyle(el).height)]),
        );
      expect(bar.length).toBeGreaterThanOrEqual(2); // Menu, you (the moon/sun in your menu: Phase 22)
      for (const [name, height] of bar) expect(height, String(name)).toBeGreaterThanOrEqual(44);
      await menuButton.click();
      await expect(drawer).toBeVisible();
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

      // On a wide screen the menu is the sidebar, and there's no Menu button.
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.getByRole("navigation", { name: "Office menu" })).toBeVisible();
      await expect(menuButton).toBeHidden();
    });

    test("the light/dark switch (in your account menu) changes the theme at once and keeps it after a reload", async ({
      page,
    }) => {
      await officeLogin(page, `${device}.theme`);
      const other = device === "light" ? "dark" : "light";
      const shell = page.locator('[data-shell="office"]');
      const sheet = page.locator("#main > div");
      await expect(shell).toHaveCSS("background-color", CANVAS[device]);
      await expect(sheet).toHaveCSS("background-color", SHEET[device]);
      // Its words say what it switches to (Phase 22: a row of the account menu; a round button with
      // its words beside it until then).
      const menu = await accountMenu(page);
      await menu.getByRole("button", { name: `Switch to ${other} mode` }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await expect(shell).toHaveCSS("background-color", CANVAS[other]);
      await expect(sheet).toHaveCSS("background-color", SHEET[other]);
      await expect(menu.getByRole("button", { name: `Switch to ${device} mode` })).toBeVisible();

      // Kept: the server sends the next page in that theme (no flash), and after a reload too.
      const sent = await page.request.get(`${acme}/office`);
      expect(await sent.text()).toMatch(new RegExp(`<html lang="en-GB" data-theme="${other}"`));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await expect(shell).toHaveCSS("background-color", CANVAS[other]);
    });

    test("the top bar: the firm's name (over the menu, on a wide screen); the account menu has the name and role", async ({
      page,
    }) => {
      await officeLogin(page, `${device}.bar`);
      // Below 1024px the page is a sheet with rounded top corners under the top bar (Phase 22).
      const sheet = page.locator("#main > div");
      await expect(sheet).toHaveCSS("border-top-left-radius", "20px");
      await expect(sheet).toHaveCSS("border-top-right-radius", "20px");
      await expect(sheet).toHaveCSS("border-bottom-left-radius", "0px");
      // The firm's own bar gives way to the top bar on logged-in office pages.
      await expect(page.getByTestId("brand-bar")).toBeHidden();
      const bar = page.getByRole("banner");
      await expect(bar.getByText("Acme Events", { exact: true })).toBeVisible();

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

      // On a tablet the name and role show on the account button.
      const account = page.locator('button[popovertarget="office-account-menu"]');
      await page.setViewportSize({ width: 800, height: 900 });
      await expect(account.getByText("Sam Rota", { exact: true })).toBeVisible();

      // From 1024px no top bar (Phase 20): the firm (its initial, its name, "Office") and your
      // initials sit over the menu (248px wide), and the menu doesn't repeat the firm (Phase 22).
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(bar.getByText("Acme Events", { exact: true })).toBeVisible();
      await expect(bar.getByText("Office", { exact: true })).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Office menu" })
          .getByText("Acme Events", { exact: true }),
      ).toHaveCount(0);
      await expect(account.getByText("SR", { exact: true })).toBeVisible();
      await expect(account).toHaveAccessibleName("Sam Rota Resourcer");
      const box = await account.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(248);
      expect(box?.y ?? 900).toBeLessThan(64);
      // The window and the page: the menu on the window's ground, the page a sheet set into it.
      await expect(page.locator('[data-shell="office"]')).toHaveCSS(
        "background-color",
        CANVAS[device],
      );
      await expect(page.locator("body")).toHaveCSS("background-color", CANVAS[device]);
      await expect(page.locator("#main")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(sheet).toHaveCSS("background-color", SHEET[device]);
      // Set into the window, rounded all round.
      await expect(sheet).toHaveCSS("border-bottom-left-radius", "20px");
      await (await accountMenu(page)).getByRole("link", { name: "How-to guide" }).click();
      await expect(page).toHaveURL(`${acme}/office/guide`);
    });
  });
}

// On a laptop with a mouse (Phase 22; Dylan: "a tacky scroll wheel on the left side", "subtle
// reactive on click responses"): the browser tests' phone has a touch screen, so this one doesn't.
test.describe("on a laptop window (1280 × 640) with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 640 }, hasTouch: false, isMobile: false });

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
        bar: getComputedStyle(box).scrollbarWidth,
        // A scrollbar would take room from the box's width.
        taken: (box as HTMLElement).offsetWidth - box.clientWidth,
      };
    });
    expect(fit.rows).toBeGreaterThanOrEqual(12);
    expect(fit.heights).toEqual([34]);
    expect(fit.last).toBeLessThanOrEqual(fit.bottom);
    expect(fit.bar).toBe("none");
    expect(fit.taken).toBe(0);

    // The page you're on: the white pill under its row. Picked, another link has the pill at once,
    // before its page arrives (held back here), while the page you're on is still marked current.
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

  test("what you press dips and springs back; a dashboard card lifts under the pointer", async ({
    page,
  }) => {
    await officeLogin(page, "press", "admin");
    const card = page.locator('a[href="#waiting"]');
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).translate)).toBe("0px -2px");
    await page.mouse.down();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).scale)).toBe("0.97");
    await page.mouse.move(box.x + 40, box.y + 400);
    await page.mouse.up();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).scale)).toBe("none");
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
      const card = page.locator('a[href="#waiting"]');
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

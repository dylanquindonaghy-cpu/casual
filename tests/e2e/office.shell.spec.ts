import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { accountMenu, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office shell in a real browser (docs/office-v2.md 3.1; PLAN.md 12A.2), at phone width (the
// browser tests' Pixel 7) and on a wide screen: the menu drawer (opens with Menu; Escape, the
// backdrop and Close menu shut it; focus goes back to Menu; nothing in it can be tabbed to while
// it's shut), the moon/sun button (switches at once, kept after a reload with no flash), and the
// account menu (name, role, How-to guide, Log out), which from 1024px sit at the menu's foot with
// no top bar (Phase 20). Everything runs with the device set to light and again set to dark.

const acme = "http://acme.localhost:3100";
// The office's page (Phase 21, the office's look): its warm off-white ground (a near-black in dark),
// the menu's too at every width; from 1024px no sheet on a frame (Phase 20's), the page's white
// cards sit on the ground itself.
const CANVAS = { light: "rgb(246, 245, 243)", dark: "rgb(18, 18, 17)" }; // #f6f5f3, #121211

// Each test logs in as a resourcer of its own (the seeded users allow 3 login links per 15
// minutes, and this spec logs in six times).
async function officeLogin(page: Page, who: string) {
  const email = `shell.${who}@example.com`;
  await addOfficeUser("acme", { email, name: "Sam Rota", role: "resourcer" });
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

      // Escape shuts it, and focus goes back to Menu.
      await menuButton.click();
      await expect(drawer).toBeVisible();
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

    test("the moon/sun button switches the theme at once and keeps it after a reload", async ({
      page,
    }) => {
      await officeLogin(page, `${device}.theme`);
      const other = device === "light" ? "dark" : "light";
      const button = page.getByRole("button", { name: `Switch to ${other} mode` });
      const main = page.locator('[data-shell="office"]');
      await expect(main).toHaveCSS("background-color", CANVAS[device]);
      // Its words show beside it on keyboard focus (and on hover, where a device can hover; the
      // test phone can't).
      await button.focus();
      await expect(page.getByText(`Switch to ${other} mode`)).toBeVisible();

      await button.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await expect(main).toHaveCSS("background-color", CANVAS[other]);
      await expect(page.getByRole("button", { name: `Switch to ${device} mode` })).toBeVisible();

      // Kept: the server sends the next page in that theme (no flash), and after a reload too.
      const sent = await page.request.get(`${acme}/office`);
      expect(await sent.text()).toMatch(new RegExp(`<html lang="en-GB" data-theme="${other}"`));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await expect(main).toHaveCSS("background-color", CANVAS[other]);
    });

    test("the top bar: the firm's name (the menu's, on a wide screen); the account menu has the name and role", async ({
      page,
    }) => {
      await officeLogin(page, `${device}.bar`);
      // The firm's own bar gives way to the top bar on logged-in office pages.
      await expect(page.getByTestId("brand-bar")).toBeHidden();
      const bar = page.getByRole("banner");
      await expect(bar.getByText("Acme Events", { exact: true })).toBeVisible();

      await expect(page.getByRole("button", { name: "Sam Rota Resourcer" })).toBeVisible();
      const menu = await accountMenu(page);
      await expect(menu.getByText("Sam Rota", { exact: true })).toBeVisible();
      await expect(menu.getByText("Resourcer", { exact: true })).toBeVisible();
      await expect(menu.getByRole("link", { name: "How-to guide" })).toBeVisible();
      await expect(menu.getByRole("button", { name: "Log out" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();

      // On a wide screen the name and role show on the button itself, and the firm's name heads
      // the menu beside the page instead of the top bar.
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(bar.getByText("Acme Events", { exact: true })).toBeHidden();
      await expect(
        page
          .getByRole("navigation", { name: "Office menu" })
          .getByText("Acme Events", { exact: true }),
      ).toBeVisible();
      const account = page.locator('button[popovertarget="office-account-menu"]');
      await expect(account.getByText("Sam Rota", { exact: true })).toBeVisible();
      await expect(account.getByText("SR", { exact: true })).toBeVisible();
      // No top bar from 1024px (Phase 20): the account and moon/sun buttons are at the menu's foot
      // (the menu is 248px wide), and the page and menu share the one ground (Phase 21).
      const foot = async (button: typeof account) => {
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(248);
        expect(box?.y ?? 0).toBeGreaterThan(900 / 2);
      };
      await foot(account);
      await foot(page.getByRole("button", { name: /^Switch to (light|dark) mode$/ }));
      await expect(page.locator('[data-shell="office"]')).toHaveCSS(
        "background-color",
        CANVAS[device],
      );
      await expect(page.locator("body")).toHaveCSS("background-color", CANVAS[device]);
      await expect(page.locator("#main")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await (await accountMenu(page)).getByRole("link", { name: "How-to guide" }).click();
      await expect(page).toHaveURL(`${acme}/office/guide`);
    });
  });
}

// A page picked in the menu shows its skeleton in the page's place while it's on its way (Phase
// 21; docs/ui-design.md "States"): the page's answer is held back here so the wait is long enough
// to see. Then the page, and the skeleton gone. The dashboard has its own.
test("a page picked in the menu shows its skeleton while it's on its way", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let held = 0;
  await page.route(/\/office(\/casuals)?(\?|$)/, async (route) => {
    const request = route.request();
    if (request.headers()["rsc"] === "1" && request.headers()["next-router-prefetch"] !== "1") {
      held += 1;
      await new Promise((done) => setTimeout(done, 1500));
    }
    await route.continue();
  });
  await officeLogin(page, "skeleton");
  const skeleton = page.locator("[data-skeleton]");
  await expect(skeleton).toHaveCount(0);

  await (await menuLink(page, "Casuals")).click();
  await expect(skeleton).toBeVisible();
  await expect(skeleton.getByText("Loading the page…")).toBeAttached();
  await expect(page.getByRole("heading", { level: 1, name: "Casuals" })).toBeVisible();
  await expect(page).toHaveURL(`${acme}/office/casuals`);
  await expect(skeleton).toHaveCount(0);

  await (await menuLink(page, "Dashboard")).click();
  await expect(skeleton.getByText("Loading the dashboard…")).toBeAttached();
  await expect(page).toHaveURL(`${acme}/office`);
  await expect(skeleton).toHaveCount(0);
  expect(held).toBeGreaterThanOrEqual(2);
});

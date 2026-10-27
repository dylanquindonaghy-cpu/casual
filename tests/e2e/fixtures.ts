import { createHash } from "node:crypto";
import { expect, test as base, type Locator, type Page } from "@playwright/test";

// Every e2e test gets its own client IP (as Caddy would set X-Real-IP), so tests don't share
// one rate-limit bucket and can't run each other out of login attempts.
// (Playwright calls the second argument `use`; it's named `provide` here because React's
// hooks lint rule treats any call to a function named `use` as a hook.)
export const test = base.extend({
  page: async ({ page }, provide, testInfo) => {
    const h = createHash("sha256").update(testInfo.testId).digest();
    await page.setExtraHTTPHeaders({ "x-real-ip": `10.${h[0]}.${h[1]}.${h[2]}` });
    await provide(page);
  },
});
export { expect } from "@playwright/test";

// The office dashboard's heading: "Dashboard" (Phase 24, round 7; Phase 20's greeting and how many
// things need you until then).
export const DASHBOARD_HEADING = /^Dashboard$/;

// A link in the office menu (docs/office-v2.md 3.1). The browser tests run at phone width, where
// the menu is a drawer: this opens it with "Menu" first (waiting for the page to be ready), then
// finds the link by its exact name inside the menu. On a wide screen the rail is already there
// (Phase 24). After a check that a link is absent, close the drawer again (Escape) before going on.
export async function menuLink(page: Page, name: string): Promise<Locator> {
  const menu = page.getByRole("navigation", { name: "Office menu" });
  const open = page.getByRole("button", { name: "Menu", exact: true });
  // The rail or the Menu button (both, when the drawer is already open).
  await expect(menu.or(open).first()).toBeVisible();
  if (!(await menu.isVisible())) {
    await open.click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  }
  const link = menu.getByRole("link", { name, exact: true });
  // A link in a fold (the drawer's "Admin and records", Phase 18; the rail's Pay, People and
  // Admin and records, Phase 24) is hidden until its button opens it: the button that controls
  // the box it's in (it waits for the page; the click waits for the button). In the rail, opening
  // a fold opens the rail too.
  // (Found by its label: a hidden link's name, worked out by the browser, takes in its hidden
  // count too, "Casuals 4".)
  if (!(await link.isVisible())) {
    const box = await menu.evaluate(
      (nav, label) =>
        [...nav.querySelectorAll("a")]
          .find((a) =>
            [...a.querySelectorAll("span:not([aria-hidden])")].some((s) => s.textContent === label),
          )
          ?.closest("[hidden]")?.id ?? "",
      name,
    );
    if (box) await menu.locator(`button[aria-controls="${box}"]`).click();
  }
  return link;
}

// The office's account menu (the account button at the top right): How-to guide and Log out.
export async function accountMenu(page: Page): Promise<Locator> {
  await page.locator('button[popovertarget="office-account-menu"]').click();
  const menu = page.locator("#office-account-menu");
  await expect(menu).toBeVisible();
  return menu;
}

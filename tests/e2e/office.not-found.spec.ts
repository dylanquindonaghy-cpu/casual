import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { accountMenu, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Phase 37.6 (w1-08): any /office address that matches no page gets the office's own not-found,
// inside the office frame when someone is logged in, with "Back to the office" (never the casual
// app's "Go to my shifts"), and a tab that says "Page not found". A page this role can't open is
// titled the same way, never by its own name. Office users of this spec's own, so the seeded
// ones' login links aren't used up.

const acme = "http://acme.localhost:3100";
const TITLE = "Page not found · Acme Events shifts";

async function officeLogin(page: Page, email: string) {
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

async function officeNotFound(page: Page) {
  await expect(page.getByRole("heading", { name: "We can't find that page." })).toBeVisible();
  await expect(
    page.getByText("This page doesn't exist, or your role can't open it."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the office" })).toHaveAttribute(
    "href",
    "/office",
  );
  await expect(page.getByRole("link", { name: "Go to my shifts" })).toHaveCount(0);
  await expect(page.getByText("404")).toHaveCount(0);
  await expect(page).toHaveTitle(TITLE);
}

test("an office address that matches no page keeps the office frame", async ({
  page,
}, testInfo) => {
  const email = `notfound.admin${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Lost Admin", role: "admin" });
  await officeLogin(page, email);
  for (const path of ["/office/no-such-page", "/office/settings/no-such-page"]) {
    expect((await page.goto(`${acme}${path}`))?.status(), path).toBe(404);
    await officeNotFound(page);
    await expect(page.locator("#main").getByText(/^Updated \d/)).toHaveCount(0);
    // The office menu, and the account menu's one "Log out".
    await expect(await menuLink(page, "Casuals")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect((await accountMenu(page)).getByRole("button", { name: "Log out" })).toHaveCount(1);
    await page.keyboard.press("Escape");
  }
});

test("logged out, it's the office's not-found too, and its way back leads to the office login", async ({
  page,
}) => {
  expect((await page.goto(`${acme}/office/no-such-page`))?.status()).toBe(404);
  await officeNotFound(page);
  await page.getByRole("link", { name: "Back to the office" }).click();
  await expect(page).toHaveURL(/\/office\/login/);
});

test("a page this role can't open doesn't name itself in the tab", async ({ page }, testInfo) => {
  const email = `notfound.resourcer${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Lost Resourcer", role: "resourcer" });
  await officeLogin(page, email);
  for (const path of ["/office/pay", "/office/settings"]) {
    expect((await page.goto(`${acme}${path}`))?.status(), path).toBe(404);
    await officeNotFound(page);
  }
});

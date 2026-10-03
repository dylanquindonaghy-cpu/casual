import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Office login in a real browser (console mode): a link by email, then the dashboard with the
// person's role. Seeded office users: acme.admin@, acme.resourcer@, acme.payroll@example.com.

const acme = "http://acme.localhost:3100";

async function officeLogin(page: Page, email: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await expect(page).toHaveURL(`${acme}/office/l`);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

test("an admin logs in by email link, sees their role and the office team, and logs out", async ({
  page,
  context,
}) => {
  await page.goto(`${acme}/office`);
  await expect(page).toHaveURL(`${acme}/office/login`);

  await officeLogin(page, "acme.admin@example.com");
  await expect(page.getByText("You're logged in as Admin.")).toBeVisible();
  // Acme's shifts line (a fake number from the seed).
  await expect(
    page.getByText("Your shifts line: +44 7700 900000 (WhatsApp, text and calls)."),
  ).toBeVisible();
  const [cookie] = (await context.cookies(acme)).filter((c) => c.name === "__Host-sd_office");
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
  // An office session is not a worker session.
  await page.goto(`${acme}/`);
  await expect(page).toHaveURL(`${acme}/login`);

  await page.goto(`${acme}/office`);
  await page.getByRole("link", { name: "Office team" }).click();
  await expect(page.getByRole("heading", { name: "Office team" })).toBeVisible();
  await expect(page.getByText("acme.payroll@example.com")).toBeVisible();

  await page.goto(`${acme}/office`);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(`${acme}/office/login?out=1`);
  await expect(page.getByText("You're logged out.")).toBeVisible();
});

test("a resourcer can use the dashboard but not the admin-only team page", async ({ page }) => {
  await officeLogin(page, "acme.resourcer@example.com");
  await expect(page.getByText("You're logged in as Resourcer.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Office team" })).toHaveCount(0);
  const response = await page.goto(`${acme}/office/team`);
  expect(response?.status()).toBe(404);
});

test("payroll logs in with their own role", async ({ page }) => {
  await officeLogin(page, "acme.payroll@example.com");
  await expect(page.getByText("You're logged in as Payroll.")).toBeVisible();
});

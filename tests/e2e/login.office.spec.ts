import type { Page } from "@playwright/test";
import { accountMenu, DASHBOARD_HEADING, expect, menuLink, test } from "./fixtures";
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
  // Payroll's home is the pay dashboard: /office sends them on (12A.3).
  await expect(page).toHaveURL(new RegExp(`^${acme.replace(/\./g, "\\.")}/office(/pay)?$`));
}

test("an admin logs in by email link, sees their role and the office team, and logs out", async ({
  page,
  context,
}) => {
  await page.goto(`${acme}/office`);
  await expect(page).toHaveURL(`${acme}/office/login`);

  await officeLogin(page, "acme.admin@example.com");
  // The dashboard, and the account button names their role.
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Admin (demo) Admin" })).toBeVisible();
  // Under it, Acme's day, pay week and pay day (Phase 24, 24.3). Acme's shifts line (a fake number
  // from the seed) left the dashboard with round 7: it's in Settings, read there below.
  await expect(
    page
      .getByRole("main")
      .getByText(
        /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+ · Week \d{1,2} · Pay Fri \d{1,2} [A-Z][a-z]{2}$/,
      ),
  ).toBeVisible();
  const shiftsLine = page.getByText(
    "Your shifts line: +44 7700 900000 (WhatsApp, text and calls).",
  );
  await expect(shiftsLine).toHaveCount(0);
  await (await menuLink(page, "Settings")).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(shiftsLine).toBeVisible();
  const [cookie] = (await context.cookies(acme)).filter((c) => c.name === "__Host-sd_office");
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
  // An office session is not a worker session.
  await page.goto(`${acme}/`);
  await expect(page).toHaveURL(`${acme}/login`);

  await page.goto(`${acme}/office`);
  await (await menuLink(page, "Office team")).click();
  await expect(page.getByRole("heading", { name: "Office team" })).toBeVisible();
  await expect(page.getByText("acme.payroll@example.com")).toBeVisible();

  await page.goto(`${acme}/office`);
  // "Log out" is in the account menu (12A.2).
  await (await accountMenu(page)).getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(`${acme}/office/login?out=1`);
  await expect(page.getByText("You're logged out.")).toBeVisible();
});

test("a resourcer can use the dashboard but not the admin-only team page", async ({ page }) => {
  await officeLogin(page, "acme.resourcer@example.com");
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resourcer (demo) Resourcer" })).toBeVisible();
  // Absent from the menu itself (opened first, so the check can't pass just because it's shut).
  await expect(await menuLink(page, "Events & sessions")).toBeVisible();
  await expect(await menuLink(page, "Office team")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const response = await page.goto(`${acme}/office/team`);
  expect(response?.status()).toBe(404);
});

test("payroll logs in with their own role", async ({ page }) => {
  await officeLogin(page, "acme.payroll@example.com");
  // Their home, the pay dashboard; the account button names their role.
  await expect(page).toHaveURL(`${acme}/office/pay`);
  await expect(page.getByRole("button", { name: "Payroll (demo) Payroll" })).toBeVisible();
});

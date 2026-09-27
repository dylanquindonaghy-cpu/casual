import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// Worker login in a real browser, in console mode: the web app and the worker run against a
// freshly seeded database; the link comes from the console transport's outbox.
// Seeded workers (src/lib/db/admin/seed-data.ts): Acme's numbers start at 07700 900100.

const acme = "http://acme.localhost:3100";
const northline = "http://northline.localhost:3100";

async function requestLink(page: Page, portal: string, typed: string, e164: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${portal}/login`);
  await page.getByLabel("Your mobile number").fill(typed);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your phone.")).toBeVisible();
  return loginLinkSentTo(e164, asked);
}

test("a worker logs in with a link, the link works once, and they can log out", async ({
  page,
  context,
}) => {
  await page.goto(`${acme}/`);
  await expect(page).toHaveURL(`${acme}/login`); // not logged in yet

  const link = await requestLink(page, acme, "07700 900100", "+447700900100");
  expect(link.startsWith(`${acme}/l#`)).toBe(true);

  await page.goto(link);
  await expect(page).toHaveURL(`${acme}/l`); // the token is cleared from the address bar
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
  await expect(page.getByRole("heading", { name: /^Hello / })).toBeVisible();

  const [cookie] = (await context.cookies(acme)).filter((c) => c.name === "__Host-sd_session");
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  // Host-only: the cookie is never sent to another firm's portal.
  expect((await context.cookies(northline)).some((c) => c.name === "__Host-sd_session")).toBe(
    false,
  );
  await page.goto(`${northline}/`);
  await expect(page).toHaveURL(`${northline}/login`);

  // The same link again: refused.
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();

  await page.goto(`${acme}/`);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(`${acme}/login?out=1`);
  await expect(page.getByText("You're logged out.")).toBeVisible();
  await page.goto(`${acme}/`);
  await expect(page).toHaveURL(`${acme}/login`);
});

test("a link from one firm does nothing on another firm's portal", async ({ page }) => {
  const link = await requestLink(page, acme, "07700900101", "+447700900101");
  await page.goto(link.replace(acme, northline));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();

  // Still unused on its own firm.
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
});

test("an unknown number gets exactly the same answer", async ({ page }) => {
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900999");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your phone.")).toBeVisible();
});

test("something that isn't a phone number gets a plain-English fix", async ({ page }) => {
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("hello");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Enter a UK mobile number, like 07700 900123.")).toBeVisible();
});

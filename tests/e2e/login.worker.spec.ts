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
  await expect(page.getByRole("heading", { name: /^Hi / })).toBeVisible();
  // Home (12H.1): this seeded worker has no bookings yet. The tab bar is at the bottom.
  await expect(page.getByRole("heading", { name: "No shifts booked" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Shifts", "Messages", "Pay", "Profile"]);
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Find a shift" }).click();
  await expect(page).toHaveURL(`${acme}/shifts/open`);
  await expect(page.getByRole("heading", { name: "Open shifts" })).toBeVisible();
  // The demo seed's Saturday: this steward is free, and the four open steward places are theirs
  // to take (the other open places need other roles): a card each, opening its page.
  const cards = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.locator('a[href^="/shifts/"]:not([href^="/shifts/open"])') });
  await expect(cards).toHaveCount(4);
  // (inside the list: the site filter's choices name the arena too)
  await expect(page.getByRole("listitem").filter({ hasText: "Acme Demo Arena" })).toHaveCount(3);
  await expect(page.getByRole("listitem").filter({ hasText: "Acme Demo Racecourse" })).toHaveCount(
    1,
  );
  // My requests is on Profile now (12H.1).
  await tabs.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(`${acme}/profile`);
  await page.getByRole("link", { name: "My requests" }).click();
  await expect(page).toHaveURL(`${acme}/requests`);
  await expect(page.getByText("No requests yet.")).toBeVisible();
  // Booked is on the Shifts tab, with the last 30 days a toggle away; the old address goes there.
  await tabs.getByRole("link", { name: "Shifts" }).click();
  await expect(page).toHaveURL(`${acme}/shifts`);
  await expect(page.getByRole("heading", { name: "Booked shifts" })).toBeVisible();
  await page.getByRole("link", { name: "Past 30 days" }).click();
  await expect(page).toHaveURL(`${acme}/shifts?view=past`);
  await expect(page.getByText("No shifts in the last 30 days.")).toBeVisible();
  await page.goto(`${acme}/?view=past`);
  await expect(page).toHaveURL(`${acme}/shifts?view=past`);

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

  // Log out is the last thing on Profile (12H.1).
  await page.goto(`${acme}/profile`);
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

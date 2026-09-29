import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office's Today view in a real browser, on the demo seed: Acme's Saturday event (open gaps,
// the urgent 06:00 dropout, two open requests). A resourcer sees each section and offers a gap to
// someone; payroll doesn't get Today. (Other specs may have filled the urgent shift already, so
// this one checks the sections and uses an ordinary gap.)

const acme = "http://acme.localhost:3100";

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

test("a resourcer sees Today and offers a gap to someone", async ({ page }) => {
  await officeLogin(page, "acme.resourcer@example.com");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  for (const name of [
    "Urgent shifts",
    "Gaps in the next 7 days",
    "Cancelled in the last 24 hours",
    "Requests",
    "Credentials expiring this week",
  ]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  // The seed's two requests (a time change and a swap), and any other spec added before this one.
  await expect(page.getByRole("region", { name: "Requests" })).toContainText(
    /\d+ requests waiting: \d+ time changes?, \d+ swaps?\./,
  );
  const cancelled = page.getByRole("region", { name: "Cancelled in the last 24 hours" });
  await expect(cancelled).toContainText("cancelled");
  await expect(cancelled).toContainText("notice");

  const gaps = page.getByRole("region", { name: "Gaps in the next 7 days" });
  const gap = gaps.getByRole("article").first();
  await expect(gap).toContainText("free");
  await gap.getByRole("link", { name: "Offer to someone" }).click();
  await expect(page.getByRole("heading", { name: "Offer this shift" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who can take it" })).toBeVisible();
  const send = page.getByRole("button", { name: /^Send offer to / }).first();
  const name = ((await send.getAttribute("aria-label")) ?? "").replace("Send offer to ", "");
  await send.click();
  await expect(page.getByText(`Offer on its way to ${name}.`)).toBeVisible();
  await page.getByRole("link", { name: "Back to Today" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
});

test("/office/today opens Today", async ({ page }) => {
  await officeLogin(page, "acme.admin@example.com");
  await page.goto(`${acme}/office/today`);
  await expect(page).toHaveURL(`${acme}/office`);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});

test("payroll doesn't get Today or the offer page", async ({ page }) => {
  await officeLogin(page, "acme.payroll@example.com");
  await expect(page.getByText("Your dashboard will appear here.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Urgent shifts" })).toHaveCount(0);
  const response = await page.goto(`${acme}/office/offer/00000000-0000-4000-8000-000000000000`);
  expect(response?.status()).toBe(404);
});

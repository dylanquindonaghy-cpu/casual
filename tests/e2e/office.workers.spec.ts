import type { Page } from "@playwright/test";
import { addBookedShift, addOfficeUser, addWorker } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// A worker who leaves, and one barred from a site, in a real browser (audit M22, M23, L24): a
// resourcer finds a booked worker, makes them inactive, sees their booking on Today and cancels it
// with the leaver reason; then blocks another booked worker from their site and keeps that
// booking. This spec's own resourcer, workers, shifts and sites (fresh ones on a retry).

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

test("a leaver made inactive, their booking cancelled from Today; another kept off a site", async ({
  page,
}, testInfo) => {
  const n = testInfo.retry;
  const resourcer = `workers.resourcer${n || ""}@example.com`;
  await addOfficeUser("acme", { email: resourcer, name: "Wren Resourcer", role: "resourcer" });
  const leaver = await addWorker("acme", {
    firstName: "Lena",
    lastName: `Leaver${n || ""}`,
    mobileE164: `+4477009008${81 + 2 * n}`,
  });
  const barred = await addWorker("acme", {
    firstName: "Bram",
    lastName: `Barred${n || ""}`,
    mobileE164: `+4477009008${82 + 2 * n}`,
  });
  const lenaName = `Lena Leaver${n || ""}`;
  const bramName = `Bram Barred${n || ""}`;
  await addBookedShift("acme", { workerId: leaver, daysAhead: 3, site: `Leaver Hall ${n}` });
  const { siteId } = await addBookedShift("acme", {
    workerId: barred,
    daysAhead: 4,
    site: `Barred Arena ${n}`,
  });
  await officeLogin(page, resourcer);

  // Find the leaver and make them inactive (a reason, then "Yes").
  await page.getByRole("link", { name: "Workers" }).click();
  await expect(page.getByRole("heading", { name: "Workers" })).toBeVisible();
  await page.getByLabel("Name or mobile number").fill(lenaName);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("link", { name: lenaName }).click();
  await expect(page.getByRole("heading", { name: lenaName })).toBeVisible();
  await expect(page.getByRole("link", { name: `Steward at Leaver Hall ${n}` })).toBeVisible();
  await page.getByRole("button", { name: "Make inactive" }).click();
  await expect(page.getByText("Choose a reason.")).toBeVisible();
  await page.getByLabel("Why?").first().selectOption("left");
  await page.getByRole("button", { name: "Make inactive" }).click();
  await page.getByRole("button", { name: `Yes, make ${lenaName} inactive` }).click();
  await expect(
    page.getByText(
      `${lenaName} is now inactive. They've been logged out, and can't log in or take shifts. They're booked on 1 shift ahead: it's on Today to cancel or keep.`,
    ),
  ).toBeVisible();
  await expect(page.getByText("Not active · Steward")).toBeVisible();

  // Block the other from their site.
  await page.goto(`${acme}/office/workers/${barred}`);
  await page.getByLabel("Site", { exact: true }).selectOption(siteId);
  await page.getByLabel("Why?").last().selectOption("client_asked");
  await page.getByRole("button", { name: "Block from this site" }).click();
  await expect(
    page.getByText(
      `${bramName} can't work at Barred Arena ${n} now. They're booked there on 1 shift ahead: it's on Today to cancel or keep.`,
    ),
  ).toBeVisible();

  // Today: both bookings to check. Cancel the leaver's; keep the other's.
  await page.goto(`${acme}/office`);
  const toCheck = page.getByRole("region", { name: "Bookings to check" });
  const lena = toCheck.locator("li", {
    hasText: `${lenaName} is booked, but is no longer active.`,
  });
  await lena.getByText(`Cancel ${lenaName}'s booking`, { exact: true }).click();
  await lena.getByLabel("Why?").selectOption("not_available");
  await lena.getByRole("button", { name: `Yes, cancel ${lenaName}'s booking` }).click();
  await expect(
    lena.getByText(/^Cancelled .* booking with .* notice\. They'll be told\.$/),
  ).toBeVisible();
  const bram = toCheck.locator("li", {
    hasText: `${bramName} is booked, but is blocked from Barred Arena ${n}.`,
  });
  await bram.getByRole("button", { name: "Keep the booking" }).click();
  await expect(
    page.getByText(
      `Kept. ${bramName}'s booking stays, and it won't show here again unless something changes.`,
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(`${lenaName} is booked`)).toHaveCount(0);
  await expect(page.getByText(`${bramName} is booked`)).toHaveCount(0);

  // The action log says what happened.
  await page.goto(`${acme}/office/log`);
  await expect(
    page.getByText(
      `Wren Resourcer made ${lenaName} inactive. Reason: They've left. 1 booking ahead to check.`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      `Wren Resourcer blocked ${bramName} from Barred Arena ${n}. Reason: The client asked. 1 booking ahead to check.`,
    ),
  ).toBeVisible();
});

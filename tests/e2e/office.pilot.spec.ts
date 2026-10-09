import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The pilot metrics page in a real browser, on the demo seed: enter part of the week-0 baseline,
// work out today's figures now, and see baseline against now. The resourcer is this spec's own
// (the seeded ones' login links are used up by the other office specs: 3 per email every 15
// minutes).

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

test("enter the baseline, update the figures, and see baseline against now", async ({ page }) => {
  const email = "pilot.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Pilot Resourcer", role: "resourcer" });
  await officeLogin(page, email);

  await (await menuLink(page, "Pilot metrics")).click();
  await expect(page).toHaveURL(`${acme}/office/reports/pilot`);
  await expect(page.getByRole("heading", { name: "Pilot metrics", level: 1 })).toBeVisible();

  // Part of the baseline (a blank figure is left out).
  const baseline = page.getByRole("region", { name: "Baseline (week 0)" });
  await baseline.getByLabel("Staff emails per day").fill("40");
  await baseline.getByLabel("Calls per day").fill("12");
  await baseline.getByLabel("Time to refill a cancellation (median, in minutes)").fill("240");
  await baseline.getByRole("button", { name: "Save the baseline" }).click();
  await expect(baseline.getByText("Baseline saved.")).toBeVisible();
  // A figure that isn't a number is refused, and says which.
  await baseline.getByLabel("No-shows per week").fill("lots");
  await baseline.getByRole("button", { name: "Save the baseline" }).click();
  await expect(baseline.getByText(/^Check these: No-shows per week\./)).toBeVisible();

  // Today's figures, now (the seed's bookings were made by the workers themselves).
  await page.getByRole("button", { name: "Update the figures now" }).click();
  await expect(page.getByText("Figures updated.")).toBeVisible();
  // The page shows complete days by default; today's figures need dates that include today.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  await page.goto(`${acme}/office/reports/pilot?to=${today}`);
  const cells = async (label: RegExp) =>
    page.getByRole("row", { name: label }).locator("td").allTextContents();
  expect(await cells(/^Messages in per day/)).toEqual([
    "Messages in per day (emails, calls and WhatsApp)",
    "52",
    "No tally for these dates",
    "Half the baseline",
  ]);
  expect((await cells(/^Time to refill a cancellation/))[1]).toBe("4 hours");
  expect((await cells(/^Portal actions/))[2]).toMatch(/^[1-9]\d* \([\d.]+ a day\)$/);
  await expect(page.getByText(/^Daily figures last worked out at /)).toBeVisible();
});

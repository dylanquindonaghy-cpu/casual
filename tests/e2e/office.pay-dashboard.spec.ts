import type { Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// Payroll's pay dashboard in a real browser (docs/office-v2.md 3.8; PLAN.md 12A.3), on the demo
// seed: payroll lands there from /office; the title with the pay week under it (no shifts line:
// Phase 26.10, fix-1), the four counts, the two sections, the Pay queries badge in the menu; resourcers can't open it. (Other
// specs add pay queries, so the counts are read, not assumed.)

const acme = "http://acme.localhost:3100";

async function officeLogin(page: Page, email: string, role: "payroll" | "resourcer") {
  await addOfficeUser("acme", { email, name: `Dash ${role}`, role });
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
}

test("payroll lands on the pay dashboard: the pay week, the counts and both sections", async ({
  page,
}) => {
  await officeLogin(page, "dash.payroll@example.com", "payroll");
  await expect(page).toHaveURL(`${acme}/office/pay`);
  await expect(page).toHaveTitle("Pay dashboard · Acme Events shifts");
  await expect(page.getByRole("heading", { name: "Pay dashboard", level: 1 })).toBeVisible();
  await expect(page.getByText(/^Your shifts line:/)).toHaveCount(0);
  // The pay week and its dates (Phase 24: from the top bar; 37.1: no "(paid …)" beside the Next
  // pay day, in the casual's words).
  await expect(
    page
      .getByRole("main")
      .getByText(/^Week \d{1,2} · Mon \d{1,2}( [A-Z][a-z]{2})? to Sun \d{1,2} [A-Z][a-z]{2}$/),
  ).toBeVisible();
  for (const name of ["Pay queries waiting", "Next digest", "Sorted this week", "Next pay day"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  // Which shifts the next pay day pays (Phase 26.10, fix-1; 37.1's words).
  await expect(
    page.getByText(/^For shifts Mon \d{1,2}( [A-Z][a-z]{2})? to Sun \d{1,2} [A-Z][a-z]{2}\.$/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Waiting, grouped by likely cause", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pay questions never get an AI answer: they come here."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recently sorted", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send the digest now" })).toBeVisible();

  // The waiting count is the Pay queries badge's, and each group opens Pay queries.
  const waiting = Number(
    await page
      .getByText("Pay queries waiting", { exact: true })
      .locator("xpath=preceding-sibling::p[1]")
      .textContent(),
  );
  const payQueries = await menuLink(page, "Pay queries");
  await expect(payQueries).toBeVisible();
  if (waiting > 0) {
    await expect(
      page.getByRole("navigation", { name: "Office menu" }).getByText(`${waiting} waiting`),
    ).toBeAttached();
  }
  await page.keyboard.press("Escape");
  const groups = page.getByRole("region", { name: "Waiting, grouped by likely cause" });
  if (waiting > 0) {
    await groups.getByRole("link").first().click();
    await expect(page).toHaveURL(`${acme}/office/pay-queries`);
  } else {
    await expect(groups.getByText("No pay queries waiting.")).toBeVisible();
  }

  // "Import pay records" from the header.
  await page.goto(`${acme}/office/pay`);
  await page.getByRole("main").getByRole("link", { name: "Import pay records" }).click();
  await expect(page).toHaveURL(`${acme}/office/pay/import`);
});

test("resourcers can't open the pay dashboard", async ({ page }) => {
  await officeLogin(page, "dash.resourcer@example.com", "resourcer");
  await expect(page).toHaveURL(`${acme}/office`);
  await expect(await menuLink(page, "Dashboard")).toBeVisible();
  await expect(await menuLink(page, "Pay dashboard")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const response = await page.goto(`${acme}/office/pay`);
  expect(response?.status()).toBe(404);
});

// One pay day everywhere (37.1): Zoe (whose seeded pay records are whole weeks on the calendar)
// sees on /pay the same next pay day, and the same shifts, as payroll's dashboard.
test("Zoe's pay day is the dashboard's Next pay day", async ({ page, browser }) => {
  await officeLogin(page, "dash.payroll.agree@example.com", "payroll");
  await expect(page).toHaveURL(`${acme}/office/pay`);
  const tile = page.getByText("Next pay day", { exact: true }).locator("xpath=..");
  const officeDay = (await tile.locator("p").first().textContent())?.trim() ?? "";
  const officeShifts = (await tile.getByText(/^For shifts /).textContent())?.trim() ?? "";
  expect(officeDay).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);

  const zoe = await browser.newContext();
  try {
    const casual = await zoe.newPage();
    const asked = new Date(Date.now() - 1000);
    await casual.goto(`${acme}/login`);
    await casual.getByLabel("Your mobile number").fill("07700 900400");
    await casual.getByRole("button", { name: "Send me a link" }).click();
    await casual.goto(await loginLinkSentTo("+447700900400", asked));
    await casual.getByRole("button", { name: "Log me in" }).click();
    await expect(casual).toHaveURL(`${acme}/`);
    await casual.goto(`${acme}/pay`);
    await expect(casual.getByRole("heading", { level: 2, name: /^Next pay day: / })).toHaveText(
      `Next pay day: ${officeDay}`,
    );
    // The same shifts, the office's line ending in a full stop.
    await expect(
      casual
        .getByRole("region", { name: /^Next pay day: / })
        .getByText(/^For shifts /)
        .first(),
    ).toHaveText(officeShifts.replace(/\.$/, ""));
  } finally {
    await zoe.close();
  }
});

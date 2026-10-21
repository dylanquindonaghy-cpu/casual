import type { Page } from "@playwright/test";
import { addEventWithSession, addOfficeUser, addSteward, cancelOwnShift } from "./db";
import { DASHBOARD_HEADING, expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office dashboard in a real browser, on the demo seed (12E.1; docs/screens.md `/office`;
// Phase 18's redesign): a resourcer sees how many things need them, the shifts line, this week's
// seven days (each a link), "Next up", "After that" and "Sorted today" (cancellations recorded,
// never approved), and nothing to approve, decline or deny; the bell opens Needs attention's page;
// the offer page leads back here; `/office/today` redirects here; payroll is sent to the pay
// dashboard. (Other specs change the seed's numbers, so this one checks the words and the links,
// not the counts.) Replaces office.today.spec.ts.

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
  // Payroll's home is the pay dashboard: /office sends them on (12A.3).
  await expect(page).toHaveURL(new RegExp(`^${acme.replace(/\./g, "\\.")}/office(/pay)?$`));
}

test("a resourcer's dashboard: what needs them, this week, where to start, and nothing to approve", async ({
  page,
}) => {
  await officeLogin(page, "acme.resourcer@example.com");
  // The heading says how many things need you; the page's tab still says Dashboard.
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Dashboard · Acme Events shifts");
  // Acme's shifts line (a fake number from the seed), under the heading.
  await expect(
    page.getByText("Your shifts line: +44 7700 900000 (WhatsApp, text and calls)."),
  ).toBeVisible();

  // Every part loaded (a part that couldn't says so where it shows, and the rest still shows).
  await expect(page.getByText("This couldn't load. Reload the page to try again.")).toHaveCount(0);
  await expect(page.getByText("Couldn't load", { exact: true })).toHaveCount(0);

  // This week: seven days, today first marked, each a link to its shifts (or its sessions to mark).
  const days = page.getByRole("navigation", { name: "This week" }).getByRole("link");
  await expect(days).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    await expect(days.nth(i)).toHaveAttribute(
      "href",
      /^\/office\/(shifts\?from=\d{4}-\d\d-\d\d|needs-attention#to-mark)$/,
    );
  }
  await expect(days.filter({ hasText: "Today" })).toHaveCount(1);

  // The parts, in order: where to start, then the rest of what needs you, then what's sorted.
  const headings = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(headings.first()).toHaveText("Next up");
  await expect(headings.nth(1)).toHaveText("After that");
  await expect(headings.last()).toHaveText("Sorted today");
  // Cancellations are recorded, never approved or declined: nothing on the page does either.
  const sorted = page.getByRole("list", { name: "Sorted today" });
  await expect(sorted.getByRole("link", { name: /cancellations? today/ })).toContainText(
    "Recorded automatically, never approved or declined.",
  );
  // (Whole words: the row's own "never approved or declined" is a statement, not an action.)
  for (const role of ["button", "link"] as const) {
    await expect(page.getByRole(role, { name: /\b(approve|decline|deny)\b/i })).toHaveCount(0);
  }

  // The bell in the top bar opens Needs attention's page.
  const bell = page.getByRole("link", { name: /^Needs attention/ });
  await expect(bell).toHaveAttribute("href", "/office/needs-attention");
  await bell.click();
  await expect(page).toHaveURL(`${acme}/office/needs-attention`);
  await expect(page.getByRole("heading", { name: "Needs attention", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Needs attention · Acme Events shifts");

  // A row opens its list: today's cancellations.
  await page.goto(`${acme}/office`);
  await sorted.getByRole("link", { name: /cancellations? today/ }).click();
  await expect(page).toHaveURL(`${acme}/office/cancellations?day=today`);
  await expect(page.getByText("Only today's.")).toBeVisible();
});

test("the offer page leads back to the dashboard", async ({ page }, testInfo) => {
  // A session, a steward and a resourcer of this spec's own: another spec's bookings can't get in
  // the way, and the seeded resourcer's login links (3 per email every 15 minutes) aren't used up.
  const email = `dashboard.offer${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Dashboard Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  const { shiftId } = await addEventWithSession("acme", {
    name: `Dashboard Offer Night ${n}`,
    site: `Dashboard Hall ${n}`,
    role: "steward",
    daysAhead: 11,
  });
  await addSteward("acme", {
    firstName: "Della",
    lastName: "Example",
    mobileE164: "+447700900641",
  });
  try {
    await officeLogin(page, email);
    await page.goto(`${acme}/office/offer/${shiftId}`);
    await expect(page.getByRole("heading", { name: "Offer this shift" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who can take it" })).toBeVisible();
    const send = page.getByRole("button", { name: /^Send offer to / }).first();
    const name = ((await send.getAttribute("aria-label")) ?? "").replace("Send offer to ", "");
    await send.click();
    await expect(page.getByText(`Offer on its way to ${name}.`)).toBeVisible();
    await page.getByRole("link", { name: "Back to the dashboard" }).click();
    await expect(page).toHaveURL(`${acme}/office`);
    await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test("Next up steps through the urgent places, one at a time", async ({ page }, testInfo) => {
  // Two urgent places of this spec's own, in a role no casual has (no other spec sees them), and a
  // resourcer of its own.
  const email = `dashboard.focus${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Focus Resourcer", role: "resourcer" });
  const n = Date.now() % 100_000;
  const made = [
    await addEventWithSession("acme", {
      name: `Focus Gala ${n}`,
      site: `Focus Hall ${n}`,
      role: "focus_check",
      daysAhead: 1,
      urgent: true,
    }),
    await addEventWithSession("acme", {
      name: `Focus Fair ${n}`,
      site: `Focus Yard ${n}`,
      role: "focus_check",
      daysAhead: 2,
      urgent: true,
    }),
  ];
  try {
    await officeLogin(page, email);
    const card = page.locator("[data-focus]");
    const band = card.getByText(/^\d+ of \d+$/);
    await expect(band).toHaveText(/^1 of ([2-9]|\d{2,})$/);
    const total = ((await band.textContent()) ?? "").split(" of ")[1];
    const first = await card.getByRole("link").first().getAttribute("href");
    // Next: the second place, a different session; Previous: back to the first.
    await card.getByRole("button", { name: "Next urgent place" }).click();
    await expect(band).toHaveText(`2 of ${total}`);
    await expect(card.getByRole("link").first()).not.toHaveAttribute("href", first ?? "");
    await card.getByRole("button", { name: "Previous urgent place" }).click();
    await expect(band).toHaveText(`1 of ${total}`);
    await expect(card.getByRole("link").first()).toHaveAttribute("href", first ?? "");
    // Previous from the first goes round to the last.
    await card.getByRole("button", { name: "Previous urgent place" }).click();
    await expect(band).toHaveText(`${total} of ${total}`);
  } finally {
    for (const m of made) await cancelOwnShift("acme", m.shiftId);
  }
});

test("/office/today opens the dashboard", async ({ page }) => {
  await officeLogin(page, "acme.admin@example.com");
  await page.goto(`${acme}/office/today`);
  await expect(page).toHaveURL(`${acme}/office`);
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
});

test("payroll doesn't get the dashboard, the bell or the offer page", async ({ page }) => {
  await officeLogin(page, "acme.payroll@example.com");
  // /office sends payroll to their pay dashboard (12A.3; tests/e2e/office.pay-dashboard.spec.ts).
  await expect(page).toHaveURL(`${acme}/office/pay`);
  await expect(page.getByRole("heading", { name: "Pay dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next up" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Needs attention/ })).toHaveCount(0);
  const response = await page.goto(`${acme}/office/offer/00000000-0000-4000-8000-000000000000`);
  expect(response?.status()).toBe(404);
  // Nor Needs attention's page: their home instead.
  await page.goto(`${acme}/office/needs-attention`);
  await expect(page).toHaveURL(`${acme}/office/pay`);
});

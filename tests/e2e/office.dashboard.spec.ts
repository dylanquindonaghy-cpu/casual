import type { Page } from "@playwright/test";
import { addEventWithSession, addSteward, cancelOwnShift } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office dashboard in a real browser, on the demo seed (12E.1; docs/screens.md `/office`): a
// resourcer sees the four counts labelled exactly, each a link to its list, the sections in order,
// the shifts line, the Cancellations hint and nothing to approve, decline or deny; the bell links
// to Needs attention; the offer page leads back here; `/office/today` redirects here; payroll is
// sent to the pay dashboard. (Other specs change the seed's numbers, so this one checks the words
// and the links, not the counts.) Replaces office.today.spec.ts.

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

const COUNTS = [
  ["Urgent shifts not filled", "/office/events?view=urgent"],
  ["Events showing to casuals", "/office/events?view=showing"],
  ["Cancellations today", "/office/cancellations?day=today"],
  ["Enquiries today", "/office/enquiries?day=today"],
] as const;

test("a resourcer's dashboard: the counts, the sections in order, and nothing to approve", async ({
  page,
}) => {
  await officeLogin(page, "acme.resourcer@example.com");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  // Acme's shifts line (a fake number from the seed), under the heading.
  await expect(
    page.getByText("Your shifts line: +44 7700 900000 (WhatsApp, text and calls)."),
  ).toBeVisible();

  // The four counts, in order, labelled exactly, each a link to its filtered list.
  const counts = page.getByRole("navigation", { name: "Counts" }).getByRole("link");
  await expect(counts).toHaveCount(4);
  for (const [i, [label, href]] of COUNTS.entries()) {
    const link = counts.nth(i);
    await expect(link.getByText(label, { exact: true })).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  }

  // The sections, in order, and the Cancellations hint.
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([
    "Urgent shifts not filled",
    "Showing to casuals",
    "Cancellations",
    "Enquiries",
    "Needs attention",
  ]);
  await expect(
    page
      .getByRole("region", { name: "Cancellations", exact: true })
      .getByText("Recorded automatically, never approved or declined", { exact: true }),
  ).toBeVisible();
  // A cancellation is final: nothing on the page approves, declines or denies anything.
  for (const role of ["button", "link"] as const) {
    await expect(page.getByRole(role, { name: /approve|decline|deny/i })).toHaveCount(0);
  }

  // The bell in the top bar goes to Needs attention.
  const bell = page.getByRole("link", { name: /^Needs attention/ });
  await expect(bell).toHaveAttribute("href", "/office#needs-attention");
  await bell.click();
  await expect(page).toHaveURL(`${acme}/office#needs-attention`);
  await expect(page.getByRole("heading", { name: "Needs attention", level: 2 })).toBeInViewport();

  // A count opens its list: today's cancellations.
  await counts.nth(2).click();
  await expect(page).toHaveURL(`${acme}/office/cancellations?day=today`);
  await expect(page.getByText("Only today's.")).toBeVisible();
});

test("the offer page leads back to the dashboard", async ({ page }) => {
  // A session and a steward of this spec's own, so another spec's bookings can't get in the way.
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
    await officeLogin(page, "acme.resourcer@example.com");
    await page.goto(`${acme}/office/offer/${shiftId}`);
    await expect(page.getByRole("heading", { name: "Offer this shift" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who can take it" })).toBeVisible();
    const send = page.getByRole("button", { name: /^Send offer to / }).first();
    const name = ((await send.getAttribute("aria-label")) ?? "").replace("Send offer to ", "");
    await send.click();
    await expect(page.getByText(`Offer on its way to ${name}.`)).toBeVisible();
    await page.getByRole("link", { name: "Back to the dashboard" }).click();
    await expect(page).toHaveURL(`${acme}/office`);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test("/office/today opens the dashboard", async ({ page }) => {
  await officeLogin(page, "acme.admin@example.com");
  await page.goto(`${acme}/office/today`);
  await expect(page).toHaveURL(`${acme}/office`);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
});

test("payroll doesn't get the dashboard, the bell or the offer page", async ({ page }) => {
  await officeLogin(page, "acme.payroll@example.com");
  // /office sends payroll to their pay dashboard (12A.3; tests/e2e/office.pay-dashboard.spec.ts).
  await expect(page).toHaveURL(`${acme}/office/pay`);
  await expect(page.getByRole("heading", { name: "Pay dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Urgent shifts not filled" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Needs attention/ })).toHaveCount(0);
  const response = await page.goto(`${acme}/office/offer/00000000-0000-4000-8000-000000000000`);
  expect(response?.status()).toBe(404);
});

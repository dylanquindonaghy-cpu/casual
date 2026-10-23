import type { Page } from "@playwright/test";
import { addEventWithSession, addOfficeUser, addSteward, cancelOwnShift } from "./db";
import { DASHBOARD_HEADING, expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office dashboard in a real browser, on the demo seed (12E.1; docs/screens.md `/office`;
// Phases 18 and 20): a resourcer sees how many things need them (the one count, the same as the
// menu's Needs attention adds up to with the urgent places), the shifts line, the four count
// tiles, every urgent place, this week's seven days (each a link), Needs attention, Waiting on
// others and Sorted today (cancellations recorded, never approved), and nothing to approve,
// decline or deny; Needs attention in the menu opens its page; the offer page leads back here;
// `/office/today` redirects here; payroll is sent to the pay dashboard. (Other specs change the
// seed's numbers, so this one checks the words, the links and that the counts add up.) Replaces
// office.today.spec.ts.

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

  // The parts, in order: the urgent places, this week, the rest of what needs you, what waits on
  // others, then what's sorted.
  const headings = page.getByRole("main").getByRole("heading", { level: 2 });
  await expect(headings).toHaveText([
    "Urgent places to fill",
    "This week",
    "Needs attention",
    "Waiting on others",
    "Sorted today",
  ]);
  // The one count adds up: the urgent places plus Needs attention's (its tiles' figures).
  const heading = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  const things = Number(/(\d+) things? needs? you/.exec(heading)?.[1] ?? 0);
  const figure = async (label: string) =>
    Number(
      await page
        .getByRole("main")
        .getByRole("link")
        .filter({ hasText: new RegExp(`^${label}`) })
        .locator("span")
        .nth(1)
        .textContent(),
    );
  const urgent = await figure("Urgent places");
  const attention = await figure("Needs attention");
  expect(things).toBe(urgent + attention);
  // Cancellations are recorded, never approved or declined: nothing on the page does either.
  const sorted = page.getByRole("list", { name: "Sorted today" });
  await expect(sorted.getByRole("link", { name: /cancellations? today/ })).toContainText(
    "Recorded automatically, never approved or declined.",
  );
  // (Whole words: the row's own "never approved or declined" is a statement, not an action.)
  for (const role of ["button", "link"] as const) {
    await expect(page.getByRole(role, { name: /\b(approve|decline|deny)\b/i })).toHaveCount(0);
  }

  // Needs attention in the menu (the bell's place until Phase 20), with the same count, opens its
  // page.
  // (The demo seed always has some: yesterday's racecourse sessions to mark.)
  expect(attention).toBeGreaterThan(0);
  const item = await menuLink(page, "Needs attention");
  await expect(item).toHaveAttribute("href", "/office/needs-attention");
  await expect(item.locator("xpath=following-sibling::span[1]")).toHaveText(
    `${attention} to deal with`,
  );
  await item.click();
  await expect(page).toHaveURL(`${acme}/office/needs-attention`);
  await expect(page.getByRole("heading", { name: "Needs attention", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Needs attention · Acme Events shifts");
  // Its page says the same count, and the urgent places beside them, so the two add up again.
  await expect(
    page.getByText(
      new RegExp(`^${attention} things? for you\\. Each item links to where it's dealt with\\.$`),
    ),
  ).toBeVisible();
  const also = page.getByRole("region", { name: "Also needs you" });
  await expect(also).toContainText(
    urgent === 0
      ? "No urgent places to fill."
      : new RegExp(`(?<!\\d)${urgent} urgent places? to fill, the first on `),
  );

  // A card jumps to its own section (Phase 21): the address takes the heading's id, and the
  // heading is on screen. Then this week's grey pill opens the rota board.
  await page.goto(`${acme}/office`);
  await page
    .getByRole("main")
    .getByRole("link")
    .filter({ hasText: /^Waiting on others/ })
    .click();
  await expect(page).toHaveURL(`${acme}/office#waiting`);
  await expect(page.getByRole("heading", { name: "Waiting on others", level: 2 })).toBeInViewport();
  await page.getByRole("link", { name: "Open the rota board" }).click();
  await expect(page).toHaveURL(`${acme}/office/events`);
  await expect(page.getByRole("heading", { name: "Events & sessions", level: 1 })).toBeVisible();

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

test("every urgent place is listed, each with Offer to someone and the rest under …", async ({
  page,
}, testInfo) => {
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
    const places = page.getByRole("region", { name: "Urgent places to fill" });
    for (const m of made) {
      const row = places.locator("[data-urgent-place]").filter({
        has: page.locator(`a[href="/office/shifts/${m.shiftId}"]`),
      });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("link", { name: "Offer to someone" })).toHaveAttribute(
        "href",
        `/office/offer/${m.shiftId}`,
      );
      // "…" opens the rest: mark as filled, not urgent.
      await expect(row.getByRole("button", { name: "Not urgent" })).toBeHidden();
      await row.locator('summary[aria-label^="More for "]').click();
      await expect(row.getByText("Mark as filled", { exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: "Not urgent" })).toBeVisible();
      // It grows out of its button (Phase 22): from the button's left edge on a phone, from its
      // right edge from 768px, where the buttons end the row.
      const more = row.locator("details[open] > div");
      await expect(more).toHaveCSS("animation-name", "sd-pop");
      await expect(more).toHaveCSS("transform-origin", "0px 0px");
    }
    const phone = page.viewportSize()!;
    await page.setViewportSize({ width: 1280, height: 800 });
    const opened = places.locator("details[open] > div").first();
    const across = await opened.evaluate((el) => (el as HTMLElement).offsetWidth);
    await expect(opened).toHaveCSS("transform-origin", `${across}px 0px`);
    await page.setViewportSize(phone);
    // Soonest first: tomorrow's before the day after's.
    const order = await places
      .locator("[data-urgent-place] a[href^='/office/shifts/']")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(order.indexOf(`/office/shifts/${made[0]!.shiftId}`)).toBeLessThan(
      order.indexOf(`/office/shifts/${made[1]!.shiftId}`),
    );
    // "Not urgent": the place leaves the list, and the answer stays at the foot of the screen.
    const second = places.locator("[data-urgent-place]").filter({
      has: page.locator(`a[href="/office/shifts/${made[1]!.shiftId}"]`),
    });
    await second.getByRole("button", { name: "Not urgent" }).click();
    await expect(second).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "No longer urgent. No more offers will go out." }),
    ).toBeVisible();

    // "Offer": while the offer page is on its way (held back here), a spinner in its word's place
    // (Phase 22); then the page.
    const first = places.locator("[data-urgent-place]").filter({
      has: page.locator(`a[href="/office/shifts/${made[0]!.shiftId}"]`),
    });
    await page.route(new RegExp(`/office/offer/${made[0]!.shiftId}(\\?|$)`), async (route) => {
      const request = route.request();
      if (request.headers()["rsc"] === "1" && request.headers()["next-router-prefetch"] !== "1")
        await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    const offer = first.getByRole("link", { name: "Offer to someone" });
    await expect(offer.locator(".animate-turn")).toHaveCount(0);
    await offer.click();
    await expect(offer.locator(".animate-turn")).toBeVisible();
    await expect(offer.locator(".animate-turn")).toHaveCSS("animation-name", "sd-turn");
    await expect(offer.getByText("Offer", { exact: true })).toHaveCSS("opacity", "0");
    await expect(page).toHaveURL(`${acme}/office/offer/${made[0]!.shiftId}`);
  } finally {
    for (const m of made) await cancelOwnShift("acme", m.shiftId);
  }
});

// With a mouse on a laptop (Phase 22): a card's jump lands with a ring that fades out round the
// section it lands on; a day of this week shows its numbers over it under the pointer, or when the
// keyboard reaches it, and not otherwise.
test.describe("on a laptop with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test("a card's jump shows where it landed; a day's numbers under the pointer or on focus", async ({
    page,
  }, testInfo) => {
    const email = `dashboard.laptop${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Laptop Resourcer", role: "resourcer" });
    await officeLogin(page, email);

    await page
      .getByRole("main")
      .getByRole("link")
      .filter({ hasText: /^Waiting on others/ })
      .click();
    await expect(page).toHaveURL(`${acme}/office#waiting`);
    const landed = page.locator("section:has(:target)");
    await expect(landed).toHaveCount(1);
    await expect(landed).toHaveCSS("animation-name", "sd-landed");

    const days = page.getByRole("navigation", { name: "This week" }).getByRole("link");
    await expect(days).toHaveCount(7);
    const day = days.nth(3);
    const tip = day.locator('span[aria-hidden="true"]').first();
    await expect(tip).toHaveText((await day.getAttribute("aria-label"))!);
    await expect(tip).toBeHidden();
    await day.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveCSS("animation-name", "sd-pop");
    await page.mouse.move(640, 5);
    await expect(tip).toBeHidden();
    await days.nth(2).focus();
    await page.keyboard.press("Tab");
    await expect(day).toBeFocused();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(tip).toBeHidden();
  });
});

test("/office/today opens the dashboard", async ({ page }) => {
  await officeLogin(page, "acme.admin@example.com");
  await page.goto(`${acme}/office/today`);
  await expect(page).toHaveURL(`${acme}/office`);
  await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
});

test("payroll doesn't get the dashboard, Needs attention or the offer page", async ({ page }) => {
  await officeLogin(page, "acme.payroll@example.com");
  // /office sends payroll to their pay dashboard (12A.3; tests/e2e/office.pay-dashboard.spec.ts).
  await expect(page).toHaveURL(`${acme}/office/pay`);
  await expect(page.getByRole("heading", { name: "Pay dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Urgent places to fill" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Needs attention/ })).toHaveCount(0);
  const response = await page.goto(`${acme}/office/offer/00000000-0000-4000-8000-000000000000`);
  expect(response?.status()).toBe(404);
  // Nor Needs attention's page: their home instead.
  await page.goto(`${acme}/office/needs-attention`);
  await expect(page).toHaveURL(`${acme}/office/pay`);
});

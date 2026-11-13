import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  bookThenCasualsAsk,
  cancelOwnShift,
} from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// An event's page, round 8, in a real browser (Phase 26.5; the spec page's evt-1 to evt-6 and
// aud-5): an event of this spec's own with one steward session of 3 places (nobody booked). Its
// Staffing tab lays out the 3 places (each named for its place to a screen reader), the open places
// panel has it opened with "Offer to the best …" and "Pick someone"; "Offer 3 open places", after
// a "Yes", marks it urgent (the tiles turn urgent); Overview and History are a tab away; "Add
// shifts" opens the form for this event. On a phone the tiles sit three across. The resourcer is
// this spec's own; a retry makes a new event.

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

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

test("the staffing layout, the open places, Offer N open places, the tabs and Add sessions", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const run = `${Date.now().toString(36)}${testInfo.retry}`;
  const name = `Staffing Test Event ${run}`;
  const email = `event.page${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Event Page Resourcer", role: "resourcer" });
  const { eventId, shiftId } = await addEventWithSession("acme", {
    name,
    site: `Staffing Test Hall ${run}`,
    role: "steward",
    // Inside the firm's urgent window (24 hours), where "Offer N open places" offers.
    daysAhead: 0.5,
    headcount: 3,
  });
  try {
    await officeLogin(page, email);
    await page.goto(`${acme}/office/events/${eventId}`);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    // Its tab names the event and the tab open (Phase 37.6, w1-09).
    await expect(page).toHaveTitle(`${name} · Staffing · Acme Events shifts`);
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Events & sessions" })).toHaveAttribute(
      "href",
      "/office/events",
    );
    await expect(page.getByRole("link", { name: /^Staffing \d+$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Three places, each its own name to a screen reader (aud-5).
    const layout = page.locator("#staffing-layout");
    for (const n of [1, 2, 3]) {
      await expect(
        layout.getByRole("link", {
          name: new RegExp(`^Open place: Steward, \\d\\d:\\d\\d to \\d\\d:\\d\\d, place ${n}$`),
        }),
      ).toBeVisible();
    }
    // Its open place, opened, with its two ways to fill it.
    const open = page.locator("#open-places");
    await expect(open.locator(`[data-open-chosen="${shiftId}"]`)).toContainText("Steward × 3");
    await expect(
      open.getByRole("button", { name: /^Offer to the best (\d+|people): / }),
    ).toBeVisible();
    await expect(open.getByRole("link", { name: /^Pick someone: / })).toHaveAttribute(
      "href",
      `/office/offer/${shiftId}`,
    );

    // Offer 3 open places, after a "Yes": marked urgent, the tiles turn urgent.
    await page.getByRole("button", { name: "Offer 3 open places" }).click();
    await page.getByRole("button", { name: "Yes, offer them" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Offers are going out for 1 session." }),
    ).toBeVisible();
    await expect(
      layout.getByRole("link", { name: /^Urgent open place: Steward, .*place 1$/ }),
    ).toBeVisible();
    await expect(open).toContainText("Offers are going out.");

    // History has it; Overview has the session's list.
    await page.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(`${acme}/office/events/${eventId}?tab=history`);
    await expect(page.getByRole("region", { name: "History" })).toContainText("urgent");
    await expect(page).toHaveTitle(`${name} · History · Acme Events shifts`);
    await page.getByRole("link", { name: /^Overview \d+$/ }).click();
    await expect(page).toHaveURL(`${acme}/office/events/${eventId}?tab=overview`);
    await expect(
      page.getByRole("link", { name: /^Assign someone: /, includeHidden: true }),
    ).toHaveCount(1);

    // Add sessions: the form for this event.
    await page.getByRole("link", { name: "Add sessions" }).click();
    await expect(page).toHaveURL(`${acme}/office/shifts/event?event=${eventId}`);
    await expect(page.getByRole("heading", { name: "Add sessions", level: 1 })).toBeVisible();
    await expect(page.getByText(`Adding shifts to ${name}.`)).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

// Phase 37.6 (w1-09): payroll can't open an event's page, and its tab never names the event.
test("payroll opening an event's page: Page not found, never the event's name", async ({
  page,
}, testInfo) => {
  const run = `${Date.now().toString(36)}${testInfo.retry}`;
  const name = `Payroll Hidden Event ${run}`;
  const email = `event.payroll${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Event Payroll", role: "payroll" });
  const { eventId, shiftId } = await addEventWithSession("acme", {
    name,
    site: `Payroll Hidden Hall ${run}`,
    role: "steward",
    daysAhead: 3,
  });
  try {
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/office/login`);
    await page.getByLabel("Your work email").fill(email);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page.getByText("Check your email.")).toBeVisible();
    const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
    await page.goto(link);
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${acme}/office/pay`);
    for (const path of [`/office/events/${eventId}`, `/office/shifts/${shiftId}`]) {
      expect((await page.goto(`${acme}${path}`))?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { name: "We can't find that page." })).toBeVisible();
      await expect(page).toHaveTitle("Page not found · Acme Events shifts");
      expect(await page.title()).not.toContain(name);
    }
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

// The event's Cancellations tab, empty and then with one (evt-2); then a booked place's tile opens
// the session's Booked list, where the booking is cancelled or moved (evt-5), even while casuals
// ask for the event's sessions and the session's page would open on "Asked for it" (the
// claims-auditor's round 1).
test("the Cancellations tab; a booked tile opens the booking, to cancel or move it, while casuals ask", async ({
  page,
}, testInfo) => {
  const run = `${Date.now().toString(36)}${testInfo.retry}`;
  const email = `event.booked${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Event Booked Resourcer", role: "resourcer" });
  const nina = await addSteward("acme", {
    firstName: "Nina",
    lastName: "Tiled",
    mobileE164: "+447700900691",
  });
  const { eventId, shiftId } = await addEventWithSession("acme", {
    name: `Booked Tile Event ${run}`,
    site: `Booked Tile Hall ${run}`,
    role: "steward",
    daysAhead: 3,
    headcount: 2,
  });
  const oscar = await addSteward("acme", {
    firstName: "Oscar",
    lastName: "Tiled",
    mobileE164: "+447700900692",
  });
  try {
    await officeLogin(page, email);
    await page.goto(`${acme}/office/events/${eventId}?tab=cancellations`);
    const cancellations = page.getByRole("region", { name: "Cancellations" });
    await expect(cancellations.getByText("No cancellations on this event.")).toBeVisible();
    await bookAndCancel("acme", { shiftId, workerId: oscar, reason: "Something came up" });
    await page.reload();
    await expect(
      cancellations.getByRole("link").filter({ hasText: "Oscar Tiled" }),
    ).toHaveAttribute("href", /^\/office\/cancellations\/[0-9a-f-]{36}$/);

    await bookThenCasualsAsk("acme", { shiftId, workerId: nina, eventId, officeEmail: email });
    await page.goto(`${acme}/office/events/${eventId}`);
    await page
      .locator("#staffing-layout")
      .getByRole("link", { name: /^Nina Tiled: Steward, .*place \d\. Open the session$/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/office/shifts/${shiftId}\\?show=booked#places$`));
    await expect(page.getByRole("link", { name: /^Booked 1$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Its "Cancel …'s booking" (the opener of the form; its confirm button is inside).
    await expect(page.locator("summary", { hasText: "Cancel Nina Tiled's booking" })).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tiles three across, then the open places, nothing sideways", async ({ page }, testInfo) => {
    const run = `${Date.now().toString(36)}${testInfo.retry}`;
    const email = `event.phone${testInfo.retry || ""}@example.com`;
    await addOfficeUser("acme", { email, name: "Event Phone", role: "resourcer" });
    const { eventId, shiftId } = await addEventWithSession("acme", {
      name: `Phone Staffing ${run}`,
      site: `Phone Staffing Hall ${run}`,
      role: "steward",
      daysAhead: 3,
      headcount: 4,
    });
    try {
      await officeLogin(page, email);
      await page.goto(`${acme}/office/events/${eventId}`);
      const tiles = page.locator("#staffing-layout [data-place]");
      await expect(tiles).toHaveCount(4);
      const boxes = await tiles.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().top)),
      );
      // The first three on one row, the fourth below.
      expect(new Set(boxes.slice(0, 3)).size).toBe(1);
      expect(boxes[3]).toBeGreaterThan(boxes[0] ?? 0);
      // The open places come after the layout.
      const layout = await page.locator("#staffing-layout").boundingBox();
      const open = await page.locator("#open-places").boundingBox();
      expect((open?.y ?? 0) > (layout?.y ?? 0) + (layout?.height ?? 0) - 1).toBe(true);
      await noSidewaysScroll(page);
    } finally {
      await cancelOwnShift("acme", shiftId);
    }
  });
});

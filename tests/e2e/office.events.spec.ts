import type { Browser, Page } from "@playwright/test";
import { addEventWithSession, addOfficeUser, addSteward, cancelOwnShift } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// Events & sessions in a real browser (12B.5; Phase 24, 24.4: round 7's event cards): a resourcer
// switches an event off on its card and a casual's Open shifts loses its session; switched back
// on (from the event's own page, its card's View sessions), it's there again. On a laptop, the
// filters and their line on one row, the cards in two columns. The event, its site, the casual
// and the resourcer are this spec's own (made-up details), and its shift is cancelled at the end,
// so nothing another spec sees changes. A retry makes its own event and site (the run's suffix);
// the casual and the resourcer are found again.

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const EVENT = `Switch Test Gala ${RUN}`;
const SITE = `Switch Test Hall ${RUN}`;
const RESOURCER = "events.resourcer@example.com";
const CASUAL = { firstName: "Esme", lastName: "Switch", mobileE164: "+447700900612" };

async function officeLogin(page: Page) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(RESOURCER);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(RESOURCER, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

async function casualLogin(page: Page) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900612");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(CASUAL.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
}

test("switching an event off hides it from a casual's open shifts; on again brings it back", async ({
  browser,
}) => {
  const { shiftId } = await addEventWithSession("acme", {
    name: EVENT,
    site: SITE,
    role: "steward",
    daysAhead: 3,
  });
  await addSteward("acme", CASUAL);
  await addOfficeUser("acme", { email: RESOURCER, name: "Events Resourcer", role: "resourcer" });
  try {
    await switchAndCheck(browser, shiftId);
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

async function switchAndCheck(browser: Browser, shiftId: string) {
  const office = await (await browser.newContext()).newPage();
  const casual = await (await browser.newContext()).newPage();
  await officeLogin(office);
  await casualLogin(casual);
  // Its card on the casual's Open shifts (found by its event's name, which only it has).
  const session = casual.getByRole("listitem").filter({ hasText: EVENT });
  await casual.goto(`${acme}/shifts/open`);
  await expect(session).toHaveCount(1);

  // The resourcer finds the event's card and switches it off there (round 7: on the card).
  await (await menuLink(office, "Events & sessions")).click();
  await expect(office.getByRole("heading", { name: "Events & sessions", level: 1 })).toBeVisible();
  // No dates to page through (Phase 18's board's): the shifts list has the days.
  await expect(office.getByRole("navigation", { name: "Dates" })).toHaveCount(0);
  await expect(
    office.getByRole("main").getByRole("link", { name: "All shifts by day" }),
  ).toHaveAttribute("href", "/office/shifts");
  // The filters, each with its count: All, Showing, Hidden, "Urgent, not filled".
  const show = office.getByRole("navigation", { name: "Show" });
  await expect(show.getByRole("link")).toHaveText([
    /^All \d+$/,
    /^Showing \d+$/,
    /^Hidden \d+$/,
    /^Urgent, not filled \d+$/,
  ]);
  // On a computer: the filters and their line on one row, the cards in two columns.
  const phone = office.viewportSize();
  await office.setViewportSize({ width: 1280, height: 900 });
  const line = office
    .getByRole("main")
    .getByText(/^\d+ events? with sessions to come · \d+ places? free$/);
  const filters = await show.boundingBox();
  const beside = await line.boundingBox();
  if (!filters || !beside) throw new Error("the filters' row isn't on the page");
  expect(beside.y).toBeLessThan(filters.y + filters.height); // the two overlap: one row
  expect(filters.y).toBeLessThan(beside.y + beside.height);
  expect(beside.x).toBeGreaterThan(filters.x + filters.width); // the line to the right
  const cards = office.locator("main article[data-event]");
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  if (!first || !second) throw new Error("fewer than two event cards");
  expect(second.x).toBeGreaterThanOrEqual(first.x + first.width); // side by side
  expect(Math.abs(second.y - first.y)).toBeLessThan(2); // tops level
  if (phone) await office.setViewportSize(phone);
  // Its card: the switch on, its answer in words beside it.
  const card = office
    .locator("main article[data-event]")
    .filter({ has: office.getByRole("heading", { name: EVENT, level: 2 }) });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Showing to casuals");
  const toggle = card.getByRole("switch", { name: `Show ${EVENT} to casuals` });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(
    office
      .getByRole("status")
      .filter({ hasText: "Hidden from casuals. Booked casuals keep their shifts." }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(card).toContainText("Hidden from casuals");
  // The Hidden filter has it; Showing doesn't (each checked once its page has loaded). A
  // filter's link carries its count.
  const tab = async (name: string, view: string) => {
    await show.getByRole("link", { name: new RegExp(`^${name} \\d+$`) }).click();
    await expect(office).toHaveURL(`${acme}/office/events?view=${view}`);
    await expect(show.getByRole("link", { name: new RegExp(`^${name} \\d+$`) })).toHaveAttribute(
      "aria-current",
      "page",
    );
  };
  await tab("Hidden", "hidden");
  await expect(card).toBeVisible();
  await tab("Showing", "showing");
  await expect(office.getByRole("heading", { name: "Events & sessions", level: 1 })).toBeVisible();
  await expect(card).toHaveCount(0);

  // The casual's Open shifts no longer has it, and its page says it isn't available.
  await casual.goto(`${acme}/shifts/open`);
  await expect(casual.getByRole("heading", { name: "Open shifts", level: 1 })).toBeVisible();
  await expect(session).toHaveCount(0);
  await casual.goto(`${acme}/shifts/${shiftId}`);
  await expect(casual.getByRole("heading", { name: "This shift isn't available." })).toBeVisible();

  // Switched back on, from the event's own page (its card's View sessions): the casual sees it
  // again.
  await tab("Hidden", "hidden");
  await card.getByRole("link", { name: `View sessions: ${EVENT}` }).click();
  await expect(office.getByRole("heading", { name: EVENT, level: 1 })).toBeVisible();
  const again = office.getByRole("switch", { name: `Show ${EVENT} to casuals` });
  await again.click();
  await expect(office.getByRole("status").filter({ hasText: "Showing to casuals." })).toBeVisible();
  await expect(again).toHaveAttribute("aria-checked", "true");
  await casual.goto(`${acme}/shifts/open`);
  await expect(session).toHaveCount(1);
}

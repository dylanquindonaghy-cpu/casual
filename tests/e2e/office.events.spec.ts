import type { Browser, Page } from "@playwright/test";
import { addEventWithSession, addOfficeUser, addSteward, cancelOwnShift } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// Events & sessions in a real browser (12B.5; Phase 18's rota board): a resourcer opens an event's
// row and switches it off there (Phase 20) and a casual's Open shifts loses its session; switched back on (from the event's
// own page, opened from its row), it's there again. The event, its site,
// the casual and the resourcer are this spec's own (made-up details), and its shift is cancelled
// at the end, so nothing another spec sees changes. A retry makes its own event and site (the
// run's suffix); the casual and the resourcer are found again.

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

  // The resourcer finds the event's row on the board and switches it off.
  await (await menuLink(office, "Events & sessions")).click();
  await expect(office.getByRole("heading", { name: "Events & sessions", level: 1 })).toBeVisible();
  // Two weeks at a time: Later, then Earlier back to today (nothing before it).
  const dates = office.getByRole("navigation", { name: "Dates" });
  await expect(dates.getByRole("link", { name: "Earlier" })).toHaveCount(0);
  await dates.getByRole("link", { name: "Later" }).click();
  await expect(office).toHaveURL(/\/office\/events\?from=\d{4}-\d\d-\d\d$/);
  await dates.getByRole("link", { name: "Earlier" }).click();
  await expect(office).toHaveURL(`${acme}/office/events`);
  await expect(dates.getByRole("link", { name: "Earlier" })).toHaveCount(0);
  // On a computer (Phase 20): the filters and the dates on one row, the key under them in words.
  const phone = office.viewportSize();
  await office.setViewportSize({ width: 1280, height: 900 });
  const show = await office.getByRole("navigation", { name: "Show" }).boundingBox();
  const when = await dates.boundingBox();
  const key = office.locator("[data-board-key]");
  await expect(key).toHaveText(
    /^Urgent gap\s*Places open\s*Full\s*Pills show places filled out of places needed\.$/,
  );
  const under = await key.boundingBox();
  if (!show || !when || !under) throw new Error("the board's controls aren't on the page");
  expect(when.y).toBeLessThan(show.y + show.height); // the two overlap: one row
  expect(show.y).toBeLessThan(when.y + when.height);
  expect(when.x).toBeGreaterThan(show.x + show.width); // the dates to the right of the filters
  const rowEnd = Math.max(show.y + show.height, when.y + when.height);
  expect(under.y).toBeGreaterThanOrEqual(rowEnd - 4); // under them (it sits 4px closer)
  if (phone) await office.setViewportSize(phone);
  // The row's name (it opens the row into its sessions) and its line. Its switch is in the opened
  // row only (Phase 20), so a slip on the board can't hide an event.
  const row = office.getByRole("button", { name: new RegExp(`^${EVENT}`) });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Hidden from casuals");
  const toggle = office.getByRole("switch", { name: `Show ${EVENT} to casuals` });
  await expect(toggle).toHaveCount(0);
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(
    office
      .getByRole("status")
      .filter({ hasText: "Hidden from casuals. Booked casuals keep their shifts." }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(row).toContainText("Hidden from casuals");
  // The Hidden filter has it; Showing (a filter again since Phase 24's dashboard) doesn't (each
  // checked once its page has loaded). A filter's link carries its count.
  const tab = async (name: string, view: string) => {
    await office.getByRole("link", { name: new RegExp(`^${name} \\d+$`) }).click();
    await expect(office).toHaveURL(`${acme}/office/events?view=${view}`);
    await expect(office.getByRole("link", { name: new RegExp(`^${name} \\d+$`) })).toHaveAttribute(
      "aria-current",
      "page",
    );
  };
  await tab("Hidden", "hidden");
  await expect(row).toBeVisible();
  await tab("Showing", "showing");
  await expect(office.getByRole("heading", { name: "Events & sessions", level: 1 })).toBeVisible();
  await expect(row).toHaveCount(0);

  // The casual's Open shifts no longer has it, and its page says it isn't available.
  await casual.goto(`${acme}/shifts/open`);
  await expect(casual.getByRole("heading", { name: "Open shifts", level: 1 })).toBeVisible();
  await expect(session).toHaveCount(0);
  await casual.goto(`${acme}/shifts/${shiftId}`);
  await expect(casual.getByRole("heading", { name: "This shift isn't available." })).toBeVisible();

  // Switched back on, from the event's own page (its row opens, with the way to it): the casual
  // sees it again.
  await tab("Hidden", "hidden");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await office.getByRole("link", { name: `Open the event's page: ${EVENT}` }).click();
  await expect(office.getByRole("heading", { name: EVENT, level: 1 })).toBeVisible();
  const again = office.getByRole("switch", { name: `Show ${EVENT} to casuals` });
  await again.click();
  await expect(office.getByRole("status").filter({ hasText: "Showing to casuals." })).toBeVisible();
  await expect(again).toHaveAttribute("aria-checked", "true");
  await casual.goto(`${acme}/shifts/open`);
  await expect(session).toHaveCount(1);
}

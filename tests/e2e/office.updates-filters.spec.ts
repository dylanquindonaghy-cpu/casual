import { mkdirSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  contractScene,
  endContractScene,
  unusedMobile,
} from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Phase 36.1 and 36.2 in a real browser (docs/screens.md "## Phase 36"): a resourcer of this spec's
// own looks after a contract of its own (one venue), whose match tomorrow has 3 places: one booked,
// one a casual took and cancelled (open again), one never filled. Updates: the filters in the
// address (how far back, what kind, which event), the same view from its link, the list grouped by
// day, "Low on cover" with the match alone (1 of 3 booked). The event's page: a session's "…" menu
// is solid (its background's alpha 1, nothing painted over it), dark and light; its Interested tab's
// "Casuals ask, you choose" switch turns on and off. On a phone: nothing scrolls sideways and Low on
// cover sits under the list. Screenshots of the new screens go to M36_SHOTS when it's set.

const acme = "http://acme.localhost:3100";
const SHOTS = process.env.M36_SHOTS ?? "";

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

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

// The open menu's own background (an rgb() or rgba() colour) and whether anything else is painted
// over its middle.
async function menuLook(menu: Locator) {
  return menu.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    const parts = bg.match(/[\d.]+/g)?.map(Number) ?? [];
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { alpha: parts.length === 4 ? parts[3] : 1, bg, onTop: !!top && el.contains(top) };
  });
}

test.use({ viewport: { width: 1280, height: 900 } });

test("Updates' filters in the address, Low on cover, a solid session menu and the Interested switch", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const run = `${Date.now().toString(36)}${testInfo.retry}`;
  const email = `updates.filters${testInfo.retry || ""}@example.com`;
  const name = `Filter Match ${run}`;
  const venue = `Filter Ground ${run}`;
  await addOfficeUser("acme", { email, name: "Filters Resourcer", role: "resourcer" });
  const { eventId, shiftId } = await addEventWithSession("acme", {
    name,
    site: venue,
    role: "steward",
    daysAhead: 1,
    headcount: 3,
  });
  const booked = await addSteward("acme", {
    firstName: "Bea",
    lastName: `Filter${run}`,
    mobileE164: await unusedMobile("acme", "stewards"),
  });
  const leaver = await addSteward("acme", {
    firstName: "Cal",
    lastName: `Filter${run}`,
    mobileE164: await unusedMobile("acme", "stewards"),
  });
  const { clientId } = await contractScene("acme", { tag: run, email, shiftId, workerId: booked });
  try {
    // A day's notice: under the firm's strike line, so the casual was warned of a strike.
    await bookAndCancel("acme", {
      shiftId,
      workerId: leaver,
      reason: "Travel problem",
      warning: "strike",
    });
    await officeLogin(page, email);
    await page.goto(`${acme}/office/updates`);
    await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
    const period = page.getByRole("navigation", { name: "How far back" });
    const kinds = page.getByRole("navigation", { name: "What kind" });
    const list = page.locator("section#updates-list");
    const event = page.getByRole("combobox", { name: "Which event" });
    // The defaults: the last 7 days, every event, Needs action (with its count).
    await expect(period.getByRole("link", { name: "7 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(kinds.getByRole("link", { name: /^Needs action \d+$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // A resourcer: no pay queries.
    await expect(kinds.getByRole("link", { name: /^Pay queries/ })).toHaveCount(0);
    await expect(event).toHaveValue("");
    // Today's group: the match still to fill and Cal's cancellation (its place open again).
    const today = list.getByRole("region", { name: "Today" });
    await expect(today.locator("li", { hasText: "Cal Filter" })).toContainText("cancelled");
    await expect(today.locator("li", { hasText: /^2 places still to fill/ })).toContainText(venue);
    await expect(list.getByRole("heading", { name: /^Needs action · Last 7 days/ })).toBeVisible();

    // Low on cover: the match alone (the resourcer's one contract), 1 of 3 booked, a link to it.
    const cover = page.getByRole("region", { name: "Low on cover" });
    await expect(cover).toContainText("Events in the next 7 days, least covered first.");
    const match = cover.getByRole("link", { name: new RegExp(`^${name}`) });
    await expect(match).toHaveCount(1);
    await expect(match).toContainText("1 of 3 places booked · 2 to fill");
    await expect(match).toHaveAttribute("href", `/office/events/${eventId}`);
    await expect(cover.getByRole("listitem")).toHaveCount(1);
    await noSidewaysScroll(page);
    await shot(page, "updates-laptop-dark");

    // How far back: 3 days; then what kind: cancellations, each kept in the address.
    await period.getByRole("link", { name: "3 days" }).click();
    await expect(page).toHaveURL(`${acme}/office/updates?days=3`);
    await expect(period.getByRole("link", { name: "3 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await kinds.getByRole("link", { name: /^Cancellations \d+$/ }).click();
    await expect(page).toHaveURL(`${acme}/office/updates?days=3&kind=cancellations`);
    await expect(list.getByRole("heading", { name: /^Cancellations · Last 3 days/ })).toBeVisible();
    await expect(list.locator("li", { hasText: "Cal Filter" })).toHaveCount(1);
    await expect(list.locator("li", { hasText: /still to fill/ })).toHaveCount(0);
    // Which event: the match (it has something in the period).
    await event.selectOption({ label: name });
    await expect(page).toHaveURL(
      `${acme}/office/updates?days=3&event=${eventId}&kind=cancellations`,
    );
    await expect(list.locator("li", { hasText: "Cal Filter" })).toHaveCount(1);
    // The same view from its link, in a new tab.
    const again = await context.newPage();
    await again.goto(`${acme}/office/updates?days=3&event=${eventId}&kind=cancellations`);
    await expect(again.getByRole("combobox", { name: "Which event" })).toHaveValue(eventId);
    await expect(
      again.getByRole("navigation", { name: "How far back" }).getByRole("link", { name: "3 days" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      again
        .getByRole("navigation", { name: "What kind" })
        .getByRole("link", { name: /^Cancellations \d+$/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(again.locator("section#updates-list li", { hasText: "Cal Filter" })).toHaveCount(
      1,
    );
    await again.close();
    // Back to every event.
    await event.selectOption({ label: "All events" });
    await expect(page).toHaveURL(`${acme}/office/updates?days=3&kind=cancellations`);

    // The light look of Updates.
    await context.addCookies([{ name: "sd-theme", value: "light", url: acme }]);
    await page.goto(`${acme}/office/updates`);
    await expect(page.getByRole("region", { name: "Low on cover" })).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "updates-laptop-light");

    // A session's "…" menu is solid, light then dark, and nothing is painted over it.
    for (const theme of ["light", "dark"] as const) {
      await context.addCookies([{ name: "sd-theme", value: theme, url: acme }]);
      await page.goto(`${acme}/office/events/${eventId}?tab=overview`);
      const more = page.locator('summary[aria-label^="More for "]');
      await expect(more).toHaveCount(1);
      await more.click();
      const menu = page.locator("details[open] > div").filter({ hasText: "Assign someone" });
      await expect(menu).toBeVisible();
      await menu.scrollIntoViewIfNeeded();
      const look = await menuLook(menu);
      expect(look.alpha, `${theme}: ${look.bg}`).toBe(1);
      expect(look.onTop, theme).toBe(true);
      await shot(page, `session-menu-${theme}`);
    }
    // And on Events & sessions, where Dylan saw the rows through it: the match's card's menu.
    await page.goto(`${acme}/office/events`);
    const card = page.getByRole("article", { name });
    await card.locator('summary[aria-label^="More for "]').click();
    const listMenu = card.locator("details[open] > div").filter({ hasText: "Assign someone" });
    await expect(listMenu).toBeVisible();
    await listMenu.scrollIntoViewIfNeeded();
    const listLook = await menuLook(listMenu);
    expect(listLook.alpha, listLook.bg).toBe(1);
    expect(listLook.onTop).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/events-menu-dark.png` }); // as it's seen

    // The Interested tab: the event's "Casuals ask, you choose" switch, off, on, off.
    await page.goto(`${acme}/office/events/${eventId}?tab=interested`);
    const interested = page.getByRole("region", { name: "Interested" });
    await expect(
      interested.getByRole("heading", { name: "Casuals ask, you choose", level: 2 }),
    ).toBeVisible();
    await expect(interested).toContainText(
      'Off: casuals take places on this event straight away. On: they tap "I can do this" and you choose who works each session, here and on each session\'s page.',
    );
    const ask = interested.getByRole("switch", { name: "Casuals ask, you choose" });
    await expect(ask).toHaveAttribute("aria-checked", "false");
    await expect(ask).toContainText("Off");
    await expect(interested).toContainText(
      'No one has asked yet. Switch it on and the casuals who ask show here, with "Choose who works it" for each session.',
    );
    const box = await ask.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await shot(page, "interested-laptop-dark");
    await ask.click();
    await expect(interested.getByRole("status")).toHaveText(
      'On: casuals on this event now tap "I can do this", and you choose.',
    );
    await expect(ask).toHaveAttribute("aria-checked", "true");
    await expect(ask).toContainText("On");
    await expect(interested).toContainText(
      'No one has asked yet. Casuals see "I can do this" on this event\'s sessions, and the ones who ask show here.',
    );
    await shot(page, "interested-on-laptop-dark");
    // The session's page says the same: one setting for the event.
    await page.goto(`${acme}/office/shifts/${shiftId}`);
    await expect(
      page
        .getByRole("region", { name: "This session" })
        .getByRole("switch", { name: /Casuals ask, you choose/ }),
    ).toHaveAttribute("aria-checked", "true");
    await page.goto(`${acme}/office/events/${eventId}?tab=interested`);
    await ask.click();
    await expect(interested.getByRole("status")).toHaveText(
      "Off: the first casual to tap takes a place.",
    );
    await expect(ask).toHaveAttribute("aria-checked", "false");

    // On a phone: nothing scrolls sideways; Low on cover under the list; each filter row scrolls
    // inside its own track.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["dark", "light"] as const) {
      await context.addCookies([{ name: "sd-theme", value: theme, url: acme }]);
      await page.goto(`${acme}/office/updates`);
      await expect(page.getByRole("heading", { name: "Updates", level: 1 })).toBeVisible();
      await noSidewaysScroll(page);
      const listBox = await page.locator("section#updates-list").boundingBox();
      const coverBox = await page.getByRole("region", { name: "Low on cover" }).boundingBox();
      expect(coverBox?.y ?? 0).toBeGreaterThan((listBox?.y ?? 0) + (listBox?.height ?? 0) - 1);
      const kindsBox = await page.getByRole("navigation", { name: "What kind" }).boundingBox();
      expect((kindsBox?.x ?? 0) + (kindsBox?.width ?? 0)).toBeLessThanOrEqual(390);
      await shot(page, `updates-phone-${theme}`);
      await page.goto(`${acme}/office/events/${eventId}?tab=interested`);
      await noSidewaysScroll(page);
      await shot(page, `interested-phone-${theme}`);
    }
  } finally {
    await endContractScene("acme", { shiftId, clientId });
  }
});

import type { Browser, Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  cancelOwnShift,
  setFirmSetting,
} from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// "Casuals ask, you choose" in real browsers (Phase 26.6, ses-1 to ses-6): a session of this spec's
// own (one place) whose event the resourcer switches to "Casuals ask, you choose" on the session's
// page. Two casuals of its own see "I can do this" (no "Take shift"), ask, and see "Asked: we'll
// tell you"; the office sees both under "Asked for it", says "Not this time" to one (who is told by
// message and sees "Not this time") and books the other with "Book the best 1" after a "Yes" (the
// rules run first). The forms are in the "…" menu's panels, the history a tab away. A retry makes
// its own event; the casuals and the resourcer are found again.

const acme = "http://acme.localhost:3100";
const ASHA = { firstName: "Asha", lastName: "Asker", mobileE164: "+447700900671" };
const BEN = { firstName: "Ben", lastName: "Asker", mobileE164: "+447700900672" };

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

async function casualLogin(browser: Browser, who: { mobileE164: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(`0${who.mobileE164.slice(3)}`);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(who.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);
  return page;
}

test("casuals ask, the office chooses: Not this time, then Book the best 1", async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const run = `${Date.now().toString(36)}${testInfo.retry}`;
  const event = `Ask Test Fair ${run}`;
  const email = `session.asks${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Asks Resourcer", role: "resourcer" });
  await addSteward("acme", ASHA);
  await addSteward("acme", BEN);
  const { eventId, shiftId } = await addEventWithSession("acme", {
    name: event,
    site: `Ask Test Hall ${run}`,
    role: "steward",
    daysAhead: 3,
    headcount: 1,
  });
  try {
    const office = await (await browser.newContext()).newPage();
    await officeLogin(office, email);
    await office.goto(`${acme}/office/shifts/${shiftId}`);
    await expect(office.getByRole("heading", { name: /^Steward · /, level: 1 })).toBeVisible();
    await expect(
      office.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: event }),
    ).toHaveAttribute("href", `/office/events/${eventId}`);
    // The event's setting, in "This session": off, then on.
    const session = office.getByRole("region", { name: "This session" });
    const ask = session.getByRole("switch", { name: /Casuals ask, you choose/ });
    await expect(ask).toHaveAttribute("aria-checked", "false");
    await ask.click();
    await expect(session.getByRole("status")).toHaveText(/^On: casuals on this event now tap/);
    await expect(ask).toHaveAttribute("aria-checked", "true");
    const casuals = office.getByRole("region", { name: "Casuals for this session" });
    await expect(casuals.getByText(/^Nobody has asked yet\./)).toBeVisible();

    // Each casual: "I can do this", never "Take shift"; then "Asked: we'll tell you".
    const asha = await casualLogin(browser, ASHA);
    const ben = await casualLogin(browser, BEN);
    for (const page of [asha, ben]) {
      await page.goto(`${acme}/shifts/${shiftId}`);
      await expect(page.getByRole("button", { name: "Take shift" })).toHaveCount(0);
      await page.getByRole("button", { name: "I can do this" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Asked: we'll tell you." }),
      ).toBeVisible();
    }
    await asha.goto(`${acme}/shifts/open`);
    await expect(
      asha.getByRole("listitem").filter({ hasText: event }).getByText("Asked: we'll tell you"),
    ).toBeVisible();

    // The event's Interested tab (evt-2): both waiting, under their session, with "Choose who
    // works it" back to the session's Asked for it.
    const sessionPage = office.url();
    await office.goto(`${acme}/office/events/${eventId}?tab=interested`);
    await expect(office.getByRole("link", { name: /^Interested 2$/ })).toBeVisible();
    const interested = office.getByRole("region", { name: "Interested" });
    await expect(interested.getByText("Asha Asker", { exact: true })).toBeVisible();
    await expect(interested.getByText("Ben Asker", { exact: true })).toBeVisible();
    await interested.getByRole("link", { name: /^Choose who works it: Steward, / }).click();
    await expect(office).toHaveURL(new RegExp(`/office/shifts/${shiftId}\\?show=asked$`));
    await office.goto(sessionPage);

    // The office: both under "Asked for it", most reliable first, each with Book and a menu.
    await office.reload();
    await expect(office.getByRole("link", { name: /^Asked for it 2$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(casuals.locator("[data-casual]")).toHaveCount(2);
    const benRow = casuals.locator('[data-casual="Ben Asker"]');
    await expect(benRow.getByText(/^Asked \d\d:\d\d$/)).toBeVisible();
    await expect(benRow.getByText("New: 0 shifts so far")).toBeVisible();
    // Not this time, from Ben's menu: he's told. Quiet hours off for Acme while it goes (at night
    // the message waits for them to end: CI ran it at 00:06 once), then put back as they were.
    const quietBefore = await setFirmSetting("acme", "quiet_hours", {
      start: "00:00",
      end: "00:00",
      urgent_override: true,
    });
    try {
      const toldAfter = new Date(Date.now() - 1000);
      await benRow.getByLabel("More for Ben Asker").click();
      await benRow.getByRole("button", { name: "Not this time: Ben Asker" }).click();
      await expect(
        office.getByRole("status").filter({ hasText: "Not this time: Ben Asker will be told." }),
      ).toBeVisible();
      await sentTo(BEN.mobileE164, toldAfter, /^(Not this time: you're not booked for .+)$/);
    } finally {
      await setFirmSetting("acme", "quiet_hours", quietBefore);
    }
    await ben.reload();
    await expect(ben.getByText("Not this time.")).toBeVisible();
    await expect(ben.getByRole("button", { name: "I can do this" })).toHaveCount(0);

    // Book the best 1: Asha, after a "Yes".
    await office.reload();
    await office.getByRole("button", { name: "Book the best 1" }).click();
    await expect(office.getByText(/^Book Asha Asker\? Each is checked/)).toBeVisible();
    await office.getByRole("button", { name: "Yes, book them" }).click();
    await expect(
      office.getByRole("status").filter({ hasText: "Booked: Asha Asker." }),
    ).toBeVisible();
    await office.getByRole("link", { name: /^Booked 1$/ }).click();
    await expect(casuals.getByText("Asha Asker:")).toBeVisible();
    await asha.goto(`${acme}/shifts/${shiftId}`);
    await expect(asha.getByText("You're booked on this shift")).toBeVisible();

    // The forms are in the menu's panels; the history a tab away.
    await office.getByLabel("More for this session").click();
    await office.getByRole("link", { name: "Session details" }).click();
    const panel = office.getByRole("region", { name: "Session details" });
    await expect(panel.getByLabel("Post (optional)")).toBeVisible();
    await panel.getByRole("link", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
    await office
      .getByRole("navigation", { name: "Show" })
      .getByRole("link", { name: "History" })
      .click();
    const history = office.getByRole("region", { name: "History" });
    await expect(history.getByText('Ben Asker asked for it ("I can do this").')).toBeVisible();
    await expect(
      history.getByText('Asks Resourcer said "Not this time" to Ben Asker.'),
    ).toBeVisible();

    // The event's Interested tab names who asked (nobody waiting now).
    await office.goto(`${acme}/office/events/${eventId}?tab=interested`);
    await expect(office.getByRole("link", { name: /^Interested 0$/ })).toBeVisible();
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test("on a phone: the session page fits, the panel covers the screen", async ({
  page,
}, testInfo) => {
  const run = `${Date.now().toString(36)}${testInfo.retry}`;
  const email = `session.phone${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Phone Resourcer", role: "resourcer" });
  const { shiftId } = await addEventWithSession("acme", {
    name: `Phone Ask Fair ${run}`,
    site: `Phone Ask Hall ${run}`,
    role: "steward",
    daysAhead: 4,
    headcount: 2,
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await officeLogin(page, email);
    await page.goto(`${acme}/office/shifts/${shiftId}?panel=edit`);
    const panel = page.getByRole("region", { name: "Edit this session" });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box?.width).toBe(390);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBe(0);
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

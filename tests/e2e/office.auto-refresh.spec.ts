import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addSteward,
  bookAndCancel,
  cancelOwnShift,
} from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// Office pages keep themselves up to date (round 8, the pre-build audit's aud-2), in a real browser
// with its clock in the test's hands: Cancellations open, a casual cancels behind the page's back,
// and 30 seconds later (the clock moved on, nothing pressed, no reload) the page has asked for its
// figures again: the cancellation is on it, and "Updated 10:01" in its title row has moved on from
// "Updated 10:00". The casual, the session and the resourcer are the spec's own.

const acme = "http://acme.localhost:3100";
const RHEA = { firstName: "Rhea", lastName: "Refresh", mobileE164: "+447700900693" };

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

test("a page asks for its figures again by itself every 30 seconds, and says when", async ({
  page,
}, testInfo) => {
  const run = `${Date.now().toString(36)}${testInfo.retry}`;
  const email = `auto.refresh${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email, name: "Refresh Resourcer", role: "resourcer" });
  const rhea = await addSteward("acme", RHEA);
  const { shiftId } = await addEventWithSession("acme", {
    name: `Refresh Fair ${run}`,
    site: `Refresh Hall ${run}`,
    role: "steward",
    daysAhead: 4,
    headcount: 1,
  });
  try {
    await officeLogin(page, email);
    // The page's clock from here: 10:00:40 London (GMT in November) today.
    const start = new Date();
    start.setUTCHours(10, 0, 40, 0);
    await page.clock.install({ time: start });
    await page.goto(`${acme}/office/cancellations`);
    const stamp = page.locator("#main [data-updated-slot]");
    await expect(stamp).toHaveText("Updated 10:00");
    await expect(page.getByText("Rhea Refresh")).toHaveCount(0);

    // Behind the page's back: Rhea takes the session and cancels it (enough notice: no strike).
    await bookAndCancel("acme", { shiftId, workerId: rhea, reason: "Something came up" });
    await expect(page.getByText("Rhea Refresh")).toHaveCount(0);

    // 30 seconds on, with nothing pressed: the page has its figures again.
    await page.clock.fastForward(31_000);
    // (Its card on a phone; the laptop's table row is there too, hidden.)
    await expect(
      page.locator("main").getByText("Rhea Refresh").locator("visible=true").first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(stamp).toHaveText("Updated 10:01");
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

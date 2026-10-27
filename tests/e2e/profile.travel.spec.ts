import type { Page } from "@playwright/test";
import { addOfficeUser, addSteward, clearTravel } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// The casual's travel area in a real browser, on a phone (12G.1; docs/office-v2.md 4.6): from
// Profile, a casual of this spec's own sets "Where you work" (an unknown postcode first: nothing
// saved), sees it kept after a reload, and removes it. The office's page for them shows the
// district only. The casual and the resourcer are made up and this spec's own; their travel area
// is cleared first, so a retry starts the same way. The postcodes are made up (the fake geocoder:
// never the network).

const acme = "http://acme.localhost:3100";
const CASUAL = { firstName: "Tara", lastName: "Travel", mobileE164: "+447700900618" };
const RESOURCER = "travel.resourcer@example.com";

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

test("a casual sets their travel area, the office sees only the district, and they remove it", async ({
  page,
  browser,
}) => {
  const workerId = await addSteward("acme", CASUAL);
  await clearTravel("acme", workerId);
  await addOfficeUser("acme", { email: RESOURCER, name: "Travel Resourcer", role: "resourcer" });

  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900618");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(CASUAL.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);

  await page.goto(`${acme}/profile`);
  const where = page.getByRole("region", { name: "Where you work" });
  await expect(where).toContainText("Not set yet.");
  await where.getByRole("link", { name: "Set your travel area" }).click();
  await expect(page).toHaveURL(`${acme}/profile/travel`);
  await expect(page.getByRole("heading", { name: "Where you work", level: 1 })).toBeVisible();
  await expect(
    page.getByText("The office only sees your postcode district (the first part, like ZZ1)"),
  ).toBeVisible();
  await noSidewaysScroll(page);

  // A postcode the look-up doesn't know: nothing saved.
  await page.getByLabel("Start-from postcode").fill("zz0 0aa");
  await page.getByRole("button", { name: "Save travel area" }).click();
  // (Scoped to the form: Next.js's own route announcer is an alert too.)
  await expect(where.getByRole("alert")).toHaveText(
    "We couldn't find that postcode, so nothing was saved. Check it and try again.",
  );

  await page.getByLabel("Start-from postcode").fill("zz1 1aa");
  await page.getByLabel("Car", { exact: true }).check();
  await page.getByLabel("60 minutes").check();
  await page.getByRole("button", { name: "Save travel area" }).click();
  await expect(where.getByRole("status")).toContainText("Saved. This is your travel area now.");
  await expect(where.getByRole("status")).toContainText("Acme Events Shift Team");
  await page.reload();
  await expect(page.getByLabel("Start-from postcode")).toHaveValue("ZZ1 1AA");
  await expect(page.getByLabel("Car", { exact: true })).toBeChecked();
  await expect(page.getByLabel("60 minutes")).toBeChecked();
  await expect(
    page.getByText("The office only sees your postcode district (ZZ1), never your full postcode."),
  ).toBeVisible();
  await noSidewaysScroll(page);

  await page.getByRole("link", { name: "Back to my profile" }).click();
  await expect(where).toContainText("From ZZ1 1AA · up to 60 minutes by car");

  // The office: the district, the limit and how they travel; never the full postcode.
  const office = await (await browser.newContext()).newPage();
  const sent = new Date(Date.now() - 1000);
  await office.goto(`${acme}/office/login`);
  await office.getByLabel("Your work email").fill(RESOURCER);
  await office.getByRole("button", { name: "Send me a link" }).click();
  await expect(office.getByText("Check your email.")).toBeVisible();
  await office.goto(await sentTo(RESOURCER, sent, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/));
  await office.getByRole("button", { name: "Log me in" }).click();
  await expect(office).toHaveURL(`${acme}/office`);
  // The login moves to the dashboard inside the page (router.replace), streaming it in; the
  // address changes when it first commits, and Next writes its history again when the stream ends,
  // which cancels a page load started in between (net::ERR_ABORTED, with no request of its own).
  // So the next page is loaded once that navigation is over.
  await office.waitForLoadState("networkidle");
  await office.goto(`${acme}/office/casuals/${workerId}`);
  const area = office.getByRole("region", { name: "Travel area" });
  await expect(area).toContainText("ZZ1 · 60 min, car");
  expect(await office.content()).not.toContain("ZZ1 1AA");

  // Removed by the casual, after asking.
  await where.getByRole("link", { name: "Change your travel area" }).click();
  await page.getByRole("button", { name: "Remove my travel area" }).click();
  await page.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(where.getByRole("status")).toContainText(
    "Removed. We'll show you shifts wherever they are.",
  );
  await page.goto(`${acme}/profile`);
  await expect(where).toContainText("Not set yet.");
  await office.reload();
  await expect(area).toContainText("Not set");
});

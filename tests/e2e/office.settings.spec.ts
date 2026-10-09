import type { Page } from "@playwright/test";
import { addEventWithSession, addOfficeUser, cancelOwnShift } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Settings in a real browser (12B.7): an admin saves the strikes team's email; the worker emails
// the address a link (the console outbox); someone opens it and confirms; the page then says
// "Confirmed". A site's postcode is changed. A resourcer can't open the page. The office users,
// the site and its session are this spec's own (made-up details; the session is cancelled at the
// end); a retry makes its own site.

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const ADMIN = "settings.admin@example.com";
const RESOURCER = "settings.resourcer@example.com";
const TEAM = "strikes.team@example.com";
const SITE = `Settings Test Hall ${RUN}`;

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

test("an admin saves the strikes team's email and its link confirms it; a site's postcode changes", async ({
  page,
  browser,
}) => {
  await addOfficeUser("acme", { email: ADMIN, name: "Settings Admin", role: "admin" });
  const { shiftId } = await addEventWithSession("acme", {
    name: `Settings Test Event ${RUN}`,
    site: SITE,
    role: "steward",
    daysAhead: 20,
  });
  try {
    await officeLogin(page, ADMIN);
    await (await menuLink(page, "Settings")).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("Settings · Acme Events shifts");

    const asked = new Date(Date.now() - 1000);
    // (The section is named "Strikes team email" too: its text box is the one to fill.)
    await page.getByRole("textbox", { name: "Strikes team email" }).fill(TEAM);
    await page.getByRole("button", { name: "Save and send a link" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Saved. We've sent a link to that address to confirm it" }),
    ).toBeVisible();
    await expect(page.getByText("Not confirmed", { exact: true })).toBeVisible();

    // The strikes team opens the link (in a browser of their own) and confirms.
    const link = await sentTo(
      TEAM,
      asked,
      /(https?:\/\/\S+\/confirm-email#[A-Za-z0-9_-]{28}\.[A-Za-z0-9_-]{43})/,
    );
    const team = await (await browser.newContext()).newPage();
    await team.goto(link);
    await expect(
      team.getByRole("heading", { name: "Confirm an email address for Acme Events" }),
    ).toBeVisible();
    // The link's code is gone from the address bar once read.
    await expect(team).toHaveURL(`${acme}/confirm-email`);
    await team.getByRole("button", { name: "Confirm this address" }).click();
    await expect(
      team.getByText(
        "Confirmed. Acme Events can now send records of late cancellations to this address.",
      ),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();

    // A site with no bookings to come: its postcode changes.
    const site = page.getByRole("listitem").filter({ hasText: SITE });
    await site.getByLabel("Postcode", { exact: true }).fill("zz9 9zz");
    await site.getByRole("button", { name: `Save postcode: ${SITE}` }).click();
    await expect(site.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("listitem").filter({ hasText: SITE }).getByLabel("Postcode", { exact: true }),
    ).toHaveValue("ZZ9 9ZZ");
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

test("a resourcer doesn't get Settings", async ({ page }) => {
  await addOfficeUser("acme", { email: RESOURCER, name: "Settings Resourcer", role: "resourcer" });
  await officeLogin(page, RESOURCER);
  await expect(await menuLink(page, "Events & sessions")).toBeVisible();
  await expect(await menuLink(page, "Settings")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect((await page.goto(`${acme}/office/settings`))?.status()).toBe(404);
});

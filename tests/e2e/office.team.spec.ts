import { createHash } from "node:crypto";
import { devices, type Page } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Taking office access away in a real browser (audit M21): an admin turns a resourcer's access
// off while the resourcer is logged in on their own phone. The resourcer is out at their next page;
// turning access back on doesn't bring the old session back; a role change shows at their next
// login. This spec's own admin and resourcer, so the seeded users aren't touched.

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

test("an admin turns a resourcer's access off, back on, and changes their role", async ({
  page,
  browser,
}, testInfo) => {
  // Fresh people on a retry (the first try may have left Lee off or on Payroll).
  const admin = `team.admin${testInfo.retry || ""}@example.com`;
  const leaver = `team.leaver${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email: admin, name: "Tessa Admin", role: "admin" });
  await addOfficeUser("acme", { email: leaver, name: "Lee Leaver", role: "resourcer" });

  // The resourcer, logged in on their own phone.
  const h = createHash("sha256").update(`${testInfo.testId}:leaver`).digest();
  const theirPhone = await browser.newContext({
    ...devices["Pixel 7"],
    extraHTTPHeaders: { "x-real-ip": `10.${h[0]}.${h[1]}.${h[2]}` },
  });
  try {
    const lee = await theirPhone.newPage();
    await officeLogin(lee, leaver);
    await expect(lee.getByText("You're logged in as Resourcer.")).toBeVisible();

    await officeLogin(page, admin);
    await (await menuLink(page, "Office team")).click();
    await expect(page.getByRole("heading", { name: "Office team" })).toBeVisible();
    const me = page.getByRole("listitem").filter({ hasText: admin });
    await expect(me.getByText("To change your own access, ask another admin.")).toBeVisible();
    const card = page.getByRole("listitem").filter({ hasText: leaver });
    await expect(card.getByText("Resourcer · Can log in")).toBeVisible();

    // Off: a second "Yes", then the confirmation; the resourcer is out at their next page.
    await card.getByRole("button", { name: "Turn off access" }).click();
    await expect(
      card.getByText(
        "Turn off Lee Leaver's access? They're logged out at once and can't log in until it's turned back on.",
      ),
    ).toBeVisible();
    await card.getByRole("button", { name: "Yes, turn off access" }).click();
    await expect(
      card.getByText(
        "Lee Leaver's access is off. They've been logged out everywhere and can't log in until it's turned back on.",
      ),
    ).toBeVisible();
    await expect(card.getByText("Resourcer · Access off")).toBeVisible();
    await lee.goto(`${acme}/office`);
    await expect(lee).toHaveURL(`${acme}/office/login`);

    // Back on: the old session stays ended.
    await card.getByRole("button", { name: "Turn access back on" }).click();
    await expect(
      card.getByText("Lee Leaver can log in again. They'll need a new login link."),
    ).toBeVisible();
    await expect(card.getByText("Resourcer · Can log in")).toBeVisible();
    await lee.goto(`${acme}/office`);
    await expect(lee).toHaveURL(`${acme}/office/login`);

    // A new role, seen at their next login.
    await card.getByLabel("Role").selectOption("payroll");
    await card.getByRole("button", { name: "Change role" }).click();
    await expect(
      card.getByText("Lee Leaver is now Payroll. This applies from their next page."),
    ).toBeVisible();
    await expect(card.getByText("Payroll · Can log in")).toBeVisible();
    await officeLogin(lee, leaver);
    await expect(lee.getByText("You're logged in as Payroll.")).toBeVisible();
  } finally {
    await theirPhone.close();
  }
});

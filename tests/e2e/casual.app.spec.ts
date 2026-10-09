import type { Page } from "@playwright/test";
import { addQualifiedCasual } from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";

// The casual app in a real browser, on a phone (12F.1; docs/office-v2.md 4.2, 4.6): a made-up Zoe of
// this spec's own (12I.1's demo seed brings the persona's full set) is a door supervisor, a steward
// and a CSAS officer, with her SIA licence valid, her steward qualification expiring in 12 days and
// no CSAS accreditation. Profile shows each status with its date line and what it means, then right
// to work; My shifts' "Needs updating" lists the two to sort out. Never "credential".

const acme = "http://acme.localhost:3100";
const ZOE = { firstName: "Zoe", lastName: "Adeyemi", mobileE164: "+447700900620" };

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

test("Profile shows Zoe's qualifications: one Valid, one Expiring soon, one Missing", async ({
  page,
}) => {
  await addQualifiedCasual("acme", ZOE, {
    roles: ["door_supervisor", "steward", "csas_officer"],
    held: [
      { type: "SIA_DS", daysAhead: 300 },
      { type: "STEWARD_L2", daysAhead: 12 },
    ],
  });
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900620");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(ZOE.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: "Hello Zoe" })).toBeVisible();

  // My shifts' "Needs updating": the expiring one (level 3) before the missing one (level 4).
  const needs = page.getByRole("region", { name: "Needs updating" });
  await expect(needs.getByRole("listitem")).toHaveText([
    /^Level 2 spectator safety qualification expires on \d{1,2} \w{3}( \d{4})?\. Renew it to keep getting steward shifts\.$/,
    "CSAS accreditation is missing. Needed for CSAS officer shifts.",
  ]);
  await needs.getByRole("link", { name: "See your qualifications" }).click();

  await expect(page).toHaveURL(`${acme}/profile`);
  const qualifications = page.getByRole("region", { name: "Qualifications" });
  const items = qualifications.getByRole("listitem");
  await expect(items).toHaveCount(3);
  // Worst first: Missing, Expiring soon, Valid.
  await expect(items.nth(0)).toContainText("CSAS accreditation");
  await expect(items.nth(0)).toContainText("Missing · Needed for CSAS officer shifts");
  await expect(items.nth(0)).toContainText(
    "You won't see CSAS officer shifts until the office has it.",
  );
  await expect(items.nth(1)).toContainText("Level 2 spectator safety qualification");
  await expect(items.nth(1)).toContainText(/Expiring soon · Expires \d{1,2} \w{3}/);
  await expect(items.nth(2)).toContainText("SIA door supervisor licence");
  await expect(items.nth(2)).toContainText(/Valid · Valid until \d{1,2} \w{3}/);
  await expect(qualifications).toContainText("Right to work");
  await expect(qualifications).toContainText("Not checked yet: ask the office");
  expect((await page.locator("body").innerText()).toLowerCase()).not.toContain("credential");
  await noSidewaysScroll(page);
});

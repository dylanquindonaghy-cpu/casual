import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addQualifiedCasual,
  bookAndCancel,
  cancelOwnShift,
} from "./db";
import { expect, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// The casual app in a real browser, on a phone (12F.1; docs/office-v2.md 4.2, 4.6): a made-up Zoe of
// this spec's own (12I.1's demo seed brings the persona's full set) is a door supervisor, a steward
// and a CSAS officer, with her SIA licence valid, her steward qualification expiring in 12 days and
// no CSAS accreditation. Profile shows each status with its date line and what it means, then right
// to work; My shifts' "Needs updating" lists the two to sort out. Never "credential". Then the
// office's side (docs/office-v2.md 3.7): with one strike of hers (a session of this spec's own,
// cancelled inside 48 hours), a resourcer sees her on Casuals' Need updating (stacked cards on a
// phone, the table's columns on a computer; each view's count is the number it lists) and opens her
// page: needs updating, qualifications, right to work and her strike.

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const ZOE = { firstName: "Zoe", lastName: "Adeyemi", mobileE164: "+447700900620" };
const ZOE_QUALIFICATIONS = {
  roles: ["door_supervisor", "steward", "csas_officer"],
  held: [
    { type: "SIA_DS", daysAhead: 300 },
    { type: "STEWARD_L2", daysAhead: 12 },
  ],
};
const DAY = /\d{1,2} [A-Z][a-z]{2}( \d{4})?/.source;
// Her qualifications as tags on Casuals, worst first.
const TAGS =
  /CSAS accreditation: Missing.*Level 2 spectator safety qualification: Expiring soon.*SIA door supervisor licence: Valid/;
const SUMMARY = "Level 2 spectator safety qualification: expiring soon, and 1 more";

const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

test("Profile shows Zoe's qualifications: one Valid, one Expiring soon, one Missing", async ({
  page,
}) => {
  await addQualifiedCasual("acme", ZOE, ZOE_QUALIFICATIONS);
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900620");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(ZOE.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: "Hello Zoe" })).toBeVisible();

  // My shifts' "Needs updating": the expiring one (level 3) before the missing one (level 4).
  const needs = page.getByRole("region", { name: "Needs updating" });
  // One she can upload ends "Upload it" (12F.2); CSAS is recorded by the office, so it doesn't.
  await expect(needs.getByRole("listitem")).toHaveText([
    /^Level 2 spectator safety qualification expires on \d{1,2} \w{3}( \d{4})?\. Renew it to keep getting steward shifts\. Upload it$/,
    "CSAS accreditation is missing. Needed for CSAS officer shifts.",
  ]);
  await expect(
    needs.getByRole("link", { name: "Upload your Level 2 spectator safety qualification" }),
  ).toHaveAttribute("href", "/profile/upload/STEWARD_L2");
  await expect(needs.getByRole("link", { name: /CSAS/ })).toHaveCount(0);
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

// The count in a view's link: "Need updating (3)" is 3.
const countIn = async (page: Page, name: string) => {
  const text = await page
    .getByRole("navigation", { name: "Show", exact: true })
    .getByRole("link", { name: new RegExp(`^${name} \\(\\d+\\)$`) })
    .innerText();
  return Number(/\((\d+)\)/.exec(text)?.[1]);
};

test("the office sees Zoe on Casuals and on her own page", async ({ page }, testInfo) => {
  const zoe = await addQualifiedCasual("acme", ZOE, ZOE_QUALIFICATIONS);
  const resourcer = `casuals.resourcer${testInfo.retry || ""}@example.com`;
  await addOfficeUser("acme", { email: resourcer, name: "Cass Resourcer", role: "resourcer" });
  const site = `Casuals Test Hall ${RUN}`;
  const { shiftId } = await addEventWithSession("acme", {
    name: `Casuals Test Event ${RUN}`,
    site,
    role: "steward",
    daysAhead: 1,
  });
  try {
    const { ref, assignmentId } = await bookAndCancel("acme", {
      shiftId,
      workerId: zoe,
      reason: "Travel problem",
      warning: "strike",
    });
    const strikes = 1 + testInfo.retry; // a retry cancels a session of its own too

    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/office/login`);
    await page.getByLabel("Your work email").fill(resourcer);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page.getByText("Check your email.")).toBeVisible();
    await page.goto(
      await sentTo(resourcer, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/),
    );
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${acme}/office`);

    // All, on a phone: stacked cards, as many as its link counts.
    await page.goto(`${acme}/office/casuals`);
    await expect(page.getByRole("heading", { name: "Casuals", level: 1 })).toBeVisible();
    const all = page.getByRole("region", { name: "All", exact: true });
    await expect(all.getByRole("listitem")).toHaveCount(await countIn(page, "All"));
    await noSidewaysScroll(page);

    // Need updating: Zoe's card (her expiring one first, then 1 more), as many as its link counts.
    await page
      .getByRole("navigation", { name: "Show", exact: true })
      .getByRole("link", { name: /^Need updating \(\d+\)$/ })
      .click();
    await expect(page).toHaveURL(`${acme}/office/casuals?view=needs`);
    const needsList = page.getByRole("region", { name: "Need updating", exact: true });
    const needCount = await countIn(page, "Need updating");
    expect(needCount).toBeLessThan(await countIn(page, "All"));
    await expect(needsList.getByRole("listitem")).toHaveCount(needCount);
    const card = needsList.getByRole("listitem").filter({ hasText: "Zoe Adeyemi" });
    await expect(card).toContainText(TAGS);
    await expect(card.locator("dt")).toHaveText([
      "Staff photo",
      "Travel area",
      "Live strikes",
      "Needs updating",
    ]);
    await expect(card.locator("dd")).toHaveText(["Missing", "Not set", String(strikes), SUMMARY]);
    await noSidewaysScroll(page);

    // On a computer: the table's columns, and Zoe's row; the cards are hidden.
    await page.setViewportSize({ width: 1280, height: 900 });
    const table = page.getByRole("region", { name: "Need updating: casuals" });
    await expect(table.getByRole("columnheader")).toHaveText([
      "Casual",
      "Qualifications",
      "Staff photo",
      "Travel area",
      "Live strikes",
      "Needs updating",
    ]);
    await expect(table.getByRole("row")).toHaveCount(needCount + 1);
    const row = table.getByRole("row").filter({ hasText: "Zoe Adeyemi" });
    await expect(row.getByRole("cell").nth(1)).toContainText(TAGS);
    await expect(row.getByRole("cell").nth(2)).toHaveText("Missing"); // no staff photo yet
    await expect(row.getByRole("cell").nth(3)).toHaveText("Not set");
    await expect(row.getByRole("cell").nth(4)).toHaveText(String(strikes));
    await expect(row.getByRole("cell").nth(5)).toHaveText(SUMMARY);
    await expect(needsList.getByRole("listitem")).toHaveCount(0);

    // Her page, on a phone again.
    await page.setViewportSize({ width: 390, height: 844 });
    await needsList.getByRole("link", { name: "Zoe Adeyemi" }).click();
    await expect(page).toHaveURL(`${acme}/office/casuals/${zoe}`);
    await expect(
      page.getByRole("region", { name: "Needs updating", exact: true }).getByRole("listitem"),
    ).toHaveText([
      new RegExp(`^Level 2 spectator safety qualification expires on ${DAY}\\.$`),
      "CSAS accreditation is missing. Needed for CSAS officer shifts.",
    ]);
    // Each with its status and date line, worst first.
    const quals = page.getByRole("region", { name: "Qualifications", exact: true });
    const items = quals.getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0).locator("p")).toHaveText([
      "CSAS accreditation",
      "Missing · Needed for CSAS officer shifts",
    ]);
    await expect(items.nth(1).locator("p")).toHaveText([
      "Level 2 spectator safety qualification",
      new RegExp(`^Expiring soon · Expires ${DAY}$`),
    ]);
    await expect(items.nth(2).locator("p")).toHaveText([
      "SIA door supervisor licence",
      new RegExp(`^Valid · Valid until ${DAY}$`),
    ]);
    await expect(quals).toContainText("Right to work: Not checked yet: ask the office");
    const strikesSection = page.getByRole("region", { name: "Strikes", exact: true });
    await expect(strikesSection).toContainText(
      `${strikes} live ${strikes === 1 ? "strike" : "strikes"}.`,
    );
    const strike = strikesSection.getByRole("listitem").filter({ hasText: site });
    await expect(strike).toContainText(new RegExp(`^Steward at ${site} · `));
    await expect(strike).toContainText(/Counts until /);
    await expect(strike.getByRole("link", { name: `Cancellation record ${ref}` })).toHaveAttribute(
      "href",
      `/office/cancellations/${assignmentId}`,
    );
    expect((await page.locator("main").innerText()).toLowerCase()).not.toContain("credential");
    await noSidewaysScroll(page);
  } finally {
    await cancelOwnShift("acme", shiftId);
  }
});

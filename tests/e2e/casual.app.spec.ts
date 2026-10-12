import type { Page } from "@playwright/test";
import {
  addEventWithSession,
  addOfficeUser,
  addQualifiedCasual,
  bookAndCancel,
  cancelOwnShift,
  homeScene,
  shiftsScene,
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
// The shifts list and shift page's casual (12H.2): one of this spec's own, in a role of her own.
const ZOE_PARK = { firstName: "Zoe", lastName: "Park", mobileE164: "+447700900624" };
// Home's casual (12H.1): one of this spec's own, with a booked session, an urgent one and an old photo.
const HOLLY = { firstName: "Holly", lastName: "Grant", mobileE164: "+447700900621" };
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

// Home (12H.1; docs/office-v2.md 4.2): the photo row in Needs updating with its seeded upload date,
// the urgent card and the next shift each with their site and both travel times, the next shift's
// facts, and the tab bar with the Profile dot.
test("Home shows Holly's photo row, the urgent card and her next shift in full", async ({
  page,
}) => {
  const scene = await homeScene("acme", HOLLY);
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900621");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(HOLLY.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: "Hello Holly" })).toBeVisible();

  // Needs updating: her photo, overdue, with the date it was uploaded (the firm's calendar).
  // ("3 Sep 2023": the app's own short months, not the browser's "Sept".)
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" })
    .format(scene.photoOn)
    .split("-")
    .map(Number);
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  const uploaded = `${d} ${months[(m ?? 1) - 1]} ${y}`;
  const needs = page.getByRole("region", { name: "Needs updating" });
  await expect(needs.getByRole("listitem")).toHaveText([
    new RegExp(
      `^Your staff photo is overdue\\. Last uploaded ${uploaded} · renew by ${DAY}\\. Take a new photo$`,
    ),
  ]);
  await expect(needs.getByRole("link", { name: "Take a new photo" })).toHaveAttribute(
    "href",
    "/profile#photo-heading",
  );

  // The urgent card: role · event, the site, and both travel times.
  const urgent = page.getByRole("region", { name: "Urgent: needed now, and you can take them" });
  await expect(urgent.getByRole("listitem")).toHaveCount(1);
  await expect(urgent).toContainText("Home check");
  await expect(urgent).toContainText(scene.urgent.site);
  await expect(urgent).toContainText("£13.00/hour");
  await expect(urgent).toContainText("3.1 miles · 12 min by car · 24 min by public transport");

  // Her next shift, in full.
  const next = page.getByRole("region", { name: "Your next shift" });
  await expect(next).toContainText("Home check");
  await expect(next).toContainText(scene.booked.site);
  await expect(next).toContainText("Gate 3");
  await expect(next).toContainText(/£12\.60 an hour, about £100\.80/);
  await expect(next).toContainText("Staff entrance on Mill Lane");
  await expect(next).toContainText("Black trousers and your hi-vis");
  await expect(next).toContainText("5.0 miles · 15 min by car · 30 min by public transport");
  await expect(next.getByRole("link", { name: "Ask for a change" })).toBeVisible();
  await expect(next.getByRole("button", { name: "Cancel this shift" })).toBeVisible();

  // Nothing else in her role is open, so the apply list says so.
  const apply = page.getByRole("region", { name: "Shifts you can apply for" });
  await expect(apply).toContainText(
    "Only shifts your licences and hours allow, up to 45 minutes from your home area.",
  );
  await expect(apply.getByRole("link", { name: "See all open shifts" })).toBeVisible();

  // The tab bar: Home is current; Profile carries the dot for her photo.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Profile, something needs updating" })).toBeVisible();
  await noSidewaysScroll(page);
});

// The shifts list and shift page (12H.2; docs/office-v2.md 4.3, 4.4): Zoe's Open row for the Arena
// session (role · event, site, date and time · £/hour · post, the chip, places, the travel line),
// the site filter narrowing the list, the shift's page in full, and a session she can't take with
// her status for each thing it needs.
test("Shifts: Zoe sees the Arena shift with its travel line, and its page in full", async ({
  page,
}) => {
  const scene = await shiftsScene("acme", ZOE_PARK);
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900624");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(ZOE_PARK.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: "Hello Zoe" })).toBeVisible();

  // Open: two of her three sessions (the third needs what she hasn't got).
  await page.goto(`${acme}/shifts/open`);
  const rows = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Take shift" }) });
  await expect(rows).toHaveCount(2);
  const arena = rows.filter({ hasText: "Gate A" });
  await expect(arena).toContainText(`Arena check · ${scene.event}`);
  await expect(arena).toContainText(scene.arena);
  await expect(arena).toContainText(
    /\d{1,2} [A-Z][a-z]{2}, \d\d:\d\d to \d\d:\d\d · £15\.50\/hour · Gate A/,
  );
  await expect(arena).toContainText("Needs: SIA DS");
  await expect(arena).toContainText("4 places left");
  await expect(arena).toContainText("3.1 miles · 12 min by car · 24 min by public transport");
  await expect(page.getByText("Manual handling")).toHaveCount(0);
  await noSidewaysScroll(page);

  // The site filter, as built, narrows the list: the other hall, then the Arena.
  await page.getByLabel("Site").selectOption({ label: scene.arena.replace("Arena", "Other Hall") });
  await page.getByRole("button", { name: "Show shifts" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).not.toContainText("Gate A");
  await page.getByLabel("Site").selectOption({ label: scene.arena });
  await page.getByRole("button", { name: "Show shifts" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Gate A");

  // Its page in full.
  await rows.getByRole("link", { name: `Arena check · ${scene.event}` }).click();
  await expect(page).toHaveURL(`${acme}/shifts/${scene.takeable}`);
  await expect(page.getByRole("heading", { level: 1, name: "Arena check" })).toBeVisible();
  await expect(page.getByText(`${scene.arena} · ${scene.event}`)).toBeVisible();
  await expect(page.getByText("1 Example Road, Exampleton, ZZ1 1AA")).toBeVisible();
  const fact = (label: string) =>
    page.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) });
  await expect(fact("Pay")).toBeVisible();
  await expect(page.getByText("£15.50 an hour, about £124.00")).toBeVisible();
  await expect(page.getByText("Staff entrance on Mill Lane")).toBeVisible();
  await expect(fact("Post")).toBeVisible();
  await expect(page.getByText("Black trousers and your hi-vis")).toBeVisible();
  await expect(page.getByText("4 of 4 left")).toBeVisible();
  const there = page.getByRole("region", { name: "Getting there" });
  await expect(there.getByRole("listitem")).toHaveText([
    "3.1 miles away",
    "About 12 min by car",
    "About 24 min by public transport",
  ]);
  await expect(there.getByRole("link", { name: "Open in maps" })).toBeVisible();
  const needs = page.getByRole("region", { name: "What it needs" });
  await expect(needs.getByRole("listitem")).toHaveText([
    new RegExp(`^SIA door supervisor licenceYou have it, valid until ${DAY}$`),
  ]);
  await expect(page.getByRole("button", { name: "Take shift" })).toBeVisible();
  await expect(
    page.getByText("Cancelling less than 48 hours before the start gives you a strike."),
  ).toBeVisible();
  await noSidewaysScroll(page);

  // A session she can't take, from a direct link: her status for each thing it needs.
  await page.goto(`${acme}/shifts/${scene.blocked}`);
  await expect(page.getByRole("heading", { name: "You can't take this shift:" })).toBeVisible();
  const blockedNeeds = page.getByRole("region", { name: "What it needs" }).getByRole("listitem");
  await expect(blockedNeeds).toHaveText([
    new RegExp(`^SIA door supervisor licenceYou have it, valid until ${DAY}$`),
    /^Level 2 spectator safety qualificationExpires before this shift: upload it$/,
    /^CSAS accreditationMissing: ask the office\.$/,
    /^Manual handling certificateMissing: upload it$/,
  ]);
  await expect(
    page.getByRole("link", { name: "Upload your Level 2 spectator safety qualification" }),
  ).toHaveAttribute("href", "/profile/upload/STEWARD_L2");
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

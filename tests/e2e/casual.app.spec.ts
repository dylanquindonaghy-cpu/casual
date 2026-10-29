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
// to work; Home's "Do this" counts the two to sort out (Phases 18 and 24). Never "credential". Then the
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
// Casuals' words for her (Phase 24, 24.4: each qualification's short name with its date), the
// worst first.
const TAGS = new RegExp(`CSAS: missing.*Steward L2: expires ${DAY}.*SIA DS: valid until ${DAY}`);
const SUMMARY = new RegExp(`^Steward L2: expires ${DAY}, and 1 more$`);

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
  await expect(page.getByRole("heading", { name: "Hi Zoe" })).toBeVisible();

  // Home's "Do this" (Phases 18 and 24): what needs doing as one row, the expiring one (level 3)
  // first, then how many more (the missing one, level 4), to Profile, where each is listed.
  const needs = page.getByRole("region", { name: "Do this" }).locator('[data-for-you="needs"]');
  await expect(needs).toContainText("2 things need doing");
  await expect(needs).not.toContainText("Needs doing now");
  await expect(needs).toContainText(
    /Level 2 spectator safety qualification expires on \d{1,2} \w{3}( \d{4})?\. Renew it to keep getting steward shifts\. And 1 more\./,
  );
  await needs.getByRole("link").click();

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
  // One she can upload has its link (12F.2); CSAS is recorded by the office, so it doesn't.
  await expect(items.nth(1).getByRole("link", { name: "Upload a certificate" })).toHaveAttribute(
    "href",
    "/profile/upload/STEWARD_L2",
  );
  await expect(items.nth(0).getByRole("link")).toHaveCount(0);
  await expect(qualifications).toContainText("Right to work");
  await expect(qualifications).toContainText("Not checked yet: ask the office");
  expect((await page.locator("body").innerText()).toLowerCase()).not.toContain("credential");
  await noSidewaysScroll(page);
});

// Home (12H.1; docs/office-v2.md 4.2; Phases 18, 20 and 24): "Do this" with her photo's row (its
// date), the urgent row to the urgent board (where the card has its site and both travel times),
// pay day, her next shift as a pass whose Details open its facts and actions, and the tab bar with
// the Profile count.
test("Home shows Holly's photo row, the urgent row and her next shift in full", async ({
  page,
}) => {
  const scene = await homeScene("acme", HOLLY);
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900621");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(HOLLY.mobileE164, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: "Hi Holly" })).toBeVisible();

  // The date her photo was uploaded (the firm's calendar), as Profile's photo card says it.
  // ("3 Sep 2023": the app's own short months, not the browser's "Sept".)
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" })
    .format(scene.photoOn)
    .split("-")
    .map(Number);
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  const uploaded = `${d} ${months[(m ?? 1) - 1]} ${y}`;
  // Do this: her photo, overdue (it stops her working, so "Needs doing now"), to Profile's photo,
  // her initials beside it.
  const needs = page.getByRole("region", { name: "Do this" }).locator('[data-for-you="needs"]');
  await expect(needs).toContainText("Needs doing now");
  await expect(needs).toContainText("HG");
  await expect(needs.getByRole("link")).toHaveAccessibleName(
    /^Needs doing now Renew your staff photo It was due by \d{1,2} [A-Z][a-z]{2}\.$/,
  );
  await expect(needs.getByRole("link")).toHaveAttribute("href", "/profile#photo-heading");

  // Shifts you can take: the urgent row (round 7's words: how many, near her home area, when, the
  // top rate) to the urgent board.
  const canTake = page.getByRole("region", { name: "Shifts you can take" });
  const urgentRow = canTake.getByRole("link", { name: /^1 urgent near you / });
  await expect(urgentRow).toContainText("up to £13.00/hour");
  await expect(urgentRow).toHaveAttribute("href", "/urgent");
  // Nothing else in her role is open, so the apply row says so (to Open shifts).
  await expect(canTake.getByRole("link", { name: /^No other shifts now / })).toHaveAttribute(
    "href",
    "/shifts/open",
  );
  // Pay day: the pay week's Friday (D8), to Pay.
  const pay = page.getByRole("region", { name: "Pay" }).locator('[data-for-you="pay"]');
  await expect(pay.getByRole("link")).toHaveAttribute("href", "/pay");
  await expect(pay).toContainText("Pay day");
  await expect(pay).toContainText(/Fri \d{1,2} [A-Z][a-z]{2}/);
  await expect(pay).toContainText("For this week's shifts");

  // Her next shift: a glass pass (when, what, where, the gate), Directions and Details side by
  // side, its Details opening the card under it.
  const next = page.getByRole("region", { name: "Your next shift" });
  await expect(next.getByRole("link", { name: "Directions" })).toBeVisible();
  const [dirs, more] = await Promise.all([
    next.getByRole("link", { name: "Directions" }).boundingBox(),
    next.locator("[data-pass-more] summary").boundingBox(),
  ]);
  expect(dirs && more && Math.abs(dirs.y - more.y) < 2 && dirs.x < more.x).toBe(true);
  await expect(next).toContainText("Home check");
  await expect(next).toContainText(scene.booked.site);
  await expect(next).toContainText("Gate 3");
  await expect(next.getByRole("link", { name: "Ask for a change" })).toBeHidden();
  await next.locator("[data-pass-more] summary").click();
  await expect(next).toContainText(/£12\.60 an hour, about £100\.80/);
  await expect(next).toContainText("Staff entrance on Mill Lane");
  await expect(next).toContainText("Black trousers and your hi-vis");
  await expect(next).toContainText("5.0 miles · 15 min by car · 30 min by public transport");
  await expect(next.getByRole("link", { name: "Ask for a change" })).toBeVisible();
  await expect(next.getByRole("button", { name: "Can't make it?" })).toBeVisible();

  // The tab bar: Home is current; Profile carries the count for her photo.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Profile, 1 thing needs doing" })).toBeVisible();
  await noSidewaysScroll(page);

  // The theme follows the phone (§4.1; 12H.1 audit): no cookie set, so a dark phone gets the dark
  // page and tab bar (Phase 20; D7), a light one the light; the tab bar a floating glass capsule
  // (Phase 24, round 7).
  const LIGHT = { page: "rgb(238, 241, 248)", bar: "rgba(255, 255, 255, 0.78)" }; // #eef1f8
  const DARK = { page: "rgb(7, 8, 12)", bar: "rgba(30, 30, 34, 0.8)" }; // #07080c
  const capsule = tabs.locator(":scope > div");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", DARK.page);
  await expect(capsule).toHaveCSS("background-color", DARK.bar);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", LIGHT.page);
  await expect(capsule).toHaveCSS("background-color", LIGHT.bar);

  // The urgent board's card: the site and both travel times.
  await urgentRow.click();
  const urgent = page.getByRole("main").getByRole("listitem");
  await expect(urgent).toHaveCount(1);
  await expect(urgent).toContainText("Home check");
  await expect(urgent).toContainText("£13.00/hour");
  await expect(urgent).toContainText("3.1 miles · 12 min by car · 24 min by public transport");
  // Open shifts says how far she travels (round 7's words).
  await page.goto(`${acme}/shifts/open`);
  await expect(page.getByText("Shifts you can take, up to 45 minutes from home.")).toBeVisible();

  // Profile's staff photo card (12H.3; §4.6): the photo, its dates and its status.
  await page.goto(`${acme}/`);
  await tabs.getByRole("link", { name: "Profile, 1 thing needs doing" }).click();
  await expect(page).toHaveURL(`${acme}/profile`);
  const photo = page.getByRole("region", { name: "Staff photo" });
  await expect(photo.getByRole("img", { name: "Staff photo of Holly Grant" })).toBeVisible();
  await expect(photo).toContainText(new RegExp(`Last uploaded ${uploaded} · renew by ${DAY}`));
  await expect(photo).toContainText("Overdue");
  await expect(page.getByText("To change your name or number, ask the office.")).toBeVisible();
  await noSidewaysScroll(page);
});

// The shifts list and shift page (12H.2; docs/office-v2.md 4.3, 4.4; Phase 18): Zoe's card for the
// Arena session (the time, role, event and post, the travel line, places, £/hour; what it needs is
// on its page), the site filter narrowing the list, the shift's page in full, and a session she
// can't take with her status for each thing it needs.
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
  await expect(page.getByRole("heading", { name: "Hi Zoe" })).toBeVisible();

  // Open: two of her three sessions (the third needs what she hasn't got).
  await page.goto(`${acme}/shifts/open`);
  const rows = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.locator('a[href^="/shifts/"]:not([href^="/shifts/open"])') });
  await expect(rows).toHaveCount(2);
  const arena = rows.filter({ hasText: "Gate A" });
  await expect(arena).toContainText(/\d\d:\d\d–\d\d:\d\d/);
  await expect(arena).toContainText("Arena check");
  await expect(arena).toContainText(`${scene.event}, Gate A`);
  await expect(arena).toContainText("£15.50/hour");
  await expect(arena).toContainText("4 places left");
  await expect(arena).toContainText("3.1 miles · 12 min by car · 24 min by public transport");
  await expect(page.getByText("Manual handling")).toHaveCount(0);
  await noSidewaysScroll(page);

  // How many, and "Site and role" (round 7), which opens the filters under it; the site narrows
  // the list: the other hall, then the Arena.
  await expect(page.getByText("2 shifts", { exact: true })).toBeVisible();
  const filter = page.getByRole("form", { name: "Choose a day, site or role" });
  await expect(filter).toBeHidden();
  await page.locator("[data-filters] summary").click();
  await expect(filter).toBeVisible();
  await filter
    .getByLabel("Site")
    .selectOption({ label: scene.arena.replace("Arena", "Other Hall") });
  await page.getByRole("button", { name: "Show shifts" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).not.toContainText("Gate A");
  // A site chosen: the filters stay open, showing it.
  await expect(filter).toBeVisible();
  await filter.getByLabel("Site").selectOption({ label: scene.arena });
  await page.getByRole("button", { name: "Show shifts" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Gate A");

  // Its page in full.
  await rows.getByRole("link").click();
  await expect(page).toHaveURL(`${acme}/shifts/${scene.takeable}`);
  await expect(page.getByRole("heading", { level: 1, name: "Arena check" })).toBeVisible();
  const card = page.getByRole("region", { name: "Arena check" });
  await expect(card).toContainText("Gate A");
  await expect(card).toContainText(scene.event);
  await expect(card).toContainText(scene.arena);
  await expect(page.getByText("1 Example Road, Exampleton, ZZ1 1AA")).toBeVisible();
  // A glass card for each fact (round 7).
  const payCard = page.getByRole("region", { name: "Pay" });
  await expect(payCard.getByText("£15.50 an hour, about £124.00").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Report to" })).toBeVisible();
  await expect(page.getByText("Staff entrance on Mill Lane")).toBeVisible();
  await expect(page.getByText("Black trousers and your hi-vis")).toBeVisible();
  await expect(page.getByRole("region", { name: "Places" })).toContainText("4 of 4 places left");
  const there = page.getByRole("region", { name: "Getting there, from your home area" });
  await expect(there).toContainText("3.1 miles · 12 min by car · 24 min by public transport");
  await expect(there).toContainText("12 min");
  await expect(there).toContainText("24 min");
  await expect(there.getByRole("link", { name: "Open in maps" })).toBeVisible();
  const needs = page.getByRole("region", { name: "You need" });
  await expect(needs.getByRole("listitem")).toHaveText([
    new RegExp(`^SIA door supervisor licence\\s*You have it, valid until ${DAY}$`),
  ]);
  await expect(page.getByRole("button", { name: "Take shift" })).toBeVisible();
  await expect(
    page.getByText("Cancelling less than 48 hours before the start gives you a strike."),
  ).toBeVisible();
  // Its own bar back to Open shifts (the firm's bar hides), and no tab bar on a shift's page.
  await expect(page.getByRole("link", { name: "Open shifts" })).toHaveAttribute(
    "href",
    "/shifts/open",
  );
  await expect(page.getByTestId("brand-bar")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await noSidewaysScroll(page);

  // A session she can't take, from a direct link: her status for each thing it needs.
  await page.goto(`${acme}/shifts/${scene.blocked}`);
  await expect(page.getByRole("heading", { name: "You can't take this shift:" })).toBeVisible();
  const blockedNeeds = page.getByRole("region", { name: "You need" }).getByRole("listitem");
  await expect(blockedNeeds).toHaveText([
    new RegExp(`^SIA door supervisor licence\\s*You have it, valid until ${DAY}$`),
    // Not one her roles need, so she can't send it herself: the office.
    /^Level 2 spectator safety qualification\s*Expires before this shift: ask the office\.$/,
    /^CSAS accreditation\s*Missing: ask the office\.$/,
    /^Manual handling certificate\s*Missing: upload it$/,
  ]);
  // "upload it" opens a page that takes it (her second role needs it).
  await page.getByRole("link", { name: "Upload your manual handling certificate" }).click();
  await expect(page).toHaveURL(`${acme}/profile/upload/MANUAL_HANDLING`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Upload your manual handling certificate" }),
  ).toBeVisible();
});

// The count in a view's link (its disc, Phase 24): "Need updating 3" is 3.
const countIn = async (page: Page, name: string) => {
  const text = await page
    .getByRole("navigation", { name: "Show", exact: true })
    .getByRole("link", { name: new RegExp(`^${name} \\d+$`) })
    .innerText();
  return Number(/(\d+)\s*$/.exec(text)?.[1]);
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
      .getByRole("link", { name: /^Need updating \d+$/ })
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
    // The search on the filters' row, at its right (Phase 24, 24.4); her initials beside her name.
    const tabsBox = (await page
      .getByRole("navigation", { name: "Show", exact: true })
      .boundingBox())!;
    const searchBox = (await page.getByRole("search").boundingBox())!;
    expect(searchBox.y).toBeLessThan(tabsBox.y + tabsBox.height);
    expect(tabsBox.y).toBeLessThan(searchBox.y + searchBox.height);
    expect(searchBox.x).toBeGreaterThan(tabsBox.x + tabsBox.width);
    await expect(row.getByRole("cell").nth(0)).toHaveText(/^ZA\s*Zoe Adeyemi/);

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

import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { fakeCall, fakeSms, fakeWhatsApp } from "../../scripts/fake-phone";
import { walkthroughFiles } from "../../scripts/walkthrough-files";
import { E2E_TWILIO_AUTH_TOKEN } from "../../playwright.config";
import {
  WALKTHROUGH_OUTBOX,
  WALKTHROUGH_PORT,
  WALKTHROUGH_SITE_PASSWORD,
} from "../../playwright.walkthrough.config";
import { seedFirms } from "../../src/lib/db/admin/seed-data";
import { acmeSaturday } from "../../src/lib/db/admin/seed-saturday";
import { setFirmSetting } from "./db";
import { accountMenu, DASHBOARD_HEADING, menuLink } from "./fixtures";
import { emailSentTo, readOutbox, sentTo } from "./outbox";

// docs/walkthrough.md, step by step (Phase 10 task 20): what Dylan does on his own computer, done
// here in the same order, on a fresh demo (its own database: playwright.walkthrough.config.ts) and
// a production build. The worker's steps on a phone-sized screen, the office's at desktop size
// (audit L66). Each step's number is the guide's. If the guide and the app part ways, this fails.
// (Part 1, the setup, is what the run itself does; Part 5, the production-mode run, is this run's
// own web app.)

test.describe.configure({ mode: "serial" });

const acme = `http://acme.localhost:${WALKTHROUGH_PORT}`;
const northline = `http://northline.localhost:${WALKTHROUGH_PORT}`;
const ACME_LINE = "+447700900000";
const phoneTarget = {
  baseDomain: `localhost:${WALKTHROUGH_PORT}`,
  authToken: E2E_TWILIO_AUTH_TOKEN,
  // This run is a demo server's (playwright.walkthrough.config.ts): every request needs the password.
  sitePassword: WALKTHROUGH_SITE_PASSWORD,
};

const ZOE = { typed: "07700 900122", e164: "+447700900122", name: "Zoe Usman" };
const SAM = { typed: "07700 900110", e164: "+447700900110", name: "Sam Walsh" };
const MAYA = { typed: "07700 900129", e164: "+447700900129" };
const WES = { typed: "07700 900139", e164: "+447700900139" };
// Two of the mock-up's story casuals (12I.1's seed).
const ZOE_A = { typed: "07700 900400", e164: "+447700900400" };
const KIERAN = { typed: "07700 900401", e164: "+447700900401" };
// The planner's calls go to the platform address, never a firm's own (docs/integrations.md).
const api = `http://localhost:${WALKTHROUGH_PORT}/api/v1`;

const sent = (to: string, after: Date, pattern: RegExp) =>
  sentTo(to, after, pattern, WALKTHROUGH_OUTBOX);
const emailed = (to: string, after: Date, subject: RegExp) =>
  emailSentTo(to, after, subject, WALKTHROUGH_OUTBOX);
const justBefore = () => new Date(Date.now() - 1000);

// The newest message whose body matches, to anyone, after a moment (the guide's "appears in the dev
// window" when it doesn't say who to).
async function anySent(after: Date, pattern: RegExp): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const match = (await readOutbox<{ at: string; body: string }>(WALKTHROUGH_OUTBOX))
      .filter((l) => new Date(l.at) >= after && pattern.test(l.body))
      .at(-1);
    if (match) return match.body;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no message matching ${pattern}`);
}

// A phone-sized browser for a worker, a desktop one for the office; each its own address (as Caddy
// sets X-Real-IP), so the login limits per address are each person's.
let ip = 0;
async function phone(browser: Browser): Promise<Page> {
  ip += 1;
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    extraHTTPHeaders: { "x-real-ip": `10.77.0.${ip}` },
  });
  return context.newPage();
}
async function desk(browser: Browser): Promise<Page> {
  ip += 1;
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    extraHTTPHeaders: { "x-real-ip": `10.78.0.${ip}` },
  });
  return context.newPage();
}

// Steps 10, 16, 18, 19, 20, 21: a worker's login, with the link from the "dev window".
async function workerLogin(page: Page, who: { typed: string; e164: string }) {
  const asked = justBefore();
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(who.typed);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your phone.")).toBeVisible();
  const link = await sent(
    who.e164,
    asked,
    /^Here's your Acme Events shifts link\. It works for 15 minutes and only for you: (http:\/\/acme\.localhost:\d+\/l#[A-Za-z0-9_-]{43}) /,
  );
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page.getByRole("heading", { name: /^Hi / })).toBeVisible();
}

// Steps 22, 36, 39, 42: an office login, with the link from the emailed message.
async function officeLogin(page: Page, email: string, base = acme) {
  const asked = justBefore();
  await page.goto(`${base}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  await emailed(email, asked, /office login link$/);
  const link = await sent(
    email,
    asked,
    /(http:\/\/\w+\.localhost:\d+\/office\/l#[A-Za-z0-9_-]{43})/,
  );
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  // Payroll's home is the pay dashboard: /office sends them on (12A.3).
  await expect(page).toHaveURL(new RegExp(`^${base.replace(/\./g, "\\.")}/office(/pay)?$`));
}

// "Log out" is the last thing on a casual's Profile (12H.1), and in the office's account menu (12A.2).
async function logOut(page: Page, home: string) {
  await page.goto(home.includes("/office") ? home : `${home.replace(/\/$/, "")}/profile`);
  const where = home.includes("/office") ? await accountMenu(page) : page;
  await where.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/(office\/)?login/);
}

const daysFromToday = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date(Date.now() + n * 86_400_000),
  );

// The urgent dropout (the link at the end of npm run db:reset's summary), worked out once, just after
// the run's seed (see beforeAll).
let dropout = "";
function dropoutShiftId(): string {
  const now = new Date();
  const firm = seedFirms(now).find((f) => f.slug === "acme");
  if (!firm) throw new Error("no Acme in the seed");
  return acmeSaturday(firm.workers, firm.sites, now).urgentShiftId;
}

test.beforeAll(async () => {
  dropout = dropoutShiftId();
  // Only "Send the digest now" (step 36) sends one: the worker's own tick would otherwise send it at
  // 09:00 on a weekday if the run happens then, and the step's count would be 0.
  await setFirmSetting("acme", "pay_digest", { days: [] });
  // No quiet hours, so a run at night sees the messages the guide expects at once (the offer, the
  // booking's confirmation, the answers): at night they'd wait for 07:00, as the guide says.
  await setFirmSetting("acme", "quiet_hours", {
    start: "07:00",
    end: "07:00",
    urgent_override: true,
  });
});

test("Part 2: as a worker", async ({ browser }) => {
  const page = await phone(browser);

  await test.step("10. Log in as Zoe Usman", async () => {
    await workerLogin(page, ZOE);
    await expect(page.getByRole("heading", { name: "Hi Zoe" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No shifts booked" })).toBeVisible();
  });

  await test.step("11. Take a shift", async () => {
    await page.getByRole("link", { name: "Find a shift" }).click();
    await expect(page.getByRole("heading", { name: "Open shifts" })).toBeVisible();
    // A card for one at the Arena; it opens the shift's page, where "Take shift" is.
    const arena = page.getByRole("listitem").filter({ hasText: "Acme Demo Arena" }).first();
    await arena.getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Take shift" }).click();
    await expect(page.getByText("You're booked.")).toBeVisible();
    await expect(page.getByText(/^Reference: [0-9A-F]{8}$/).first()).toBeVisible();
    await expect(page.getByText("— Acme Events Shift Team").first()).toBeVisible();
  });

  await test.step("12. Cancel it", async () => {
    await page.getByRole("link", { name: "See my shifts" }).click();
    await expect(page.getByRole("heading", { name: "Your next shift" })).toBeVisible();
    // "Can't make it?" opens the sheet: the warning, why, then "Cancel this shift".
    await page.getByRole("button", { name: "Can't make it?" }).click();
    const sheet = page.getByRole("dialog", { name: "Can't make it?" });
    await sheet.getByLabel("I'm unwell").check();
    await sheet.getByRole("button", { name: "Cancel this shift" }).click();
    // Whether it's a strike depends on when the run is (the notice); the words say which.
    await expect(
      sheet.getByText(
        /^Cancelled\. Reference [0-9A-F]{8}\. (No strike\.|A strike has been recorded\. It counts until .+\.)$/,
      ),
    ).toBeVisible();
    await expect(sheet.getByText(/^You gave \d+ (hours'|days') notice\.$/)).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("No shifts booked yet.")).toBeVisible();
  });

  await test.step("13. Your pay", async () => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pay" }).click();
    const asked = justBefore();
    await page.getByRole("button", { name: "Send me a code" }).click();
    const code = await sent(ZOE.e164, asked, /^Your Acme Events code is (\d{6})\./);
    await page.getByLabel("Your code").fill(code);
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByText("The last 8 weeks, from Acme Events's payroll.")).toBeVisible();
  });

  await test.step("14. Raise a pay query", async () => {
    await page.getByRole("link", { name: "Raise a pay query" }).click();
    await page.getByLabel("Which shift?").selectOption({ label: "A day not in the list" });
    await page.getByLabel("Which day?").fill(daysFromToday(-7));
    await page.getByLabel("Paid late or not paid").check();
    await page.getByLabel("Tell payroll more (optional)").fill("Not paid for this day yet.");
    await page.getByRole("button", { name: "Send pay query" }).click();
    await expect(page.getByText("Pay query sent.")).toBeVisible();
    await expect(page.getByText(/^Reference: [0-9A-F]{8}$/)).toBeVisible();
  });

  await test.step("15. Your profile", async () => {
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Profile" })
      .click();
    await expect(page).toHaveURL(`${acme}/profile`);
    await expect(page.getByText("Level 2 spectator safety qualification")).toBeVisible();
    await expect(page.getByText(/^Valid/).first()).toBeVisible();
    const days = page.getByRole("region", { name: "Days you can't work" });
    await page.getByLabel("A day you can't work").fill(daysFromToday(10));
    await page.getByRole("button", { name: "Mark as unavailable" }).click();
    await expect(days.getByRole("status")).toContainText(/^Marked .+ as unavailable\./);
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(days.getByRole("status")).toContainText(/ is available again\./);
    await logOut(page, `${acme}/`);
  });

  await test.step("16. Log in as Sam Walsh: his booking, its instructions, and yesterday's race day", async () => {
    await workerLogin(page, SAM);
    await expect(page.getByRole("heading", { name: "Your next shift" })).toBeVisible();
    // His pass's Details opens the card under it: the instructions among it.
    await page.locator("[data-pass-more] summary").click();
    await expect(
      page.locator("[data-pass]").getByText("Instructions", { exact: true }),
    ).toBeVisible();
    // Her bookings are on the Shifts tab (12H.1).
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Shifts" })
      .click();
    await page.getByRole("link", { name: "Past 30 days" }).click();
    await expect(page).toHaveURL(`${acme}/shifts?view=past`);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Acme Demo Racecourse" }).first(),
    ).toBeVisible();
    await page.getByRole("link", { name: "Upcoming" }).click();
  });

  await test.step("17. Ask for a change", async () => {
    await page.goto(`${acme}/`);
    await page.locator("[data-pass-more] summary").click();
    await page.getByRole("link", { name: "Ask for a change" }).first().click();
    await page.getByLabel("Change the times").check();
    await page.getByLabel("New start").fill("13:00");
    await page.getByLabel("New finish").fill("18:30");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Request sent.")).toBeVisible();
    await page.getByRole("link", { name: "See my requests" }).click();
    await expect(page).toHaveURL(`${acme}/requests`);
    await expect(page.getByText("Waiting for the office").first()).toBeVisible();
    await logOut(page, `${acme}/`);
  });

  await test.step("18. Log in as Maya Morgan: her expired licence, and the urgent shift she can't take", async () => {
    await workerLogin(page, MAYA);
    // For you's "Needs doing now" (12F.1; Phase 18), red: her licence stops her working.
    const needs = page.getByRole("region", { name: "For you" }).locator('[data-for-you="needs"]');
    await expect(needs).toContainText("Needs doing now");
    await expect(needs).toContainText("Renew your SIA door supervisor licence");
    await expect(needs).toContainText(
      /SIA door supervisor licence expired on .+\. Until it's renewed you won't see door supervisor shifts\./,
    );
    // Straight to its upload page (12F.2).
    await expect(needs.getByRole("link")).toHaveAttribute("href", "/profile/upload/SIA_DS");
    await page.goto(`${acme}/shifts/${dropout}`);
    await expect(page.getByRole("heading", { name: "You can't take this shift:" })).toBeVisible();
    await expect(page.getByText(/Your SIA door supervisor licence expired on /)).toBeVisible();
    await page.getByRole("button", { name: "Ask the office to review" }).click();
    await expect(page.getByRole("status")).toContainText(/Reference/);
    await logOut(page, `${acme}/`);
  });

  await test.step("19. Log in as Wes Doyle: take the urgent shift", async () => {
    await workerLogin(page, WES);
    // One, the 08:00 dropout; two from Friday noon, when Zoe's cancelled Saturday shift (step 12)
    // is inside the urgent window too.
    const onHome = page
      .getByRole("region", { name: "For you" })
      .getByRole("link", { name: /^Urgent( near you)? [12] shifts? / });
    await onHome.click();
    await expect(page.getByRole("heading", { name: "Urgent shifts" })).toBeVisible();
    const dropout = page.getByRole("listitem").filter({ hasText: "08:00–" });
    await expect(dropout).toHaveCount(1);
    await dropout.getByRole("link").click();
    await page.getByRole("button", { name: "Take shift" }).click();
    await expect(page.getByText("You're booked.")).toBeVisible();
    await logOut(page, `${acme}/`);
  });

  await test.step("20. Log in as Zoe Adeyemi: how far each shift is, and her travel area", async () => {
    await workerLogin(page, ZOE_A);
    // The seed's fixed travel times on each open shift: distance, then car and public transport
    // (12G.3).
    await page.goto(`${acme}/shifts/open`);
    await expect(page.getByText(/^\d+\.\d miles · .+ by car · /).first()).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Profile" })
      .click();
    await expect(page.getByRole("region", { name: "Staff photo", exact: true })).toContainText(
      "Due soon",
    );
    const where = page.getByRole("region", { name: "Where you work" });
    await where.getByRole("link", { name: "Change your travel area" }).click();
    await expect(page).toHaveURL(`${acme}/profile/travel`);
    await page.getByLabel("60 minutes").check();
    await page.getByRole("button", { name: "Save travel area" }).click();
    await expect(
      page.getByRole("region", { name: "Where you work" }).getByRole("status"),
    ).toContainText("Saved. This is your travel area now.");
    await page.getByRole("link", { name: "Back to my profile" }).click();
    await expect(page).toHaveURL(`${acme}/profile`);
    await logOut(page, `${acme}/`);
  });

  await test.step("21. Log in as Kieran Doyle: his strikes, and where he'd upload his licence", async () => {
    await workerLogin(page, KIERAN);
    // His licence ran out: the one thing to do, straight to its upload page (12F.2).
    const needs = page.getByRole("region", { name: "For you" }).locator('[data-for-you="needs"]');
    await expect(needs).toContainText("Needs doing now");
    await expect(needs).toContainText("Renew your SIA door supervisor licence");
    await expect(needs.getByRole("link")).toHaveAttribute("href", "/profile/upload/SIA_DS");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: /^Profile/ })
      .click();
    await expect(page.getByRole("region", { name: "Strikes", exact: true })).toContainText(
      "You have 2 strikes in the last 90 days.",
    );
    await page.goto(`${acme}/`);
    await needs.getByRole("link").click();
    await expect(page).toHaveURL(`${acme}/profile/upload/SIA_DS`);
    await expect(
      page.getByRole("heading", { name: "Upload your SIA door supervisor licence" }),
    ).toBeVisible();
    await logOut(page, `${acme}/`);
  });
});

test("Part 3: as the office", async ({ browser }) => {
  const page = await desk(browser);
  const now = new Date();

  await test.step("22. Log in as the resourcer", async () => {
    await officeLogin(page, "acme.resourcer@example.com");
    await expect(page.getByRole("heading", { name: DASHBOARD_HEADING, level: 1 })).toBeVisible();
  });

  await test.step("23. The dashboard", async () => {
    // The urgent places, then six charts (Phase 23); the places chart a mark for each of the next
    // 14 days.
    await expect(
      page.getByRole("heading", { name: "Urgent places to fill", level: 2 }),
    ).toBeVisible();
    const places = page.getByRole("region", { name: "Places to fill, next 2 weeks" });
    await expect(places.locator("[data-col]")).toHaveCount(14);
    // The panel a day or a count card opens (once the page is ready): a day's sessions, with the
    // way to its list (this week's strip's link until Phase 23).
    const panel = page.locator('dialog[aria-labelledby="chart-panel-title"]');
    await expect(page.locator("dialog[data-ready]")).toHaveCount(1);
    await places.locator("button[data-col]").first().click();
    await expect(panel.getByRole("link", { name: "See this day's sessions" })).toHaveAttribute(
      "href",
      /^\/office\/shifts\?from=\d{4}-\d\d-\d\d$/,
    );
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    const card = (label: string) =>
      page
        .getByRole("main")
        .getByRole("link")
        .filter({ hasText: new RegExp(`^${label}`) });
    // Today's cancellations (Zoe's, step 12, among them) are sorted: nothing to approve or decline.
    await card("Sorted today").click();
    const cancellations = panel.getByRole("link", { name: /cancellations? today/ });
    await expect(panel).toContainText("Recorded automatically, never approved or declined.");
    await cancellations.click();
    await expect(page).toHaveURL(`${acme}/office/cancellations?day=today`);
    await expect(page.getByRole("link").filter({ hasText: ZOE.name }).first()).toBeVisible();
    // Needs attention: yesterday's racecourse shifts to mark, in full on its own page.
    await page.goto(`${acme}/office`);
    await expect(page.locator("dialog[data-ready]")).toHaveCount(1);
    await card("Needs attention").click();
    await panel.getByRole("link", { name: "Mark who worked" }).click();
    await expect(
      page.getByRole("region", { name: "Who worked?" }).getByText("Acme Demo Racecourse").first(),
    ).toBeVisible();
  });

  await test.step("24. Offer a gap", async () => {
    // "Events showing to casuals" (in the list Sorted today's card opens) opens Events &
    // sessions' Showing list; "Need people" has the events with places free; an event's row
    // opens into its sessions, and a session's "…" menu has "Offer a place" while it has one free.
    await page.goto(`${acme}/office`);
    await expect(page.locator("dialog[data-ready]")).toHaveCount(1);
    await page
      .getByRole("main")
      .getByRole("link")
      .filter({ hasText: /^Sorted today/ })
      .click();
    await page
      .locator('dialog[aria-labelledby="chart-panel-title"]')
      .getByRole("link", { name: /events? showing to casuals/ })
      .click();
    await expect(page).toHaveURL(`${acme}/office/events?view=showing`);
    await page.getByRole("link", { name: /^Need people \d+$/ }).click();
    await expect(page).toHaveURL(`${acme}/office/events?view=need`);
    await page.locator('button[aria-controls$="-sessions"][aria-expanded="false"]').first().click();
    const menu = page.locator('details:has(a[href^="/office/offer/"])').first();
    await menu.locator("summary").click();
    await menu.getByRole("link", { name: "Offer a place" }).click();
    await expect(page.getByRole("heading", { name: "Offer this shift" })).toBeVisible();
    const asked = justBefore();
    await page
      .getByRole("button", { name: /^Send offer to / })
      .first()
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Offer on its way to .+\.$/ }),
    ).toBeVisible();
    await anySent(asked, /^(Shift available|URGENT): /);
    await page.getByRole("link", { name: "Back to the dashboard" }).click();
    await expect(page).toHaveURL(`${acme}/office`);
  });

  await test.step("25. Enquiries, and answer a request", async () => {
    // The shifts line's messages (the story's three, answered by the app's own replies), then the
    // requests made in the app, Enquiries' "Requests from the app" (12D.1).
    await (await menuLink(page, "Enquiries")).click();
    await expect(page).toHaveURL(`${acme}/office/enquiries`);
    for (const name of ["Kieran Doyle", "Ben Fraser", "Zoe Adeyemi"]) {
      await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Pay (always a person)").first()).toBeVisible();
    await page.getByRole("link", { name: "Requests from the app" }).click();
    await expect(page).toHaveURL(`${acme}/office/enquiries?view=app`);
    const card = page
      .getByRole("region", { name: "Waiting for an answer" })
      .locator("li", { hasText: SAM.name })
      .first();
    const asked = justBefore();
    await card.getByRole("button", { name: "Approve and tell Sam" }).click();
    await expect(card.getByText("Approved. Sam will be told.")).toBeVisible();
    await sent(SAM.e164, asked, /^(Your request \(time change, ref [0-9A-F]{8}\) is approved\.)/);
  });

  await test.step("26. Mark who worked", async () => {
    await page.goto(`${acme}/office/needs-attention`);
    const card = page
      .getByRole("region", { name: "Who worked?" })
      .locator("li", { hasText: "Acme Demo Racecourse" })
      .first();
    await card.getByRole("link").first().click();
    await expect(page.getByText("Mark who worked it and who didn't attend.")).toBeVisible();
    const mark = page.getByRole("button", { name: /^Mark as worked: / }).first();
    // The person's name is in the button's label (it shows "Mark as worked").
    const name = ((await mark.getAttribute("aria-label")) ?? "").replace(/^Mark as worked: /, "");
    await mark.click();
    await expect(page.getByText(`Marked ${name} as worked.`)).toBeVisible();
  });

  let booked = "";
  await test.step("27. Make a shift and book someone", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Events & sessions")).click();
    await page.getByRole("link", { name: "All shifts by day" }).click();
    await page.getByRole("link", { name: "New shift" }).click();
    await page.getByLabel("Date").fill(daysFromToday(9));
    await page.getByLabel("Role").fill("steward");
    await page.getByLabel("Start").fill("10:00");
    await page.getByLabel("Finish").fill("18:00");
    await page.getByLabel("Places").fill("2");
    await page.getByRole("button", { name: "Create shift" }).click();
    await expect(page).toHaveURL(/\/office\/shifts\/[0-9a-f-]{36}$/);
    await expect(page.getByText("0 of 2 booked · Open")).toBeVisible();
    const options = await page
      .getByLabel("Who?")
      .locator("option:not([disabled])")
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
    for (const value of options.slice(0, 8)) {
      await page.getByLabel("Who?").selectOption(value);
      await page.getByRole("button", { name: "Check" }).click();
      const yes = page.getByText(/^The rules say (.+) can work this shift\.$/);
      if (await yes.isVisible()) {
        booked = ((await yes.textContent()) ?? "").replace(/^The rules say (.+) can work.*$/, "$1");
        break;
      }
    }
    expect(booked).not.toBe("");
    const asked = justBefore();
    await page.getByRole("button", { name: `Assign ${booked}` }).click();
    await expect(
      page.getByText(`${booked} is booked on this shift. They'll get a message to say so.`),
    ).toBeVisible();
    await anySent(asked, /^Confirmed: .+ \(steward\)\. Details and instructions: /);
    await page.reload();
  });

  await test.step("28. Move it, then cancel the booking", async () => {
    await page.getByLabel("New start").fill("11:00");
    await page.getByLabel("New finish").fill("19:00");
    await page
      .locator("#move-reason")
      .selectOption({ label: "The event's times or place changed" });
    await page.getByRole("button", { name: "Move for everyone booked" }).click();
    await expect(page.getByText(/^Moved\. 1 person booked will be told\./)).toBeVisible();
    await page.reload();
    await page.getByText(`Cancel ${booked}'s booking`, { exact: true }).click();
    await page
      .locator("details[open]")
      .getByLabel("Why?")
      .selectOption({ label: "Weather or safety" });
    await page.getByRole("button", { name: `Yes, cancel ${booked}'s booking` }).click();
    await expect(
      page.getByText(
        new RegExp(`^Cancelled ${booked}'s booking with \\d+ days' notice\\. They'll be told\\.$`),
      ),
    ).toBeVisible();
  });

  await test.step("29. A whole event, and an import", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Events & sessions")).click();
    await page.getByRole("link", { name: "Add shifts" }).click();
    await page.getByLabel("Event name").fill("Cup final");
    await page.getByLabel("Date").fill(daysFromToday(13));
    const lines = page.getByRole("group");
    await lines.nth(0).getByLabel("Role").fill("steward");
    await lines.nth(0).getByLabel("Start").fill("08:00");
    await lines.nth(0).getByLabel("Finish").fill("16:00");
    await lines.nth(1).getByLabel("Role").fill("door supervisor");
    await lines.nth(1).getByLabel("Start").fill("20:00");
    await lines.nth(1).getByLabel("Finish").fill("04:00");
    await page.getByRole("button", { name: "Create these shifts" }).click();
    await expect(page.getByText("2 shifts created.")).toBeVisible();
    await page.goto(`${acme}/office/events`);
    await page.getByRole("link", { name: "Import shifts" }).click();
    await page.getByLabel("Your file (.csv or .xlsx)").setInputFiles({
      name: "shifts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(walkthroughFiles(now).shifts),
    });
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(
      page.getByText("This file would add 2 shifts, change 0, leave 0 as they are and skip 0."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Import these shifts" }).click();
    await expect(
      page.getByText("Imported: 2 shifts added, 0 changed, 0 left as they were, 0 skipped."),
    ).toBeVisible();
  });

  await test.step("30. Cancellations: Zoe's record", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Cancellations")).click();
    await expect(page.getByRole("heading", { name: "Cancellations", level: 1 })).toBeVisible();
    await page.getByRole("link").filter({ hasText: ZOE.name }).first().click();
    await expect(page).toHaveURL(/\/office\/cancellations\/[^/]+$/);
    await expect(page.getByRole("heading", { name: /^Cancellation / })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
  });

  await test.step("31. Strikes: Kieran's two, and Priya's for review", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Strikes")).click();
    await expect(page.getByRole("heading", { name: "Strikes", level: 1 })).toBeVisible();
    const casual = (name: string) =>
      page.getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
    await expect(casual("Kieran Doyle")).toContainText("2 live strikes");
    await page.getByRole("link", { name: "Needs review", exact: true }).click();
    const priya = casual("Priya Shah");
    await expect(priya).toContainText("Needs review");
    await priya.locator('a[href^="/office/cancellations/"]').first().click();
    await page.getByRole("button", { name: "Keep strike" }).click();
    await expect(page.getByRole("status")).toHaveText("Kept, and marked as reviewed.");
  });

  await test.step("32. Casuals", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Casuals")).click();
    const find = page.getByRole("region", { name: "Find a casual" });
    await find.getByLabel("Name or mobile number").fill("Zoe");
    await find.getByRole("button", { name: "Find" }).click();
    await find.getByRole("link", { name: ZOE.name }).click();
    await expect(page.getByRole("heading", { name: ZOE.name })).toBeVisible();
    // The uploads waiting for a person (the story's): approve Ben's new photo.
    await page.goto(`${acme}/office/casuals`);
    await page.getByRole("link", { name: /^Uploads to check/ }).click();
    const waiting = page.getByRole("region", { name: "Uploads to check", exact: true });
    await expect(waiting.getByRole("listitem").filter({ hasText: "Leah Ward" })).toBeVisible();
    await waiting
      .getByRole("listitem")
      .filter({ hasText: "Ben Fraser" })
      .getByRole("link", { name: "Check it" })
      .click();
    await expect(page.getByRole("heading", { name: "Ben Fraser", level: 1 })).toBeVisible();
    const photo = page
      .getByRole("region", { name: "Uploads to check", exact: true })
      .getByRole("listitem")
      .filter({ hasText: "Staff photo" });
    await photo.getByRole("button", { name: "Approve staff photo" }).click();
    await expect(photo.getByRole("status")).toHaveText("Approved. It counts from now.");
  });

  await test.step("33. The action log", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Action log")).click();
    await expect(page.getByRole("heading", { name: "Action log" })).toBeVisible();
    await page.getByLabel("Type").selectOption({ label: "Cancellations" });
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/type=cancellations/);
    await expect(
      page.getByText(`${ZOE.name} cancelled, with `, { exact: false }).first(),
    ).toBeVisible();
  });

  await test.step("34. The notice report: the office's cancellation (audit L25) and Zoe's", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Notice report")).click();
    await expect(
      page.getByRole("heading", { name: "Notice and cancellation report" }),
    ).toBeVisible();
    await expect(page.getByText(/^Short notice means under 48 hours/)).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Weather or safety" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: ZOE.name }).first()).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download as a spreadsheet (CSV)" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  await test.step("35. Pilot metrics", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Pilot metrics")).click();
    const baseline = page.getByRole("region", { name: "Baseline (week 0)" });
    await baseline.getByLabel("Staff emails per day").fill("40");
    await baseline.getByRole("button", { name: "Save the baseline" }).click();
    await expect(baseline.getByText("Baseline saved.")).toBeVisible();
    await logOut(page, `${acme}/office`);
  });

  await test.step("36. Log in as payroll: the pay queries, and the digest", async () => {
    await officeLogin(page, "acme.payroll@example.com");
    // Payroll's home: the pay dashboard (12A.3).
    await expect(page).toHaveURL(`${acme}/office/pay`);
    await expect(page.getByRole("heading", { name: "Pay dashboard", level: 1 })).toBeVisible();
    await (await menuLink(page, "Pay queries")).click();
    await expect(page).toHaveURL(`${acme}/office/pay-queries`);
    await expect(
      page.getByRole("region", { name: /^7 queries: wrong rate, the week of / }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", {
        name: /^2 queries: hours missing, the week of .+, at Acme Demo Shopping Centre\.$/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: /^1 query: something else, the week of / }),
    ).toBeVisible();
    // Zoe's, from step 14 (the only "paid late" one).
    await expect(
      page
        .getByRole("region", { name: /^1 query: paid late or not paid, the week of / })
        .getByText(ZOE.name),
    ).toBeVisible();
    // "Send the digest now" sends what's new: everything, or only Zoe's when the worker's 09:00
    // weekday digest went first (it can, while this run's app was being built).
    const digest = page.getByRole("region", { name: "Payroll digest" });
    const asked = justBefore();
    await digest.getByRole("button", { name: "Send the digest now" }).click();
    await expect(digest.getByRole("status")).toHaveText(
      /^Sending the digest now: \d+ new quer(y|ies) to 1 person\./,
    );
    await emailed("acme.payroll@example.com", asked, /^Acme Events: \d+ new pay quer(y|ies)$/);
  });

  await test.step("37. Answer a group", async () => {
    const group = page.getByRole("region", { name: /^7 queries: wrong rate, the week of / });
    await group
      .getByLabel("Tell them what payroll did")
      .fill("We've added the difference to Friday's pay.");
    const asked = justBefore();
    await group.getByRole("button", { name: "Mark as sorted and tell them" }).click();
    await expect(group.getByRole("status")).toHaveText(
      "Marked as sorted: 7 queries. Each person gets a message saying payroll has answered, and sees your note on their pay page.",
    );
    // Sam Walsh is one of them.
    await sent(SAM.e164, asked, /^(Payroll has answered your pay query \(ref [0-9A-F]{8}\)\.)/);
  });

  await test.step("38. Import pay records", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Import pay records")).click();
    await page.getByLabel("Your file (.csv or .xlsx)").setInputFiles({
      name: "pay.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(walkthroughFiles(now).pay),
    });
    await page.getByRole("button", { name: "Check the file" }).click();
    const status = page.getByRole("status");
    await expect(status).toContainText(
      "This file would add 1 pay line, change 0, leave 0 as they are and skip 0.",
    );
    await page.getByRole("button", { name: "Import these pay records" }).click();
    await expect(status).toContainText(
      "Imported: 1 pay line added, 0 changed, 0 left as they were, 0 skipped.",
    );
    await logOut(page, `${acme}/office`);
  });

  await test.step("39. Log in as the admin: the office team, and Zoe's data", async () => {
    await officeLogin(page, "acme.admin@example.com");
    await (await menuLink(page, "Office team")).click();
    await expect(page.getByRole("heading", { name: "Office team" })).toBeVisible();
    for (const name of ["Admin (demo)", "Resourcer (demo)", "Payroll (demo)"]) {
      await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
    }
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Data requests")).click();
    await page.getByLabel("Name or mobile number").fill(ZOE.typed);
    await page.getByRole("button", { name: "Find" }).click();
    await page.getByRole("link", { name: ZOE.name }).click();
    await expect(page.getByRole("heading", { name: ZOE.name })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download (CSV, opens in Excel)" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  await test.step("40. Settings: the strikes team's email, confirmed by its link", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Settings")).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const box = page.getByRole("textbox", { name: "Strikes team email" });
    await expect(box).toHaveValue("strikes@acme-events.example");
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    const team = "strikes.team@acme-events.example";
    const asked = justBefore();
    await box.fill(team);
    await page.getByRole("button", { name: "Save and send a link" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Saved. We've sent a link to that address to confirm it" }),
    ).toBeVisible();
    await expect(page.getByText("Not confirmed", { exact: true })).toBeVisible();
    const link = await sent(
      team,
      asked,
      /(http:\/\/\S+\/confirm-email#[A-Za-z0-9_-]{28}\.[A-Za-z0-9_-]{43})/,
    );
    const opened = await desk(browser);
    await opened.goto(link);
    await opened.getByRole("button", { name: "Confirm this address" }).click();
    await expect(
      opened.getByText(
        "Confirmed. Acme Events can now send records of late cancellations to this address.",
      ),
    ).toBeVisible();
    await opened.context().close();
    await page.reload();
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Postcode", { exact: true }).first()).toBeVisible();
  });

  await test.step("41. Connect a planner: a key, a session sent with it, then revoked", async () => {
    await page.goto(`${acme}/office`);
    await (await menuLink(page, "Integrations")).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Demo planner");
    await page.getByRole("button", { name: "Create a key" }).click();
    const shown = page.locator("code").filter({ hasText: /shiftdesk_/ });
    const key = ((await shown.textContent()) ?? "").trim();
    expect(key).toMatch(/^shiftdesk_[A-Za-z0-9_-]{43}$/);
    // The guide's curl, as the planner (server to server).
    const day = daysFromToday(10);
    const answer = await page.request.put(`${api}/sessions/DEMO-STEWARD-1`, {
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-real-ip": "10.79.0.1",
      },
      data: JSON.stringify({
        event: { ref: "DEMO-EVENT", name: "Planner demo day" },
        site: { name: "Acme Demo Arena" },
        role: "steward",
        starts_at: `${day}T10:00:00+00:00`,
        ends_at: `${day}T16:00:00+00:00`,
        places: 2,
        status: "open",
      }),
    });
    expect(answer.status()).toBe(201);
    expect(await answer.text()).toMatch(/^\{"result":"created","session":\{/);
    await page.reload();
    await expect(
      page.getByText(/^Connected by API · last change from your planner /),
    ).toBeVisible();
    await (await menuLink(page, "Events & sessions")).click();
    await expect(page.getByText("Planner demo day").first()).toBeVisible();
    await page.goto(`${acme}/office/settings/integrations`);
    // At desktop size the keys are a table (stacked cards only on a phone).
    await page.getByRole("button", { name: "Revoke Demo planner" }).click();
    await page.getByRole("button", { name: "Yes, revoke it" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Revoked. That key stopped working at once." }),
    ).toBeVisible();
    await logOut(page, `${acme}/office`);
  });

  await test.step("42. Northline: the short-notice cancellation by the office (audit L25)", async () => {
    await officeLogin(page, "northline.admin@example.com", northline);
    await (await menuLink(page, "Notice report")).click();
    const row = page.getByRole("row").filter({ hasText: "Weather or safety" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Yes"); // short notice
    await logOut(page, `${northline}/office`);
  });
});

test("Part 4: the fake phone", async ({ browser }) => {
  const page = await desk(browser);

  await test.step("43. A WhatsApp from a worker", async () => {
    const asked = justBefore();
    const answer = await fakeWhatsApp(phoneTarget, {
      from: ZOE.e164,
      to: ACME_LINE,
      text: "Any shifts this weekend?",
    });
    expect(answer.status).toBe(200);
    await sent(
      ZOE.e164,
      asked,
      // Her personal reply (12D.2): the list depends on the seed and today; the frame doesn't.
      /^(Hi Zoe, [\s\S]*(?:Take one here|All open shifts): http:\/\/acme\.localhost:\d+\/shifts\/open\nAutomatic reply\. Send OFFICE to reach a person\.\n— Acme Events Shift Team)$/,
    );
  });

  await test.step("44. A WhatsApp from a number nobody has", async () => {
    const stranger = "+447700900999";
    const asked = justBefore();
    const answer = await fakeWhatsApp(phoneTarget, {
      from: stranger,
      to: ACME_LINE,
      text: "Hi it's Sam, new phone",
    });
    expect(answer.status).toBe(200);
    await sent(stranger, asked, /^(Thanks for your message\. We don't recognise this number\.)/);
    await officeLogin(page, "acme.resourcer@example.com");
    // Enquiries (12D.1): it needs a person; its page says how it was answered.
    await (await menuLink(page, "Enquiries")).click();
    await page.getByRole("link", { name: /^Need a person \(\d+\)$/ }).click();
    const row = page
      .getByRole("region", { name: "Need a person" })
      .getByRole("listitem")
      .filter({ hasText: "“Hi it's Sam, new phone”" })
      .last();
    await expect(row).toContainText("Unknown number");
    await expect(row).toContainText("Passed to a person, waiting");
    await row.getByRole("link", { name: "Unknown number" }).click();
    await expect(page.getByRole("region", { name: "How it was answered" })).toContainText(
      "Not one of your casuals' numbers: passed to a person.",
    );
    await expect(page.getByRole("region", { name: "Answer it" })).toBeVisible();
  });

  await test.step("45. A call with a voicemail", async () => {
    const asked = justBefore();
    const call = await fakeCall(phoneTarget, {
      from: ZOE.e164,
      to: ACME_LINE,
      voicemail: "Please call me about Saturday",
    });
    expect(call.answer.status).toBe(200);
    expect(call.heard[0]).toMatch(/^Thanks for calling Acme Events\. We've just sent a link/);
    expect(call.voicemail?.status).toBe(200);
    await sent(ZOE.e164, asked, /(http:\/\/acme\.localhost:\d+\/l#[A-Za-z0-9_-]{43})/);
    await sent(
      ZOE.e164,
      asked,
      /^(Thanks for your voicemail\. The office will see it and get back to you\. Ref [0-9A-F]{8}\.)/,
    );
    // Enquiries' Need a person (12D.1): the voicemail's words, then its page with the warning.
    await (await menuLink(page, "Enquiries")).click();
    await page.getByRole("link", { name: /^Need a person \(\d+\)$/ }).click();
    const voicemail = page
      .getByRole("region", { name: "Need a person" })
      .getByRole("listitem")
      .filter({ hasText: "“Please call me about Saturday”" })
      .last();
    await expect(voicemail).toContainText("Zoe Usman");
    await voicemail.getByRole("link", { name: "Zoe Usman" }).click();
    await expect(
      page.getByText("From a voicemail on the shifts line.", { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "How it was answered" })).toContainText(
      "A voicemail: always passed to a person.",
    );
  });

  await test.step("46. A text: STOP, then START", async () => {
    let asked = justBefore();
    expect(
      (await fakeSms(phoneTarget, { from: ZOE.e164, to: ACME_LINE, text: "STOP" })).status,
    ).toBe(200);
    await sent(ZOE.e164, asked, /^(You won't get texts from Acme Events now\.)/);
    asked = justBefore();
    expect(
      (await fakeSms(phoneTarget, { from: ZOE.e164, to: ACME_LINE, text: "START" })).status,
    ).toBe(200);
    await sent(ZOE.e164, asked, /^(Texts from Acme Events are back on\.)/);
  });
});

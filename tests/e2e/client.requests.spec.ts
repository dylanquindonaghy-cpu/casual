import { mkdirSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { addOfficeUser, clientScene, endClientScene } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { sentTo } from "./outbox";

// Client logins and client requests in a real browser (Phase 36.3, 36.4; docs/screens.md "## Phase
// 36", "36.3 and 36.4 screens"). An admin adds a client login on a contract and sends a link; the
// client logs in through it and sees their event in numbers (never a casual's name), asks for 2 more
// places on a session starting within 48 hours (the urgent note shows first) and sees it Waiting; a
// resourcer sees it on Client requests (the top bar's chip and the menu's count) and in Updates'
// Client requests chip, accepts it with the places offered, and the client sees Accepted. Then a
// decline with a reason, a question and its answer, a planner's session's request on "To do in …"
// and Mark done, and Log out. No sideways scroll at 390px or 1280px. The contract, venue, event and
// sessions are this spec's own (made up; cancelled and removed at the end).

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
const ADMIN = `client.admin.${RUN}@example.com`;
const RESOURCER = `client.resourcer.${RUN}@example.com`;
const CLIENT = `priya.${RUN}@client-spec.example`;
const SHOTS =
  "/tmp/claude-0/-home-user-casual/168a269a-728b-52bc-b2a4-cb7f7bbe6fae/scratchpad/m36/built";
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 900 };

const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const noSidewaysScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

async function context(
  browser: Browser,
  viewport: { width: number; height: number },
  ip: string,
  theme?: "light" | "dark",
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, locale: "en-GB" });
  await ctx.setExtraHTTPHeaders({ "x-real-ip": ip });
  if (theme) {
    await ctx.addCookies([{ name: "sd-theme", value: theme, domain: "acme.localhost", path: "/" }]);
  }
  return ctx;
}

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

// Chooses the session whose label has `words` in "Which session?".
async function pickSession(page: Page, words: string) {
  const select = page.getByLabel("Which session?");
  const label = (await select.locator("option", { hasText: words }).first().textContent()) ?? "";
  await select.selectOption({ label });
}

// A request the client sends from "Ask for a change" on their event.
async function ask(
  page: Page,
  eventId: string,
  kind: string,
  fill: (page: Page) => Promise<void>,
): Promise<void> {
  await page.goto(`${acme}/client/requests/new?event=${eventId}`);
  await page.getByRole("radio", { name: kind }).check();
  await fill(page);
  await page.getByRole("button", { name: "Send to Acme Events" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sent to Acme Events." })).toBeVisible();
}

// The chosen request's panel on Client requests, picked from the list by its words.
async function choose(page: Page, tab: string | null, words: string) {
  await page.goto(`${acme}/office/client-requests${tab ? `?tab=${tab}` : ""}`);
  await page
    .locator("#client-requests-list li")
    .filter({ hasText: words })
    .first()
    .getByRole("link")
    .click();
  const panel = page.locator("#request-panel");
  await expect(panel.getByRole("heading", { level: 2 })).toContainText(words);
  return panel;
}

test("a client logs in, asks for places and gets answers; the office accepts, declines, asks and marks done", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await addOfficeUser("acme", { email: ADMIN, name: "Client Spec Admin", role: "admin" });
  await addOfficeUser("acme", {
    email: RESOURCER,
    name: "Client Spec Resourcer",
    role: "resourcer",
  });
  const scene = await clientScene("acme", { tag: RUN, hours: 30 });
  const adminCtx = await context(browser, PHONE, "10.36.3.1");
  const clientPhone = await context(browser, PHONE, "10.36.3.2");
  const officeCtx = await context(browser, LAPTOP, "10.36.3.3", "dark");
  try {
    // --- An admin adds a client login on the contract and sends a link. ---------------------------
    const admin = await adminCtx.newPage();
    await officeLogin(admin, ADMIN);
    await (await menuLink(admin, "Settings")).click();
    await admin.getByRole("link", { name: `Client logins for ${scene.contractName}` }).click();
    await expect(admin.getByRole("heading", { name: scene.contractName, level: 1 })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Client logins", level: 2 })).toBeVisible();
    await expect(admin.getByText("No client logins yet. Add one below.")).toBeVisible();
    await admin.getByLabel("Their name").fill("Priya Spec");
    await admin.getByLabel("Their work email").fill(CLIENT);
    await admin.getByRole("button", { name: "Add a client login" }).click();
    await expect(
      admin.getByRole("status").filter({ hasText: "Added Priya Spec. Send them a link" }),
    ).toBeVisible();
    await expect(admin.getByText(`${CLIENT} · not logged in yet`)).toBeVisible();
    const asked = new Date(Date.now() - 1000);
    await admin.getByRole("button", { name: "Send link to Priya Spec" }).click();
    await expect(
      admin.getByRole("status").filter({ hasText: "Sent. Priya Spec has a login link by email." }),
    ).toBeVisible();
    await noSidewaysScroll(admin);
    await shot(admin, "built-contract-logins-phone");

    // --- The client logs in through the link and sees their event in numbers. --------------------
    const link = await sentTo(CLIENT, asked, /(https?:\/\/\S+\/client\/l#[A-Za-z0-9_-]{43})/);
    const client = await clientPhone.newPage();
    await client.goto(link);
    await client.getByRole("button", { name: "Log me in" }).click();
    await expect(client).toHaveURL(`${acme}/client`);
    await expect(client.getByRole("heading", { name: "Your events", level: 1 })).toBeVisible();
    await expect(client.getByText("Acme Events · Client")).toBeVisible();
    await expect(client.getByText("Priya Spec", { exact: true })).toBeVisible();
    // Light by default.
    await expect(client.locator("html")).toHaveAttribute("data-theme", "light");
    const card = client.locator("li").filter({ hasText: scene.eventName });
    await expect(card).toContainText("2 of 6 booked");
    await expect(card).toContainText("4 to fill");
    for (const name of scene.casuals) await expect(client.locator("body")).not.toContainText(name);
    await noSidewaysScroll(client);
    await shot(client, "built-client-events-phone");

    await card.getByRole("link", { name: scene.eventName }).click();
    await expect(client.getByRole("heading", { name: scene.eventName, level: 1 })).toBeVisible();
    await expect(client.getByText("North Gate · Steward")).toBeVisible();
    for (const name of scene.casuals) await expect(client.locator("body")).not.toContainText(name);
    await noSidewaysScroll(client);
    await shot(client, "built-client-event-phone");

    // 2 more places on North Gate: it starts within 48 hours, so the urgent note shows first.
    await client.getByRole("link", { name: "Add places" }).click();
    await expect(client.getByRole("heading", { name: "Ask for a change", level: 1 })).toBeVisible();
    await expect(client.getByRole("radio", { name: "More places on a session" })).toBeChecked();
    await client.getByRole("button", { name: "Send to Acme Events" }).click();
    await expect(client.getByText("Choose a session.")).toBeVisible();
    await pickSession(client, "North Gate");
    await expect(client.getByText("It has 4 places, 2 booked.")).toBeVisible();
    await client.getByLabel("How many more?").fill("2");
    await client.getByLabel("Why (optional)").fill("Category raised to B.");
    await expect(client.getByText("This starts within 2 days.")).toBeVisible();
    await expect(
      client.getByText(
        "Acme Events will treat it as urgent. You'll get an answer here and by email.",
      ),
    ).toBeVisible();
    await noSidewaysScroll(client);
    await shot(client, "built-client-ask-phone");
    await client.getByRole("button", { name: "Send to Acme Events" }).click();
    await expect(
      client.getByRole("status").filter({
        hasText:
          "Sent to Acme Events. It starts soon or affects people already booked, so they'll treat it as urgent.",
      }),
    ).toBeVisible();
    await client.getByRole("link", { name: "See your requests" }).click();
    const mine = client.locator("#your-requests li").first();
    await expect(mine).toContainText("Waiting");
    await expect(mine).toContainText("+2 places");
    await noSidewaysScroll(client);

    // The client's pages on a laptop.
    const clientLaptop = await clientPhone.newPage();
    await clientLaptop.setViewportSize(LAPTOP);
    await clientLaptop.goto(`${acme}/client`);
    await noSidewaysScroll(clientLaptop);
    await shot(clientLaptop, "built-client-events-laptop");
    await clientLaptop.goto(`${acme}/client/events/${scene.eventId}`);
    await expect(clientLaptop.getByRole("columnheader", { name: "Location" })).toBeVisible();
    await expect(clientLaptop.getByRole("cell", { name: "2/4" })).toBeVisible();
    for (const name of scene.casuals) {
      await expect(clientLaptop.locator("body")).not.toContainText(name);
    }
    await expect(
      clientLaptop.getByRole("heading", { name: "Waiting for Acme Events" }),
    ).toBeVisible();
    await noSidewaysScroll(clientLaptop);
    await shot(clientLaptop, "built-client-event-laptop");
    await clientLaptop.goto(`${acme}/client/requests`);
    await noSidewaysScroll(clientLaptop);
    await shot(clientLaptop, "built-client-requests-laptop");

    // --- A resourcer sees it: the top bar's chip, the menu, Updates; accepts it. ----------------
    const office = await officeCtx.newPage();
    await officeLogin(office, RESOURCER);
    const chip = office
      .locator("header [data-bar-counts]")
      .getByRole("link", { name: /^Client requests \d+$/ });
    await expect(chip).toBeVisible();
    await expect(await menuLink(office, "Client requests")).toBeVisible();
    await office.goto(`${acme}/office/updates?kind=client-requests`);
    const row = office.locator("li").filter({ hasText: `Client request: +2 places` }).filter({
      hasText: scene.contractName,
    });
    await expect(row).toContainText("urgent · starts within 2 days");
    await row.getByRole("link", { name: "Answer" }).click();
    await expect(office).toHaveURL(/\/office\/client-requests\?request=/);
    const panel = office.locator("#request-panel");
    await expect(panel).toContainText("What accepting does");
    await expect(panel).toContainText("4 places become 6 (2 booked, 4 to fill).");
    await expect(panel).toContainText("Urgent · starts within 2 days");
    await expect(panel).toContainText("Their note: “Category raised to B.”");
    await noSidewaysScroll(office);
    await shot(office, "built-office-requests-laptop-dark");
    await panel.getByRole("button", { name: "Accept and offer the places" }).click();
    await expect(
      panel.getByRole("status").filter({ hasText: "Accepted. 4 places are now 6" }),
    ).toBeVisible();

    await client.reload();
    await expect(client.locator("#your-requests li").first()).toContainText("Accepted");

    // --- A decline with a reason the client sees. --------------------------------------------------
    await ask(client, scene.eventId, "Something else", async (p) => {
      await p
        .getByRole("textbox", { name: "What do you need?", exact: true })
        .fill("Can you bring radios?");
    });
    let chosen = await choose(office, null, "Something else");
    await expect(chosen).toContainText("They asked: “Can you bring radios?”");
    await chosen.getByRole("button", { name: "Decline…" }).click();
    await chosen.getByLabel("Why? The client sees this.").fill("We don't supply radios.");
    await chosen.getByRole("button", { name: "Decline the request" }).click();
    await expect(
      chosen.getByRole("status").filter({ hasText: "Declined. The client sees your reason" }),
    ).toBeVisible();
    await client.goto(`${acme}/client/requests`);
    const declined = client
      .locator("#your-requests li")
      .filter({ hasText: "Can you bring radios?" });
    await expect(declined).toContainText("Declined");
    await expect(declined).toContainText("Reason from Acme Events: “We don't supply radios.”");

    // --- A question, and the client's answer. ------------------------------------------------------
    await ask(client, scene.eventId, "Something else", async (p) => {
      await p
        .getByRole("textbox", { name: "What do you need?", exact: true })
        .fill("A supervisor too, please.");
    });
    chosen = await choose(office, null, "Something else");
    await chosen.getByRole("button", { name: "Ask the client" }).click();
    await chosen.getByLabel("Your question for the client").fill("Which gate?");
    await chosen.getByRole("button", { name: "Send the question" }).click();
    await expect(
      chosen.getByRole("status").filter({ hasText: "Sent. The client sees your question" }),
    ).toBeVisible();
    await client.goto(`${acme}/client/requests`);
    const question = client.locator("#your-requests li").filter({ hasText: "A supervisor too" });
    await expect(question).toContainText("Question for you");
    await expect(question).toContainText("Which gate?");
    await question.getByLabel("Your answer").fill("North Gate.");
    await question.getByRole("button", { name: "Send my answer" }).click();
    await expect(
      question
        .getByRole("status")
        .filter({ hasText: "Sent. Acme Events will look at your request again." }),
    ).toBeVisible();
    // The confirmation stays after the page refreshes under it (it did once vanish: answered, the
    // request has no question any more, so the reply box, and its "Sent", went from the page).
    // The address names the request answered first (that's what keeps it), then a reload.
    await expect(client).toHaveURL(/\/client\/requests\?answered=[0-9a-f-]{36}$/);
    await client.reload();
    await expect(
      client
        .locator("#your-requests li")
        .filter({ hasText: "A supervisor too" })
        .getByRole("status")
        .filter({ hasText: "Sent. Acme Events will look at your request again." }),
    ).toBeVisible();
    chosen = await choose(office, null, "Something else");
    await expect(chosen).toContainText("Their note: “North Gate.”");

    // --- A planner's session: "To do in …", then Mark done. ---------------------------------------
    await ask(client, scene.eventId, "More places on a session", async (p) => {
      await pickSession(p, "South Bridge");
      await p.getByLabel("How many more?").fill("1");
    });
    chosen = await choose(office, null, "South Bridge");
    await expect(chosen).toContainText("so nothing changes here");
    await chosen.getByRole("button", { name: "Accept: to do in the planner" }).click();
    await expect(
      chosen.getByRole("status").filter({ hasText: "on your planner's to-do list" }),
    ).toBeVisible();
    await office.goto(`${acme}/office/client-requests`);
    const plannerTab = office.getByRole("navigation", { name: "Show" }).getByRole("link", {
      name: /^To do in /,
    });
    await plannerTab.click();
    chosen = await choose(office, "planner", "South Bridge");
    await chosen.getByRole("button", { name: "Mark done" }).click();
    await expect(chosen.getByRole("status").filter({ hasText: "Marked done." })).toBeVisible();
    await client.goto(`${acme}/client/requests`);
    // (The client's list names the venue, not the post: "+1 place · Steward · {venue} · …".)
    await expect(
      client.locator("#your-requests li").filter({ hasText: "+1 place ·" }),
    ).toContainText("Accepted");

    // The office page in light, too.
    const light = await context(browser, LAPTOP, "10.36.3.4", "light");
    try {
      const lp = await light.newPage();
      await officeLogin(lp, RESOURCER);
      await lp.goto(`${acme}/office/client-requests?tab=accepted`);
      await expect(lp.locator("#request-panel")).toBeVisible();
      await noSidewaysScroll(lp);
      await shot(lp, "built-office-requests-laptop-light");
    } finally {
      await light.close();
    }

    // --- Log out. ---------------------------------------------------------------------------------
    await client.goto(`${acme}/client`);
    await client.getByRole("button", { name: "Log out" }).click();
    await expect(client).toHaveURL(`${acme}/client/login?out=1`);
    await expect(client.getByText("You're logged out.")).toBeVisible();
    await expect(client).toHaveTitle("Client login · Acme Events shifts"); // Phase 37.6
    await client.goto(`${acme}/client`);
    await expect(client).toHaveURL(`${acme}/client/login`);
  } finally {
    await Promise.all([adminCtx.close(), clientPhone.close(), officeCtx.close()]);
    await endClientScene("acme", scene);
  }
});

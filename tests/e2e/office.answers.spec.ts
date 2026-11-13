import type { Browser, BrowserContext, Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { addOfficeUser, messagesScene } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";

// The answer library's screens in a real browser (Phase 35.3, 35.4; docs/screens.md "## Phase 35";
// the approved mock-up): an admin of this spec's own turns a channel's switch (and back), adds an
// answer with a fill-in picked from the list, sees it listed with its chip, and, at the end,
// switches it off; a made-up casual of this spec's own asks in the app with its example question
// and gets it on Messages, marked automatic, with "Not what you needed? Ask the office", which sends
// her question on to Need a person; her next question, which nothing answers, goes to a person too.
// On Enquiries the admin sees "Answered automatically" (its tab and count), the row's "Answered
// automatically · {name}" and "How it was answered" (the answer, how it was chosen, what was filled
// in, the words that went), and on a question for a person "Make this an answer", which opens Add
// with it. A resourcer can't open the page (not found), has no menu item, and sees no "Make this an
// answer". No sideways scroll at 390px or 1,280px, light and dark. The answer's name and example
// are this run's own (a retry makes new ones). Made-up people only (07700 900935).
// Screenshots of the built screens are attached to the run's report and, with P35_SHOTS set, saved
// in that folder too.

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);
// Not its example question (since the guardrails review's H1, "Ask the office" always names the
// answer and always reaches a person anyway: tests/unit/answers.screens.test.ts).
const NAME = `Torch and badge ${RUN}`;
const EXAMPLE = `kit list ${RUN}`;
const ADMIN = `answers.admin.${RUN}@example.com`;
const RESOURCER = `answers.resourcer.${RUN}@example.com`;
const KIT = { firstName: "Kit", lastName: "Answerson", mobileE164: "+447700900935" };
const KIT_TYPED = "07700 900935";
const FOOD = `Is there food at the festival? (${RUN})`;
const LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const SHOTS = process.env.P35_SHOTS;
const IP = "10.235.35.1";

test.describe.configure({ mode: "serial" });

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function shoot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await test.info().attach(name, { body, contentType: "image/png" });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, animations: "disabled" });
  }
}

async function context(
  browser: Browser,
  size: { width: number; height: number },
  scheme: "dark" | "light" = "dark",
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: size,
    deviceScaleFactor: size.width > 1000 ? 1.5 : 3,
    isMobile: size.width < 1000,
    hasTouch: size.width < 1000,
    colorScheme: scheme,
    locale: "en-GB",
    extraHTTPHeaders: { "x-real-ip": IP },
  });
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

let admin: BrowserContext;
let food: string; // the id of Kit's question for a person (from "Make this an answer")

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await addOfficeUser("acme", { email: ADMIN, name: "Answers Admin", role: "admin" });
  await addOfficeUser("acme", { email: RESOURCER, name: "Answers Resourcer", role: "resourcer" });
  admin = await context(browser, LAPTOP);
  await officeLogin(await admin.newPage(), ADMIN);
});
test.afterAll(async () => {
  await admin?.close();
});

test("an admin turns a switch, adds an answer with a fill-in, and sees it listed", async () => {
  const page = await admin.newPage();
  await page.goto(`${acme}/office`);
  await (await menuLink(page, "Automatic answers")).click();
  await expect(page).toHaveURL(`${acme}/office/settings/answers`);
  await expect(page.getByRole("heading", { name: "Automatic answers", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("Automatic answers · Acme Events shifts");
  await expect(
    page.getByText(
      "What the shifts line may answer by itself. The AI only picks one of these, or none; it never writes its own words.",
    ),
  ).toBeVisible();
  for (const h of ["Answer casuals automatically", "Your answers", "Built in", "No answer yet"])
    await expect(page.getByRole("heading", { name: h, level: 2 })).toBeVisible();
  // The demo's starters: on, with their example questions and fill-ins as chips.
  const payDay = page.locator('[data-answer="Pay day"]');
  await expect(payDay).toContainText("“when do we get paid”");
  await expect(payDay.locator("[data-fill-in]").first()).toHaveText("Next pay day");
  expect(await sideways(page)).toBe(0);

  // The email switch: off, then on again, each answered under it.
  const email = page.getByRole("switch", {
    name: "Answer emails to the staffing inbox automatically",
  });
  await expect(email).toHaveAttribute("aria-checked", "true");
  await email.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Emails to the staffing inbox: switched off. They go to a person." }),
  ).toBeVisible();
  await expect(email).toHaveAttribute("aria-checked", "false");
  await email.click();
  await expect(
    page.getByRole("status").filter({
      hasText:
        "Emails to the staffing inbox: answered automatically now, with the answers that are on.",
    }),
  ).toBeVisible();
  await expect(email).toHaveAttribute("aria-checked", "true");
  // Wave 1 (w1-06): with a channel on, no "don't go out yet" banner; Built in says it answers
  // with the three switches off. (The banner's own state is in tests/unit/answers.screens.test.ts:
  // Acme's switches are shared with specs running in parallel.)
  await expect(page.locator("[data-no-channel]")).toHaveCount(0);
  await expect(page.locator("section", { has: page.locator("#built-in") })).toContainText(
    "These still answer with the three switches off.",
  );

  // Add an answer: its name, its example question, and words with a fill-in from the picker.
  await page.getByRole("link", { name: "Add an answer" }).click();
  await expect(page).toHaveURL(`${acme}/office/settings/answers/new`);
  await expect(page.getByRole("heading", { name: "Add an answer", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill(NAME);
  await page.getByRole("textbox", { name: "Ways casuals ask it" }).fill(EXAMPLE);
  const words = page.getByRole("textbox", { name: "The answer" });
  await words.fill("Hi ");
  await page.getByRole("button", { name: "First name", exact: true }).click();
  await expect(words).toBeFocused();
  await page.keyboard.type(", bring a torch and your badge.");
  await expect(words).toHaveValue("Hi {first_name}, bring a torch and your badge.");
  // What a casual would get: the made-up example, never a real casual's.
  await expect(page.locator("[data-preview]")).toHaveText("Hi Zoe, bring a torch and your badge.");
  await expect(page.getByText("Automatic reply. — Acme Events Shift Team")).toBeVisible();
  expect(await sideways(page)).toBe(0);
  await shoot(page, "35-add-laptop-dark");
  // A {word} not on the list is refused, next to the words.
  await words.fill("Hi {nickname}");
  await expect(page.getByText("Use only the fill-ins from the list.")).toBeVisible();
  await page.getByRole("button", { name: "Save and switch on" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Check the answer: see the notes above." }),
  ).toBeVisible();
  await words.fill("Hi {first_name}, bring a torch and your badge.");
  await page.getByRole("button", { name: "Save and switch on" }).click();

  // Listed, on, with its chip; the list says so.
  await expect(page).toHaveURL(/\/office\/settings\/answers\?saved=[0-9a-f-]{36}$/);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `Saved “${NAME}”. It's on: it answers casuals now.` }),
  ).toBeVisible();
  const mine = page.locator(`[data-answer="${NAME}"]`);
  await expect(mine).toContainText(`“${EXAMPLE}”`);
  await expect(mine.locator("[data-fill-in]")).toHaveText("First name");
  await expect(mine).toContainText("Not used in the last 7 days");
  await expect(mine).toContainText(/Edited by Answers Admin, \d\d:\d\d on /);
  await expect(mine.getByRole("switch", { name: `Use “${NAME}”` })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(await sideways(page)).toBe(0);
  await page.close();
});

test("a casual asks with its example: the answer on Messages, then 'Ask the office' reaches a person", async ({
  browser,
}) => {
  await messagesScene("acme", KIT);
  const phone = await context(browser, PHONE, "light");
  try {
    const page = await phone.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(KIT_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(KIT.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page).toHaveURL(`${acme}/`);
    await page.goto(`${acme}/messages`);
    await expect(
      page.getByText(
        "Ask us anything. Common questions are answered straight away; anything else goes to the office. If your pay looks wrong, raise a pay query on the Pay page: it goes to payroll.",
      ),
    ).toBeVisible();

    const box = page.getByLabel("Your message", { exact: true });
    const send = page.getByRole("button", { name: "Send", exact: true });
    await box.fill(`What's on the ${EXAMPLE}?`);
    await send.click();
    const thread = page.getByRole("list", { name: "Your messages" });
    const answer = thread
      .getByRole("listitem")
      .filter({ hasText: "Hi Kit, bring a torch and your badge." });
    await expect(answer).toBeVisible({ timeout: 20_000 });
    await expect(answer).toContainText("Automatic reply. — Acme Events Shift Team");
    await expect(answer).toContainText("Automatic reply ·");
    const askOffice = answer.getByRole("button", { name: "Not what you needed? Ask the office" });
    await expect(askOffice).toBeVisible();
    expect(await sideways(page)).toBe(0);
    await shoot(page, "35-messages-phone-light");

    // Asked: her message names the answer, it says so, and the office's usual reply comes.
    await askOffice.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Sent to the office. They'll answer here." }),
    ).toBeVisible();
    await expect(
      thread
        .getByRole("listitem")
        .filter({ hasText: `Please can someone from the office help? (About: ${NAME})` }),
    ).toBeVisible();
    await expect(
      thread
        .getByRole("listitem")
        .filter({ hasText: "The office will see this and get back to you. Ref" }),
    ).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(
      page.getByRole("status").filter({ hasText: "Sent to the office. They'll answer here." }),
    ).toBeVisible();

    // A question nothing answers: for a person, as before.
    await box.fill(FOOD);
    await send.click();
    await expect(
      thread
        .getByRole("listitem")
        .filter({ hasText: "The office will see this and get back to you. Ref" }),
    ).toHaveCount(2, { timeout: 20_000 });
    // Written since: the button and its words are gone.
    await expect(
      page.getByRole("button", { name: "Not what you needed? Ask the office" }),
    ).toHaveCount(0);
    expect(await sideways(page)).toBe(0);
  } finally {
    await phone.close();
  }
});

test("Enquiries: answered automatically with the answer's name, how it was answered, and Make this an answer", async () => {
  const page = await admin.newPage();
  await page.goto(`${acme}/office/enquiries`);
  const tab = page.getByRole("link", { name: /^Answered automatically \d+$/ });
  await tab.click();
  await expect(page).toHaveURL(`${acme}/office/enquiries?view=answered`);
  await expect(tab).toHaveAttribute("aria-current", "page");
  const row = page
    .getByRole("region", { name: "Answered automatically" })
    .getByRole("listitem")
    .filter({ hasText: EXAMPLE });
  await expect(row).toContainText(`Answered automatically · ${NAME}`);
  await expect(row).toContainText("In the app:");
  // Never one for a person in this view.
  await expect(
    page.getByRole("region", { name: "Answered automatically" }).getByText(FOOD),
  ).toHaveCount(0);
  await row.getByRole("link", { name: "Kit Answerson" }).click();
  const pane = page.locator("[data-chosen-message]");
  await expect(pane).toContainText(EXAMPLE);
  await expect(pane.getByRole("heading", { name: "How it was answered" })).toBeVisible();
  await expect(pane.locator("[data-answer-chosen]")).toContainText(
    `Answer chosen: “${NAME}”, matched by one of its example questions. Switched on by Answers Admin at`,
  );
  await expect(pane.getByRole("link", { name: `Edit “${NAME}”` })).toBeVisible();
  await expect(
    pane.getByText("First name. The values are in the words that went.", { exact: false }),
  ).toBeVisible();
  await expect(pane.locator("[data-sent-words]")).toHaveText(
    "“Hi Kit, bring a torch and your badge. Automatic reply. — Acme Events Shift Team”",
  );
  expect(await sideways(page)).toBe(0);
  await shoot(page, "35-enquiries-answered-laptop-dark");

  // Her question for a person: "Make this an answer" opens Add with it.
  await page.goto(`${acme}/office/enquiries?view=person`);
  const waiting = page
    .getByRole("region", { name: "Need a person" })
    .getByRole("listitem")
    .filter({ hasText: FOOD });
  await waiting.getByRole("link", { name: "Kit Answerson" }).click();
  // The pane shows it once its page has come (from 1,024px the list's link picks it beside).
  await expect(page.locator("[data-chosen-message]")).toContainText(FOOD);
  const make = page.locator("[data-chosen-message]").getByRole("link", {
    name: "Make this an answer",
  });
  await expect(make).toBeVisible();
  food =
    new URL(`${acme}${(await make.getAttribute("href")) ?? ""}`).searchParams.get("from") ?? "";
  expect(food).toMatch(/^[0-9a-f-]{36}$/);
  await make.click();
  await expect(page).toHaveURL(`${acme}/office/settings/answers/new?from=${food}`);
  await expect(page.getByRole("textbox", { name: "Ways casuals ask it" })).toHaveValue(FOOD);
  await page.close();
});

test("the page and its forms, laptop and phone, light and dark; switched off at the end", async ({
  browser,
}) => {
  // Four sizes and themes, each with full-page screenshots.
  test.setTimeout(150_000);
  for (const [size, scheme, name] of [
    [LAPTOP, "dark", "laptop-dark"],
    [LAPTOP, "light", "laptop-light"],
    [PHONE, "dark", "phone-dark"],
    [PHONE, "light", "phone-light"],
  ] as const) {
    const ctx = await context(browser, size, scheme);
    try {
      await ctx.addCookies(await admin.cookies());
      // The office is dark until light is picked (the sd-theme cookie), whatever the device says.
      if (scheme === "light")
        await ctx.addCookies([{ name: "sd-theme", value: "light", url: acme }]);
      const page = await ctx.newPage();
      // (A phone's emulation takes the context's colour scheme only from the page itself.)
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${acme}/office/settings/answers`);
      await expect(
        page.getByRole("heading", { name: "Automatic answers", level: 1 }),
      ).toBeVisible();
      expect(await sideways(page), name).toBe(0);
      await shoot(page, `35-answers-${name}`);
      await page
        .locator(`[data-answer="${NAME}"]`)
        .getByRole("link", { name: `Edit ${NAME}` })
        .click();
      await expect(page.getByRole("heading", { name: NAME, level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save, keep on" })).toBeVisible();
      expect(await sideways(page), name).toBe(0);
      await shoot(page, `35-edit-${name}`);
      await page.goto(`${acme}/office/enquiries/${food}`);
      await expect(page.getByRole("link", { name: "Make this an answer" })).toBeVisible();
      expect(await sideways(page), name).toBe(0);
      if (size === PHONE) await shoot(page, `35-enquiry-person-${name}`);
    } finally {
      await ctx.close();
    }
  }

  // Switched off: said so, and Kit's next ask with its example goes to a person.
  const page = await admin.newPage();
  await page.goto(`${acme}/office/settings/answers`);
  const mine = page.locator(`[data-answer="${NAME}"]`);
  const sw = mine.getByRole("switch", { name: `Use “${NAME}”` });
  await sw.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `“${NAME}” is off: those questions go to a person.` }),
  ).toBeVisible();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(mine).toContainText("Off");
  await expect(mine).toContainText("Used once in the last 7 days");
  await page.close();
});

test("a resourcer: no Automatic answers (not found, not in the menu), no Make this an answer", async ({
  page,
}) => {
  await officeLogin(page, RESOURCER);
  await expect(await menuLink(page, "Enquiries")).toBeVisible();
  await expect(await menuLink(page, "Automatic answers")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect((await page.goto(`${acme}/office/settings/answers`))?.status()).toBe(404);
  expect((await page.goto(`${acme}/office/settings/answers/new?from=${food}`))?.status()).toBe(404);
  await page.goto(`${acme}/office/enquiries/${food}`);
  await expect(
    page.getByRole("heading", { name: "Message from Kit Answerson", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Make this an answer" })).toHaveCount(0);
  // The answered one: its answer named, with no Edit link.
  await page.goto(`${acme}/office/enquiries?view=answered`);
  const row = page
    .getByRole("region", { name: "Answered automatically" })
    .getByRole("listitem")
    .filter({ hasText: EXAMPLE });
  await expect(row).toContainText(`Answered automatically · ${NAME}`);
  await row.getByRole("link", { name: "Kit Answerson" }).click();
  await expect(page.locator("[data-answer-chosen]").first()).toContainText(`“${NAME}”`);
  await expect(page.getByRole("link", { name: `Edit “${NAME}”` })).toHaveCount(0);
  expect(await sideways(page)).toBe(0);
});

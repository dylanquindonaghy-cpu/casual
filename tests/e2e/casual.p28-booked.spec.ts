import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo, sentTo } from "./outbox";
import {
  attendanceQuestion,
  bookedScene,
  markNow,
  P28_13_CASUAL,
  P28_13_TYPED,
} from "./p28/28-13-data";

// Phase 28.13 (docs/screens.md "### 28.13"): Booked in a real browser, as a made-up casual of this
// spec's own (tests/e2e/p28/28-13-data.ts), on a phone (390px). "Updated" sits beside the "Booked
// shifts" headline; Upcoming | Past 90 days are tabs with counts; Past covers reliability's 90 days
// (a session 40 days ago shows), each row with its hours and mark; a "Marked as not attended" row
// opens to "Think this mark is wrong?", and "Tell the office" sends an attendance question with a
// reference (a second one is refused with the first's), the mark unchanged; the office sees it in
// Enquiries; "Ask about the pay for this shift" opens the pay query with the shift chosen; "Your
// shift record" opens the record, from Past and from Profile. Then screenshots on a phone (390px)
// and Dylan's laptop (1,280px at 150%), light and dark, kept with the run.

const acme = "http://acme.localhost:3100";
const IP = { "x-real-ip": "10.240.28.13" };
const OFFICE_IP = { "x-real-ip": "10.240.28.31" };

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

async function logIn(
  browser: Browser,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: IP });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P28_13_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_13_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    return await context.storageState();
  } finally {
    await context.close();
  }
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

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test("Booked: Updated beside the headline, tabs with counts, Past 90 days with hours and marks, Tell the office, the pay query, the record", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene = await bookedScene();
  const session = await logIn(browser);
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "en-GB",
    extraHTTPHeaders: IP,
  });
  try {
    const page = await context.newPage();

    // The headline, with "Updated 21:35" beside it on the same line (online).
    await page.goto(`${acme}/shifts`);
    const heading = page.getByRole("heading", { level: 1, name: "Booked shifts" });
    await expect(heading).toBeVisible();
    const updated = page.getByText(/^Updated \d\d:\d\d$/);
    await expect(updated).toBeVisible();
    const [h, u] = [await heading.boundingBox(), await updated.boundingBox()];
    expect(h && u).toBeTruthy();
    expect(u!.x).toBeGreaterThan(h!.x + h!.width - 1);
    expect(Math.abs(u!.y + u!.height - (h!.y + h!.height))).toBeLessThan(12);

    // Upcoming | Past 90 days: the office's tabs, each with its count.
    const which = page.getByRole("navigation", { name: "Which shifts" });
    const upcoming = which.getByRole("link", { name: /^Upcoming/ });
    const past = which.getByRole("link", { name: /^Past 90 days/ });
    await expect(upcoming).toHaveAttribute("aria-current", "page");
    await expect(upcoming).toHaveText(/^Upcoming\s*1$/);
    await expect(past).toHaveText(/^Past 90 days\s*\d+$/);
    const pastCount = Number(((await past.textContent()) ?? "").replace(/\D/g, ""));
    expect(pastCount).toBeGreaterThanOrEqual(3);
    for (const t of [upcoming, past]) {
      expect((await t.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole("region", { name: "Your next shift" })).toContainText(
      scene.sites.upcoming,
    );
    expect(await noSideScroll(page)).toBe(0);

    // Past 90 days: the record first, then the rows with their hours and marks.
    await past.click();
    await expect(page).toHaveURL(`${acme}/shifts?view=past`);
    await expect(which.getByRole("link", { name: /^Past 90 days/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const record = page.getByRole("link", { name: /^Your shift record/ });
    await expect(record).toHaveAttribute("href", "/shifts/record");
    const list = page.getByRole("region", { name: "The last 90 days" });
    const row = (site: string) => list.getByRole("listitem").filter({ hasText: site });
    await expect(row(scene.sites.missed)).toContainText("8 hours");
    await expect(row(scene.sites.missed)).toContainText("Marked as not attended");
    // 40 days ago: outside the old 30 days, inside reliability's 90.
    await expect(row(scene.sites.worked)).toContainText("6.5 hours");
    await expect(row(scene.sites.worked)).toContainText("Worked");
    await expect(row(scene.sites.unmarked)).toContainText("Not marked yet");

    // A "Marked as not attended" row opens to what she can do.
    const missed = row(scene.sites.missed);
    await expect(missed.getByText("Think this mark is wrong?")).toBeHidden();
    await missed.locator("summary").click();
    await expect(missed.getByText("Think this mark is wrong?")).toBeVisible();
    const tell = missed.getByRole("link", { name: "Tell the office" });
    const pay = missed.getByRole("link", { name: "Ask about the pay for this shift" });
    const inRecord = missed.getByRole("link", { name: "See it in your shift record" });
    await expect(pay).toHaveAttribute("href", `/pay/query?shift=${scene.missedId}`);
    await expect(inRecord).toHaveAttribute("href", "/shifts/record");
    for (const link of [tell, pay, inRecord]) {
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // One not marked yet can't be questioned (there's no mark), but its pay can.
    const unmarked = row(scene.sites.unmarked);
    await unmarked.locator("summary").click();
    await expect(
      unmarked.getByRole("link", { name: "Ask about the pay for this shift" }),
    ).toBeVisible();
    await expect(unmarked.getByRole("link", { name: "Tell the office" })).toHaveCount(0);
    expect(await noSideScroll(page)).toBe(0);

    // "Tell the office": what happened, then a reference.
    await tell.click();
    await expect(page).toHaveURL(`${acme}/requests/new?shift=${scene.missedId}&kind=attendance`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Tell the office what happened" }),
    ).toBeVisible();
    await expect(page.getByText("Marked as: Marked as not attended")).toBeVisible();
    const send = page.getByRole("button", { name: "Send to the office" });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose what happened." })).toHaveText(
      "Choose what happened.",
    );
    const choices = page.getByRole("group", { name: "What happened?" });
    await expect(choices.getByRole("radio")).toHaveCount(2);
    await choices.getByRole("radio", { name: "I worked this shift" }).check();
    await page
      .getByLabel("Anything the office should know? (optional)")
      .fill("I signed in at the north gate.");
    await send.click();
    const sent = page.getByRole("status").filter({ hasText: "Sent. The office will check it." });
    await expect(sent).toContainText(/Reference [0-9A-F]{8}\./);
    const ref = /Reference ([0-9A-F]{8})\./.exec((await sent.textContent()) ?? "")?.[1] ?? "";
    await expect(sent).toContainText("You'll see their answer in My requests.");
    await expect(sent.getByRole("link", { name: "See my requests" })).toBeVisible();
    const question = await attendanceQuestion(scene.workerId, scene.missedId);
    expect(question?.status).toBe("open");
    expect(question?.id.slice(0, 8).toUpperCase()).toBe(ref);
    // The question never changes the mark.
    expect(await markNow(scene.workerId, scene.missedId)).toBe("no_show");
    await shoot(page, testInfo, "28.13 tell the office, sent, phone, light");

    // Asking again while it waits: the first one's reference.
    await page.reload();
    await page
      .getByRole("group", { name: "What happened?" })
      .getByRole("radio", { name: "I worked this shift" })
      .check();
    await page.getByRole("button", { name: "Send to the office" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "You've already asked about this shift." }),
    ).toContainText(`You've already asked about this shift. Reference ${ref}.`);

    // "Ask about the pay for this shift": payroll's pay query, the shift chosen once the code is in.
    await page.goto(`${acme}/shifts?view=past`);
    const again = page
      .getByRole("region", { name: "The last 90 days" })
      .getByRole("listitem")
      .filter({ hasText: scene.sites.missed });
    await again.locator("summary").click();
    await again.getByRole("link", { name: "Ask about the pay for this shift" }).click();
    await expect(page).toHaveURL(`${acme}/pay/query?shift=${scene.missedId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Raise a pay query" })).toBeVisible();
    const asked = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Send me a code" }).click();
    await page.getByLabel("Your code").fill(await codeSentTo(P28_13_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page).toHaveURL(`${acme}/pay/query?shift=${scene.missedId}`);
    await expect(page.getByLabel("Which shift?")).toHaveValue(scene.missedId);

    // A row 80 days back (past the old 8 weeks, inside Past's 90 days): its pay link chooses it too.
    await page.goto(`${acme}/shifts?view=past`);
    const oldest = page
      .getByRole("region", { name: "The last 90 days" })
      .getByRole("listitem")
      .filter({ hasText: scene.sites.oldest });
    await oldest.locator("summary").click();
    await oldest.getByRole("link", { name: "Ask about the pay for this shift" }).click();
    await expect(page).toHaveURL(`${acme}/pay/query?shift=${scene.oldestId}`);
    await expect(page.getByLabel("Which shift?")).toHaveValue(scene.oldestId);

    // "Your shift record", from Past and from Profile.
    await page.goto(`${acme}/shifts?view=past`);
    await page.getByRole("link", { name: /^Your shift record/ }).click();
    await expect(page).toHaveURL(`${acme}/shifts/record`);
    await expect(page.getByRole("heading", { level: 1, name: "Your shift record" })).toBeVisible();
    await page.goto(`${acme}/profile`);
    const fromProfile = page.getByRole("link", { name: /^Your shift record/ });
    await expect(fromProfile).toHaveAttribute("href", "/shifts/record");
    expect((await fromProfile.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await fromProfile.click();
    await expect(page).toHaveURL(`${acme}/shifts/record`);
  } finally {
    await context.close();
  }

  // The office sees it in Enquiries, as an attendance question with "Mark again".
  const email = "p28-booked.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Booked Twentyeight", role: "resourcer" });
  const question = await attendanceQuestion(scene.workerId, scene.missedId);
  expect(question).not.toBeNull();
  const office = await browser.newContext({ extraHTTPHeaders: OFFICE_IP, locale: "en-GB" });
  try {
    const page = await office.newPage();
    await officeLogin(page, email);
    await page.goto(`${acme}/office/enquiries?view=app`);
    const card = page
      .getByRole("region", { name: "Waiting for an answer" })
      .locator(`#request-${question!.id}`);
    await expect(card.getByText("Attendance question", { exact: true })).toBeVisible();
    await expect(
      card.getByText(`${P28_13_CASUAL.firstName} ${P28_13_CASUAL.lastName}`, { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText("Says the mark is wrong: marked not attended (they say they worked)."),
    ).toBeVisible();
    await expect(card.getByText("Their note: I signed in at the north gate.")).toBeVisible();
    await expect(card.getByRole("link", { name: "Mark again" })).toBeVisible();
  } finally {
    await office.close();
  }

  // Screenshots: Upcoming, Past (a row opened) and the form, phone and laptop, light and dark.
  for (const size of SIZES)
    for (const theme of THEMES) {
      const shots = await browser.newContext({
        storageState: session,
        viewport: size.viewport,
        deviceScaleFactor: size.scale,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        colorScheme: theme,
        locale: "en-GB",
        extraHTTPHeaders: IP,
      });
      try {
        const page = await shots.newPage();
        await page.goto(`${acme}/shifts`);
        await expect(page.getByRole("heading", { level: 1, name: "Booked shifts" })).toBeVisible();
        await shoot(page, testInfo, `28.13 booked upcoming, ${size.name}, ${theme}`);
        await page.goto(`${acme}/shifts?view=past`);
        const open = page
          .getByRole("region", { name: "The last 90 days" })
          .getByRole("listitem")
          .filter({ hasText: scene.sites.worked });
        await open.locator("summary").click();
        await expect(open.getByRole("link", { name: "Tell the office" })).toBeVisible();
        await shoot(page, testInfo, `28.13 booked past 90 days, ${size.name}, ${theme}`);
        await page.goto(`${acme}/requests/new?shift=${scene.workedId}&kind=attendance`);
        await expect(page.getByRole("group", { name: "What happened?" })).toBeVisible();
        await shoot(page, testInfo, `28.13 tell the office, ${size.name}, ${theme}`);
      } finally {
        await shots.close();
      }
    }
});

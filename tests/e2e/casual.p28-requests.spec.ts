import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import {
  answersReadAt,
  casualRequestsScene,
  P28_9_CASUAL,
  P28_9_SITES,
  P28_9_TYPED,
} from "./p28/28-9-data";

// Phase 28.9 (docs/screens.md "### 28.9"): My requests and New request in a real browser, as a
// made-up casual of this spec's own (tests/e2e/p28/28-9-data.ts), on a phone (390px). The picker
// shows each shift's site in full on two-line choice cards; "Take back this request" asks first,
// then confirms with the reference and the chip turns to "Taken back"; an answered attendance
// question reads "Answered" with "Your shift now shows: Worked"; her unseen answers are marked seen
// once the list is on her screen. Then screenshots of both pages on a phone (390px) and Dylan's
// laptop (1,280px at 150%), light and dark, kept with the run.

const acme = "http://acme.localhost:3100";
const IP = { "x-real-ip": "10.240.28.9" };

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
    await page.getByLabel("Your mobile number").fill(P28_9_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_9_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

test("My requests and New request: the whole site on the picker, take back, an answered attendance question, answers seen", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene = await casualRequestsScene();
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

    // New request: one choice card per upcoming booking, each site's name in full.
    await page.goto(`${acme}/requests/new`);
    await expect(page.getByRole("heading", { level: 1, name: "New request" })).toBeVisible();
    const picker = page.getByRole("group", { name: "Which shift?" });
    await expect(picker.getByRole("radio")).toHaveCount(2);
    for (const site of P28_9_SITES) {
      const words = picker.getByText(new RegExp(`at ${site}$`));
      await expect(words).toBeVisible();
      // Nothing cut off: the words sit inside their box, and the card is a big tap target.
      const fits = await words.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, `${site} fits its card`).toBe(true);
      const card = picker.locator("label", { hasText: site });
      const box = await card.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await picker.getByRole("radio", { name: new RegExp(P28_9_SITES[1]) }).check();
    await expect(picker.getByRole("radio", { name: new RegExp(P28_9_SITES[1]) })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    // My requests: an answered attendance question with the mark as it is now.
    await page.goto(`${acme}/requests`);
    await expect(page.getByRole("heading", { level: 1, name: "My requests" })).toBeVisible();
    const answered = page
      .getByRole("listitem")
      .filter({ hasText: `Reference ${scene.answeredRef}` });
    await expect(answered.getByText("Answered", { exact: true })).toBeVisible();
    await expect(answered.getByText("Your shift now shows: Worked")).toBeVisible();
    await expect(answered.getByText(/^Attendance question: /)).toBeVisible();
    await expect(answered.getByText("Approved", { exact: true })).toHaveCount(0);
    await expect(answered.getByRole("button", { name: "Take back this request" })).toHaveCount(0);

    // Her answer, on her screen: marked seen by the page's own action (never while it's made).
    await expect
      .poll(async () => (await answersReadAt(scene.workerId))?.getTime() ?? 0, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(scene.answeredAt.getTime() - 1);

    // Taking back the waiting time change: a step first, then the confirmation and its reference.
    const waiting = page.getByRole("listitem").filter({ hasText: `Reference ${scene.waitingRef}` });
    await expect(waiting.getByText("Waiting for the office")).toBeVisible();
    const takeBack = waiting.getByRole("button", { name: "Take back this request" });
    expect((await takeBack.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await takeBack.click();
    const step = waiting.getByRole("group", { name: "Take back this request?" });
    await expect(
      step.getByText("The office won't answer it. You can ask again any time."),
    ).toBeVisible();
    // "Keep my request" closes the step and changes nothing.
    await step.getByRole("button", { name: "Keep my request" }).click();
    await expect(step).toHaveCount(0);
    await waiting.getByRole("button", { name: "Take back this request" }).click();
    await waiting.getByRole("button", { name: "Yes, take it back" }).click();
    await expect(waiting.getByRole("status")).toContainText(
      `Taken back. Reference ${scene.waitingRef}.`,
    );
    await expect(waiting.getByText("The office won't answer it.")).toBeVisible();
    await expect(waiting.getByText("Taken back", { exact: true })).toBeVisible();
    await expect(waiting.getByRole("button", { name: "Take back this request" })).toHaveCount(0);
    // Still taken back after a reload, from the server.
    await page.reload();
    const after = page.getByRole("listitem").filter({ hasText: `Reference ${scene.waitingRef}` });
    await expect(after.getByText("Taken back", { exact: true })).toBeVisible();
    await expect(after.getByRole("button", { name: "Take back this request" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    // "Back to my profile", where requests are reached.
    await page.getByRole("link", { name: "Back to my profile" }).click();
    await expect(page).toHaveURL(`${acme}/profile`);
  } finally {
    await context.close();
  }

  // Screenshots: both pages, phone and laptop, light and dark.
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
        await page.goto(`${acme}/requests`);
        await expect(page.getByRole("heading", { level: 1, name: "My requests" })).toBeVisible();
        await shoot(page, testInfo, `28.9 my requests, ${size.name}, ${theme}`);
        await page.goto(`${acme}/requests/new`);
        await expect(page.getByRole("group", { name: "Which shift?" })).toBeVisible();
        await shoot(page, testInfo, `28.9 new request, ${size.name}, ${theme}`);
      } finally {
        await shots.close();
      }
    }
});

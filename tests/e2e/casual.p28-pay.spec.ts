import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { staffChoice } from "../../src/app/ui/classes";
import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo } from "./outbox";
import {
  P28_10_CASUAL,
  P28_10_NOTE,
  P28_10_TYPED,
  payAnswersUnseen,
  payScene,
} from "./p28/28-10-data";

// Phase 28.10 (docs/screens.md "### 28.10"): Pay and the pay query, in a real browser, as a made-up
// casual of this spec's own (tests/e2e/p28/28-10-data.ts). At 390px: the pay day shows before the
// code, with no figure; the code step on the pay query itself takes a code from the outbox and
// comes back to the query (and only there: a crafted next= is dropped), with her shift chosen; a
// shift that isn't hers chooses nothing; the choices are the app's choice cards; and payroll's
// answer, once on her screen, stops counting. Screenshots of both pages before and after the code,
// on a phone (390px) and a laptop (1,280px at 150%), light and dark, attached to the run's report.

const acme = "http://acme.localhost:3100";
const IP = "10.240.28.10";

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;
type Size = (typeof SIZES)[number];
type Theme = (typeof THEMES)[number];

async function logIn(
  browser: Browser,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P28_10_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_10_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(
      page.getByRole("heading", { name: `Hi ${P28_10_CASUAL.firstName}` }),
    ).toBeVisible();
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

test("Pay and the pay query: the pay day before the code, the code step back to the query, a chosen shift, payroll's answer seen", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const scene = await payScene();
  const session = await logIn(browser);
  const inContext = async (size: Size, theme: Theme, work: (page: Page) => Promise<void>) => {
    const context = await browser.newContext({
      storageState: session,
      viewport: size.viewport,
      deviceScaleFactor: size.scale,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      colorScheme: theme,
      locale: "en-GB",
      extraHTTPHeaders: { "x-real-ip": IP },
    });
    try {
      await work(await context.newPage());
    } finally {
      await context.close();
    }
  };
  const payDay = (page: Page) => page.getByRole("heading", { level: 2, name: /^Pay day: / });

  // Before the code: the pay day first, then the code card; no hours, rate or amount anywhere.
  for (const size of SIZES)
    for (const theme of THEMES)
      await inContext(size, theme, async (page) => {
        const where = (what: string) => `${what} at ${size.name}, ${theme}`;
        await page.goto(`${acme}/pay`);
        await expect(payDay(page), where("the pay day")).toBeVisible();
        await expect(
          page.getByRole("region", { name: /^Pay day: / }).getByText(/^For shifts /),
        ).toBeVisible();
        const send = page.getByRole("button", { name: "Send me a code" });
        await expect(send).toBeVisible();
        expect(
          (await payDay(page).boundingBox())!.y,
          where("the pay day above the code"),
        ).toBeLessThan((await send.boundingBox())!.y);
        await expect(
          page.getByText("To keep your pay private, we'll text you a 6‑digit code."),
        ).toBeVisible();
        await expect(page.getByText(/£|an hour|Pay before tax/)).toHaveCount(0);
        await shoot(page, testInfo, `28.10 pay before the code ${size.name} ${theme}`);

        await page.goto(`${acme}/pay/query?shift=${scene.shiftId}`);
        await expect(
          page.getByRole("heading", { level: 1, name: "Raise a pay query" }),
        ).toBeVisible();
        await expect(
          page.getByText("Enter your 6‑digit code first. Then you'll come straight back here."),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Send me a code" })).toBeVisible();
        await expect(page.getByLabel("Which shift?")).toHaveCount(0);
        await shoot(page, testInfo, `28.10 pay query before the code ${size.name} ${theme}`);
      });

  // The code step on the pay query itself, on a phone: the code from the outbox, then straight
  // back to the query with her shift chosen. The crafted next= is dropped, never followed.
  await inContext(SIZES[0], "light", async (page) => {
    await page.goto(
      `${acme}/pay/query?shift=${scene.shiftId}&next=${encodeURIComponent("https://example.com/")}`,
    );
    const asked = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(
      page.getByText("We've sent a 6‑digit code by text. It works for 10 minutes."),
    ).toBeVisible();
    await page.getByLabel("Your code").fill(await codeSentTo(P28_10_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page).toHaveURL(`${acme}/pay/query?shift=${scene.shiftId}`);
    await expect(page.getByLabel("Which shift?")).toHaveValue(scene.shiftId);
    await expect(
      page.getByText("Payroll will look at it. You'll see its status on your pay page."),
    ).toBeVisible();

    // The choices are the app's choice cards, and the chosen one takes the ink edge.
    for (const name of ["Hours missing", "Wrong rate", "Paid late or not paid", "Something else"]) {
      await expect(page.locator("label").filter({ hasText: name })).toHaveClass(staffChoice);
    }
    const edge = (name: string) =>
      page
        .locator("label")
        .filter({ hasText: name })
        .evaluate((el) => getComputedStyle(el).borderTopColor);
    const unchosen = await edge("Wrong rate");
    await page.getByLabel("Wrong rate").check();
    expect(await edge("Wrong rate")).not.toBe(unchosen);
    expect(await edge("Hours missing")).toBe(unchosen);

    // A shift that isn't hers (made up here) chooses nothing.
    await page.goto(`${acme}/pay/query?shift=00000000-0000-4000-8000-000000002810`);
    await expect(page.getByLabel("Which shift?")).toHaveValue("");
    await page.goto(`${acme}/pay/query?shift=not-a-shift`);
    await expect(page.getByLabel("Which shift?")).toHaveValue("");

    // Payroll's answer counts until it is on her screen (that the page's own reads never clear it
    // is tests/integration/portal.pay-query-p28.test.ts's).
    expect(await payAnswersUnseen(scene.workerId)).toBeGreaterThan(0);
    await page.goto(`${acme}/pay`);
    await expect(payDay(page)).toBeVisible();
    // The newest (a rerun leaves earlier runs' answers under it).
    const answer = page.getByText(`Payroll says: “${P28_10_NOTE}”`).first();
    await expect(answer).toBeAttached();
    // Into the middle of the screen, clear of the tab bar.
    await answer.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(answer).toBeVisible();
    await expect.poll(() => payAnswersUnseen(scene.workerId), { timeout: 15_000 }).toBe(0);
  });

  // After the code (the session is open for 30 minutes): both pages, every size and theme.
  for (const size of SIZES)
    for (const theme of THEMES)
      await inContext(size, theme, async (page) => {
        await page.goto(`${acme}/pay`);
        await expect(page.getByText("The last 8 weeks, from Acme Events' payroll.")).toBeVisible();
        await expect(payDay(page)).toBeVisible();
        await expect(
          page.getByRole("heading", { level: 2, name: "Your pay queries" }),
        ).toBeVisible();
        await shoot(page, testInfo, `28.10 pay after the code ${size.name} ${theme}`);

        await page.goto(`${acme}/pay/query?shift=${scene.shiftId}`);
        await expect(page.getByLabel("Which shift?")).toHaveValue(scene.shiftId);
        await shoot(page, testInfo, `28.10 pay query after the code ${size.name} ${theme}`);
      });
});

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { codeSentTo, loginLinkSentTo } from "./outbox";
import {
  P29_5_CASUAL,
  P29_5_NOTE,
  P29_5_TYPED,
  payAnswersUnseen,
  payCountScene,
  type PayCountScene,
} from "./p29/29-5-data";

// Phase 29, 29.5 (docs/screens.md "### 29.5"): two of Phase 28's test gaps, in a real browser, as a
// made-up casual of this spec's own (tests/e2e/p29/29-5-data.ts).
//
// 1. The Pay tab's count, on screen: with one answer from payroll she hasn't seen, the Pay tab
//    shows "1" and is named "Pay, 1 new answer from payroll", on every page with the tab bar. Once
//    the code step has shown her the answer, the count goes, and reloading any of her pages shows
//    the Pay tab with no count (until now this was only checked in the database).
// 2. Her booked shift's page (/shifts/[id]) at a phone's size (390px) and a laptop's (1,280px at
//    150%), dark and light. Each is attached to the run's report; with SAVE_AFTER_SHOTS=1 each is
//    also written to docs/mockups/phase-28/after/staff-my-shift-{dark,light}-{phone,laptop}.jpg,
//    beside the phase's other "after" pages (a normal run never writes into docs/).

const acme = "http://acme.localhost:3100";
const IP = "10.240.29.5";

// As the phase's other "after" pages were taken: the phone at 2x, the laptop at 150%.
const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 2, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["dark", "light"] as const;
const AFTER_DIR = join(process.cwd(), "docs", "mockups", "phase-28", "after");
const saveAfterShots = process.env.SAVE_AFTER_SHOTS === "1";

async function logIn(
  browser: Browser,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P29_5_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P29_5_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    return await context.storageState();
  } finally {
    await context.close();
  }
}

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Main" });

// The Pay tab with its count: the number on screen and its words in the link's name.
async function expectPayCount(page: Page, where: string) {
  const pay = tabBar(page).getByRole("link", { name: "Pay, 1 new answer from payroll" });
  await expect(pay, `the Pay tab's name on ${where}`).toBeVisible();
  await expect(pay.locator("[data-pay-count]"), `the Pay count on ${where}`).toHaveText("1");
}

// The Pay tab with no count: named plain "Pay", and no number on it.
async function expectNoPayCount(page: Page, where: string) {
  const pay = tabBar(page).getByRole("link", { name: "Pay", exact: true });
  await expect(pay, `the Pay tab on ${where}`).toBeVisible();
  await expect(pay.locator("[data-pay-count]"), `no Pay count on ${where}`).toHaveCount(0);
  await expect(tabBar(page).getByRole("link", { name: /new answers? from payroll/ })).toHaveCount(
    0,
  );
}

test.describe.configure({ mode: "serial" });

let scene: PayCountScene;
let session: Awaited<ReturnType<BrowserContext["storageState"]>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  scene = await payCountScene();
  session = await logIn(browser);
});

test("the Pay tab counts payroll's answer until the code step shows it, then reloading any page shows no count", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    storageState: session,
    viewport: SIZES[0].viewport,
    deviceScaleFactor: SIZES[0].scale,
    isMobile: true,
    hasTouch: true,
    locale: "en-GB",
    extraHTTPHeaders: { "x-real-ip": IP },
  });
  try {
    const page = await context.newPage();
    expect(await payAnswersUnseen(scene.workerId)).toBe(1);

    // One unseen answer: the count on Home, on Shifts, and on Pay itself before the code.
    await page.goto(`${acme}/`);
    await expectPayCount(page, "Home");
    await page.goto(`${acme}/shifts`);
    await expectPayCount(page, "Shifts");
    await page.goto(`${acme}/pay`);
    await expectPayCount(page, "Pay before the code");
    // Opening Pay without the code shows no answer, so it still counts.
    await expect(page.getByText(`Payroll says: “${P29_5_NOTE}”`)).toHaveCount(0);
    await page.reload();
    await expectPayCount(page, "Pay before the code, reloaded");
    expect(await payAnswersUnseen(scene.workerId)).toBe(1);

    // The code step: the code from the outbox, then her pay and payroll's answer.
    const asked = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(
      page.getByText("We've sent a 6‑digit code by text. It works for 10 minutes."),
    ).toBeVisible();
    await page.getByLabel("Your code").fill(await codeSentTo(P29_5_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Check code" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Your pay queries" })).toBeVisible();
    const answer = page.getByText(`Payroll says: “${P29_5_NOTE}”`);
    await expect(answer).toBeAttached();
    // Into the middle of the screen, clear of the tab bar: now it is on her screen.
    await answer.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(answer).toBeVisible();
    await expect.poll(() => payAnswersUnseen(scene.workerId), { timeout: 15_000 }).toBe(0);
    // The page draws again, and its own Pay tab loses the count.
    await expect(
      tabBar(page).getByRole("link", { name: "Pay", exact: true }).locator("[data-pay-count]"),
    ).toHaveCount(0, { timeout: 15_000 });

    // Reloading any of her pages: the Pay tab with no count.
    for (const [path, where] of [
      ["/pay", "Pay"],
      ["/", "Home"],
      ["/shifts", "Shifts"],
      ["/messages", "Messages"],
      ["/profile", "Profile"],
    ] as const) {
      await page.goto(`${acme}${path}`);
      await page.reload();
      await expectNoPayCount(page, `${where}, reloaded`);
    }
  } finally {
    await context.close();
  }
});

test("her booked shift's page at a phone's and a laptop's size, dark and light (saved to after/ with SAVE_AFTER_SHOTS=1)", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  if (saveAfterShots) await mkdir(AFTER_DIR, { recursive: true });
  for (const size of SIZES)
    for (const theme of THEMES) {
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
        const page = await context.newPage();
        const where = `${size.name}, ${theme}`;
        await page.goto(`${acme}/shifts/${scene.booked}`);
        await expect(
          page.locator("[data-own-bar]").getByRole("link", { name: "Your shifts" }),
          where,
        ).toBeVisible();
        await expect(page.getByText("You're booked on this shift"), where).toBeVisible();
        await expect(page.getByText("Staff gate on Wharf Road").first(), where).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          `no sideways scroll at ${where}`,
        ).toBe(0);
        await page.evaluate(() => document.fonts.ready);
        const name = `staff-my-shift-${theme}-${size.name}`;
        const png = await page.screenshot({ fullPage: true, animations: "disabled" });
        await testInfo.attach(`29.5 ${name}`, { body: png, contentType: "image/png" });
        if (saveAfterShots)
          await page.screenshot({
            path: join(AFTER_DIR, `${name}.jpg`),
            type: "jpeg",
            quality: 55,
            fullPage: true,
            animations: "disabled",
          });
      } finally {
        await context.close();
      }
    }
});

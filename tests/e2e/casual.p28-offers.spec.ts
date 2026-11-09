import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import {
  endOfferScene,
  offerAnswer,
  offerScene,
  P28_15_EVENT,
  P28_15_INES,
  P28_15_INES_TYPED,
  P28_15_OWEN,
  P28_15_OWEN_TYPED,
  P28_15_SITE,
} from "./p28/28-15-data";

// Phase 28, 28.15 (docs/screens.md "The casual app, Phase 28", 28.15): "Offered to you" on Home,
// above "Shifts you can take", with "No thanks". In a real browser, as made-up casuals of this
// spec's own (tests/e2e/p28/28-15-data.ts): Ines sees her offer (role · event, day, times and site,
// "Offered 21:20. First to take it gets it.", no deadline), on a phone (390px) and on Dylan's laptop
// (1,280px at 150%), light and dark, each with a screenshot kept with the run; the section is hidden
// in the copy kept for no signal; she taps "No thanks", confirms, sees "Done. You won't be offered
// this shift again." and the row is gone, and the offer is stored as declined and logged. Owen opens
// his offer and takes it with "Take shift".

const acme = "http://acme.localhost:3100";

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

async function logIn(
  browser: Browser,
  typed: string,
  casual: { firstName: string; mobileE164: string },
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "10.240.28.15" } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(typed);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(casual.mobileE164, asked));
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

test("Offered to you: shown above Shifts you can take, hidden offline, and 'No thanks' declines it", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene = await offerScene(P28_15_INES);
  try {
    const session = await logIn(browser, P28_15_INES_TYPED, P28_15_INES);
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
          extraHTTPHeaders: { "x-real-ip": "10.240.28.15" },
        });
        try {
          const page = await context.newPage();
          const where = (what: string) =>
            `${what} at ${size.name} (${size.viewport.width}px), ${theme}`;
          await page.goto(`${acme}/`);
          const offered = page.getByRole("region", { name: "Offered to you", exact: true });
          await expect(offered, where("the section")).toBeVisible();
          const canTake = page.getByRole("region", { name: "Shifts you can take", exact: true });
          const [o, c] = [await offered.boundingBox(), await canTake.boundingBox()];
          expect(o && c && o.y + o.height <= c.y, where("above Shifts you can take")).toBe(true);

          const row = offered.locator(`li[data-offer="${scene.shiftId}"]`);
          await expect(row).toHaveCount(1);
          await expect(row).toContainText(`Steward · ${P28_15_EVENT}`);
          await expect(row).toContainText(P28_15_SITE);
          await expect(row).toContainText(/Offered \d\d:\d\d\. First to take it gets it\./);
          await expect(offered).not.toContainText(/answer by|expires/i);
          const link = row.getByRole("link");
          await expect(link).toHaveAttribute("href", `/shifts/${scene.shiftId}`);
          const noThanks = row.getByRole("button", { name: "No thanks" });
          const tap = await noThanks.boundingBox();
          expect(tap?.height ?? 0, where("No thanks' tap target")).toBeGreaterThanOrEqual(44);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
            where("sideways"),
          ).toBe(0);
          await shoot(page, testInfo, `28.15 offered ${size.name} ${theme}`);

          // The copy kept for no signal: the section needs signal, so it goes.
          await page.evaluate(() =>
            document.querySelector("[data-offline-notice]")?.removeAttribute("hidden"),
          );
          await expect(offered, where("hidden offline")).toBeHidden();
        } finally {
          await context.close();
        }
      }

    // "No thanks", the step, "Yes, say no": the row goes and she's told.
    const context = await browser.newContext({
      storageState: session,
      viewport: SIZES[0].viewport,
      isMobile: true,
      hasTouch: true,
      locale: "en-GB",
      extraHTTPHeaders: { "x-real-ip": "10.240.28.15" },
    });
    try {
      const page = await context.newPage();
      await page.goto(`${acme}/`);
      const offered = page.getByRole("region", { name: "Offered to you", exact: true });
      const row = offered.locator(`li[data-offer="${scene.shiftId}"]`);
      await row.getByRole("button", { name: "No thanks" }).click();
      const step = row.getByRole("group", { name: "Say no to this shift?" });
      await expect(step).toContainText(
        "We won't offer it to you again. You can still take it from the shift's page while it's open.",
      );
      // "Keep the offer" closes the step and changes nothing.
      await step.getByRole("button", { name: "Keep the offer" }).click();
      await expect(step).toHaveCount(0);
      expect((await offerAnswer(scene.offerId)).response).toBeNull();
      await row.getByRole("button", { name: "No thanks" }).click();
      await row.getByRole("button", { name: "Yes, say no" }).click();
      await expect(offered.getByRole("status")).toContainText(
        "Done. You won't be offered this shift again.",
      );
      await expect(offered.getByRole("status")).toContainText(
        "You can still take it from the shift's page while it's open.",
      );
      await expect(offered.getByRole("link", { name: "Open the shift" })).toHaveAttribute(
        "href",
        `/shifts/${scene.shiftId}`,
      );
      await expect(row).toHaveCount(0);
      expect(await offerAnswer(scene.offerId)).toEqual({ response: "declined", declinedLogged: 1 });
      // Home made again: the section is gone.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Offered to you" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await endOfferScene(scene);
  }
});

test("Offered to you: another casual opens his offer and takes it", async ({ browser }) => {
  test.setTimeout(120_000);
  const scene = await offerScene(P28_15_OWEN);
  try {
    const session = await logIn(browser, P28_15_OWEN_TYPED, P28_15_OWEN);
    const context = await browser.newContext({
      storageState: session,
      viewport: SIZES[0].viewport,
      isMobile: true,
      hasTouch: true,
      locale: "en-GB",
      extraHTTPHeaders: { "x-real-ip": "10.240.28.15" },
    });
    try {
      const page = await context.newPage();
      await page.goto(`${acme}/`);
      const offered = page.getByRole("region", { name: "Offered to you", exact: true });
      const row = offered.locator(`li[data-offer="${scene.shiftId}"]`);
      await row.getByRole("link").click();
      await expect(page).toHaveURL(`${acme}/shifts/${scene.shiftId}`);
      await page.getByRole("button", { name: "Take shift" }).click();
      await expect(page.getByText("You're booked.")).toBeVisible();
      expect((await offerAnswer(scene.offerId)).response).toBe("accepted");
      await page.goto(`${acme}/`);
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Offered to you" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    await endOfferScene(scene);
  }
});

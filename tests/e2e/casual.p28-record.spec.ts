import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import { P28_4_CASUAL, P28_4_TYPED, recordScene } from "./p28/28-4-data";

// Phase 28, 28.4 (docs/screens.md "The casual app, Phase 28", "### 28.4"): Your shift record. In a
// real browser, as a made-up casual of this spec's own (tests/e2e/p28/28-4-data.ts, every row made
// by the real code): her own cancellations (a strike, and one with no strike), an office move for
// the weather, an offer, and a session the office cancelled at the client's request (no link). On
// a phone (390px) and on Dylan's laptop (1,280px at 150%), light and dark, each with a screenshot
// kept with the run (test-results, and attached to the report); no sideways scroll; the Shifts tab
// is lit.

const acme = "http://acme.localhost:3100";
const RUN = Date.now().toString(36);

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

async function logIn(
  browser: Browser,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "10.240.28.4" } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P28_4_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_4_CASUAL.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { name: `Hi ${P28_4_CASUAL.firstName}` })).toBeVisible();
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

// The row of `title` about the session at `site`.
const rowOf = (page: Page, title: string, site: string): Locator =>
  page.getByRole("listitem").filter({ hasText: title }).filter({ hasText: site });

test("Your shift record: her offers, bookings, the office's changes and her cancellations, phone and laptop, light and dark", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene = await recordScene(`${RUN}${testInfo.retry || ""}`);
  const session = await logIn(browser);

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
        extraHTTPHeaders: { "x-real-ip": "10.240.28.4" },
      });
      try {
        const page = await context.newPage();
        const where = `${size.name} (${size.viewport.width}px), ${theme}`;
        await page.goto(`${acme}/shifts/record`);
        await expect(
          page.getByRole("heading", { level: 1, name: "Your shift record" }),
          where,
        ).toBeVisible();
        await expect(
          page.getByText(
            "Every offer, booking, change and cancellation for you in the last 90 days, with the notice you had.",
          ),
        ).toBeVisible();
        // Made just now: under today's heading (yesterday's, if the run crossed midnight).
        await expect(
          page.getByRole("heading", { level: 2, name: /^(Today|Yesterday)$/ }).first(),
        ).toBeVisible();

        // Her strike, as it stands, with her reference and her own reason.
        const struck = rowOf(page, "You cancelled", scene.sites.strike);
        await expect(struck).toContainText(`Reference ${scene.refs.strike}`);
        await expect(struck).toContainText("Your reason: Travel problem");
        await expect(struck).toContainText(/You gave \d+ hours' notice\./);
        await expect(struck.getByText("Strike", { exact: true })).toBeVisible();

        // Days of notice: no strike.
        const calm = rowOf(page, "You cancelled", scene.sites.calm);
        await expect(calm).toContainText(`Reference ${scene.refs.calm}`);
        await expect(calm).toContainText("Your reason: I'm unwell");
        await expect(calm).toContainText(/You gave \d+ days' notice\./);
        await expect(calm.getByText("No strike", { exact: true })).toBeVisible();

        // The office's move: from and to, its reason, the notice she had; a link to the shift.
        const moved = rowOf(page, "Moved by the office", scene.sites.moved);
        // ("… to 22:00", "… to 04:00 Tue" or "… to midnight", by the hour the run starts.)
        await expect(moved).toContainText(/From \w{3} \d+ \w{3}, \d\d:\d\d to /);
        await expect(moved).toContainText(/To \w{3} \d+ \w{3}, \d\d:\d\d to /);
        await expect(moved).toContainText("Weather or safety");
        await expect(moved).toContainText(/You had \d+ days' notice\./);
        await expect(moved.getByRole("link")).toHaveAttribute(
          "href",
          `/shifts/${scene.shiftIds.moved}`,
        );
        await expect(rowOf(page, "Booked by you", scene.sites.moved)).toBeVisible();

        // The offer, with its link.
        const offered = rowOf(page, "Offered to you", scene.sites.offered);
        await expect(offered).toContainText(/You had \d+ days' notice\./);
        await expect(offered.getByRole("link")).toHaveAttribute(
          "href",
          `/shifts/${scene.shiftIds.offered}`,
        );

        // The session the office cancelled at the client's request: no link, no strike words.
        const gone = rowOf(page, "Cancelled by the office", scene.sites.gone);
        await expect(gone).toContainText("The event was cancelled");
        await expect(gone).toContainText("The client asked.");
        await expect(gone.getByRole("link")).toHaveCount(0);
        await expect(gone).not.toContainText("strike");
        await expect(page.locator(`a[href="/shifts/${scene.shiftIds.gone}"]`)).toHaveCount(0);

        // Never anyone's name from the office, and the foot's way to ask for older records.
        await expect(page.getByRole("main")).not.toContainText("Record Resourcer");
        await expect(page.getByRole("link", { name: "ask the office for a copy" })).toHaveAttribute(
          "href",
          "/messages",
        );

        // The Shifts tab is lit; nothing scrolls sideways.
        await expect(
          page.getByRole("navigation", { name: "Main" }).locator('a[aria-current="page"]'),
        ).toContainText("Shifts");
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
          where,
        ).toBe(0);
        await shoot(page, testInfo, `28.4 record ${size.name} ${theme}`);
      } finally {
        await context.close();
      }
    }
});

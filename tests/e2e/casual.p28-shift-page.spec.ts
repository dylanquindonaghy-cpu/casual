import { readFile } from "node:fs/promises";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import { P28_5_CASUAL, P28_5_TYPED, shiftPageScene, type ShiftPageScene } from "./p28/28-5-data";

// Phase 28, 28.5 (docs/screens.md "The casual app, Phase 28" 28.5): a shift's page on 28.1's parts,
// with every way to the office a working link. In a real browser, as a made-up casual of this
// spec's own (tests/e2e/p28/28-5-data.ts): an urgent open session (the urgent slip, the firm's
// name in the page's own bar, "Ask the office about the pay" with 28.2's link, the strike note
// inside the notice, the travel line's one sentence); her booking starting within 3 hours
// ("Running late?", "Add to my calendar" downloading text/calendar); and her booking the office
// moved and changed since she booked ("The times changed. Add it to your calendar again.",
// "Changed since you booked: …", with no other casual's id anywhere on the page). Then each of the
// three at 390px and 1,280px (at 150%), light and dark, with a screenshot kept with the run.
// Messages' own "About" line for the link is 28.6's to check.

const acme = "http://acme.localhost:3100";
const IP = "10.240.28.5";

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

async function logIn(
  browser: Browser,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": IP } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P28_5_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_5_CASUAL.mobileE164, asked));
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

// A link's or button's box: every target on the casual's page is at least 44px tall.
async function height(page: Page, name: string): Promise<number> {
  const box = await page.getByRole("link", { name, exact: true }).first().boundingBox();
  return box?.height ?? 0;
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("the shift page: the urgent slip, the firm's name, working links to the office, Running late?, Add to my calendar and what changed since she booked", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const scene: ShiftPageScene = await shiftPageScene();
  const session = await logIn(browser);
  const context = await browser.newContext({
    storageState: session,
    viewport: SIZES[0].viewport,
    deviceScaleFactor: SIZES[0].scale,
    isMobile: true,
    hasTouch: true,
    locale: "en-GB",
    acceptDownloads: true,
    extraHTTPHeaders: { "x-real-ip": IP },
  });
  try {
    const page = await context.newPage();

    // The urgent open session.
    // A shift she can't see names nothing in the tab (Phase 37.6, w1-09).
    await page.goto(`${acme}/shifts/6f9619ff-8b86-4011-b42d-00c04fc964ff`);
    await expect(page.getByText("This shift isn't available.")).toBeVisible();
    await expect(page).toHaveTitle("Shift not available · Acme Events shifts");
    await page.goto(`${acme}/shifts/${scene.urgent}`);
    // Its tab names the shift: role and day (Phase 37.6, w1-09).
    await expect(page).toHaveTitle(/^[^·]+, \w{3} \d{1,2} \w{3} · Acme Events shifts$/);
    const bar = page.locator("[data-own-bar]");
    await expect(bar.getByRole("link", { name: "Open shifts" })).toBeVisible();
    // The firm's name, beside its initial tile (aria-hidden).
    await expect(
      bar.locator("[data-firm]").getByText("Acme Events", { exact: true }),
    ).toBeVisible();
    const slip = page.locator('[data-slip="urgent"]').first();
    await expect(slip).toHaveText("Urgent, needed now");
    await expect(page.locator(".bg-urgent-fill")).toHaveCount(0);
    // No chips of what it needs under the role; places on a tag.
    await expect(page.locator("[data-requirements]")).toHaveCount(0);
    await expect(page.locator("[data-places-left]")).toHaveText("The last place");
    // Getting there: no travel area, so one sentence, never figure tiles.
    await expect(page.locator("[data-travel-line]")).toBeVisible();
    // The strike note inside the firm's notice names the hours.
    await expect(
      page
        .locator("[data-action-bar]")
        .getByText(/^This shift starts in \d+ hours?\. If you cancel it, you'll get a strike\.$/),
    ).toBeVisible();
    // The pay: no rate set, so a link to Messages about it (28.2's contract).
    await expect(page.getByText("Not given yet.")).toBeVisible();
    const pay = page.getByRole("link", { name: "Ask the office about the pay" });
    await expect(pay).toHaveAttribute("href", `/messages?shift=${scene.urgent}&about=pay`);
    expect(await height(page, "Ask the office about the pay")).toBeGreaterThanOrEqual(44);
    expect(await sideways(page)).toBe(0);
    await pay.click();
    await expect(page).toHaveURL(`${acme}/messages?shift=${scene.urgent}&about=pay`);

    // Her booking starting within 3 hours.
    await page.goto(`${acme}/shifts/${scene.soon}`);
    await expect(
      page.locator("[data-own-bar]").getByRole("link", { name: "Your shifts" }),
    ).toBeVisible();
    await expect(page.getByText("You're booked on this shift")).toBeVisible();
    const late = page.getByRole("link", { name: "Running late?" });
    await expect(late).toHaveAttribute("href", `/messages?shift=${scene.soon}&about=late`);
    expect(await height(page, "Running late?")).toBeGreaterThanOrEqual(44);
    const calendar = page.getByRole("link", { name: "Add to my calendar" });
    await expect(calendar).toHaveAttribute("href", `/shifts/${scene.soon}/calendar`);
    expect(await height(page, "Add to my calendar")).toBeGreaterThanOrEqual(44);
    await expect(page.getByText("The times changed. Add it to your calendar again.")).toHaveCount(
      0,
    );
    const [download] = await Promise.all([page.waitForEvent("download"), calendar.click()]);
    expect(download.suggestedFilename()).toMatch(/^shift-\d{4}-\d{2}-\d{2}\.ics$/);
    const path = await download.path();
    const ics = await readFile(path, "utf8");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain(`URL:${acme}/shifts/${scene.soon}`);
    expect(ics).not.toMatch(/pay|£/i);
    // Served as a calendar, never cached; not hers: not found.
    const served = await page.request.get(`${acme}/shifts/${scene.soon}/calendar`);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(served.headers()["cache-control"]).toBe("private, no-store");
    expect((await page.request.get(`${acme}/shifts/${scene.urgent}/calendar`)).status()).toBe(404);
    await late.click();
    await expect(page).toHaveURL(`${acme}/messages?shift=${scene.soon}&about=late`);

    // Her booking the office moved and changed since she booked.
    await page.goto(`${acme}/shifts/${scene.moved}`);
    await expect(page.getByText("The times changed. Add it to your calendar again.")).toBeVisible();
    await expect(
      page.getByText(
        /^Changed since you booked: instructions and meeting point \(\w{3} \d{1,2} \w{3}, \d{2}:\d{2}\)$/,
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Running late?" })).toHaveCount(0);
    expect(await page.content()).not.toContain(scene.otherCasual);
  } finally {
    await context.close();
  }

  // Each of the three at a phone's and a laptop's size, light and dark.
  for (const size of SIZES)
    for (const theme of THEMES) {
      const look = await browser.newContext({
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
        const page = await look.newPage();
        for (const [name, id] of [
          ["urgent", scene.urgent],
          ["soon", scene.soon],
          ["moved", scene.moved],
        ] as const) {
          await page.goto(`${acme}/shifts/${id}`);
          await expect(
            page.locator("[data-own-bar] [data-firm]").getByText("Acme Events", { exact: true }),
          ).toBeVisible();
          expect(await sideways(page), `${name} at ${size.name}, ${theme}`).toBe(0);
          await shoot(page, testInfo, `28.5 ${name} ${size.name} ${theme}`);
        }
      } finally {
        await look.close();
      }
    }
});

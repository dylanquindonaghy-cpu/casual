import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { OFFLINE_CACHE } from "../../src/lib/portal/offline";
import { expect, test } from "./fixtures";
import { loginLinkSentTo, sentTo } from "./outbox";
import {
  endStillComingScene,
  P28_14_CASUAL,
  P28_14_TYPED,
  saidComingAt,
  stillComingScene,
  type StillComingScene,
} from "./p28/28-14-data";

// Phase 28, 28.14 (docs/screens.md "The casual app, Phase 28" 28.14): "Still coming?" in the day
// before a booked shift. In a real browser, as a made-up casual of this spec's own booked on a
// session about 20 hours away (tests/e2e/p28/28-14-data.ts), with the office user who looks after
// its venue's contract:
// - the office's Coming up first says "Not answered yet" beside her name;
// - Home's pass shows "Still coming?", and the copy kept for no signal shows no card (online only);
// - she opens the shift from the reminder's link (`/shifts/{id}`, the reminders' own link);
//   "Can't make it?" there opens the cancel sheet (kept: nothing cancelled); "Yes, I'm coming"
//   says "Thanks. The office can see you're coming." and the card then reads "You said you're
//   coming (…)", and the booking records when;
// - the office's Coming up then says "Coming" with the time.
// Then the shift's page and Home at 390px and 1,280px (at 150%), light and dark, with a screenshot
// of each kept with the run, and the dashboard's Coming up the same.

const acme = "http://acme.localhost:3100";
const IP = "10.240.28.14";

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
    await page.getByLabel("Your mobile number").fill(P28_14_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P28_14_CASUAL.mobileE164, asked));
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

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const hasCopy = (page: Page) =>
  page.evaluate(async (name) => !!(await (await caches.open(name)).match("/")), OFFLINE_CACHE);

// Her row on the dashboard's Coming up.
const herRow = (page: Page, scene: StillComingScene) =>
  page
    .locator(`section#coming-up [data-coming-up="${scene.shiftId}"] li`)
    .filter({ has: page.getByRole("link", { name: "Tess Comer", exact: true }) });

test("Still coming?: Not answered yet, then online only on Home, Can't make it? opens the sheet, Yes, I'm coming, and Coming on the dashboard", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const tag = `${Date.now() % 100_000}${testInfo.retry}`;
  const email = `still.coming${testInfo.retry || ""}@example.com`;
  const scene = await stillComingScene(tag, email);
  const office = await browser.newContext({
    viewport: SIZES[1].viewport,
    deviceScaleFactor: SIZES[1].scale,
    locale: "en-GB",
  });
  try {
    // The office, before she answers: "Not answered yet", in grey, in full for a screen reader.
    const desk = await office.newPage();
    await officeLogin(desk, email);
    const before = herRow(desk, scene);
    await expect(before).toHaveCount(1);
    await expect(before.getByText("Not answered yet", { exact: true })).toBeVisible();
    await expect(
      before.getByText("Tess Comer hasn't said yet if they're coming.", { exact: true }),
    ).toHaveCount(1);
    await expect(before.locator('[data-still-coming="coming"]')).toHaveCount(0);

    const session = await logIn(browser);
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

      // Home: her pass holds "Still coming?" (with "Can't make it?" inside it).
      await page.goto(`${acme}/`);
      const pass = page.getByRole("region", { name: "Your next shift" });
      await expect(pass).toContainText(scene.site);
      const card = pass.getByRole("region", { name: "Still coming?" });
      await expect(card).toBeVisible();
      await expect(card.getByRole("button", { name: "Yes, I'm coming" })).toBeEnabled();
      await expect(card.getByRole("button", { name: "Can't make it?" })).toBeVisible();

      // The copy kept for no signal: no card (nor the cancel button inside it).
      await expect.poll(() => hasCopy(page), { timeout: 15_000 }).toBe(true);
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByText("No signal.")).toBeVisible();
      await expect(page.getByRole("region", { name: "Your next shift" })).toContainText(scene.site);
      await expect(page.locator("[data-still-coming]")).toBeHidden();
      await expect(page.getByText("Still coming?")).toBeHidden();
      await expect(page.getByRole("button", { name: "Yes, I'm coming" })).toBeHidden();
      await context.setOffline(false);
      // Since 29.6 the kept copy reloads itself when signal returns: let that land first, so it
      // can't replace the page opened next.
      await expect(page.getByText("No signal.")).toBeHidden({ timeout: 10_000 });

      // From the reminder's link: the shift's own page.
      await page.goto(`${acme}/shifts/${scene.shiftId}`);
      const ask = page.getByRole("region", { name: "Still coming?" });
      await expect(ask).toBeVisible();
      const yes = ask.getByRole("button", { name: "Yes, I'm coming" });
      await expect(yes).toBeEnabled();
      // Every target at least 44px tall.
      expect((await yes.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      // "Can't make it?" opens the cancel sheet, unchanged; she keeps her shift.
      await ask.getByRole("button", { name: "Can't make it?" }).click();
      const sheet = page.getByRole("dialog", { name: "Can't make it?" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Cancel this shift" })).toBeVisible();
      await sheet.getByRole("button", { name: "Keep my shift" }).first().click();
      await expect(sheet).toBeHidden();
      expect(await saidComingAt(scene)).toBeNull();

      // "Yes, I'm coming": the thanks, then the card says when.
      await yes.click();
      await expect(
        ask.getByRole("status").getByText("Thanks. The office can see you're coming.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(ask.getByText(/^You said you're coming \(\w{3} \d\d:\d\d\)$/)).toBeVisible();
      await expect(ask.getByRole("button", { name: "Yes, I'm coming" })).toHaveCount(0);
      await expect.poll(() => saidComingAt(scene)).not.toBeNull();
      // Opened again, it still says so.
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: "Still coming?" })
          .getByText(/^You said you're coming \(\w{3} \d\d:\d\d\)$/),
      ).toBeVisible();
    } finally {
      await context.close();
    }

    // The office: "Coming" with the time, in green.
    await desk.reload();
    const after = herRow(desk, scene);
    await expect(after.getByText(/^Coming \d\d:\d\d$/)).toBeVisible();
    await expect(
      after.getByText(/^Tess Comer said they're coming, at \d\d:\d\d on \w{3} \d{1,2} \w{3}\.$/),
    ).toHaveCount(1);
    await expect(after.getByText("Not answered yet", { exact: true })).toHaveCount(0);

    // The look: the shift's page and Home at both sizes, light and dark; Coming up too.
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
          for (const [name, path] of [
            ["shift page", `/shifts/${scene.shiftId}`],
            ["home", "/"],
          ] as const) {
            await page.goto(`${acme}${path}`);
            await expect(page.getByRole("region", { name: "Still coming?" })).toBeVisible();
            expect(await sideways(page), `${name} at ${size.name}, ${theme}`).toBe(0);
            await shoot(page, testInfo, `28.14 ${name} ${size.name} ${theme}`);
          }
        } finally {
          await look.close();
        }
        await desk.setViewportSize(size.viewport);
        await desk.emulateMedia({ colorScheme: theme });
        await desk.reload();
        await expect(herRow(desk, scene).getByText(/^Coming \d\d:\d\d$/)).toBeVisible();
        expect(await sideways(desk), `Coming up at ${size.name}, ${theme}`).toBe(0);
        await shoot(desk, testInfo, `28.14 coming up ${size.name} ${theme}`);
      }
  } finally {
    await office.close();
    await endStillComingScene(scene);
  }
});

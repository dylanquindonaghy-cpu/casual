import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import {
  P30_1_KIT,
  P30_1_ZARA,
  P30_1_ZARA_TYPED,
  p30HomeScene,
  type P30Scene,
} from "./p30/30-1-data";

// Phase 30, 30.1 (docs/screens.md "## Phase 30", "### 30.1"): Home as the casual's dashboard. In a
// real browser, as a made-up casual of this spec's own (tests/e2e/p30/30-1-data.ts), on a phone
// (390px) and on Dylan's laptop (1,280px at 150%), light and dark, each with a screenshot kept with
// the run: the date line; her counts, each with the number its page counts and a link there; her
// next shift's line ("Starts in …", the hours, the pay estimate); "Your qualifications" with its
// rows and pills, worst first; a booked day in "Your week" by its name; "Updates" with her booking
// and "See the shift"; "Your record"'s figures; no sideways scroll; every link and button at least
// 44px; and at 1,280px the next shift and the qualifications side by side. Another casual's
// booking never shows.

const acme = "http://acme.localhost:3100";

const SIZES = [
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
  { name: "laptop", viewport: { width: 1280, height: 800 }, scale: 1.5, mobile: false },
] as const;
const THEMES = ["light", "dark"] as const;

async function logIn(
  browser: Browser,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "10.240.30.1" } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(P30_1_ZARA_TYPED);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(P30_1_ZARA.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { name: `Hi ${P30_1_ZARA.firstName}` })).toBeVisible();
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

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not on screen");
  return { ...b, bottom: b.y + b.height, right: b.x + b.width };
}

// "Monday 9 November", "14:00", in London, as the page says them.
const longDay = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(d)
    .replace(",", "");
const clock = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);

// The count a page shows for itself: the open list's "{n} shifts", the urgent board's rows, the
// Booked tab's "Upcoming {n}".
async function pageCounts(page: Page) {
  await page.goto(`${acme}/shifts/open`);
  await expect(page.getByRole("heading", { level: 1, name: "Open shifts" })).toBeVisible();
  const openWords = await page
    .getByText(/^\d+ shifts?$/)
    .first()
    .innerText();
  await page.goto(`${acme}/urgent`);
  await expect(page.getByRole("heading", { level: 1, name: "Urgent shifts" })).toBeVisible();
  const urgent = await page
    .getByRole("region", { name: "Urgent, needed now" })
    .locator(":scope > ul > li")
    .count();
  await page.goto(`${acme}/shifts`);
  const upcoming = await page
    .getByRole("navigation", { name: "Which shifts" })
    .getByRole("link", { name: /^Upcoming/ })
    .innerText();
  return {
    open: Number(openWords.match(/\d+/)?.[0]),
    urgent,
    booked: Number(upcoming.match(/\d+/)?.[0] ?? "0"),
  };
}

let scene: P30Scene;

test("Home as her dashboard: counts, qualifications, week, updates, record; phone and laptop, light and dark", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  scene = await p30HomeScene();
  const session = await logIn(browser);

  // What each page counts for itself, once, to hold Home's counts to.
  const counted = await (async () => {
    const context = await browser.newContext({
      storageState: session,
      extraHTTPHeaders: { "x-real-ip": "10.240.30.1" },
    });
    try {
      return await pageCounts(await context.newPage());
    } finally {
      await context.close();
    }
  })();
  expect(counted.booked).toBe(1);
  expect(counted.open).toBe(2);
  expect(counted.urgent).toBe(1);

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
        extraHTTPHeaders: { "x-real-ip": "10.240.30.1" },
      });
      try {
        const page = await context.newPage();
        const where = (what: string) =>
          `${what} at ${size.name} (${size.viewport.width}px), ${theme}`;
        await page.goto(`${acme}/`);
        const hi = page.getByRole("heading", { level: 1, name: `Hi ${P30_1_ZARA.firstName}` });
        await expect(hi).toBeVisible();

        // The date line under the headline: "Friday 6 November · Updated 15:38".
        const dateLine = page.locator("[data-date-line]");
        await expect(dateLine).toHaveText(
          new RegExp(`^${longDay(new Date())} · Updated \\d\\d:\\d\\d$`),
        );
        expect(
          (await box(dateLine)).y,
          where("date line under the headline"),
        ).toBeGreaterThanOrEqual((await box(hi)).bottom - 1);

        // The counts, each the number its page counts, each a link to it.
        const counts = page.getByRole("list", { name: "Your numbers" });
        const chip = (name: RegExp) => counts.getByRole("link", { name });
        await expect(chip(/^Booked \d+$/)).toHaveText(`Booked ${counted.booked}`);
        await expect(chip(/^Booked/)).toHaveAttribute("href", "/shifts");
        await expect(chip(/^Open to you/)).toHaveText(`Open to you ${counted.open}`);
        await expect(chip(/^Open to you/)).toHaveAttribute("href", "/shifts/open");
        await expect(chip(/^Urgent/)).toHaveText(`Urgent ${counted.urgent}`);
        await expect(chip(/^Urgent/)).toHaveAttribute("href", "/urgent");
        await expect(chip(/^To do/)).toHaveText("To do 1"); // her photo, due soon
        await expect(chip(/^To do/)).toHaveAttribute("href", "#do-this-heading");
        await expect(chip(/^Messages/)).toHaveText("Messages 1");
        await expect(chip(/^Messages/)).toHaveAttribute("href", "/messages");
        // The row scrolls inside itself, never the page.
        expect(
          await counts.evaluate((el) => getComputedStyle(el).overflowX),
          where("the counts' row"),
        ).toBe("auto");

        // Her next shift's line: how soon, how long, the pay estimate.
        const pass = page.getByRole("region", { name: "Your next shift" });
        await expect(pass.locator("[data-next-line]")).toHaveText(
          /^Starts in (?:\d+ hours|3 days) · 8 hours · about £108\.00 before tax$/,
        );

        // Your qualifications: worst first, each with its pill; the photo's row to Profile.
        const quals = page.getByRole("region", { name: "Your qualifications" });
        const rows = quals.locator("li[data-qual]");
        await expect(rows).toHaveCount(4);
        await expect(rows.nth(0)).toContainText("Staff photo");
        await expect(rows.nth(0)).toContainText(/\d+ days left/);
        await expect(rows.nth(0)).toContainText("Take a new photo");
        await expect(rows.nth(0).getByRole("link")).toHaveAttribute(
          "href",
          "/profile#photo-heading",
        );
        await expect(rows.nth(1)).toContainText("Right to work");
        await expect(rows.nth(1)).toContainText("Not recorded");
        await expect(rows.nth(2)).toContainText("SIA door supervisor licence");
        await expect(rows.nth(2)).toContainText("Valid · 420 days");
        await expect(rows.nth(3)).toContainText("Level 2 spectator safety qualification");
        await expect(rows.nth(3)).toContainText("No expiry");
        await expect(quals.getByRole("link", { name: "All on Profile" })).toHaveAttribute(
          "href",
          "/profile#qualifications-heading",
        );

        // Your week: her booked day by its name, linked to that shift; Kit's never.
        const week = page.getByRole("region", { name: "Your week" });
        const bookedName = `${longDay(scene.booked.startsAt)}: booked, P30 home check ${clock(
          scene.booked.startsAt,
        )} to ${clock(scene.booked.endsAt)}`;
        const bookedDay = week.getByRole("link", { name: bookedName, exact: true });
        await expect(bookedDay).toHaveAttribute("href", `/shifts/${scene.booked.shiftId}`);
        await expect(week.locator(`a[href="/shifts/${scene.kitBooked.shiftId}"]`)).toHaveCount(0);
        await expect(
          week.getByText("Filled: booked · outlined: shifts you can take"),
        ).toBeVisible();

        // Shifts you can take: its count beside its heading.
        const canTake = page.getByRole("region", { name: "Shifts you can take", exact: true });
        await expect(canTake.locator("span[data-online-only]").first()).toHaveText(
          String(counted.open),
        );

        // Updates: her own booking first, with "See the shift"; Kit's never.
        const updates = page.getByRole("region", { name: "Updates" });
        const first = updates.locator("li[data-update]").first();
        await expect(first).toContainText("Booked by you");
        await expect(first).toContainText(scene.booked.site);
        await expect(first.getByRole("link", { name: "See the shift" })).toHaveAttribute(
          "href",
          `/shifts/${scene.booked.shiftId}`,
        );
        await expect(updates).not.toContainText(scene.kitBooked.site);
        await expect(page.locator("main")).not.toContainText(P30_1_KIT.firstName);

        // Your record: Profile's figures.
        const record = page.getByRole("region", { name: "Your record" });
        await expect(record.locator("[data-figure='worked'] dd")).toHaveText("0");
        await expect(record.locator("[data-figure='reliability'] dd")).toHaveText("New");
        await expect(record.locator("[data-figure='reliability'] dt")).toHaveText(
          "score after 5 shifts",
        );

        // No sideways scroll; every link and button at least 44px (the week's tiles both ways).
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
          where("sideways"),
        ).toBe(0);
        const small = await page.evaluate(() =>
          [...document.querySelectorAll("main a, main button, main summary")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              const s = getComputedStyle(el);
              return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
            })
            .filter((el) => el.getBoundingClientRect().height < 44)
            .map((el) => `${el.tagName} "${(el.textContent ?? "").trim().slice(0, 40)}"`),
        );
        expect(small, where("targets under 44px tall")).toEqual([]);
        for (const tile of await week.getByRole("link").all()) {
          const b = await box(tile);
          expect(Math.min(b.width, b.height), where("a day tile")).toBeGreaterThanOrEqual(44);
        }

        // On the laptop: the next shift and the qualifications side by side.
        if (!size.mobile) {
          const [p, q] = [await box(pass), await box(quals)];
          expect(q.x, where("qualifications beside the pass")).toBeGreaterThanOrEqual(p.right);
          expect(Math.abs(q.y - p.y), where("on one row")).toBeLessThan(40);
        }
        await shoot(page, testInfo, `30.1 home ${size.name} ${theme}`);
      } finally {
        await context.close();
      }
    }
});

import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginLinkSentTo } from "./outbox";
import {
  cutOff,
  noelScene,
  P28_7_NOEL,
  P28_7_NOEL_TYPED,
  P28_7_RHEA,
  P28_7_RHEA_TYPED,
  reachable,
  rheaScene,
} from "./p28/28-7-data";

// Phase 28, 28.7 (docs/screens.md "The casual app, Phase 28", 28.7): Home and the pass in the
// office's look, "Do this" with its two "can we reach you" rows, and one count on every tab bar. In
// a real browser, as made-up casuals of this spec's own (tests/e2e/p28/28-7-data.ts), on a phone
// (390px) and on Dylan's laptop (1,280px at 150%), light and dark, each with a screenshot kept with
// the run: "Hi Rhea" with "Updated 21:34" beside it (not in the firm's bar); "Do this", "Shifts you
// can take" and "Pay" each a glass section 12px round with its heading inside, 32px apart, rows 12px
// under the heading and 8px apart; no initials anywhere, her photo's row a camera; both rows for a
// casual nothing can reach whose alerts are off, each to Profile's How we reach you; the pass with
// no band, its "In 9 days" a pill and its gate an 8px plate; the same Profile count on Home, Booked
// and Messages. And with nothing booked, the empty pass with no dashed edge and "See open shifts".

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
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "10.240.28.7" } });
  try {
    const page = await context.newPage();
    const asked = new Date(Date.now() - 1000);
    await page.goto(`${acme}/login`);
    await page.getByLabel("Your mobile number").fill(typed);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await page.goto(await loginLinkSentTo(casual.mobileE164, asked));
    await page.getByRole("button", { name: "Log me in" }).click();
    await expect(page.getByRole("heading", { name: `Hi ${casual.firstName}` })).toBeVisible();
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

const radius = (l: Locator) => l.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

// The Profile tab's name (its count in words), as a screen reader hears it.
async function profileTab(page: Page): Promise<string> {
  const link = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /^Profile/ });
  return (await link.getAttribute("aria-label")) ?? (await link.innerText());
}

test("Home in the office's look, with both 'can we reach you' rows: phone and laptop, light and dark", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const scene = await rheaScene();
  const session = await logIn(browser, P28_7_RHEA_TYPED, P28_7_RHEA);
  // Logged in: now nothing can reach her (no phone, a STOP, no email) and her alerts are off.
  await cutOff(scene.workerId);
  try {
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
          extraHTTPHeaders: { "x-real-ip": "10.240.28.7" },
        });
        try {
          const page = await context.newPage();
          const where = (what: string) =>
            `${what} at ${size.name} (${size.viewport.width}px), ${theme}`;
          await page.goto(`${acme}/`);
          const hi = page.getByRole("heading", { level: 1, name: `Hi ${P28_7_RHEA.firstName}` });
          await expect(hi).toBeVisible();

          // "Updated 21:34" beside the headline, on its line; not at the end of the firm's bar.
          const stamp = page.getByText(/^Updated \d\d:\d\d$/);
          await expect(stamp).toBeVisible();
          const [h, s] = [await box(hi), await box(stamp)];
          expect(s.x, where("Updated after the headline")).toBeGreaterThanOrEqual(h.right);
          expect(s.y >= h.y - 1 && s.bottom <= h.bottom + 1, where("Updated on its line")).toBe(
            true,
          );
          await expect(page.getByTestId("brand-bar").getByText(/^Updated/)).toHaveCount(0);

          // Each section one glass section 12px round, its heading inside it.
          const regions: Record<string, Locator> = {};
          for (const name of ["Do this", "Shifts you can take", "Pay"]) {
            const region = page.getByRole("region", { name, exact: true });
            await expect(region, where(name)).toBeVisible();
            const heading = region.getByRole("heading", { level: 2, name, exact: true });
            const [r, hd] = [await box(region), await box(heading)];
            expect(
              hd.x >= r.x && hd.y >= r.y && hd.right <= r.right && hd.bottom <= r.bottom,
              where(`${name}'s heading inside its section`),
            ).toBe(true);
            expect(await radius(region), where(name)).toBe("12px");
            regions[name] = region;
          }
          // 32px apart.
          const [doThis, canTake, pay] = [
            await box(regions["Do this"]!),
            await box(regions["Shifts you can take"]!),
            await box(regions["Pay"]!),
          ];
          expect(Math.round(canTake.y - doThis.bottom), where("sections apart")).toBe(32);
          expect(Math.round(pay.y - canTake.bottom), where("sections apart")).toBe(32);

          // "Do this": her photo (a camera, never her initials), then both rows, 12px under the
          // heading and 8px apart, each a tile at least 44px tall going to How we reach you.
          const section = regions["Do this"]!;
          const rows = section.locator("li[data-for-you]");
          await expect(rows).toHaveCount(3);
          expect(
            await rows.evaluateAll((li) => li.map((l) => l.getAttribute("data-for-you"))),
          ).toEqual(["needs", "reach", "alerts"]);
          await expect(section.locator('[data-for-you="needs"] svg').first()).toBeVisible();
          await expect(section).not.toContainText(/\bRC\b/);
          const heading = await box(section.getByRole("heading", { level: 2, name: "Do this" }));
          const boxes = [];
          for (let i = 0; i < 3; i++) boxes.push(await box(rows.nth(i)));
          expect(Math.round(boxes[0]!.y - heading.bottom), where("rows under heading")).toBe(12);
          expect(Math.round(boxes[1]!.y - boxes[0]!.bottom), where("rows apart")).toBe(8);
          expect(Math.round(boxes[2]!.y - boxes[1]!.bottom), where("rows apart")).toBe(8);
          for (const b of boxes) expect(b.height, where("row height")).toBeGreaterThanOrEqual(44);
          const reach = section.getByRole("link", { name: /^We can't reach you about shifts/ });
          await expect(reach).toHaveAccessibleName(
            "We can't reach you about shifts You'll miss offers and changes to your shifts. Choose how we reach you.",
          );
          await expect(reach).toHaveAttribute("href", "/profile#notify-heading");
          const alerts = section.getByRole("link", { name: /^Open-shift alerts are off/ });
          await expect(alerts).toHaveAccessibleName(
            "Open-shift alerts are off We won't tell you about open shifts. Turn them on.",
          );
          await expect(alerts).toHaveAttribute("href", "/profile#notify-heading");
          expect(await radius(reach), where("a row's tile")).toBe("8px");

          // Shifts you can take: its rows 8px apart too (the urgent one, then the rest).
          const take = regions["Shifts you can take"]!.locator("li[data-for-you]:visible");
          await expect(take).toHaveCount(2);
          const [t0, t1] = [await box(take.nth(0)), await box(take.nth(1))];
          expect(Math.round(t1.y - t0.bottom), where("rows apart")).toBe(8);

          // The pass: no band, 12px round; how soon a pill, the gate an 8px plate.
          const pass = page.getByRole("region", { name: "Your next shift" });
          const card = pass.locator(":scope > div.glass:not(#pass-details)");
          expect(await radius(card), where("the pass")).toBe("12px");
          expect(
            await card.evaluate((el) =>
              [el, ...el.querySelectorAll(":scope > div")].map(
                (d) => getComputedStyle(d).backgroundImage,
              ),
            ),
            where("no band"),
          ).toEqual(["none", "none", "none"]);
          const soon = pass.getByText(/^In \d+ days$/);
          const pill = await soon.evaluate((el) => ({
            r: parseFloat(getComputedStyle(el).borderTopLeftRadius),
            h: el.getBoundingClientRect().height,
          }));
          expect(pill.r, where("how soon, a pill")).toBeGreaterThanOrEqual(pill.h / 2);
          expect(await radius(pass.getByText("Gate 3", { exact: true })), where("gate")).toBe(
            "8px",
          );
          // No page scrolls sideways.
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
            where("sideways"),
          ).toBe(0);
          await shoot(page, testInfo, `28.7 home ${size.name} ${theme}`);

          // One count for every tab bar: the same Profile count on Home, Booked and Messages.
          const onHome = await profileTab(page);
          expect(onHome, where("Profile's count")).toMatch(/^Profile, \d+ things? needs? doing/);
          await page.goto(`${acme}/shifts`);
          await expect(
            page.getByRole("heading", { level: 1, name: "Booked shifts" }),
          ).toBeVisible();
          expect(await profileTab(page), where("Booked's Profile count")).toBe(onHome);
          await page.goto(`${acme}/messages`);
          await expect(page.getByRole("heading", { level: 1, name: "Messages" })).toBeVisible();
          expect(await profileTab(page), where("Messages' Profile count")).toBe(onHome);
        } finally {
          await context.close();
        }
      }
  } finally {
    await reachable(scene.workerId);
  }
});

test("nothing booked: the empty pass, with no dashed edge, and 'See open shifts' to Open shifts", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  await noelScene();
  const session = await logIn(browser, P28_7_NOEL_TYPED, P28_7_NOEL);
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
        extraHTTPHeaders: { "x-real-ip": "10.240.28.7" },
      });
      try {
        const page = await context.newPage();
        const where = (what: string) =>
          `${what} at ${size.name} (${size.viewport.width}px), ${theme}`;
        await page.goto(`${acme}/`);
        const empty = page.getByRole("region", { name: "No shifts booked" });
        await expect(empty).toBeVisible();
        const edge = await empty.evaluate((el) => ({
          style: getComputedStyle(el).borderTopStyle,
          width: getComputedStyle(el).borderTopWidth,
          radius: getComputedStyle(el).borderTopLeftRadius,
        }));
        expect(edge.style === "none" || edge.width === "0px", where("no dashed edge")).toBe(true);
        expect(edge.radius, where("the empty pass")).toBe("12px");
        await expect(page.getByRole("link", { name: "Find a shift" })).toHaveCount(0);
        const see = empty.getByRole("link", { name: "See open shifts", exact: true });
        await expect(see).toHaveAttribute("href", "/shifts/open");
        expect((await box(see)).height, where("the button")).toBeGreaterThanOrEqual(44);
        await shoot(page, testInfo, `28.7 home empty ${size.name} ${theme}`);
        if (size.mobile && theme === "light") {
          await see.click();
          await expect(page).toHaveURL(`${acme}/shifts/open`);
          await expect(page.getByRole("heading", { level: 1, name: "Open shifts" })).toBeVisible();
        }
      } finally {
        await context.close();
      }
    }
});

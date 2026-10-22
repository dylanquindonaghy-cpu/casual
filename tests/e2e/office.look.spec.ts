import type { Page } from "@playwright/test";
import { addOfficeUser, addQualifiedCasual } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office's look on every page (Phase 21; docs/ui-design.md "The office's system"): an admin
// opens each page in the menu on the brief's phone (390px) and on a wide screen (1440px), with the
// device set to light and again to dark. Each page sits on the office's warm off-white ground (a
// near-black in dark), has its headline in the serif, and never scrolls sideways (a wide table
// scrolls in its own box); its serif and Geist have really loaded; it has a white card or row (a
// near-black one in dark; near-white rows count) on that ground; and every main button is near-black (white in dark).
// Two records opened from inside a page too: a casual's page and a cancellation's record. With a
// casual of its own whose qualification has the longest words a
// chip shows ("Level 2 spectator safety qualification: Expiring soon"): it ran off a phone until a
// chip could wrap.

const acme = "http://acme.localhost:3100";
const CANVAS = { light: "rgb(246, 245, 243)", dark: "rgb(18, 18, 17)" }; // #f6f5f3, #121211
const CARD = { light: /^#f{3}(?:f{3})?$/i, dark: /^#1c1c1a$/i }; // white, #1c1c1a
const INK = { light: "rgb(28, 27, 24)", dark: "rgb(242, 241, 238)" }; // #1c1b18, #f2f1ee
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

async function adminLogin(page: Page, who: string) {
  const email = `look.${who}@example.com`;
  await addOfficeUser("acme", { email, name: "Lou Look", role: "admin" });
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

for (const device of ["light", "dark"] as const) {
  test.describe(`with the device set to ${device}`, () => {
    test.use({ colorScheme: device });

    test("every office page: the ground, the serif headline, nothing sideways, at 390px and 1440px", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await addQualifiedCasual(
        "acme",
        { firstName: "Lorna", lastName: "Longform", mobileE164: "+447700900877" },
        { roles: ["steward"], held: [{ type: "STEWARD_L2", daysAhead: 5 }] },
      );
      await adminLogin(page, device);
      // The pages: every link in an admin's menu (from the sidebar, the fold opened).
      await page.setViewportSize(WIDTHS[1]!);
      const menu = page.getByRole("navigation", { name: "Office menu" });
      await menu.locator('button[aria-expanded="false"]').click();
      const pages = await menu
        .getByRole("link")
        .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
      expect(pages.length).toBeGreaterThan(15);
      // Two records, from inside their lists.
      const firstLink = async (list: string, prefix: string) => {
        await page.goto(`${acme}${list}`);
        // A record's own page: no query, not the list's CSV export.
        const href = (
          await page
            .locator(`main a[href^="${prefix}"]`)
            .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""))
        ).find((h) => !h.includes("?") && !h.includes("/export"));
        expect(href, list).toBeTruthy();
        return href!;
      };
      const records = [
        await firstLink("/office/casuals", "/office/casuals/"),
        await firstLink("/office/cancellations", "/office/cancellations/"),
      ];
      expect(pages).toEqual(
        expect.arrayContaining([
          "/office",
          "/office/needs-attention",
          "/office/events",
          "/office/casuals",
          "/office/enquiries",
          "/office/cancellations",
          "/office/pay",
          "/office/log",
          "/office/settings",
          "/office/data",
        ]),
      );

      for (const size of WIDTHS) {
        await page.setViewportSize(size);
        for (const path of [...pages, ...records]) {
          const where = `${path} at ${size.width}px, ${device}`;
          await page.goto(`${acme}${path}`);
          const h1 = page.getByRole("heading", { level: 1 });
          await expect(h1, where).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const look = await page.evaluate(() => {
            const heading = document.querySelector("h1");
            // The dashboard's greeting is its first line (the serif); every other page's whole
            // headline.
            const serif = heading?.querySelector(".font-display") ?? heading;
            const main = document.querySelector("main");
            const familyOf = (el: Element | null | undefined) =>
              el ? getComputedStyle(el).fontFamily : "";
            // Loaded, not only asked for: the first face of each list, at its own size.
            const loaded = (el: Element | null | undefined) => {
              if (!el) return false;
              const style = getComputedStyle(el);
              const first = style.fontFamily.split(",")[0]!.trim();
              return document.fonts.check(`${style.fontWeight} ${style.fontSize} ${first}`);
            };
            // The cards and rows shown in the card's fill (Needs attention's rows are near-white:
            // the card colour at 80% on their panel), and what that fill is here.
            const cards = [...(main?.querySelectorAll("*") ?? [])].filter(
              (el) =>
                /(?:^|\s)(?:sm:)?bg-card(?:\/\d+)?(?:\s|$)/.test(el.getAttribute("class") ?? "") &&
                el.checkVisibility() &&
                getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)",
            ).length;
            const card = getComputedStyle(document.body).getPropertyValue("--color-card").trim();
            const primaries = [...(main?.querySelectorAll(".bg-ink.text-on-ink") ?? [])]
              .filter((el) => el.matches("a, button"))
              .map((el) => getComputedStyle(el).backgroundColor);
            return {
              ground: getComputedStyle(document.body).backgroundColor,
              face: familyOf(serif),
              faceLoaded: loaded(serif),
              words: familyOf(main),
              wordsLoaded: loaded(main),
              cards,
              card,
              primaries,
              wide: document.documentElement.scrollWidth,
              window: document.documentElement.clientWidth,
            };
          });
          expect(look.ground, where).toBe(CANVAS[device]);
          expect(look.face, where).toMatch(/instrument.?serif/i);
          expect(look.faceLoaded, where).toBe(true);
          expect(look.words, where).toMatch(/geist/i);
          expect(look.wordsLoaded, where).toBe(true);
          expect(look.cards, where).toBeGreaterThan(0);
          expect(look.card, where).toMatch(CARD[device]);
          for (const fill of look.primaries) expect(fill, where).toBe(INK[device]);
          expect(look.wide, where).toBeLessThanOrEqual(look.window);
        }
      }
    });
  });
}

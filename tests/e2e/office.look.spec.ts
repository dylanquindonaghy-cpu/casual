import type { Page } from "@playwright/test";
import { addOfficeUser, addQualifiedCasual } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office's look on every page (Phases 21 and 22; docs/ui-design.md "Phase 22"): an admin
// opens each page in the menu on the brief's phone (390px) and on Dylan's laptop window (1280 ×
// 640; 1440px wide until Phase 22), with the device set to light and again to dark. Each page sits
// on the office's window (a warm grey, a near-black in dark) as a warm off-white sheet (a dark
// grey one), has its headline in the serif, and never scrolls sideways (a wide table scrolls in
// its own box); its serif (Newsreader) and DM Sans have really loaded; it has a white card or row
// (a dark one in dark) on that sheet, and something with depth; every main button is near-black
// (white in dark); round 2's parts (Phase 22): every button raised off its surface, everything
// you press dips (its transition carries scale: globals.css `press`), and every wash with an edge
// has depth; and nothing on it is drawn with a gradient (Dylan: "remove the gradients"). With
// every hidden step and menu on the page shown, so they're checked too.
// The pages opened from inside one too: a casual's page, a cancellation's record, an enquiry,
// the offer page, a shift's and an event's page, and the ways to add shifts. With a
// casual of its own whose qualification has the longest words a
// chip shows ("Level 2 spectator safety qualification: Expiring soon"): it ran off a phone until a
// chip could wrap.

const acme = "http://acme.localhost:3100";
const CANVAS = { light: "rgb(231, 229, 223)", dark: "rgb(8, 9, 11)" }; // #e7e5df, #08090b
const SHEET = { light: "rgb(249, 248, 245)", dark: "rgb(17, 18, 21)" }; // #f9f8f5, #111215
const CARD = { light: /^#f{3}(?:f{3})?$/i, dark: /^#1a1b1f$/i }; // white, #1a1b1f
const INK = { light: "rgb(28, 27, 24)", dark: "rgb(242, 241, 238)" }; // #1c1b18, #f2f1ee
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 640 },
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

    test("every office page: the ground, the serif headline, round 2's parts, nothing sideways, at 390px and 1280px", async ({
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
      // And the pages opened from inside one (Phase 22): an enquiry, the offer page, a shift's
      // and an event's page (its link is in a board row, once opened), and the ways to add shifts.
      const found = async (list: string, pattern: RegExp, open?: string) => {
        await page.goto(`${acme}${list}`);
        if (open) await page.locator(open).first().click();
        let href = "";
        await expect
          .poll(async () => {
            const all = await page
              .locator("main a[href]")
              .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
            href = all.find((h) => pattern.test(h)) ?? "";
            return href;
          }, list)
          .not.toBe("");
        return href;
      };
      const id = "[0-9a-f-]{36}";
      const records = [
        await firstLink("/office/casuals", "/office/casuals/"),
        await firstLink("/office/cancellations", "/office/cancellations/"),
        await found("/office/enquiries", new RegExp(`^/office/enquiries/${id}$`)),
        await found("/office", new RegExp(`^/office/offer/${id}$`)),
        await found("/office/shifts", new RegExp(`^/office/shifts/${id}$`)),
        await found(
          "/office/events",
          new RegExp(`^/office/events/${id}$`),
          'main button[aria-expanded="false"][aria-controls^="event-"]',
        ),
        "/office/shifts/new",
        "/office/shifts/import",
        "/office/shifts/event",
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
            // Every hidden step and menu shown, so its parts are checked too.
            for (const d of document.querySelectorAll("main details:not([open])"))
              (d as HTMLDetailsElement).open = true;
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
            // The cards and rows shown in the card's fill, and what that fill is here.
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
            // Round 2's parts: the office's buttons raised off their surface (their own depth);
            // everything you press dips (a button, a round control, a 44px link); and some depth
            // on the page (its cards, rows, fields).
            const shown = (el: Element) => el.checkVisibility();
            const name = (el: Element) =>
              `${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`;
            const flat = [...(main?.querySelectorAll("a, button") ?? [])]
              .filter(
                (el) => shown(el) && /(?:^|\s)(?:bg-button|bg-ink)(?:\s|$)/.test(el.className),
              )
              .filter((el) => getComputedStyle(el).boxShadow === "none")
              .map(name);
            // What you press: a button, an opener, a switch, and a link that isn't words (a row,
            // a card, a pill, a tab), or words with their own 44px target. A link in a sentence
            // is text, and doesn't move.
            const pressed = (el: Element) => {
              if (el.tagName !== "A") return true;
              const style = getComputedStyle(el);
              if (style.display === "inline") return false;
              return (
                !style.textDecorationLine.includes("underline") || parseFloat(style.minHeight) >= 44
              );
            };
            const still = [...(main?.querySelectorAll("button, summary, [role=switch], a") ?? [])]
              .filter((el) => shown(el) && pressed(el))
              .filter((el) => !getComputedStyle(el).transitionProperty.includes("scale"))
              .map(name);
            // A wash with an edge (a second step, the rules' answer) has depth too; a chip (a pill:
            // a word with its colour) is a label, not a surface.
            const tint = (token: string) => {
              const probe = document.createElement("i");
              probe.style.color = `var(--color-${token})`;
              document.body.append(probe);
              const rgb = getComputedStyle(probe).color;
              probe.remove();
              return rgb;
            };
            const washes = ["urgent-soft", "quiet-soft", "attention-soft", "done-soft"].map(tint);
            const bare = [...(main?.querySelectorAll("*") ?? [])]
              .filter((el) => {
                const style = getComputedStyle(el);
                return (
                  shown(el) &&
                  parseFloat(style.borderTopLeftRadius) < el.getBoundingClientRect().height / 2 &&
                  washes.includes(style.backgroundColor) &&
                  style.borderTopWidth !== "0px" &&
                  style.boxShadow === "none"
                );
              })
              .map(name);
            const deep = [...(main?.querySelectorAll("*") ?? [])].filter(
              (el) => shown(el) && getComputedStyle(el).boxShadow !== "none",
            ).length;
            // A gradient anywhere on the page (the menu's edge fade is a mask, not a background).
            const gradients = [...document.querySelectorAll("body *")]
              .filter((el) => /gradient\(/.test(getComputedStyle(el).backgroundImage))
              .map((el) => el.tagName);
            return {
              ground: getComputedStyle(document.body).backgroundColor,
              sheet: getComputedStyle(document.querySelector("#main > div")!).backgroundColor,
              gradients,
              face: familyOf(serif),
              faceLoaded: loaded(serif),
              words: familyOf(main),
              wordsLoaded: loaded(main),
              cards,
              card,
              primaries,
              flat,
              still,
              bare,
              deep,
              wide: document.documentElement.scrollWidth,
              window: document.documentElement.clientWidth,
            };
          });
          expect(look.ground, where).toBe(CANVAS[device]);
          expect(look.sheet, where).toBe(SHEET[device]);
          expect(look.gradients, where).toEqual([]);
          expect(look.face, where).toMatch(/newsreader/i);
          expect(look.faceLoaded, where).toBe(true);
          expect(look.words, where).toMatch(/dm.?sans/i);
          expect(look.wordsLoaded, where).toBe(true);
          expect(look.cards, where).toBeGreaterThan(0);
          expect(look.card, where).toMatch(CARD[device]);
          for (const fill of look.primaries) expect(fill, where).toBe(INK[device]);
          expect(look.flat, where).toEqual([]);
          expect(look.still, where).toEqual([]);
          expect(look.bare, where).toEqual([]);
          expect(look.deep, where).toBeGreaterThan(0);
          expect(look.wide, where).toBeLessThanOrEqual(look.window);
        }
      }
    });
  });
}

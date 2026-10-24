import type { Page } from "@playwright/test";
import { addOfficeUser, addQualifiedCasual } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office's look on every page (Phases 21 to 23; docs/ui-design.md "Phase 23"): an admin opens
// each page in the menu on the brief's phone (390px) and on Dylan's laptop window (1280 × 640),
// with the device set to light and again to dark. Round 3 (Phase 23, the approved mock-up), flat:
// each page sits on the cool light grey ground (near-black in dark) as a white page card (dark
// grey in dark) with a 1px hairline, 28px round from 1024px and 22px on a phone, with no depth;
// Plus Jakarta Sans for its headline and its words, really loaded; white cards and rows on it,
// each white box with its edge; every main button the sky with near-black words; every office
// button and pill with its 1px edge; nothing anywhere with depth but what floats over the page (an
// open "…" menu, the account menu, the drawer: placed absolutely or fixed); no background image
// at all (no gradient, no grain) and no mask but the menu's fade; everything you press dips (its
// transition carries scale: globals.css `press`); and the page never scrolls sideways (a wide
// table or the rota board scrolls in its own box). With every hidden step and menu on the page
// shown, so they're checked too.
// The pages opened from inside one too: a casual's page, a cancellation's record, an enquiry,
// the offer page, a shift's and an event's page, the ways to add shifts and a worker's data
// page; and, logged out, the office's login pages. With a casual of its own whose qualification
// has the longest words a chip shows ("Level 2 spectator safety qualification: Expiring soon"):
// it ran off a phone until a chip could wrap.
// Round 2 (Phase 22) pinned the opposite: a warm off-white sheet, Newsreader and DM Sans, a
// near-black main button, every button and edged wash raised.

const acme = "http://acme.localhost:3100";
const CANVAS = { light: "rgb(242, 244, 247)", dark: "rgb(12, 14, 18)" }; // #f2f4f7, #0c0e12
const CARD = { light: "rgb(255, 255, 255)", dark: "rgb(21, 24, 29)" }; // #ffffff, #15181d
// The card token as written (a production build may shorten #ffffff).
const CARD_TOKEN = { light: /^#f{3}(?:f{3})?$/i, dark: /^#15181d$/i };
const LINE = { light: "rgb(228, 231, 236)", dark: "rgb(38, 43, 51)" }; // #e4e7ec, #262b33
const ACCENT = { light: "rgb(14, 165, 233)", dark: "rgb(125, 211, 252)" }; // #0ea5e9, #7dd3fc
const ON_ACCENT = "rgb(6, 19, 31)"; // #06131f, in both
// The page card's corners: 22px on a phone, 28px from 1024px.
const PAGE_RADIUS: Record<number, string> = { 390: "22px", 1280: "28px" };
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 640 },
];
const FACE = /plus.?jakarta/i;

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

// What a page looks like, measured in the browser: its ground and page card, faces, cards, main
// buttons, office buttons, what dips when pressed, depth, white boxes without an edge, background
// images and masks, and whether it scrolls sideways. Every hidden step and menu is shown first,
// so its parts are measured too. The pointer is moved off the page first (`calm`), so no button
// is measured under it.
const measure = (page: Page) =>
  page.evaluate(() => {
    for (const d of document.querySelectorAll("main details:not([open])"))
      (d as HTMLDetailsElement).open = true;
    const heading = document.querySelector("h1");
    const main = document.querySelector("main");
    const familyOf = (el: Element | null | undefined) =>
      el ? getComputedStyle(el).fontFamily : "";
    // Loaded, not only asked for: the first face of each list, at its own size and weight.
    const loaded = (el: Element | null | undefined) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const first = style.fontFamily.split(",")[0]!.trim();
      return document.fonts.check(`${style.fontWeight} ${style.fontSize} ${first}`);
    };
    const shown = (el: Element) => el.checkVisibility();
    const name = (el: Element) =>
      `${el.tagName}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".")} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`;
    // A token's colour here, as the browser computes it.
    const tint = (token: string) => {
      const probe = document.createElement("i");
      probe.style.color = `var(--color-${token})`;
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    };
    const white = tint("card");
    const box = (el: Element | null) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        fill: s.backgroundColor,
        widths: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
        colours: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor],
        styles: [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle],
        radius: s.borderTopLeftRadius,
        depth: s.boxShadow,
      };
    };
    // The cards and rows shown in the card's fill, and what that fill is here.
    const cards = [...(main?.querySelectorAll("*") ?? [])].filter(
      (el) =>
        /(?:^|\s)(?:sm:)?bg-card(?:\/\d+)?(?:\s|$)/.test(el.getAttribute("class") ?? "") &&
        shown(el) &&
        getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)",
    ).length;
    const card = getComputedStyle(document.body).getPropertyValue("--color-card").trim();
    // The main buttons: their fill and their words.
    const primaries = [...(main?.querySelectorAll(".bg-accent.text-on-accent") ?? [])]
      .filter((el) => el.matches("a, button") && shown(el))
      .map((el) => {
        const s = getComputedStyle(el);
        return { fill: s.backgroundColor, words: s.color, what: name(el) };
      });
    // Every office button and pill (white or sky) keeps its 1px edge, with no depth.
    const edgeless = [...(main?.querySelectorAll("a, button") ?? [])]
      .filter((el) => shown(el) && /(?:^|\s)(?:bg-button|bg-accent)(?:\s|$)/.test(el.className))
      .filter((el) => {
        const s = getComputedStyle(el);
        return s.borderTopWidth !== "1px" || s.borderTopStyle !== "solid" || s.boxShadow !== "none";
      })
      .map(name);
    // What you press: a button, an opener, a switch, and a link that isn't words (a row,
    // a card, a pill, a tab), or words with their own 44px target. A link in a sentence
    // is text, and doesn't move.
    const pressed = (el: Element) => {
      if (el.tagName !== "A") return true;
      const style = getComputedStyle(el);
      if (style.display === "inline") return false;
      return !style.textDecorationLine.includes("underline") || parseFloat(style.minHeight) >= 44;
    };
    const still = [...(main?.querySelectorAll("button, summary, [role=switch], a") ?? [])]
      .filter((el) => shown(el) && pressed(el))
      .filter((el) => !getComputedStyle(el).transitionProperty.includes("scale"))
      .map(name);
    // Depth anywhere on the page, shown or not: only what floats over it (placed absolutely or
    // fixed: an open "…" menu, the account menu, the drawer, a toast) may have its overlay.
    const everything = [
      document.documentElement,
      document.body,
      ...document.querySelectorAll("body *"),
    ];
    const raised = everything
      .filter((el) => {
        const s = getComputedStyle(el);
        return s.boxShadow !== "none" && s.position !== "absolute" && s.position !== "fixed";
      })
      .map(name);
    // A white box (a card's, an inner card's or a row's corners: not a pill, not a field) on the
    // white page card has its edge, or it would vanish.
    const bareWhite = [...(main?.querySelectorAll("*") ?? [])]
      .filter((el) => {
        if (!shown(el) || el.matches("input, select, textarea")) return false;
        const s = getComputedStyle(el);
        const radius = parseFloat(s.borderTopLeftRadius);
        return (
          s.position !== "absolute" &&
          s.position !== "fixed" &&
          s.backgroundColor === white &&
          radius > 0 &&
          radius < el.getBoundingClientRect().height / 2 &&
          (s.borderTopWidth === "0px" || s.borderTopStyle === "none")
        );
      })
      .map(name);
    // No background image anywhere (no gradient, no grain, no stripes), and no mask but the
    // menu's fade at its scrolling edge.
    const images = everything
      .filter((el) => getComputedStyle(el).backgroundImage !== "none")
      .map((el) => `${name(el)}: ${getComputedStyle(el).backgroundImage.slice(0, 60)}`);
    const masks = everything
      .filter((el) => {
        const s = getComputedStyle(el);
        const mask = s.maskImage || s.webkitMaskImage || "none";
        return mask !== "none" && !el.classList.contains("fade-edges");
      })
      .map(name);
    return {
      ground: getComputedStyle(document.body).backgroundColor,
      // The page card in the shell; the login card outside it.
      sheet: box(document.querySelector("#main > div")),
      loginCard: box(document.querySelector("main > div")),
      face: familyOf(heading),
      faceLoaded: loaded(heading),
      words: familyOf(main),
      wordsLoaded: loaded(main),
      cards,
      card,
      primaries,
      edgeless,
      still,
      raised,
      bareWhite,
      images,
      masks,
      wide: document.documentElement.scrollWidth,
      window: document.documentElement.clientWidth,
    };
  });

// The pointer away from every button, so none is measured in its hover colour.
const calm = (page: Page) => page.mouse.move(0, 0);
// A box's four sides.
const four = (value: string) => [value, value, value, value];

// A slip's fill, its edge and its depth, with the tokens it should have here.
const slip = (page: Page) =>
  page.getByRole("status").evaluate((node) => {
    const tint = (token: string) => {
      const probe = document.createElement("i");
      probe.style.color = `var(--color-${token})`;
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    };
    const s = getComputedStyle(node);
    return {
      fill: s.backgroundColor,
      edge: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor],
      depth: s.boxShadow,
      quiet: tint("quiet-soft"),
      line: tint("line"),
      done: tint("done-soft"),
      doneLine: tint("done-line"),
    };
  });

for (const device of ["light", "dark"] as const) {
  test.describe(`with the device set to ${device}`, () => {
    test.use({ colorScheme: device });

    test("every office page: the ground, the white page card, Plus Jakarta Sans, round 3's flat parts, nothing sideways, at 390px and 1280px", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await addQualifiedCasual(
        "acme",
        { firstName: "Lorna", lastName: "Longform", mobileE164: "+447700900877" },
        { roles: ["steward"], held: [{ type: "STEWARD_L2", daysAhead: 5 }] },
      );
      await adminLogin(page, device);
      // The pages: every link in an admin's menu (the menu card, its fold opened if it has one).
      await page.setViewportSize(WIDTHS[1]!);
      const menu = page.getByRole("navigation", { name: "Office menu" });
      await expect(menu).toBeVisible();
      const fold = menu.locator('button[aria-expanded="false"]');
      if ((await fold.count()) > 0) await fold.click();
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
        // A worker's data page (download or delete their data), found by name on Data requests.
        await (async () => {
          await page.goto(`${acme}/office/data`);
          await page.getByLabel("Name or mobile number").fill("Longform");
          await page.getByRole("button", { name: "Find", exact: true }).click();
          let href = "";
          await expect
            .poll(async () => {
              const all = await page
                .locator("main a[href]")
                .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
              href = all.find((h) => new RegExp(`^/office/data/workers/${id}$`).test(h)) ?? "";
              return href;
            }, "/office/data")
            .not.toBe("");
          return href;
        })(),
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

      // Across every page and width: the main buttons seen (so the check never passes over none).
      let primaries = 0;
      for (const size of WIDTHS) {
        await page.setViewportSize(size);
        for (const path of [...pages, ...records]) {
          const where = `${path} at ${size.width}px, ${device}`;
          await page.goto(`${acme}${path}`);
          const h1 = page.getByRole("heading", { level: 1 });
          await expect(h1, where).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await calm(page);
          const look = await measure(page);
          // The ground, and the page on it: a white card with its hairline, no depth.
          expect(look.ground, where).toBe(CANVAS[device]);
          expect(look.sheet, where).not.toBeNull();
          expect(look.sheet!.fill, where).toBe(CARD[device]);
          expect(look.sheet!.widths, where).toEqual(four("1px"));
          expect(look.sheet!.styles, where).toEqual(four("solid"));
          expect(look.sheet!.colours, where).toEqual(four(LINE[device]));
          expect(look.sheet!.radius, where).toBe(PAGE_RADIUS[size.width]);
          expect(look.sheet!.depth, where).toBe("none");
          // One face, really loaded.
          expect(look.face, where).toMatch(FACE);
          expect(look.faceLoaded, where).toBe(true);
          expect(look.words, where).toMatch(FACE);
          expect(look.wordsLoaded, where).toBe(true);
          // White cards and rows on it, in this theme's white.
          expect(look.cards, where).toBeGreaterThan(0);
          expect(look.card, where).toMatch(CARD_TOKEN[device]);
          // The sky main button, its near-black words.
          for (const p of look.primaries) {
            expect(p.fill, `${where}: ${p.what}`).toBe(ACCENT[device]);
            expect(p.words, `${where}: ${p.what}`).toBe(ON_ACCENT);
          }
          primaries += look.primaries.length;
          expect(look.edgeless, where).toEqual([]);
          expect(look.still, where).toEqual([]);
          expect(look.raised, where).toEqual([]);
          expect(look.bareWhite, where).toEqual([]);
          expect(look.images, where).toEqual([]);
          expect(look.masks, where).toEqual([]);
          expect(look.wide, where).toBeLessThanOrEqual(look.window);
        }
      }
      expect(primaries).toBeGreaterThan(0);
    });

    // Logged out: the office's login, "You're logged out.", "Check your email." and the link
    // page, on round 3's parts too, at both sizes. No page card: the login is a white card with
    // its hairline on the ground from 640px (frameless on a phone: the page is the card).
    test("the office's login pages: round 3's flat parts, nothing sideways, at 390px and 1280px", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      let primaries = 0;
      for (const size of WIDTHS) {
        // An address of its own for each size, so no per-address limit is met.
        const email = `look.out.${device}.${size.width}@example.com`;
        await addOfficeUser("acme", { email, name: "Lou Out", role: "resourcer" });
        await page.setViewportSize(size);
        // Each step, then what's its own: the answers are flat slips (no depth): "You're logged
        // out." pale grey with its hairline, "Check your email." a green wash with its green edge;
        // the link page's button the office's main one (the sky, its near-black words, 44px).
        const steps: [string, () => Promise<void>, (where: string) => Promise<void>][] = [
          [
            "the login",
            () => page.goto(`${acme}/office/login`).then(() => undefined),
            async () => {},
          ],
          [
            "You're logged out.",
            async () => {
              await page.goto(`${acme}/office/login?out=1`);
              await expect(page.getByRole("status")).toHaveText("You're logged out.");
            },
            async (where) => {
              const out = await slip(page);
              expect(out.depth, where).toBe("none");
              expect(out.fill, where).toBe(out.quiet);
              expect(out.edge, where).toEqual(["1px", "solid", LINE[device]]);
              expect(out.line, where).toBe(LINE[device]);
            },
          ],
          [
            "Check your email.",
            async () => {
              await page.goto(`${acme}/office/login`);
              await page.getByLabel("Your work email").fill(email);
              await page.getByRole("button", { name: "Send me a link" }).click();
              await expect(page.getByText("Check your email.")).toBeVisible();
            },
            async (where) => {
              const sent = await slip(page);
              expect(sent.depth, where).toBe("none");
              expect(sent.fill, where).toBe(sent.done);
              expect(sent.edge, where).toEqual(["1px", "solid", sent.doneLine]);
            },
          ],
          [
            "the link page",
            async () => {
              // With no link in the address it says so, with the way to a new one.
              await page.goto(`${acme}/office/l`);
              await expect(page.getByRole("link", { name: "Send me a new link" })).toBeVisible();
            },
            async (where) => {
              const button = await page
                .getByRole("link", { name: "Send me a new link" })
                .evaluate((el) => {
                  const s = getComputedStyle(el);
                  return {
                    fill: s.backgroundColor,
                    words: s.color,
                    edge: s.borderTopWidth,
                    depth: s.boxShadow,
                    tall: el.getBoundingClientRect().height,
                  };
                });
              expect(button.fill, where).toBe(ACCENT[device]);
              expect(button.words, where).toBe(ON_ACCENT);
              expect(button.edge, where).toBe("1px");
              expect(button.depth, where).toBe("none");
              expect(button.tall, where).toBeGreaterThanOrEqual(44);
            },
          ],
        ];
        for (const [what, open, own] of steps) {
          const where = `${what} at ${size.width}px, ${device}`;
          await open();
          await expect(page.getByRole("heading", { level: 1 }), where).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await calm(page);
          const look = await measure(page);
          expect(look.ground, where).toBe(CANVAS[device]);
          expect(look.face, where).toMatch(FACE);
          expect(look.faceLoaded, where).toBe(true);
          expect(look.words, where).toMatch(FACE);
          expect(look.wordsLoaded, where).toBe(true);
          // The login card: from 640px white with its hairline, 28px round, no depth; on a phone
          // no frame at all.
          expect(look.loginCard, where).not.toBeNull();
          if (size.width >= 640) {
            expect(look.loginCard!.fill, where).toBe(CARD[device]);
            expect(look.loginCard!.widths, where).toEqual(four("1px"));
            expect(look.loginCard!.colours, where).toEqual(four(LINE[device]));
            expect(look.loginCard!.radius, where).toBe("28px");
          } else {
            expect(look.loginCard!.widths, where).toEqual(four("0px"));
          }
          expect(look.loginCard!.depth, where).toBe("none");
          for (const p of look.primaries) {
            expect(p.fill, `${where}: ${p.what}`).toBe(ACCENT[device]);
            expect(p.words, `${where}: ${p.what}`).toBe(ON_ACCENT);
          }
          primaries += look.primaries.length;
          expect(look.edgeless, where).toEqual([]);
          expect(look.still, where).toEqual([]);
          expect(look.raised, where).toEqual([]);
          expect(look.bareWhite, where).toEqual([]);
          expect(look.images, where).toEqual([]);
          expect(look.masks, where).toEqual([]);
          expect(look.wide, where).toBeLessThanOrEqual(look.window);
          await own(where);
        }
      }
      // "Send me a link" on the login, at least.
      expect(primaries).toBeGreaterThan(0);
    });
  });
}

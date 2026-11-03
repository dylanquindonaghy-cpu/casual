import type { Page } from "@playwright/test";
import { addOfficeUser, addQualifiedCasual } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";

// The office's look on every page (Phases 21 to 24; docs/ui-design.md "Phase 24"): an admin opens
// each page in the menu on the brief's phone (390px) and on Dylan's laptop window (1280 × 640),
// with the device set to light and again to dark. Round 7 (Phase 24, Liquid Glass): every page
// sits on the wash (its four lights fixed behind it, on the canvas's base), with no page card of
// its own; its sections are frosted glass (blurred 24px, saturated 1.8 times, a rim and a drop),
// the top bar (on a phone; from 1024px its three capsules), the rail and the menus floating glass
// (18px); Geist for its
// headline and its words, really loaded; every main button tinted glass in the firm's colour (its
// colour to its shade, white words), every clear button its gradient and rim; depth only on the
// glass and the few solid things the depth tokens are pinned to (tests/unit/ui.glass.test.ts); no
// opaque white box left of Phase 23's; no background image but the glass's own gradients, and no
// mask but the menu's fade; everything you press reacts (its transition carries scale: `press`
// dips, `press-glass` swells); and the page never scrolls sideways (a wide table or the rota board
// scrolls in its own box). With every hidden step and menu on the page shown, so they're checked
// too.
// The pages opened from inside one too: a casual's page, a cancellation's record, an enquiry,
// the offer page, a shift's and an event's page, the ways to add shifts and a worker's data
// page; and, logged out, the office's login pages. With a casual of its own whose qualification
// has the longest words a chip shows ("Level 2 spectator safety qualification: Expiring soon"):
// it ran off a phone until a chip could wrap.
// Round 3 (Phase 23) pinned the opposite: a white page card with its hairline on a cool grey
// ground, Plus Jakarta Sans, the sky main button, nothing with depth at rest.
// Round 8 (Phase 26, docs/ui-design.md "Phase 26"): the office has its own look, dark with no
// choice made (whatever the device says) and light when picked (the sd-theme cookie), so each look
// is opened with the device set the other way. The wash is gone: a faint street map behind every
// page (one still picture, fixed); sections translucent and sharp (a 6px blur, saturated 1.15
// times, one hairline, no drop), what floats 88% with a 12px blur and no bending; the rail section
// glass, the top bar's counts flat chips; every main button hi-vis (flat, dark words).

const acme = "http://acme.localhost:3100";
const CANVAS = { dark: "rgb(15, 15, 16)", light: "rgb(242, 242, 240)" }; // #0f0f10, #f2f2f0
// Round 8's glass (globals.css's office blocks): a section, its frost, what floats. Phase 27.1
// (Dylan, 2026-11-03, "+20%") made the dark look's more see-through: a section a light 4% tint (was
// a dark 28%) frosted 3px (was 6px), what floats 70% (was 88%). The light look is as it was.
const SECTION = { dark: "rgba(255, 255, 255, 0.04)", light: "rgba(255, 255, 255, 0.55)" };
const SECTION_FROST = { dark: "blur(3px) saturate(1.15)", light: "blur(6px) saturate(1.15)" };
const FLOAT = { dark: "rgba(24, 24, 26, 0.7)", light: "rgba(255, 255, 255, 0.92)" };
// The main button in the office: hi-vis, flat (its colour at both ends), dark words, in both looks
// and whatever the firm's colour (Acme's blue stays on its bar and in the casual app).
const TINT = "rgb(233, 248, 111)";
const TINT_IMAGE = /^linear-gradient\((?:180deg, )?rgb\(233, 248, 111\), rgb\(233, 248, 111\)\)$/;
const ON_TINT = "rgb(23, 24, 0)";
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 640 },
];
const FACE = /geist/i;

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

// What a page looks like, measured in the browser: the wash and the ground, the page, the bar,
// faces, sections, what floats, main buttons, clear buttons, what reacts when pressed, depth, white
// boxes, background images and masks, and whether it scrolls sideways. Every hidden step and menu
// is shown first, so its parts are measured too. The pointer is moved off the page first (`calm`),
// so no button is measured under it.
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
    // A class, with any variant before it (`sm:glass`, `aria-pressed:lens`).
    const carries = (el: Element, names: string[]) =>
      [...el.classList].some((c) => names.some((n) => c === n || c.endsWith(`:${n}`)));
    const GLASS = [
      "glass",
      "glass-float",
      "glass-tile",
      "glass-button",
      "glass-tint",
      "glass-rim",
      "lens",
    ];
    const DEPTH = [
      "shadow-lift",
      "shadow-panel",
      "shadow-bar",
      "shadow-float",
      "inset-shadow-sunk",
    ];
    const box = (el: Element | null) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        fill: s.backgroundColor,
        widths: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
        radius: s.borderTopLeftRadius,
        depth: s.boxShadow,
        frost: s.backdropFilter,
      };
    };
    const everything = [
      document.documentElement,
      document.body,
      ...document.querySelectorAll("body *"),
    ];
    // The street map: fixed behind everything, one still picture (a mask over its line colour),
    // none of round 7's lights.
    const before = getComputedStyle(document.body, "::before");
    const wash = {
      position: before.position,
      z: before.zIndex,
      lights: before.backgroundImage.match(/radial-gradient\(/g)?.length ?? 0,
      map: /office-streets/.test(before.maskImage || before.webkitMaskImage || ""),
    };
    // The sections on the page, frosted, in the section's fill; what floats (shown), frosted more.
    const sections = [...(main?.querySelectorAll(".glass") ?? [])].filter(shown);
    const unfrosted = sections
      .filter((el) => {
        const s = getComputedStyle(el);
        return !/blur\(\d/.test(s.backdropFilter) || s.boxShadow === "none";
      })
      .map(name);
    // Each look's own frost (expectGlass checks it exactly).
    const sectionFrosts = [...new Set(sections.map((el) => getComputedStyle(el).backdropFilter))];
    const sectionFills = [...new Set(sections.map((el) => getComputedStyle(el).backgroundColor))];
    // Glass of any kind on the page: a section, or a clear part (Needs attention's rows sit as
    // clear glass on their amber parts), as Phase 23 found a white card on every page.
    const glassParts = [
      ...(main?.querySelectorAll(".glass, .glass-tile, .glass-button") ?? []),
    ].filter(shown).length;
    const floats = [...document.querySelectorAll(".glass-float")].filter(shown);
    const floatLook = floats.map((el) => {
      const s = getComputedStyle(el);
      return {
        fill: s.backgroundColor,
        frost: s.backdropFilter.includes("blur(12px)"),
        // No bending in the office (round 7's refraction filter is switched off there).
        bent: s.backdropFilter.includes("url("),
        what: name(el),
      };
    });
    // The main buttons: tinted glass, its fill, its gradient and its words.
    const primaries = [...(main?.querySelectorAll(".glass-tint") ?? [])]
      .filter((el) => el.matches("a, button") && shown(el))
      .map((el) => {
        const s = getComputedStyle(el);
        return {
          fill: s.backgroundColor,
          image: s.backgroundImage,
          words: s.color,
          what: name(el),
        };
      });
    // Every clear glass button and count: its gradient and its rim.
    const unrimmed = [...(main?.querySelectorAll(".glass-button") ?? [])]
      .filter(shown)
      .filter((el) => {
        const s = getComputedStyle(el);
        return !s.backgroundImage.startsWith("linear-gradient(") || s.boxShadow === "none";
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
    // Depth anywhere on the page, shown or not: only the glass's own, and the depth tokens'.
    const stray = everything
      .filter(
        (el) => getComputedStyle(el).boxShadow !== "none" && !carries(el, [...GLASS, ...DEPTH]),
      )
      .map(name);
    // Nothing placed `fixed` (the toast, a chart's tooltip) inside glass: the frost would make the
    // section its containing block, so it would be placed against the section, not the window.
    // (A popover and a dialog go to the top layer, which no ancestor holds.)
    const trapped = everything
      .filter(
        (el) =>
          shown(el) &&
          getComputedStyle(el).position === "fixed" &&
          !el.matches("[popover], dialog"),
      )
      .filter((el) => {
        for (let up = el.parentElement; up; up = up.parentElement)
          if (getComputedStyle(up).backdropFilter !== "none") return true;
        return false;
      })
      .map(name);
    // No opaque white box (a card's, an inner card's or a row's corners: not a pill, not a knob,
    // not a field) is left of Phase 23's.
    const bareWhite = [...(main?.querySelectorAll("*") ?? [])]
      .filter((el) => {
        if (!shown(el) || el.matches("input, select, textarea")) return false;
        const s = getComputedStyle(el);
        const radius = parseFloat(s.borderTopLeftRadius);
        return (
          s.backgroundColor === "rgb(255, 255, 255)" &&
          radius > 0 &&
          radius < el.getBoundingClientRect().height / 2
        );
      })
      .map(name);
    // No background image but the glass's own gradients (no grain, no stripes, no picture), and
    // no mask but the menu's fade at its scrolling edge.
    const images = everything
      .filter((el) => {
        const image = getComputedStyle(el).backgroundImage;
        if (image === "none") return false;
        return !(
          carries(el, ["glass-tile", "glass-button", "glass-tint"]) &&
          image.startsWith("linear-gradient(")
        );
      })
      .map((el) => `${name(el)}: ${getComputedStyle(el).backgroundImage.slice(0, 60)}`);
    // No section tinted over (Phase 24, 24.5): a section's status is a leaf before its heading, a
    // chip, a notice or a second step (none of them a section), never a tint over the whole of it.
    // (Measured inside the office's wrapper, where round 8's tokens are set: Phase 26.)
    const office = document.querySelector("[data-office]") ?? document.body;
    const softs = ["urgent-soft", "attention-soft", "wait-soft", "done-soft", "quiet-soft"].map(
      (token) => {
        const probe = document.createElement("i");
        probe.style.backgroundColor = `var(--color-${token})`;
        office.append(probe);
        const rgb = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return rgb;
      },
    );
    const tintedSections = [...(main?.querySelectorAll("section") ?? [])]
      .filter((el) => shown(el) && softs.includes(getComputedStyle(el).backgroundColor))
      .map(name);
    // The page header (Phase 24, 24.5): its headline and lines, and the actions beside them (the
    // next box in the header after the headline's), if it has any.
    const titleBox = main?.querySelector("header h1")?.parentElement;
    const headerEl = titleBox?.closest("header");
    // The headline's own box inside the header (never the header itself, whose next box is the
    // page's content), and the box after it there.
    const actionsBox = headerEl && titleBox !== headerEl ? titleBox!.nextElementSibling : null;
    const edges = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const header =
      titleBox && actionsBox && shown(actionsBox) && actionsBox.querySelector("a, button")
        ? { title: edges(titleBox), actions: edges(actionsBox) }
        : null;
    // A list under tabs (Phase 24, 24.5): no heading on the page repeating the chosen tab (the tab
    // says it); it stays for screen readers (`sr-only`: a 1px box).
    const chosenTab = main?.querySelector('nav[aria-label="Show"] [aria-current="page"]');
    const tabWords = chosenTab?.textContent?.replace(/\s*\d+\+?$/, "").trim() ?? null;
    const repeatedTab = tabWords
      ? [...(main?.querySelectorAll("h2") ?? [])]
          .filter((h) => h.textContent?.trim() === tabWords && h.getBoundingClientRect().width > 1)
          .map(name)
      : [];
    const masks = everything
      .filter((el) => {
        const s = getComputedStyle(el);
        const mask = s.maskImage || s.webkitMaskImage || "none";
        // The menu's fade, and a sideways row's (round 8, sys-9).
        return (
          mask !== "none" &&
          !el.classList.contains("fade-edges") &&
          !el.classList.contains("fade-x")
        );
      })
      .map(name);
    return {
      ground: getComputedStyle(document.body).backgroundColor,
      wash,
      // The page in the shell (no card of its own); the login card outside it; the bar; from
      // 1024px the rail and the bar's three capsules (Phase 24).
      page: box(document.querySelector("#main > div")),
      loginCard: box(document.querySelector("main > div")),
      // (The office's own bar: the firm's bar, hidden on these pages, is a <header> too.)
      bar: box(document.querySelector('[data-shell="office"] header')),
      rail: box(document.getElementById("office-rail")),
      // Round 8: the bar's count chips and its search, flat (no frost of their own), 44px tall.
      chips: [
        ...document.querySelectorAll('[data-shell="office"] header [data-bar-counts] a'),
        document.querySelector('[data-shell="office"] header input[type="search"]')?.parentElement,
      ]
        .filter((el): el is Element => !!el && shown(el))
        .map((el) => ({ ...box(el)!, tall: el.getBoundingClientRect().height })),
      face: familyOf(heading),
      faceLoaded: loaded(heading),
      words: familyOf(main),
      wordsLoaded: loaded(main),
      sections: sections.length,
      glassParts,
      sectionFills,
      sectionFrosts,
      unfrosted,
      floatLook,
      primaries,
      unrimmed,
      still,
      stray,
      trapped,
      bareWhite,
      images,
      masks,
      tintedSections,
      header,
      tabbed: !!tabWords,
      repeatedTab,
      wide: document.documentElement.scrollWidth,
      window: document.documentElement.clientWidth,
    };
  });

// The pointer away from every button, so none is measured in its hover colour.
const calm = (page: Page) => page.mouse.move(0, 0);
// A box's four sides.
const four = (value: string) => [value, value, value, value];

// What every page shares: the wash and the ground, the face, the glass's parts, nothing sideways.
function expectGlass(
  look: Awaited<ReturnType<typeof measure>>,
  where: string,
  device: "light" | "dark",
) {
  expect(look.ground, where).toBe(CANVAS[device]);
  expect(look.wash, where).toEqual({ position: "fixed", z: "-1", lights: 0, map: true });
  // One face, really loaded.
  expect(look.face, where).toMatch(FACE);
  expect(look.faceLoaded, where).toBe(true);
  expect(look.words, where).toMatch(FACE);
  expect(look.wordsLoaded, where).toBe(true);
  // Sections frosted, in the section's glass.
  expect(look.unfrosted, where).toEqual([]);
  for (const fill of look.sectionFills) expect(fill, where).toBe(SECTION[device]);
  for (const frost of look.sectionFrosts) expect(frost, where).toBe(SECTION_FROST[device]);
  // What floats, frosted more, in its glass, never bent.
  for (const f of look.floatLook) {
    expect(f.fill, `${where}: ${f.what}`).toBe(FLOAT[device]);
    expect(f.frost, `${where}: ${f.what}`).toBe(true);
    expect(f.bent, `${where}: ${f.what}`).toBe(false);
  }
  // The main button: hi-vis, flat, dark words.
  for (const p of look.primaries) {
    expect(p.fill, `${where}: ${p.what}`).toBe(TINT);
    expect(p.image, `${where}: ${p.what}`).toMatch(TINT_IMAGE);
    expect(p.words, `${where}: ${p.what}`).toBe(ON_TINT);
  }
  expect(look.unrimmed, where).toEqual([]);
  expect(look.still, where).toEqual([]);
  expect(look.stray, where).toEqual([]);
  expect(look.trapped, where).toEqual([]);
  expect(look.bareWhite, where).toEqual([]);
  expect(look.images, where).toEqual([]);
  expect(look.masks, where).toEqual([]);
  expect(look.tintedSections, where).toEqual([]);
  expect(look.repeatedTab, where).toEqual([]);
  expect(look.wide, where).toBeLessThanOrEqual(look.window);
}

// A slip's fill, its edge and its depth, with the tokens it should have here.
const slip = (page: Page) =>
  page.getByRole("status").evaluate((node) => {
    // Measured where the slip is: inside the office's wrapper (round 8's tokens: Phase 26).
    const office = node.closest("[data-office]") ?? document.body;
    const tint = (token: string) => {
      const probe = document.createElement("i");
      probe.style.color = `var(--color-${token})`;
      office.append(probe);
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

// The spec's "every other office page" (oth-1, oth-2): Enquiries, Strikes, the notice report, Pay,
// Pay queries, Import, the action log, Pilot metrics, Team, Settings, Integrations, Data requests
// and the Guide, and their own records.
const OTHER_PAGES =
  /^\/office\/(enquiries|strikes|reports\/notice|pay|pay-queries|pay\/import|log|reports\/pilot|team|settings|settings\/integrations|data|guide)(\/|$)/;

// aud-6, oth-2 and sys-3 on one page: the first Tab lands on the skip link with the focus ring (a real key
// press: a script's focus() doesn't show the ring); every button you can see in the page or its
// frame is at least 44px tall; and no table row holds two status pills. Each problem is named.
async function keptRight(page: import("@playwright/test").Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  const found = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const style = active ? getComputedStyle(active) : null;
    // What you can see: the browser's own test (a closed check step's content still has a size,
    // but isn't shown), and a size.
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return (
        el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        r.width > 0 &&
        r.height > 0
      );
    };
    const small = [...document.querySelectorAll("button, summary, [role='button']")]
      .filter((el) => visible(el) && !el.closest("[aria-hidden='true']"))
      .filter((el) => Math.round(el.getBoundingClientRect().height) < 44)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().height)}px`,
      );
    const hivis = [...document.querySelectorAll("main a.glass-tint, main button.glass-tint")]
      .filter(visible)
      .map((el) => (el.textContent ?? "").trim().slice(0, 40));
    // A row that scrolls sideways (tabs, the counts) fades at its edge (sys-9).
    const rows = [...document.querySelectorAll('nav[aria-label="Show"], [data-bar-counts]')]
      .filter(visible)
      .filter((el) => el.scrollWidth > el.clientWidth + 1);
    const unfaded = rows
      .filter((el) => {
        const st = getComputedStyle(el);
        return (
          !st.maskImage.includes("linear-gradient") || !st.animationName.includes("fade-x-scroll")
        );
      })
      .map(
        (el) => el.getAttribute("aria-label") ?? el.getAttribute("data-bar-counts") ?? el.tagName,
      );
    const pills = [...document.querySelectorAll("main tbody tr")]
      .filter((tr) => tr.querySelectorAll("[class*='office:min-h-7']").length > 1)
      .map((tr) => (tr.textContent ?? "").trim().slice(0, 60));
    return {
      skip: active?.textContent?.trim() ?? "",
      ring: style ? `${style.outlineWidth} ${style.outlineStyle}` : "",
      small,
      pills,
      hivis,
      scrolling: rows.length,
      unfaded,
    };
  });
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return found;
}

// Each office look, with the device set the other way: dark with no choice made (on a light
// device), light when picked (on a dark one).
for (const device of ["dark", "light"] as const) {
  test.describe(`the office's ${device} look`, () => {
    test.use({ colorScheme: device === "dark" ? "light" : "dark" });
    if (device === "light")
      test.beforeEach(async ({ context }) => {
        await context.addCookies([{ name: "sd-theme", value: "light", url: acme }]);
      });

    test("every office page: the street map, no page card, Geist, round 8's glass, nothing sideways, at 390px and 1280px", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await addQualifiedCasual(
        "acme",
        { firstName: "Lorna", lastName: "Longform", mobileE164: "+447700900877" },
        { roles: ["steward"], held: [{ type: "STEWARD_L2", daysAhead: 5 }] },
      );
      await adminLogin(page, device);
      // The pages: every link in an admin's menu (the rail, its folds opened).
      await page.setViewportSize(WIDTHS[1]!);
      const menu = page.getByRole("navigation", { name: "Office menu" });
      await expect(menu).toBeVisible();
      for (const fold of ["Pay", "People", "Admin and records"]) {
        const button = menu.getByRole("button", { name: fold, exact: true });
        if ((await button.getAttribute("aria-expanded")) === "false") await button.click();
      }
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
      // and an event's page (its card's View sessions, Phase 24), and the ways to add shifts.
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
        await found("/office/events", new RegExp(`^/office/events/${id}$`)),
        "/office/shifts/new",
        "/office/shifts/import",
        "/office/shifts/event",
        // The how-to guide, in the account menu rather than the rail (24.5).
        "/office/guide",
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

      // Across every page and width: the main buttons and the sections seen (so the checks never
      // pass over none).
      let primaries = 0;
      let sections = 0;
      let checked = 0;
      let scrolling = 0;
      const problems: string[] = [];
      // The page headers with actions, and the pages with tabs, seen at each width (Phase 24, 24.5).
      const headers = new Map<number, number>();
      const tabbed = new Map<number, number>();
      for (const size of WIDTHS) {
        await page.setViewportSize(size);
        for (const path of [...pages, ...records]) {
          const where = `${path} at ${size.width}px, ${device}`;
          await page.goto(`${acme}${path}`);
          const h1 = page.getByRole("heading", { level: 1 });
          await expect(h1, where).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          // Nothing bends anywhere (Phase 27.6): round 7's refraction, which put .rf on <html> in
          // Chromium for the casual app's floating glass, is gone (expectGlass checks no float is
          // bent, too).
          await expect(page.locator("html"), where).not.toHaveClass(/(?:^|\s)rf(?:\s|$)/);
          await calm(page);
          // As a person first sees it (before measure() opens every hidden step).
          const kept = await keptRight(page);
          const look = await measure(page);
          expectGlass(look, where, device);
          // No page card: the page's own box has no fill, no edge, no corners, no depth.
          expect(look.page, where).not.toBeNull();
          expect(look.page!.fill, where).toBe("rgba(0, 0, 0, 0)");
          expect(look.page!.widths, where).toEqual(four("0px"));
          expect(look.page!.radius, where).toBe("0px");
          expect(look.page!.depth, where).toBe("none");
          // On a phone the bar floats, as glass. From 1024px it has no glass of its own: the rail
          // is section glass (12px round, round 8) and the bar's chips and search are flat, 44px.
          if (size.width >= 1024) {
            expect(look.bar!.fill, where).toBe("rgba(0, 0, 0, 0)");
            expect(look.bar!.frost, where).toBe("none");
            expect(look.rail, where).not.toBeNull();
            expect(look.rail!.fill, where).toBe(SECTION[device]);
            expect(look.rail!.radius, where).toBe("12px");
            expect(look.rail!.frost, where).toBe(SECTION_FROST[device]);
            expect(look.chips.length, where).toBe(6);
            for (const c of look.chips) {
              expect(c.frost, where).toBe("none");
              expect(c.tall, where).toBe(44);
            }
          } else {
            expect(look.bar!.fill, where).toBe(FLOAT[device]);
            expect(look.bar!.frost, where).toContain("blur(12px)");
          }
          // A page header's actions (round 7, as the mock-up's Events & sessions): from 1024px
          // beside the headline and its lines, level with their foot; on a phone under them.
          if (look.header) {
            const { title, actions } = look.header;
            if (size.width >= 1024) {
              expect(actions.left, `${where}: actions beside the headline`).toBeGreaterThanOrEqual(
                title.right,
              );
              expect(Math.abs(actions.bottom - title.bottom), `${where}: level`).toBeLessThan(2);
              // On the headline's row, not wrapped under it.
              expect(actions.top, `${where}: on the headline's row`).toBeLessThan(title.bottom);
            } else {
              expect(actions.top, `${where}: actions under the headline`).toBeGreaterThanOrEqual(
                title.bottom,
              );
            }
            headers.set(size.width, (headers.get(size.width) ?? 0) + 1);
          }
          if (look.tabbed) tabbed.set(size.width, (tabbed.get(size.width) ?? 0) + 1);
          // Glass on every page.
          expect(look.glassParts, where).toBeGreaterThan(0);
          sections += look.sections;
          primaries += look.primaries.length;
          // What today's office gets right, kept on every round 8 page (aud-6): one heading, the
          // skip link first in the tab order with the focus ring, 44px buttons; and a table row has
          // one status pill at most (oth-2).
          // Every page's problems are gathered and named together, below.
          await expect(page.getByRole("heading", { level: 1 }), where).toHaveCount(1);
          if (kept.skip !== "Skip to content") problems.push(`${where}: first Tab "${kept.skip}"`);
          if (kept.ring !== "2px solid") problems.push(`${where}: focus ring "${kept.ring}"`);
          for (const b of kept.small) problems.push(`${where}: under 44px: ${b}`);
          // One status pill a row on "every other office page" (oth-2: its list), not on the pages
          // with designs of their own (Casuals lists each qualification to update, as 26.7 has it).
          if (OTHER_PAGES.test(path))
            for (const r of kept.pills) problems.push(`${where}: two status pills: ${r}`);
          for (const r of kept.unfaded)
            problems.push(`${where}: a scrolling row with no fade: ${r}`);
          scrolling += kept.scrolling;
          // At most one hi-vis button on the screen (sys-3): those you can see (a "Yes, …" inside a
          // closed check step shows only once it's opened).
          if (kept.hivis.length > 1)
            problems.push(`${where}: hi-vis buttons: ${kept.hivis.join(" | ")}`);
          checked += 1;
        }
      }
      expect(primaries).toBeGreaterThan(0);
      expect(sections).toBeGreaterThan(50);
      expect(checked).toBeGreaterThan(40);
      expect(problems).toEqual([]);
      // Rows that scroll sideways were seen (the counts on a phone, at least), so the fade check
      // never passes over none.
      expect(scrolling).toBeGreaterThan(0);
      // Headers with actions were seen at both widths (Cancellations, Pay, the shifts list and
      // more), so the check above never passes over none.
      for (const size of WIDTHS)
        expect(headers.get(size.width) ?? 0, `${size.width}px`).toBeGreaterThan(4);
      // Lists under tabs (Cancellations, Strikes, Enquiries, Casuals, Events & sessions) were seen at
      // both widths, so the heading check never passes over none.
      for (const size of WIDTHS)
        expect(tabbed.get(size.width) ?? 0, `${size.width}px tabs`).toBeGreaterThan(3);
    });

    // Logged out: the office's login, "You're logged out.", "Check your email." and the link
    // page, on round 7's parts too, at both sizes. No page card: the login is a section of glass on
    // the wash from 640px (frameless on a phone: the page is the card).
    test("the office's login pages: round 8's glass, nothing sideways, at 390px and 1280px", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      let primaries = 0;
      for (const size of WIDTHS) {
        // An address of its own for each size, so no per-address limit is met.
        const email = `look.out.${device}.${size.width}@example.com`;
        await addOfficeUser("acme", { email, name: "Lou Out", role: "resourcer" });
        await page.setViewportSize(size);
        // Each step, then what's its own: the answers are slips with no depth: "You're logged
        // out." pale grey with its edge, "Check your email." a green wash with its green edge; the
        // link page's button the office's main one (tinted glass in the firm's colour, 44px).
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
              expect(out.edge, where).toEqual(["1px", "solid", out.line]);
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
                    tint: el.classList.contains("glass-tint"),
                    fill: s.backgroundColor,
                    image: s.backgroundImage,
                    words: s.color,
                    tall: el.getBoundingClientRect().height,
                  };
                });
              expect(button.tint, where).toBe(true);
              expect(button.fill, where).toBe(TINT);
              expect(button.image, where).toMatch(TINT_IMAGE);
              expect(button.words, where).toBe(ON_TINT);
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
          expectGlass(look, where, device);
          // The login card: from 640px a section of glass over the street map, 12px round; on a
          // phone no frame at all.
          expect(look.loginCard, where).not.toBeNull();
          if (size.width >= 640) {
            expect(look.loginCard!.fill, where).toBe(SECTION[device]);
            expect(look.loginCard!.frost, where).toBe(SECTION_FROST[device]);
            expect(look.loginCard!.radius, where).toBe("12px");
            expect(look.loginCard!.depth, where).not.toBe("none");
          } else {
            expect(look.loginCard!.fill, where).toBe("rgba(0, 0, 0, 0)");
            expect(look.loginCard!.widths, where).toEqual(four("0px"));
            expect(look.loginCard!.depth, where).toBe("none");
          }
          primaries += look.primaries.length;
          await own(where);
        }
      }
      // "Send me a link" on the login, at least.
      expect(primaries).toBeGreaterThan(0);
    });
  });
}

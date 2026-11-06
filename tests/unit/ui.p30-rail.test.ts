import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CASUAL_MENU_ID, SKIP_TO_MENU, SkipToMenu } from "@/app/skip-to-menu";
import { railInitial, TabBar } from "@/app/tab-bar";

// Phase 30 (30.2; docs/screens.md "### 30.2"): from 1024px the casual app's tab bar is the office's
// rail at the window's left. One component draws both: one <nav aria-label="Main"> with the five
// links and their counts at every size, the switch made by CSS at 1024px (globals.css's "Phase 30
// (30.2)" block), so it needs no JavaScript. Below 1024px the floating bar is untouched (its own
// tests: portal.my-shifts, ui.casual-app, ui.glass, ui.p28-classes).

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const render = (props: Parameters<typeof TabBar>[0]) =>
  renderToStaticMarkup(createElement(TabBar, props));
const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
const nameOf = (html: string, href: string) =>
  /aria-label="([^"]*)"/.exec(
    new RegExp(`<a [^>]*href="${href}"[^>]*>`).exec(html)?.[0] ?? "",
  )?.[1];

// The block of globals.css that makes the rail, split into its two media queries.
function railCss() {
  const css = read("src/app/globals.css");
  const start = css.indexOf("/* --- Phase 30 (30.2)");
  expect(start, "the 30.2 block in globals.css").toBeGreaterThan(-1);
  const block = css.slice(start);
  const media = (query: string) => {
    const at = block.indexOf(`@media (${query}) {`);
    expect(at, query).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = block.indexOf("{", at); i < block.length; i++) {
      if (block[i] === "{") depth++;
      if (block[i] === "}" && --depth === 0) return block.slice(at, i + 1);
    }
    throw new Error(`unclosed ${query}`);
  };
  return { block, wide: media("width >= 64rem"), narrow: media("width < 64rem") };
}
// One rule's declarations, by its exact selector.
function rule(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  return Object.fromEntries(
    body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
  );
}
const rem = (v: string | undefined) => Number(/^([\d.]+)rem$/.exec(v ?? "")?.[1]);

describe("the rail and the bar: one component, one nav (30.2)", () => {
  it("one nav named Main with the five links, the current one marked, at both sizes", () => {
    for (const current of ["home", "shifts", "messages", "pay", "profile"] as const) {
      const html = render({ current, firm: { name: "Acme Events" } });
      expect(html.match(/<nav /g)).toHaveLength(1);
      expect(html.match(/aria-label="Main"/g)).toHaveLength(1);
      expect(html).toContain("data-tab-bar");
      expect(links(html)).toEqual(["/", "/shifts", "/messages", "/pay", "/profile"]);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      // Plain links: nothing that needs JavaScript.
      expect(html).not.toMatch(/<button|onclick/i);
    }
  });

  it("the firm's mark at the rail's top: its initial on its colour, from 1024px only, not read out", () => {
    const html = render({ current: "home", firm: { name: "Acme Events" } });
    const mark = /<span aria-hidden="true" data-rail-mark="" class="([^"]*)">([^<]*)<\/span>/.exec(
      html,
    );
    expect(mark?.[2]).toBe("A");
    const cls = mark?.[1]?.split(" ") ?? [];
    // Hidden on a phone (the bar has no mark), shown from 1024px; 40px, 8px round, as the
    // office rail's mark.
    expect(cls).toEqual(
      expect.arrayContaining(["hidden", "lg:flex", "size-10", "rounded-row", "bg-brand-bar"]),
    );
    expect(cls).toContain("text-on-brand-bar");
    // It's the capsule's first child, before the links.
    expect(html.indexOf("data-rail-mark")).toBeLessThan(html.indexOf("<a "));
    // No firm, no mark.
    expect(render({ current: "home" })).not.toContain("data-rail-mark");
    expect(railInitial("  northline Staffing")).toBe("N");
    expect(railInitial("4Site Security")).toBe("4");
    expect(railInitial("")).toBe("");
  });

  it("the same counts and their words, rail or bar", () => {
    const html = render({
      current: "home",
      profileCount: 1,
      answersCount: 0,
      messagesCount: 2,
      payCount: 1,
      firm: { name: "Acme Events" },
    });
    expect(nameOf(html, "/profile")).toBe("Profile, 1 thing needs doing");
    expect(nameOf(html, "/messages")).toBe("Messages, 2 new replies");
    expect(nameOf(html, "/pay")).toBe("Pay, 1 new answer from payroll");
    expect(nameOf(html, "/")).toBeUndefined();
    expect(html).toMatch(/data-profile-count="[^>]*>1</);
    expect(html).toMatch(/data-messages-count="[^>]*>2</);
    expect(html).toMatch(/data-pay-count="[^>]*>1</);
  });

  it("railOnly: the same nav, marked to show from 1024px only; the bar as it was otherwise", () => {
    const rail = render({ current: "shifts", firm: { name: "Acme Events" }, railOnly: true });
    expect(rail).toMatch(/^<nav aria-label="Main" data-tab-bar="" data-rail-only="" class="/);
    expect(links(rail)).toEqual(["/", "/shifts", "/messages", "/pay", "/profile"]);
    expect(render({ current: "shifts" })).not.toContain("data-rail-only");
  });
});

describe("the rail's CSS (globals.css, Phase 30 (30.2))", () => {
  it("from 1024px: a 96px column 12px from the window's top and left; the page right of it", () => {
    const { wide } = railCss();
    const nav = rule(wide, "nav[data-tab-bar]");
    expect(nav.inset).toBe("0.75rem auto auto 0.75rem");
    expect(nav.padding).toBe("0");
    const capsule = rule(wide, "nav[data-tab-bar] > div");
    expect(capsule).toMatchObject({
      display: "flex",
      "flex-direction": "column",
      width: "6rem",
      "max-width": "none",
      height: "auto",
      "max-height": "calc(100dvh - 1.5rem)",
      "overflow-y": "auto",
    });
    // The page moves right by the rail and a 12px gap either side, so nothing goes under it.
    const body = rule(wide, "body:has(nav[data-tab-bar])");
    expect(rem(body["padding-left"])).toBe(0.75 + rem(capsule.width) + 0.75);
    // The room kept for the floating bar at the page's end goes.
    expect(rule(wide, 'div[aria-hidden="true"]:empty:has(+ nav[data-tab-bar])').display).toBe(
      "none",
    );
  });

  it("each link a tile at least 64px tall (44px and up) with its word always shown", () => {
    const { wide } = railCss();
    expect(rem(rule(wide, "nav[data-tab-bar] a")["min-height"])).toBeGreaterThanOrEqual(2.75);
    // The phone's shrunk bar hides the words (sr-only); from 1024px they're always shown.
    expect(rule(wide, "nav[data-tab-bar] a > span:last-child")).toMatchObject({
      position: "static",
      width: "auto",
      height: "auto",
      overflow: "visible",
      "clip-path": "none",
    });
  });

  it("below 1024px only the rail-only nav goes; nothing else changes the bar there", () => {
    const { narrow, block } = railCss();
    expect(rule(narrow, "nav[data-tab-bar][data-rail-only]").display).toBe("none");
    expect(narrow.replace(/\/\*[\s\S]*?\*\//g, "").match(/\{/g)).toHaveLength(2);
    // The two media queries are the block's only rules.
    expect(
      block
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/@media \(width >= 64rem\) \{[\s\S]*$/, "")
        .replace(/@media \(width < 64rem\) \{[\s\S]*?\n\}/, "")
        .trim(),
    ).toBe("");
  });
});

describe("every casual page with the bar has the rail; a shift's own page the rail alone", () => {
  it("the bar's loaders pass the firm for the mark, and a shift's page draws CasualRail", () => {
    const bar = read("src/app/casual-tab-bar.tsx");
    expect(bar.match(/firm=\{await railFirm\(\)\}/g)).toHaveLength(2);
    expect(bar).toMatch(/export async function CasualRail\([\s\S]*?railOnly\s*\/>/);
    const shift = read("src/app/shifts/[id]/page.tsx");
    expect(shift).toContain('<CasualRail firm={firm} workerId={worker.id} current="shifts" />');
    // Not the bar: a shift's own page keeps no tab bar on a phone.
    expect(shift).not.toMatch(/TabBar/);
  });
});

// The rail is last in the page (it's the bar on a phone), so from 1024px the keyboard would reach
// it only after everything else: "Skip to the menu" comes first (the 30.2 review, accessibility).
describe("Skip to the menu (30.2)", () => {
  it("a link to the nav's links, hidden until it has focus, as the office's Skip to content", () => {
    const link = renderToStaticMarkup(createElement(SkipToMenu));
    expect(SKIP_TO_MENU).toBe("Skip to the menu");
    expect(link).toBe(
      `<a href="#${CASUAL_MENU_ID}" data-skip-menu="" class="sr-only focus:not-sr-only focus:bg-ink focus:px-4 focus:py-3 focus:text-base focus:font-semibold focus:text-on-ink">Skip to the menu</a>`,
    );
    // Its target: an empty mark inside the nav, out of the flow, just before the five links, on
    // the bar and the rail alike.
    for (const railOnly of [false, true]) {
      const html = render({ current: "pay", firm: { name: "Acme Events" }, railOnly });
      expect(html.match(new RegExp(`id="${CASUAL_MENU_ID}"`, "g"))).toHaveLength(1);
      const at = html.indexOf(`<span id="${CASUAL_MENU_ID}" class="sr-only"></span>`);
      expect(at).toBeGreaterThan(html.indexOf("<nav "));
      expect(at).toBeLessThan(html.indexOf("<a "));
    }
  });

  it("first on a firm's page: after the firm's bar (no links in it), before the page", () => {
    const layout = read("src/app/layout.tsx");
    const body = layout.slice(layout.indexOf("<body"));
    const skip = body.indexOf("{brand && <SkipToMenu />}");
    expect(skip).toBeGreaterThan(body.indexOf("{brand && <BrandBar brand={brand} />}"));
    expect(skip).toBeLessThan(body.indexOf("{children}"));
    expect(read("src/app/brand-bar.tsx")).not.toMatch(/<a\b|<Link\b|<button\b/);
  });

  it("shown only from 1024px, and only on a page with the casual nav (not on a phone, not the office)", () => {
    const css = read("src/app/globals.css");
    const start = css.indexOf("/* --- Skip to the menu (30.2)");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("/* --- Phase 30 (30.2)"));
    expect(block.length).toBeGreaterThan(0);
    const media = block.slice(block.indexOf("@media (width >= 64rem) {"));
    const outside = block.slice(0, block.indexOf("@media"));
    expect(rule(outside, "a[data-skip-menu]").display).toBe("none");
    expect(rule(media, "body:has(nav[data-tab-bar]) a[data-skip-menu]").display).toBe("block");
    expect(block.replace(/\/\*[\s\S]*?\*\//g, "").match(/\{/g)).toHaveLength(3);
  });
});

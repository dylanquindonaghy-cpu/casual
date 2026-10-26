import { describe, expect, it } from "vitest";
import {
  BLOCKS,
  block,
  colourTokens,
  contrast,
  css,
  grounds,
  hexOf,
  looks,
  lowest,
  parseColour,
} from "../helpers/theme-css";

// Contrast in every look (docs/office-v2.md 3.1 and D7; PLAN.md 12A.1): every pair a page puts
// together meets WCAG AA, text 4.5:1 and borders and controls 3:1. Phase 24 (Liquid Glass, round 7
// of the Design canvas): most grounds are glass now, a translucent fill over a pastel wash, so a
// pair is checked over every ground the glass can show (tests/helpers/theme-css.ts `grounds`): a
// section over each point of the wash, its backdrop saturated as the browser does it, and over
// what floats; what floats over the wash; a tile's and a clear button's gradients, both ends, the
// button also under the pointer, pressed and brightened; the lens on its track; the main button,
// its colour to its shade. In six looks: light and dark (the cookie's block; the device's must hold
// the same), each also solid (less transparency or more contrast: no wash, no glass) and with no
// blur (a browser that can't: the glass more opaque, nothing saturated). Phase 21 to 23's office
// looks are gone: the office takes the same colours (its block sets only sizes).

const LOOKS = looks();

// Words (4.5:1), each on everywhere it sits: a token (a translucent one over every glass under
// it; `button` is the file input's button), or one of the places (theme-css.ts PLACES).
const TEXT: [string, string[]][] = [
  [
    "ink",
    [
      "canvas",
      "card",
      "sheet",
      "panel",
      "raised",
      "track",
      "glass-tile",
      "glass-button",
      "lens",
      "active",
      "count",
      "button",
      "button-hover",
      "button-press",
      "quiet-soft",
      "urgent-soft",
      "attention-soft",
      "wait-soft",
      "done-soft",
      "urgent-tile",
      "hivis",
      "wait-tile",
      "done-tile",
    ],
  ],
  // Grey words: also a tab's while it's pressed (`tab`: `active:bg-button-press`).
  [
    "ink-muted",
    [
      "canvas",
      "card",
      "sheet",
      "panel",
      "raised",
      "track",
      "glass-tile",
      "glass-button",
      "lens",
      "active",
      "count",
      "button-press",
      "quiet-soft",
      "urgent-soft",
      "attention-soft",
      "wait-soft",
      "done-soft",
      "urgent-tile",
      "hivis",
      "wait-tile",
      "done-tile",
    ],
  ],
  // The faintest words: a group's name over the menu, a chart's ticks.
  ["ink-faint", ["canvas", "card", "panel", "glass-tile"]],
  ["ink-press", ["canvas", "card"]],
  // Statuses as words, on the glass and their own tints; a destructive step's red words on a clear
  // button (btn.danger).
  ["urgent", ["canvas", "card", "panel", "glass-tile", "glass-button", "urgent-soft"]],
  // (And "Can't make it?" on the pass's clear button.)
  ["urgent-ink", ["card", "glass-button", "urgent-soft", "urgent-tile"]],
  ["attention", ["canvas", "card", "panel", "glass-tile"]],
  ["attention-ink", ["card", "attention-soft"]],
  ["done", ["canvas", "card", "panel", "glass-tile"]],
  ["done-ink", ["canvas", "card", "done-soft", "done-tile"]],
  ["quiet-ink", ["quiet-soft"]],
  ["wait-ink", ["wait-soft", "wait-tile"]],
  // The app's blue as words: the current page's icon, the chosen tab's word, "offered, no reply".
  ["accent", ["canvas", "card", "panel", "glass-tile", "lens"]],
  // The firm's colour as words (the defaults; a firm's own set: tests/unit/tenancy.brand.test.ts).
  ["brand-ink", ["canvas", "card", "panel", "glass-tile"]],
  // Words on fills.
  ["on-ink", ["ink", "ink-hover", "ink-press"]],
  ["on-brand", ["brand"]],
  ["on-tint", ["glass-tint"]],
  ["on-urgent", ["urgent-fill", "urgent-fill-hover"]],
  ["on-brand-bar", ["brand-bar"]],
  ["on-brand-bar-soft", ["brand-bar"]],
  ["on-pass-plate", ["pass-plate"]],
  ["on-hivis", ["hivis"]],
  ["on-done", ["done-fill"]],
  ["on-demo", ["demo"]],
  ["on-accent", ["accent", "accent-hover", "accent-press"]],
];

// Borders, controls, marks and the focus ring against what's around them (3:1; a switch that's
// off 3.5:1).
const CONTROLS: [string, string[]][] = [
  ["line-strong", ["canvas", "card", "sheet", "panel", "raised", "glass-tile"]],
  ["switch-off", ["card", "panel"]],
  // A switch's knob on its track: off, and on (ink: the "showing" switch; red: urgent).
  ["knob", ["switch-off", "ink", "urgent-fill"]],
  ["urgent", ["card", "panel", "urgent-soft"]],
  ["attention", ["card", "panel", "attention-soft"]],
  ["done", ["card", "panel", "done-soft"]],
  ["ink", ["canvas", "card", "sheet", "panel", "glass-tile"]],
  ["brand", ["card", "panel"]],
  // The marks a person must tell apart from their card (WCAG 1.4.11): not offered yet (ink),
  // offered and waiting (blue), red to do now, green done. Grey calm is relieved: below.
  ["mark-open", ["card"]],
  ["mark-wait", ["card"]],
  ["mark-urgent", ["card"]],
  ["mark-done", ["card"]],
];

const failures = (pairs: [string, string[]][], min: (fg: string) => number) =>
  LOOKS.flatMap((look) =>
    pairs.flatMap(([fg, places]) =>
      places
        .map((where) => [where, lowest(look, fg, where)] as const)
        .filter(([, ratio]) => !(ratio >= min(fg)))
        .map(([where, ratio]) => `${look.name}: ${fg} on ${where}: ${ratio.toFixed(2)}`),
    ),
  );

describe("the looks (src/app/globals.css)", () => {
  it("every token has a light and a dark value, and the device's dark blocks match the cookie's", () => {
    const light = colourTokens(block(BLOCKS.theme));
    const dark = colourTokens(block(BLOCKS.dark));
    expect(light.size).toBeGreaterThan(60);
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
    expect(Object.fromEntries(colourTokens(block(BLOCKS.deviceDark)))).toEqual(
      Object.fromEntries(dark),
    );
    // Every token a colour the tests can read (#rrggbb or rgb(r g b / a)).
    for (const [name, value] of [...light, ...dark])
      expect(parseColour(value), `${name}: ${value}`).toBeDefined();
    // The fallbacks' device blocks hold their cookie blocks' values.
    expect(Object.fromEntries(colourTokens(block(BLOCKS.solidDeviceDark)))).toEqual(
      Object.fromEntries(colourTokens(block(BLOCKS.solidDark))),
    );
    expect(Object.fromEntries(colourTokens(block(BLOCKS.clearDeviceDark)))).toEqual(
      Object.fromEntries(colourTokens(block(BLOCKS.clearDark))),
    );
  });

  it("the office has no colours of its own (Phase 24): its block sets only sizes", () => {
    const office = block(/body:has\(\[data-office\]\) \{([^}]*)\}/);
    expect(office).not.toMatch(/--color-/);
    expect(css).not.toMatch(/body:has\(\[data-office\]\)\s*\{[^}]*--color-/);
    expect(css).not.toMatch(/\[data-theme="dark"\] body:has\(\[data-office\]\)/);
  });

  it("each theme sets the browser's colour scheme; the device's dark gives way to a light cookie", () => {
    expect(block(BLOCKS.root)).toMatch(/^\s*color-scheme: light;/);
    expect(block(BLOCKS.dark)).toMatch(/^\s*color-scheme: dark;/);
    expect(block(BLOCKS.deviceDark)).toMatch(/^\s*color-scheme: dark;/);
  });

  // D7's true greys in dark (Dylan's change in Phase 20, from navy), kept under the glass: the
  // solid greys and the glass's own tints no more than a few steps from grey.
  it("dark is true greys", () => {
    const dark = new Map([
      ...colourTokens(block(BLOCKS.theme)),
      ...colourTokens(block(BLOCKS.dark)),
    ]);
    for (const t of [
      "canvas",
      "card",
      "sheet",
      "panel",
      "ink",
      "ink-muted",
      "ink-faint",
      "line-strong",
      "switch-off",
      "quiet-soft",
    ]) {
      const [r, g, b] = parseColour(dark.get(t))!;
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${t}: ${dark.get(t)}`).toBeLessThanOrEqual(12);
    }
    expect([dark.get("urgent-fill"), dark.get("on-urgent")]).toEqual(["#cf3a33", "#ffffff"]);
  });

  it("the grounds: six looks, each with the glass's every point", () => {
    expect(LOOKS.map((l) => l.name)).toEqual([
      "light",
      "dark",
      "light, solid",
      "dark, solid",
      "light, no blur",
      "dark, no blur",
    ]);
    const [light, dark, solid] = LOOKS;
    // 15 points of the wash (its base, four lights, and halfway between each two of those), a
    // section over each, saturated, and over what floats.
    expect(grounds(light!, "canvas")).toHaveLength(15);
    expect(grounds(light!, "card")).toHaveLength(30);
    expect(grounds(solid!, "card").map((g) => g.colour)).toEqual([
      [255, 255, 255],
      [255, 255, 255],
    ]);
    // A section over the wash is never white in light, nor black in dark: the test reads real
    // glass, not a stand-in. A pressed clear button's words are brightened with it.
    const lum = (c: number[]) => c[0]! + c[1]! + c[2]!;
    expect(Math.min(...grounds(light!, "card").map((g) => lum(g.colour)))).toBeLessThan(3 * 250);
    expect(Math.max(...grounds(dark!, "card").map((g) => lum(g.colour)))).toBeGreaterThan(3 * 20);
    // (Both its ends over each of the 45 grounds under it.)
    expect(grounds(light!, "glass-button").filter((g) => g.brightened)).toHaveLength(90);
  });

  it("words meet 4.5:1 on every ground they sit on, in every look", () => {
    expect(failures(TEXT, () => 4.5)).toEqual([]);
  });

  it("borders, controls, marks and the focus ring meet 3:1; a switch that's off, 3.5:1", () => {
    expect(failures(CONTROLS, (fg) => (fg === "switch-off" ? 3.5 : 3))).toEqual([]);
  });

  // brand-soft: the firm's colour at 12% over whatever it lies on (the current tab, the gate's
  // plate, the "shifts to apply for" tile). A firm may set any #rrggbb, so ink must read on the tint
  // of every colour (the default, both demo firms', the corners of the colour cube) over every
  // ground, in every look; and the default brand's words on its own tint, as on a sign plate.
  it("ink reads on brand-soft for any firm colour, in every look", () => {
    expect(css).toMatch(
      /--color-brand-soft: color-mix\(in srgb, var\(--color-brand\) 12%, transparent\);/,
    );
    const levels = [0, 128, 255];
    const cube = levels.flatMap((r) =>
      levels.flatMap((g) => levels.map((b) => [r, g, b] as [number, number, number])),
    );
    const failing = LOOKS.flatMap((look) =>
      [[29, 78, 216], [15, 118, 110], ...cube]
        .map((brand) => {
          const b = brand as [number, number, number];
          return [hexOf(b), lowest(look, "ink", "brand-soft", b)] as const;
        })
        .filter(([, ratio]) => !(ratio >= 4.5))
        .map(([brand, ratio]) => `${look.name}: ink on ${brand}'s tint: ${ratio.toFixed(2)}`),
    );
    expect(failing).toEqual([]);
    for (const look of LOOKS)
      expect(lowest(look, "brand-ink", "brand-soft"), look.name).toBeGreaterThanOrEqual(4.5);
  });

  // Decorative, never alone: the hairlines and status edges (the words say the status; the fill
  // draws the button), the scrim, the charts' grid and baseline, and the grey "calm" mark: under 3:1
  // on light glass by design (the set is told apart with colour blindness), so it never stands
  // alone: every bar carries its number, every chart its legend, and its Numbers table has each
  // mark's row in words (docs/ui-design.md "Phase 23"). The page's own ground is the wash's base.
  const RELIEVED = ["mark-calm"];
  it("every token but the decorative ones is in a checked pair", () => {
    const checked = new Set([...TEXT, ...CONTROLS].flatMap(([fg, places]) => [fg, ...places]));
    const unchecked = [...colourTokens(block(BLOCKS.theme)).keys()].filter((t) => !checked.has(t));
    expect(unchecked).toEqual([
      "line",
      "pill",
      "button-line",
      "scrim",
      "tint",
      "tint-shade",
      "urgent-line",
      "attention-line",
      "wait-line",
      "done-line",
      "quiet-line",
      ...RELIEVED,
      "mark-grid",
      "mark-base",
    ]);
    // `pill` is the lens, `tint` and `tint-shade` the main button's two ends: each read through
    // its place (theme-css.ts grounds), so checked all the same.
    for (const look of LOOKS) {
      expect(lowest(look, "ink", "lens"), look.name).toBeGreaterThanOrEqual(4.5);
      expect(lowest(look, "ink", "glass-button"), look.name).toBeGreaterThanOrEqual(4.5);
      expect(lowest(look, "on-tint", "glass-tint"), look.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the ratio itself: black on white is 21:1, a colour on itself 1:1", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([27, 38, 66], [27, 38, 66])).toBe(1);
    expect(contrast([71, 85, 105], [255, 255, 255])).toBeCloseTo(7.58, 2);
  });
});

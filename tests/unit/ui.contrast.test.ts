import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chip, disc, slip } from "@/app/ui/classes";
import { over, type Rgb, type Rgba } from "@/lib/tenancy/glass-grounds";
import {
  BLOCKS,
  BRIGHT,
  block,
  colourTokens,
  contrast,
  css,
  grounds,
  hexOf,
  looks,
  lowest,
  officeLooks,
  parseColour,
  props,
  type Look,
} from "../helpers/theme-css";

// Contrast in every look (docs/office-v2.md 3.1 and D7; PLAN.md 12A.1): every pair a page puts
// together meets WCAG AA, text 4.5:1 and borders and controls 3:1. Since Phase 24 (Liquid Glass)
// most grounds are glass, a translucent fill over what's behind the page, so a pair is checked over
// every ground the glass can show (tests/helpers/theme-css.ts `grounds`): a section over each point
// behind it, and over what floats; what floats over those points; a tile's and a clear button's
// gradients, both ends, the button also under the pointer, pressed and brightened; the lens on its
// track; the main button, its colour to its shade. Phase 26 (round 8, after Haulix) gave the office
// its own looks, dark by default and light when picked, translucent and sharp glass; Phase 27.6
// gave the casual app the same looks (round 7's pastel wash and its 15 points are gone), but for
// the firm's own colour, and still following the phone: light and dark (the cookie's block; the
// device's must hold the same). Behind the glass in every look since Phase 27.7 (Dylan: "Yes plain
// colour"): the plain ground alone (round 8's made-up street pattern and its two strengths of line
// are gone). Each look also solid (less transparency or more contrast: no glass) and with no blur
// (a browser that can't: every ground solid too), so twelve looks in all.

const LOOKS = [...looks(), ...officeLooks()];

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
      "glass-band",
      "booked-day",
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
      // The pass's date beside "In 3 days", on its warm band (Phase 24).
      "glass-band",
    ],
  ],
  // The faintest words: a group's name over the menu, a chart's ticks.
  ["ink-faint", ["canvas", "card", "panel", "glass-tile"]],
  ["ink-press", ["canvas", "card"]],
  // Statuses as words, on the glass and their own tints; a destructive step's red words on a clear
  // button (btn.danger).
  ["urgent", ["canvas", "card", "panel", "glass-tile", "glass-button", "urgent-soft"]],
  // (And "Can't make it?" on a later booking's clear button; Phase 24: the places left, "Urgent"
  // and a strip day's urgent count on a little glass chip. Phase 28: the casual app's opener of a
  // destructive step, `staffBtn.danger`, red words on no fill of its own, on the page, a card or a
  // sheet, and on the grey wash under the pointer.)
  [
    "urgent-ink",
    [
      "canvas",
      "card",
      "panel",
      "button-hover",
      "glass-button",
      "glass-tile",
      "urgent-soft",
      "urgent-tile",
    ],
  ],
  ["attention", ["canvas", "card", "panel", "glass-tile"]],
  ["attention-ink", ["card", "attention-soft"]],
  ["done", ["canvas", "card", "panel", "glass-tile"]],
  ["done-ink", ["canvas", "card", "done-soft", "done-tile"]],
  ["quiet-ink", ["quiet-soft"]],
  ["wait-ink", ["wait-soft", "wait-tile"]],
  // The app's blue as words: the current page's icon, the chosen tab's word, "offered, no reply".
  ["accent", ["canvas", "card", "panel", "glass-tile", "lens"]],
  // The firm's colour as words (the defaults; a firm's own set: tests/unit/tenancy.brand.test.ts).
  // (Phase 24: the current tab's icon and word, under the lens.)
  ["brand-ink", ["canvas", "card", "panel", "glass-tile", "lens"]],
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
  // A switch's knob on its track: off, and on (green: the "showing" switch, Phase 24; red: urgent).
  // The green track itself against the glass is `done` on card and panel, below.
  ["knob", ["switch-off", "done", "urgent-fill"]],
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

  // Round 8 (Phase 26): the office's own looks, every token in each (none left to the casual
  // app's), set on [data-office] so they win over <body>'s firm colours inside it; the page's ground
  // and the browser's colour scheme on <html> for an office page. One hi-vis accent on the main
  // button (flat: no glow, no shade; since Phase 27.6 the main button has no glow anywhere:
  // tests/unit/ui.glass.test.ts), the firm's mark and what's selected; white words on red at 4.93:1
  // (#d13438; the pre-build audit's aud-1); no drop under anything at rest.
  it("the office has its own looks (round 8): every token, dark by default, light when picked", () => {
    const app = [...colourTokens(block(BLOCKS.theme)).keys()].sort();
    for (const name of ["officeDark", "officeLight"] as const)
      expect([...colourTokens(block(BLOCKS[name])).keys()].sort(), name).toEqual(app);
    const dark = colourTokens(block(BLOCKS.officeDark));
    const light = colourTokens(block(BLOCKS.officeLight));
    for (const look of [dark, light]) {
      expect([look.get("tint"), look.get("tint-shade"), look.get("on-tint")]).toEqual([
        "#e9f86f",
        "#e9f86f",
        "#171800",
      ]);
      expect(look.get("brand-bar")).toBe("#e9f86f");
    }
    expect([dark.get("urgent-fill"), dark.get("on-urgent")]).toEqual(["#d13438", "#ffffff"]);
    expect(dark.get("accent")).toBe("#e9f86f");
    expect(
      lowest(
        LOOKS.find((l) => l.name === "office dark")!,
        "on-urgent",
        "urgent-fill",
      ),
    ).toBeCloseTo(4.93, 2);
    // Phase 27.1 (Dylan, "+20%"): the dark look's glass is see-through and sharper (a 12% edge,
    // a 3px blur); the light look's is as it was (10%, 6px).
    for (const [name, rim, blur] of [
      ["officeDark", "0\\.12", "3px"],
      ["officeLight", "0\\.1", "6px"],
    ] as const) {
      const body = block(BLOCKS[name]);
      expect(body, name).toMatch(/--glass-drop: 0 0 #0000;/);
      expect(body, name).toMatch(/--glass-drop-sm: 0 0 #0000;/);
      // (No glow to switch off: the main button has none at all since Phase 27.6.)
      expect(body, name).not.toMatch(/--tint-glow/);
      expect(body, name).toMatch(
        new RegExp(`--glass-rim: inset 0 0 0 1px rgb\\(\\d+ \\d+ \\d+ \\/ ${rim}\\);`),
      );
      expect(body, name).toMatch(
        new RegExp(`--glass-filter: blur\\(${blur}\\) saturate\\(1\\.15\\);`),
      );
    }
    // And its fills: a section (card, sheet) and what floats (panel: the menus and, on a phone, the
    // top bar, `max-lg:glass-float` in office-frame.tsx, pinned in tests/unit/office.shell.test.ts).
    // Dark: 4%, 70% (27.1). Light: as it was. Behind them, the page's plain ground, set on the
    // page's root for an office page and nothing else there: no street lines anywhere (Phase 27.7,
    // Dylan: "Yes plain colour"; docs/plan/decisions-waiting.md 13).
    expect(css).toMatch(/@utility glass-float \{\s*background-color: var\(--color-panel\);/);
    for (const [name, root, card, panel, canvas] of [
      [
        "officeDark",
        /:root:not\(\[data-theme="light"\]\):has\(\[data-office\]\) \{([^}]*)\}/,
        "rgb\\(255 255 255 \\/ 0\\.04\\)",
        "rgb\\(24 24 26 \\/ 0\\.7\\)",
        "#0f0f10",
      ],
      [
        "officeLight",
        /:root\[data-theme="light"\]:has\(\[data-office\]\) \{([^}]*)\}/,
        "rgb\\(255 255 255 \\/ 0\\.55\\)",
        "rgb\\(255 255 255 \\/ 0\\.92\\)",
        "#f2f2f0",
      ],
    ] as const) {
      const body = block(BLOCKS[name]);
      expect(body, name).toMatch(new RegExp(`--color-card: ${card};`));
      expect(body, name).toMatch(new RegExp(`--color-sheet: ${card};`));
      expect(body, name).toMatch(new RegExp(`--color-panel: ${panel};`));
      expect(props(body).get("color-canvas"), name).toBe(canvas);
      expect(Object.fromEntries(props(block(root))), `${name}: the page's root`).toEqual({
        "color-canvas": canvas,
      });
    }
    expect(css).not.toMatch(/--map-(?:road|line)\b/);
    expect(css).toMatch(
      /:root:not\(\[data-theme="light"\]\):has\(\[data-office\]\) \{\s*color-scheme: dark;/,
    );
    expect(css).toMatch(
      /:root\[data-theme="light"\]:has\(\[data-office\]\) \{\s*color-scheme: light;/,
    );
    // The office's sizes stay in their own block, with no colour.
    expect(block(/body:has\(\[data-office\]\) \{([^}]*)\}/)).not.toMatch(/--color-/);
  });

  // Phase 27.6 (Dylan, 2026-11-03: "casual round 8: yes, firm's colour, follow the phone"): the
  // casual app's looks are the office's round 8 values, light and dark, value by value: its colours,
  // its glass (blurs, hairlines, no drop at rest) and its plain ground (Phase 27.7), solid and with
  // no blur too. But for what stays the casual app's own: the firm's colour (the main button, the
  // firm's mark, its tints and the gate's plate), the app's blue, and the to-do tint (hi-vis yellow
  // is the office's alone). The office's blocks keep every value of their own (it's dark with no
  // cookie even where the page's root is light), so this holds the two copies together; but not
  // the corners, one set for both apps in @theme since Phase 28 (28.1), so neither copies them.
  const CASUAL_OWN = [
    "brand",
    "on-brand",
    "brand-ink",
    "tint",
    "on-tint",
    "tint-shade",
    "brand-bar",
    "on-brand-bar",
    "on-brand-bar-soft",
    "pass-plate",
    "on-pass-plate",
    "accent",
    "accent-hover",
    "accent-press",
    "on-accent",
    "hivis",
    "on-hivis",
  ].map((t) => `color-${t}`);
  const except = (m: Map<string, string>, own: string[]) =>
    Object.fromEntries([...m].filter(([k]) => !own.includes(k)));
  it("the casual app's looks are round 8's, light and dark, but for the firm's own colour (Phase 27.6)", () => {
    // The corners in no theme block at all (Phase 28): @theme's set is everyone's.
    for (const name of Object.keys(BLOCKS) as (keyof typeof BLOCKS)[])
      if (name !== "theme")
        expect(
          [...props(block(BLOCKS[name])).keys()].filter((k) => k.startsWith("radius-")),
          name,
        ).toEqual([]);
    const themeColours = new Map(
      [...props(block(BLOCKS.theme))].filter(([k]) => k.startsWith("color-")),
    );
    const casualLight = new Map([...themeColours, ...props(block(BLOCKS.root))]);
    const pairs = [
      ["light", casualLight, BLOCKS.officeLight],
      ["dark (the cookie's)", props(block(BLOCKS.dark)), BLOCKS.officeDark],
      ["dark (the device's)", props(block(BLOCKS.deviceDark)), BLOCKS.officeDark],
      ["light, solid", props(block(BLOCKS.solid)), BLOCKS.officeSolidLight],
      ["dark, solid", props(block(BLOCKS.solidDark)), BLOCKS.officeSolidDark],
      ["dark, solid (the device's)", props(block(BLOCKS.solidDeviceDark)), BLOCKS.officeSolidDark],
      ["light, no blur", props(block(BLOCKS.clear)), BLOCKS.officeClearLight],
      ["dark, no blur", props(block(BLOCKS.clearDark)), BLOCKS.officeClearDark],
      [
        "dark, no blur (the device's)",
        props(block(BLOCKS.clearDeviceDark)),
        BLOCKS.officeClearDark,
      ],
    ] as const;
    for (const [name, casual, office] of pairs)
      expect(except(casual, CASUAL_OWN), name).toEqual(except(props(block(office)), CASUAL_OWN));
    // Each look's ground and glass, as the office's (Phase 27.1's dark glass too); no street lines
    // (Phase 27.7: a plain colour behind every page).
    const light = casualLight;
    const dark = props(block(BLOCKS.dark));
    expect([light.get("color-canvas"), dark.get("color-canvas")]).toEqual(["#f2f2f0", "#0f0f10"]);
    expect([light.get("color-card"), dark.get("color-card")]).toEqual([
      "rgb(255 255 255 / 0.55)",
      "rgb(255 255 255 / 0.04)",
    ]);
    expect([light.get("color-panel"), dark.get("color-panel")]).toEqual([
      "rgb(255 255 255 / 0.92)",
      "rgb(24 24 26 / 0.7)",
    ]);
    expect([light.get("glass-filter"), dark.get("glass-filter")]).toEqual([
      "blur(6px) saturate(1.15)",
      "blur(3px) saturate(1.15)",
    ]);
    expect([light.get("glass-rim"), dark.get("glass-rim")]).toEqual([
      "inset 0 0 0 1px rgb(16 24 40 / 0.1)",
      "inset 0 0 0 1px rgb(255 255 255 / 0.12)",
    ]);
    for (const look of [light, dark, props(block(BLOCKS.deviceDark))])
      expect([...look.keys()].filter((k) => k.startsWith("map-"))).toEqual([]);
    expect(css).not.toMatch(/--map-road\b/);
    for (const look of [light, dark]) {
      expect(look.get("glass-drop")).toBe("0 0 #0000");
      expect(look.get("glass-drop-sm")).toBe("0 0 #0000");
    }
    // What stays the casual app's own: the firm's colour's defaults (the app's ink, a firm with a
    // colour of its own sets its own on <body>: below), the app's blue (a shade lighter in dark,
    // for the lighter glass: #a1bdff, was #9cb8ff) and the to-do tint's pale amber. The main
    // button one flat colour since Phase 28 (28.1), as the office's: its shade is itself.
    const lightOwn = Object.fromEntries(CASUAL_OWN.map((k) => [k, light.get(k)]));
    const darkOwn = Object.fromEntries(CASUAL_OWN.map((k) => [k, dark.get(k)]));
    // Phase 32 (32.1, 32.3; Dylan's approved mock-up, "the casual app in the office's look"): the
    // main button and the firm's mark are the office's lime with its dark olive words, in both
    // looks, as the office's own blocks have them.
    const lime = {
      "color-tint": "#e9f86f",
      "color-on-tint": "#171800",
      "color-tint-shade": "#e9f86f",
      "color-brand-bar": "#e9f86f",
      "color-on-brand-bar": "#171800",
      "color-on-brand-bar-soft": "#4a4f14",
    };
    expect(lightOwn).toMatchObject({
      ...lime,
      "color-accent": "#1d4ed8",
      "color-hivis": "rgb(251 229 160 / 0.8)",
    });
    expect(darkOwn).toMatchObject({
      ...lime,
      "color-accent": "#a1bdff",
      "color-hivis": "rgb(58 47 16 / 0.8)",
    });
    for (const [k, v] of Object.entries(lime))
      expect(colourTokens(block(BLOCKS.officeDark)).get(k.replace("color-", "")), k).toBe(v);
    // The lime is in the casual app's blocks only as the main button and the mark: never its
    // to-do tint (pale amber there), and not in the solid or clear fallbacks' own values.
    for (const name of ["theme", "root", "dark", "deviceDark"] as const) {
      const lines = block(BLOCKS[name])
        .split("\n")
        .filter((l) => /#e9f86f|233 248 111/i.test(l))
        .map((l) => l.trim().split(":")[0]);
      expect(
        lines.every((l) => /^--color-(?:tint|tint-shade|brand-bar)$/.test(l ?? "")),
        name,
      ).toBe(true);
    }
    for (const name of [
      "solid",
      "solidDark",
      "solidDeviceDark",
      "clear",
      "clearDark",
      "clearDeviceDark",
    ] as const)
      expect(block(BLOCKS[name]), name).not.toMatch(/#e9f86f|233 248 111|#f4fbb7|#2a2d16/i);
    // Still following the phone: light by default, dark from the cookie or the device (never the
    // office's dark-by-default on the casual pages).
    expect(block(BLOCKS.root)).toMatch(/^\s*color-scheme: light;/);
    expect(css).toMatch(/^:root \{\s*color-scheme: light;/m);
    expect(css).toMatch(/^:root\[data-theme="dark"\] \{\s*color-scheme: dark;/m);
    expect(css).toMatch(
      /^@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{\s*color-scheme: dark;/m,
    );
  });

  // Phase 32 (32.1, 32.3; the approved mock-up): the main button and the firm's mark are the
  // office's lime in the casual app too, in both looks, so a firm's own colour (set on <body>)
  // no longer sets them; it keeps its other tints (`brand`, `brand-ink`, the gate's plate). Until
  // Phase 32 the firm's colour was the main button (Phase 27.6).
  it("the main button and the mark are the office's lime in both apps; a firm's colour keeps its tints", () => {
    const firm = block(/^body\[data-firm-colour\] \{([^}]*)\}/m);
    for (const [token, value] of [
      ["brand", "firm-fill"],
      ["brand-ink", "firm-ink"],
    ])
      expect(firm).toContain(`--color-${token}: var(--${value});`);
    for (const body of [
      firm,
      block(/^:root\[data-theme="dark"\] body\[data-firm-colour\] \{([^}]*)\}/m),
      block(/^ {2}:root:not\(\[data-theme="light"\]\) body\[data-firm-colour\] \{([^}]*)\}/m),
    ])
      expect(body).not.toMatch(/--color-(?:tint|tint-shade|on-tint|brand-bar|on-brand-bar)\b/);
    // No --firm-shade is set or read any more (src/lib/tenancy/brand-values.ts sets none).
    expect(css).not.toMatch(/--firm-shade/);
    expect(css).toMatch(/@utility glass-tint \{\s*background-color: var\(--color-tint\);/);
    // Hi-vis only in the office's own blocks, on its wrapper.
    for (const name of ["officeDark", "officeLight"] as const)
      expect(colourTokens(block(BLOCKS[name])).get("tint"), name).toBe("#e9f86f");
    const hivis = css
      .split("\n")
      .filter((line) => /#e9f86f/i.test(line))
      .map((line) => line.trim().split(":")[0]);
    expect(new Set(hivis)).toEqual(
      new Set([
        "--color-tint",
        "--color-tint-shade",
        "--color-brand-bar",
        "--color-on-hivis",
        "--color-accent",
      ]),
    );
    for (const look of looks())
      expect(lowest(look, "on-tint", "glass-tint"), look.name).toBeGreaterThanOrEqual(4.5);
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
    // Round 8's red since Phase 27.6, as the office's (white words on it at 4.93:1).
    expect([dark.get("urgent-fill"), dark.get("on-urgent")]).toEqual(["#d13438", "#ffffff"]);
    // And round 8's office dark (Phase 26): neutral charcoal.
    const office = colourTokens(block(BLOCKS.officeDark));
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
      const [r, g, b] = parseColour(office.get(t))!;
      expect(
        Math.max(r, g, b) - Math.min(r, g, b),
        `office ${t}: ${office.get(t)}`,
      ).toBeLessThanOrEqual(12);
    }
  });

  it("the grounds: twelve looks, each with the glass's every point over the plain ground", () => {
    expect(LOOKS.map((l) => l.name)).toEqual([
      "light",
      "dark",
      "light, solid",
      "dark, solid",
      "light, no blur",
      "dark, no blur",
      "office dark",
      "office dark, solid",
      "office dark, no blur",
      "office light",
      "office light, solid",
      "office light, no blur",
    ]);
    const [light, dark, solid] = LOOKS;
    // Behind the glass (round 8's since Phase 27.6, in place of round 7's 15 points of the wash;
    // since Phase 27.7 the plain ground alone, in place of the street pattern's two strengths of
    // line over it): a section over it, and over what floats over it. The casual app's are the
    // office's.
    expect(grounds(light!, "canvas").map((g) => g.colour)).toEqual([[242, 242, 240]]);
    expect(grounds(dark!, "canvas").map((g) => g.colour)).toEqual([[15, 15, 16]]);
    for (const look of LOOKS)
      expect(look.ground, look.name).toEqual([
        look.name.includes("light") ? [242, 242, 240] : [15, 15, 16],
      ]);
    expect(grounds(light!, "card")).toHaveLength(2);
    expect(grounds(solid!, "card").map((g) => g.colour)).toEqual([
      [255, 255, 255],
      [255, 255, 255],
    ]);
    // A section over the ground is never white in light, nor black in dark: the test reads real
    // glass, not a stand-in. A pressed clear button's words are brightened with it.
    const lum = (c: number[]) => c[0]! + c[1]! + c[2]!;
    expect(Math.min(...grounds(light!, "card").map((g) => lum(g.colour)))).toBeLessThan(3 * 250);
    expect(Math.max(...grounds(dark!, "card").map((g) => lum(g.colour)))).toBeGreaterThan(3 * 20);
    // (Both its ends over each of the 3 grounds under it: 2 sections, 1 floating.)
    expect(grounds(light!, "glass-button").filter((g) => g.brightened)).toHaveLength(6);
    // The office's: its plain ground, as drawn and solid alike.
    const office = LOOKS.find((l) => l.name === "office dark")!;
    expect(grounds(office, "canvas").map((g) => g.colour)).toEqual([[15, 15, 16]]);
    expect(
      grounds(
        LOOKS.find((l) => l.name === "office dark, solid")!,
        "card",
      ),
    ).toHaveLength(2);
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
  // mark's row in words (docs/ui-design.md "Phase 23"). The page's own ground is the plain colour.
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

// Phase 28 (28.1; docs/ui-design.md "Phase 28"): the casual app's new shared parts, in both its
// themes (light and dark, each as drawn, solid and with no blur: looks()). A chip's words on its
// tint, a slip's words on each status's tint (both over the page itself, a section and what
// floats), the current tab's words on its solid ink and the counts on it (the to-do amber over the
// ink, and their edge of the page's ground against the ink), each slip's round icon disc (its icon
// on its fill, over the slip's tint) and the main button, one flat colour now.
describe("Phase 28's parts in the casual app's looks", () => {
  const CASUAL = looks();
  type Tone = "urgent" | "attention" | "wait" | "done" | "quiet";
  const TONES: Tone[] = ["urgent", "attention", "wait", "done", "quiet"];
  const solid = (look: Look, token: string): Rgb => {
    const c = look.colours.get(token);
    if (!c || c[3] !== 1) throw new Error(`${look.name}: ${token} isn't a solid colour`);
    return [c[0], c[1], c[2]];
  };
  // A translucent tint over every ground a part sits on: the page's plain ground as well as the
  // sections and what floats (theme-css.ts grounds).
  const tintGrounds = (look: Look, tint: string): Rgb[] => {
    const c = look.colours.get(tint);
    if (!c) throw new Error(`${look.name}: no ${tint}`);
    if (c[3] === 1) return [[c[0], c[1], c[2]]];
    const under = [
      ...look.ground,
      ...grounds(look, "card").map((g) => g.colour),
      ...grounds(look, "panel").map((g) => g.colour),
    ];
    return under.map((u) => over(c, u));
  };
  const worst = (look: Look, words: string, on: Rgb[]) =>
    Math.min(...on.map((g) => contrast(solid(look, words), g)));

  it("the looks it checks: the casual app's six (light and dark, as drawn, solid, no blur)", () => {
    expect(CASUAL.map((l) => l.name)).toEqual([
      "light",
      "dark",
      "light, solid",
      "dark, solid",
      "light, no blur",
      "dark, no blur",
    ]);
  });

  it("a chip's words on its tint, 4.5:1 or more (wait's words in ink, quiet's in grey)", () => {
    const CHIPS: Record<Tone, [string, string]> = {
      urgent: ["urgent-ink", "urgent-soft"],
      attention: ["attention-ink", "attention-soft"],
      wait: ["ink", "wait-soft"],
      done: ["done-ink", "done-soft"],
      quiet: ["ink-muted", "quiet-soft"],
    };
    // The pairs are the ones classes.ts's chips use.
    for (const t of TONES) expect(chip[t]).toBe(`bg-${CHIPS[t][1]} text-${CHIPS[t][0]}`);
    const failing = CASUAL.flatMap((look) =>
      TONES.map((t) => [t, worst(look, CHIPS[t][0], tintGrounds(look, CHIPS[t][1]))] as const)
        .filter(([, r]) => !(r >= 4.5))
        .map(([t, r]) => `${look.name}: ${t} chip: ${r.toFixed(2)}`),
    );
    expect(failing).toEqual([]);
  });

  it("a slip's ink words on each status's tint, 4.5:1 or more; its icon disc's icon on its fill, 3:1 or more", () => {
    for (const t of TONES) expect(slip[t]).toBe(`border-${t}-line bg-${t}-soft`);
    expect(slip.base.split(" ")).toEqual(
      expect.arrayContaining(["rounded-row", "border", "text-ink"]),
    );
    // Each disc: its fill and its icon's colour, as classes.ts's `disc` has them.
    const DISCS: Record<Tone, [string, string]> = {
      urgent: ["urgent-tile", "urgent-ink"],
      attention: ["hivis", "on-hivis"],
      wait: ["wait-tile", "ink"],
      done: ["done-tile", "done-ink"],
      quiet: ["glass-button", "ink-muted"],
    };
    for (const t of TONES) {
      const [fill, icon] = DISCS[t];
      expect(disc[t]).toBe(
        fill === "glass-button" ? `glass-button text-${icon}` : `bg-${fill} text-${icon}`,
      );
    }
    expect(disc.base.split(" ")).toEqual(expect.arrayContaining(["size-8", "rounded-full"]));
    const failing: string[] = [];
    for (const look of CASUAL)
      for (const t of TONES) {
        const soft = tintGrounds(look, `${t}-soft`);
        const words = worst(look, "ink", soft);
        if (!(words >= 4.5)) failing.push(`${look.name}: ink on ${t}-soft: ${words.toFixed(2)}`);
        const [fill, icon] = DISCS[t];
        const layer = (c: Rgba) => soft.map((s) => (c[3] === 1 ? solid(look, fill) : over(c, s)));
        const discs =
          fill === "glass-button"
            ? (["button-top", "button-bottom"] as const).flatMap((v) => {
                const c = parseColour(look.vars.get(v));
                if (!c) throw new Error(`${look.name}: no --${v}`);
                return soft.map((s) => over(c, s));
              })
            : layer(look.colours.get(fill)!);
        const mark = worst(look, icon, discs);
        if (!(mark >= 3)) failing.push(`${look.name}: ${icon} on ${t}'s disc: ${mark.toFixed(2)}`);
      }
    expect(failing).toEqual([]);
  });

  it("the current tab: its words on its solid ink 4.5:1 or more; the ink tab 3:1 on the tab bar; its counts on the ink", () => {
    // A count is drawn on the tab it belongs to (src/app/tab-bar.tsx): the to-do amber with its
    // words, or the firm's colour, each set off by a 2px edge of the page's ground. The pairs below
    // are those classes.
    const tabBar = readFileSync(join(process.cwd(), "src/app/tab-bar.tsx"), "utf8");
    expect(tabBar).toContain("outline-2 outline-canvas");
    expect(tabBar).toContain('"bg-hivis text-on-hivis"');
    // (Phase 32, 32.1: the ink is the current tab's round button, its icon on it.)
    expect(tabBar).toMatch(/"bg-ink text-on-ink"/);
    // Pressed, `press-glass`'s brightness(1.06) brightens the whole tab: the ink, the count and its
    // words together.
    const bright = (c: Rgb): Rgb => c.map((v) => Math.min(255, Math.round(v * BRIGHT))) as Rgb;
    const failing: string[] = [];
    const check = (what: string, a: Rgb, b: Rgb, min: number) => {
      for (const [x, y] of [
        [a, b],
        [bright(a), bright(b)],
      ] as const) {
        const r = contrast(x, y);
        if (!(r >= min)) failing.push(`${what}: ${r.toFixed(2)}`);
      }
    };
    for (const look of CASUAL) {
      expect(lowest(look, "on-ink", "ink"), look.name).toBeGreaterThanOrEqual(4.5);
      expect(lowest(look, "ink", "panel"), look.name).toBeGreaterThanOrEqual(3);
      // Its counts: the to-do amber and the firm's colour, each with its words.
      expect(lowest(look, "on-hivis", "hivis"), look.name).toBeGreaterThanOrEqual(4.5);
      expect(lowest(look, "on-tint", "glass-tint"), look.name).toBeGreaterThanOrEqual(4.5);
      // On the current tab a count lies on the solid ink, not on the tab bar: the amber, translucent
      // where the look has glass, over the ink, its words 4.5:1 or more.
      const ink = solid(look, "ink");
      const hivis = look.colours.get("hivis");
      if (!hivis) throw new Error(`${look.name}: no hivis`);
      check(
        `${look.name}: on-hivis on hivis over ink`,
        solid(look, "on-hivis"),
        over(hivis, ink),
        4.5,
      );
      // The count's edge, the page's ground, against the ink, 3:1 or more: it keeps a count in the
      // firm's colour apart from the ink tab whatever that colour is (the default, #15171a, is all
      // but ink in light), and the firm's colour's own words are checked on it above.
      check(`${look.name}: canvas edge on ink`, solid(look, "canvas"), ink, 3);
    }
    expect(failing).toEqual([]);
  });

  it("the main button: one flat colour (one stop), its words 4.5:1 or more on it, brightened too", () => {
    for (const look of CASUAL) {
      expect(look.colours.get("tint-shade"), look.name).toEqual(look.colours.get("tint"));
      const fills = grounds(look, "glass-tint");
      const stops = new Set(fills.filter((g) => !g.brightened).map((g) => g.colour.join(",")));
      expect(stops.size, look.name).toBe(1);
      expect(lowest(look, "on-tint", "glass-tint"), look.name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

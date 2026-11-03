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
  officeLooks,
  parseColour,
  props,
} from "../helpers/theme-css";

// Contrast in every look (docs/office-v2.md 3.1 and D7; PLAN.md 12A.1): every pair a page puts
// together meets WCAG AA, text 4.5:1 and borders and controls 3:1. Since Phase 24 (Liquid Glass)
// most grounds are glass, a translucent fill over what's behind the page, so a pair is checked over
// every ground the glass can show (tests/helpers/theme-css.ts `grounds`): a section over each point
// behind it, and over what floats; what floats over those points; a tile's and a clear button's
// gradients, both ends, the button also under the pointer, pressed and brightened; the lens on its
// track; the main button, its colour to its shade. Phase 26 (round 8, after Haulix) gave the office
// its own looks, dark by default and light when picked, translucent and sharp glass over a faint
// street map; Phase 27.6 gave the casual app the same looks (round 7's pastel wash and its 15
// points are gone), but for the firm's own colour, and still following the phone: light and dark
// (the cookie's block; the device's must hold the same). Behind the glass in every look: the flat
// ground and the street map's two strengths of line. Each look also solid (less transparency or
// more contrast: no map, no glass) and with no blur (a browser that can't: every ground solid too,
// the map still round them), so twelve looks in all.

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
  // and a strip day's urgent count on a little glass chip.)
  ["urgent-ink", ["card", "glass-button", "glass-tile", "urgent-soft", "urgent-tile"]],
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
    // top bar, `max-lg:glass-float` in office-frame.tsx, pinned in tests/unit/office.shell.test.ts),
    // and the street lines, in the office's block and on the page's root, which draws them
    // (body::before reads --map-road from there). Dark: 4%, 70%, 8.5% (27.1; the lines as in the
    // approved pictures: docs/plan/decisions-waiting.md 13). Light: as it was.
    expect(css).toMatch(/@utility glass-float \{\s*background-color: var\(--color-panel\);/);
    for (const [name, root, card, panel, road] of [
      [
        "officeDark",
        /:root:not\(\[data-theme="light"\]\):has\(\[data-office\]\) \{([^}]*)\}/,
        "rgb\\(255 255 255 \\/ 0\\.04\\)",
        "rgb\\(24 24 26 \\/ 0\\.7\\)",
        "rgb\\(255 255 255 \\/ 0\\.085\\)",
      ],
      [
        "officeLight",
        /:root\[data-theme="light"\]:has\(\[data-office\]\) \{([^}]*)\}/,
        "rgb\\(255 255 255 \\/ 0\\.55\\)",
        "rgb\\(255 255 255 \\/ 0\\.92\\)",
        "rgb\\(16 24 40 \\/ 0\\.07\\)",
      ],
    ] as const) {
      const body = block(BLOCKS[name]);
      expect(body, name).toMatch(new RegExp(`--color-card: ${card};`));
      expect(body, name).toMatch(new RegExp(`--color-sheet: ${card};`));
      expect(body, name).toMatch(new RegExp(`--color-panel: ${panel};`));
      expect(body, name).toMatch(new RegExp(`--map-road: ${road};`));
      expect(block(root), `${name}: the page's root`).toMatch(new RegExp(`--map-road: ${road};`));
    }
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
  // its glass (blurs, hairlines, no drop at rest), its ground and its street lines, solid and with
  // no blur too. But for what stays the casual app's own: the firm's colour (the main button, the
  // firm's mark, its tints and the gate's plate), the app's blue, and the to-do tint (hi-vis yellow
  // is the office's alone); and the office's own corners. The office's blocks keep every value of
  // their own (it's dark with no cookie even where the page's root is light), so this holds the
  // two copies together.
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
  const OFFICE_OWN = ["radius-card", "radius-inner", "radius-row"];
  const except = (m: Map<string, string>, own: string[]) =>
    Object.fromEntries([...m].filter(([k]) => !own.includes(k)));
  it("the casual app's looks are round 8's, light and dark, but for the firm's own colour (Phase 27.6)", () => {
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
    for (const [name, casual, office] of pairs) {
      const own = [...CASUAL_OWN, ...OFFICE_OWN];
      expect(except(casual, own), name).toEqual(except(props(block(office)), own));
    }
    // Each look's ground, glass and street lines, as the office's (Phase 27.1's dark glass too).
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
    expect([light.get("map-road"), dark.get("map-road")]).toEqual([
      "rgb(16 24 40 / 0.07)",
      "rgb(255 255 255 / 0.085)",
    ]);
    for (const look of [light, dark]) {
      expect(look.get("glass-drop")).toBe("0 0 #0000");
      expect(look.get("glass-drop-sm")).toBe("0 0 #0000");
    }
    // What stays the casual app's own: the firm's colour's defaults (the app's ink, a firm with a
    // colour of its own sets its own on <body>: below), the app's blue (a shade lighter in dark,
    // for the lighter glass: #a1bdff, was #9cb8ff) and the to-do tint's pale amber.
    const lightOwn = Object.fromEntries(CASUAL_OWN.map((k) => [k, light.get(k)]));
    const darkOwn = Object.fromEntries(CASUAL_OWN.map((k) => [k, dark.get(k)]));
    expect(lightOwn).toMatchObject({
      "color-tint": "#15171a",
      "color-on-tint": "#ffffff",
      "color-tint-shade": "#000000",
      "color-brand-bar": "#1f2227",
      "color-accent": "#1d4ed8",
      "color-hivis": "rgb(251 229 160 / 0.8)",
    });
    expect(darkOwn).toMatchObject({
      "color-tint": "#f3f4f6",
      "color-on-tint": "#0b0c0e",
      "color-tint-shade": "#ffffff",
      "color-brand-bar": "#34373d",
      "color-accent": "#a1bdff",
      "color-hivis": "rgb(58 47 16 / 0.8)",
    });
    // Hi-vis yellow is the office's alone: in no block of the casual app's.
    for (const name of [
      "theme",
      "root",
      "dark",
      "deviceDark",
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

  // The main button stays in the firm's own colour in both looks (Phase 27.6, "firm's colour"): a
  // firm with a colour of its own sets it on <body>, light and dark alike (dark keeps the light
  // set's colour and words on the button: they read on themselves), and only the office's own
  // wrapper ([data-office]) paints it hi-vis.
  it("the firm's colour is the casual app's main button in both looks; hi-vis only inside the office", () => {
    const firm = block(/^body\[data-firm-colour\] \{([^}]*)\}/m);
    for (const [token, value] of [
      ["tint", "firm-fill"],
      ["on-tint", "firm-on-fill"],
      ["tint-shade", "firm-shade"],
      ["brand", "firm-fill"],
      ["brand-bar", "firm-bar"],
    ])
      expect(firm).toContain(`--color-${token}: var(--${value});`);
    for (const dark of [
      /^:root\[data-theme="dark"\] body\[data-firm-colour\] \{([^}]*)\}/m,
      /^ {2}:root:not\(\[data-theme="light"\]\) body\[data-firm-colour\] \{([^}]*)\}/m,
    ]) {
      const body = block(dark);
      expect(body).toContain("--color-tint: var(--firm-fill);");
      expect(body).toContain("--color-on-tint: var(--firm-on-fill);");
      expect(body).toContain("--color-tint-shade: var(--firm-shade);");
    }
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

  it("the grounds: twelve looks, each with the glass's every point over the street map", () => {
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
    // Behind the glass (round 8's since Phase 27.6, in place of round 7's 15 points of the wash):
    // the flat ground and the street map's two strengths of line over it; a section over each,
    // and over what floats over each. The casual app's are the office's.
    expect(grounds(light!, "canvas").map((g) => g.colour)).toEqual([
      [242, 242, 240],
      [231, 231, 230],
      [226, 227, 226],
    ]);
    expect(grounds(dark!, "canvas").map((g) => g.colour)).toEqual([
      [15, 15, 16],
      [29, 29, 30],
      [35, 35, 36],
    ]);
    expect(grounds(light!, "card")).toHaveLength(6);
    expect(grounds(solid!, "card").map((g) => g.colour)).toEqual([
      [255, 255, 255],
      [255, 255, 255],
    ]);
    // A section over the ground is never white in light, nor black in dark: the test reads real
    // glass, not a stand-in. A pressed clear button's words are brightened with it.
    const lum = (c: number[]) => c[0]! + c[1]! + c[2]!;
    expect(Math.min(...grounds(light!, "card").map((g) => lum(g.colour)))).toBeLessThan(3 * 250);
    expect(Math.max(...grounds(dark!, "card").map((g) => lum(g.colour)))).toBeGreaterThan(3 * 20);
    // (Both its ends over each of the 9 grounds under it: 6 sections, 3 floating.)
    expect(grounds(light!, "glass-button").filter((g) => g.brightened)).toHaveLength(18);
    // The office's: its flat ground and the street map's two strengths of line; solid, the ground.
    const office = LOOKS.find((l) => l.name === "office dark")!;
    expect(grounds(office, "canvas").map((g) => g.colour)).toEqual([
      [15, 15, 16],
      [29, 29, 30],
      [35, 35, 36],
    ]);
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
  // mark's row in words (docs/ui-design.md "Phase 23"). The page's own ground is the street map's.
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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Contrast in both themes (docs/office-v2.md 3.1 and D7; PLAN.md 12A.1): every pair of tokens a
// page puts together meets WCAG AA, text 4.5:1 and borders and controls 3:1, in the light theme
// (the @theme block of src/app/globals.css) and the dark theme of greys (its two dark blocks,
// which must hold the same values; navy until Phase 20). Phase 21: and in the office's own two
// (body:has([data-office]) and its two dark blocks: the same tokens, the office's values).

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function colours(block: string | undefined): Map<string, string> {
  expect(block, "a theme block is missing").toBeDefined();
  return new Map(
    [...(block ?? "").matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1]!,
      m[2]!.toLowerCase(),
    ]),
  );
}
const light = colours(css.match(/@theme\s*\{([^}]*)\}/)?.[1]);
const dark = colours(css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1]);
const deviceDark = colours(
  css.match(
    /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/,
  )?.[1],
);
// The office's (Phase 21): its blocks change some tokens; the rest are the app's.
const officeBlock = (selector: string) =>
  colours(
    css.match(new RegExp(`${selector.replace(/[[\]().:"]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1],
  );
const officeLightOwn = officeBlock("body:has([data-office])");
const officeDarkOwn = officeBlock(':root[data-theme="dark"] body:has([data-office])');
const officeDeviceDarkOwn = colours(
  css.match(
    /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\) body:has\(\[data-office\]\)\s*\{([^}]*)\}/,
  )?.[1],
);
const officeLight = new Map([...light, ...officeLightOwn]);
const officeDark = new Map([...dark, ...officeDarkOwn]);
const THEMES = { light, dark, "office light": officeLight, "office dark": officeDark } as const;

// WCAG 2's relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Text on the backgrounds it sits on (4.5:1).
const TEXT: [string, string][] = [
  ...[
    "canvas",
    "card",
    "panel",
    "raised",
    "quiet-soft",
    "urgent-soft",
    "attention-soft",
    "done-soft",
  ].map((bg): [string, string] => ["ink", bg]),
  ...["canvas", "card", "panel", "raised", "quiet-soft"].map((bg): [string, string] => [
    "ink-muted",
    bg,
  ]),
  ["urgent", "card"],
  ["urgent", "canvas"],
  ["urgent", "urgent-soft"],
  ["urgent-ink", "urgent-soft"],
  ["urgent-ink", "card"],
  ["attention-ink", "attention-soft"],
  ["attention-ink", "card"],
  ["done-ink", "done-soft"],
  ["done-ink", "card"],
  ["done-ink", "canvas"],
  ["quiet-ink", "quiet-soft"],
  ["on-ink", "ink"],
  ["on-ink", "ink-hover"],
  // The default brand (a firm with its own colour gets the text colour that reads on it:
  // tests/unit/tenancy.brand.test.ts).
  ["on-brand", "brand"],
  ["on-urgent", "urgent-fill"],
  ["on-urgent", "urgent-fill-hover"],
  // Phase 18: the firm's colour as words and its band (the defaults; a firm's own set is checked
  // in tests/unit/tenancy.brand.test.ts), sign yellow and the done fill with their words, the
  // demo bar.
  ["brand-ink", "canvas"],
  ["brand-ink", "card"],
  ["on-brand-bar", "brand-bar"],
  // Phase 20: the pass's second line, and the status tiles with their words.
  ["on-brand-bar-soft", "brand-bar"],
  ["on-pass-plate", "pass-plate"],
  ["urgent-ink", "urgent-tile"],
  ["wait-ink", "wait-tile"],
  ["done-ink", "done-tile"],
  ["on-hivis", "hivis"],
  ["on-done", "done-fill"],
  ["on-demo", "demo"],
  // Phase 21 (the office's look): the page you're on, the grey and pressed buttons (a destructive
  // one's red words on grey), the tinted cards' numbers and grey lines, the panels' rows and
  // headings on their washes.
  ["ink", "active"],
  ["ink-muted", "active"],
  ["ink", "button"],
  ["ink", "button-hover"],
  ["ink", "button-press"],
  ["urgent", "button"],
  ["urgent", "button-hover"],
  ["on-ink", "ink-press"],
  ...["urgent-tile", "hivis", "wait-tile", "done-tile"].flatMap((bg): [string, string][] => [
    ["ink", bg],
    ["ink-muted", bg],
  ]),
  ["urgent-ink", "urgent-tile"],
  ["wait-ink", "wait-soft"],
  ["ink", "wait-soft"],
  ...["urgent-soft", "attention-soft", "wait-soft", "done-soft"].map((bg): [string, string] => [
    "ink-muted",
    bg,
  ]),
  ["attention-ink", "attention-soft"],
  // The one count pill (its grey; the urgent places' in red), and a pressed text link.
  ["ink-muted", "count"],
  ["ink-press", "canvas"],
  ["ink-press", "card"],
];

// Borders, controls and the focus ring against what's around them (3:1).
const CONTROLS: [string, string][] = [
  ["line-strong", "card"],
  ["line-strong", "canvas"],
  ["line-strong", "panel"],
  ["switch-off", "card"],
  ["switch-off", "panel"],
  ["urgent", "card"],
  ["urgent", "urgent-soft"],
  ["attention", "attention-soft"],
  ["attention", "card"],
  ["done", "done-soft"],
  ["done", "card"],
  ["ink", "canvas"],
  ["ink", "card"],
  ["ink", "panel"],
  ["brand", "card"],
];

describe("the themes (src/app/globals.css)", () => {
  it("every token has a light and a dark value, and the device's dark block matches", () => {
    expect(light.size).toBeGreaterThan(20);
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
    expect(Object.fromEntries(deviceDark)).toEqual(Object.fromEntries(dark));
    // The office's (Phase 21): its dark blocks change what its light block changes, and agree.
    expect(officeLightOwn.size).toBeGreaterThan(40);
    expect([...officeDarkOwn.keys()].sort()).toEqual([...officeLightOwn.keys()].sort());
    expect(Object.fromEntries(officeDeviceDarkOwn)).toEqual(Object.fromEntries(officeDarkOwn));
    for (const t of officeLightOwn.keys()) expect(light.has(t), t).toBe(true);
  });

  it("each theme sets the browser's colour scheme; the device's dark gives way to a light cookie", () => {
    expect(css).toMatch(/:root\s*\{\s*color-scheme: light;\s*\}/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{\s*color-scheme: dark;/);
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{\s*color-scheme: dark;/,
    );
  });

  it("dark is D7's true greys (Dylan's change in Phase 20, from navy)", () => {
    expect(
      Object.fromEntries(
        ["canvas", "panel", "card", "raised", "ink-muted", "switch-off"].map((t) => [
          t,
          dark.get(t),
        ]),
      ),
    ).toEqual({
      canvas: "#0b0c0e",
      panel: "#18191c",
      card: "#18191c",
      raised: "#232529",
      "ink-muted": "#a9adb4",
      "switch-off": "#7d8189",
    });
    // Greys: no channel more than a few steps from the others (navy's blue was 30 above its red).
    for (const t of ["canvas", "card", "raised", "line", "ink-muted"]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark.get(t)!.slice(i, i + 2), 16));
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), t).toBeLessThanOrEqual(12);
    }
    expect([dark.get("urgent-fill"), dark.get("on-urgent")]).toEqual(["#cf3a33", "#ffffff"]);
    expect(contrast("#cf3a33", "#ffffff")).toBeGreaterThanOrEqual(4.87);
    expect(light.get("switch-off")).toBe("#767b83");
    // The office's dark (Phase 21): true greys too, a touch warm.
    for (const t of ["canvas", "card", "raised", "line", "ink-muted"]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(officeDark.get(t)!.slice(i, i + 2), 16));
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), `office ${t}`).toBeLessThanOrEqual(12);
    }
  });

  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: text meets 4.5:1 on what it sits on`, () => {
      const failing = TEXT.map(
        ([fg, bg]) => [fg, bg, contrast(theme.get(fg)!, theme.get(bg)!)] as const,
      )
        .filter(([, , ratio]) => !(ratio >= 4.5))
        .map(([fg, bg, ratio]) => `${fg} on ${bg}: ${ratio.toFixed(2)}`);
      expect(failing).toEqual([]);
    });

    it(`${name}: borders, controls and the focus ring meet 3:1; a switch that's off, 3.5:1`, () => {
      const failing = CONTROLS.map(
        ([fg, bg]) => [fg, bg, contrast(theme.get(fg)!, theme.get(bg)!)] as const,
      )
        .filter(([fg, , ratio]) => !(ratio >= (fg === "switch-off" ? 3.5 : 3)))
        .map(([fg, bg, ratio]) => `${fg} on ${bg}: ${ratio.toFixed(2)}`);
      expect(failing).toEqual([]);
    });
  }

  // The firm colour's pale tint behind the current tab and the office's current menu item
  // (Phase 17): brand-soft mixes 12% of the brand into the card. A firm may set any #rrggbb
  // (on <body>, in either theme), so ink must read on the tint of every colour: the default,
  // both demo firms', and the corners of the colour cube.
  it("ink reads on brand-soft for any firm colour, in both themes", () => {
    expect(css).toMatch(
      /--color-brand-soft: color-mix\(in srgb, var\(--color-brand\) 12%, var\(--color-card\)\);/,
    );
    const mix = (brand: string, base: string) =>
      `#${[1, 3, 5]
        .map((i) =>
          Math.round(
            parseInt(brand.slice(i, i + 2), 16) * 0.12 + parseInt(base.slice(i, i + 2), 16) * 0.88,
          )
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    const levels = ["00", "80", "ff"];
    const cube = levels.flatMap((r) => levels.flatMap((g) => levels.map((b) => `#${r}${g}${b}`)));
    const failing = Object.entries(THEMES).flatMap(([name, theme]) =>
      [theme.get("brand")!, "#1d4ed8", "#0f766e", ...cube]
        .map(
          (brand) => [brand, contrast(theme.get("ink")!, mix(brand, theme.get("card")!))] as const,
        )
        .filter(([, ratio]) => !(ratio >= 4.5))
        .map(([brand, ratio]) => `${name}: ink on ${brand}'s tint: ${ratio.toFixed(2)}`),
    );
    expect(failing).toEqual([]);
    // And the firm's colour as words on its own tint, as on a sign plate (the defaults here; a
    // firm's own set in tests/unit/tenancy.brand.test.ts).
    for (const theme of Object.values(THEMES))
      expect(
        contrast(theme.get("brand-ink")!, mix(theme.get("brand")!, theme.get("card")!)),
      ).toBeGreaterThanOrEqual(4.5);
  });

  // The edges of a status's tint and of a grey button (Phase 21) are decorative too: the words say
  // the status, and the fill draws the button.
  it("every token but the decorative lines and scrim is in a checked pair", () => {
    const checked = new Set([...TEXT, ...CONTROLS].flat());
    const unchecked = [...light.keys()].filter((t) => !checked.has(t));
    expect(unchecked).toEqual([
      "line",
      "scrim",
      "urgent-line",
      "attention-line",
      "wait-line",
      "done-line",
      "quiet-line",
      "button-line",
    ]);
  });

  it("the ratio itself: black on white is 21:1, a colour on itself 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#1b2642", "#1b2642")).toBe(1);
    expect(contrast("#475569", "#ffffff")).toBeCloseTo(7.58, 2);
  });
});

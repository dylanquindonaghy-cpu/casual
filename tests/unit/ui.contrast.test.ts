import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Contrast in both themes (docs/office-v2.md 3.1 and D7; PLAN.md 12A.1): every pair of tokens a
// page puts together meets WCAG AA, text 4.5:1 and borders and controls 3:1, in the light theme
// (the @theme block of src/app/globals.css) and the navy dark theme (its two dark blocks, which
// must hold the same values).

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
const THEMES = { light, dark } as const;

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
  ["on-urgent", "urgent-fill"],
  ["on-urgent", "urgent-fill-hover"],
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
];

describe("the themes (src/app/globals.css)", () => {
  it("every token has a light and a dark value, and the device's dark block matches", () => {
    expect(light.size).toBeGreaterThan(20);
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
    expect(Object.fromEntries(deviceDark)).toEqual(Object.fromEntries(dark));
  });

  it("each theme sets the browser's colour scheme; the device's dark gives way to a light cookie", () => {
    expect(css).toMatch(/:root\s*\{\s*color-scheme: light;\s*\}/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{\s*color-scheme: dark;/);
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{\s*color-scheme: dark;/,
    );
  });

  it("dark is D7's navy, with 3.1's fixes", () => {
    expect(
      Object.fromEntries(
        ["canvas", "panel", "card", "raised", "ink-muted", "switch-off"].map((t) => [
          t,
          dark.get(t),
        ]),
      ),
    ).toEqual({
      canvas: "#0f1626",
      panel: "#16203a",
      card: "#1b2642",
      raised: "#22304f",
      "ink-muted": "#a3b0c8",
      "switch-off": "#7c8aa8",
    });
    expect([dark.get("urgent-fill"), dark.get("on-urgent")]).toEqual(["#d92d20", "#ffffff"]);
    expect(contrast("#d92d20", "#ffffff")).toBeGreaterThanOrEqual(4.83);
    expect(light.get("switch-off")).toBe("#7a8396");
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

  it("every token but the decorative line is in a checked pair", () => {
    const checked = new Set([...TEXT, ...CONTROLS].flat());
    const unchecked = [...light.keys()].filter((t) => !checked.has(t));
    expect(unchecked).toEqual(["line"]);
  });

  it("the ratio itself: black on white is 21:1, a colour on itself 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#1b2642", "#1b2642")).toBe(1);
    expect(contrast("#475569", "#ffffff")).toBeCloseTo(7.58, 2);
  });
});

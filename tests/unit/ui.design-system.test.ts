import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { btn, chip, field, staffBtn, staffField } from "@/app/ui/classes";
import { Icon, type IconName } from "@/app/ui/icons";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";

// The design tokens and the shared pieces in src/app/ui/ (docs/ui-design.md "Tokens" and "Shared
// components"): the colour tokens match the doc's table, the focus ring and the file-input button
// exist, every colour class the shared pieces use is a real colour, each status tone looks
// different and carries an icon, and the shared pieces stay hook-free and dependency-free.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = read("src/app/globals.css");
const UI_DIR = "src/app/ui";
const uiFiles = readdirSync(join(process.cwd(), UI_DIR)).filter((f) => /\.tsx?$/.test(f));

// `--color-x: #value;` inside a block: the light theme is the @theme block, the dark theme the
// `:root[data-theme="dark"]` block (tests/unit/ui.contrast.test.ts checks the device's dark block
// holds the same).
function colours(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}
const themeTokens = () => colours(css.match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "");
const darkTokens = () => colours(css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? "");

// The doc's token table: "| `urgent` / `urgent-soft` | `#b91c1c` / `#fef2f2` | `#ff8b80` /
// `#3d1d26` | Act now |", the light values then the dark ones.
function docTokens(): { light: Map<string, string>; dark: Map<string, string> } {
  const doc = read("docs/ui-design.md");
  const section = doc.slice(doc.indexOf("## Tokens"), doc.indexOf("## Shared components"));
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 5 || !cells[1]!.startsWith("`")) continue;
    const names = [...cells[1]!.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]!);
    for (const [column, into] of [
      [cells[2]!, light],
      [cells[3]!, dark],
    ] as const) {
      const values = [...column.matchAll(/`(#[0-9a-f]{6})`/gi)].map((m) => m[1]!);
      expect(values, `token row: ${line}`).toHaveLength(names.length);
      names.forEach((name, i) => into.set(name, values[i]!));
    }
  }
  return { light, dark };
}

// The CSS rule for a selector, by its exact text.
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("colour tokens (src/app/globals.css)", () => {
  it("match docs/ui-design.md's table, both ways, in both themes", () => {
    const fromDoc = docTokens();
    expect(fromDoc.light.size).toBeGreaterThan(0);
    expect(Object.fromEntries(themeTokens())).toEqual(Object.fromEntries(fromDoc.light));
    expect(Object.fromEntries(darkTokens())).toEqual(Object.fromEntries(fromDoc.dark));
  });

  it("one focus ring: a 2px ink outline with a 2px offset, for keyboard focus", () => {
    const focus = rule(":focus-visible");
    expect(focus).toContain("outline: 2px solid var(--color-ink);");
    expect(focus).toContain("outline-offset: 2px;");
  });

  it("a file input shows a real button, bordered with a token", () => {
    const button = rule('input[type="file"]::file-selector-button');
    expect(button).toMatch(/border: 2px solid var\(--color-[a-z-]+\);/);
    expect(button).toContain("color: var(--color-ink);");
    expect(css).toContain('input[type="file"]:disabled::file-selector-button {');
  });
});

describe("the shared pieces (src/app/ui/)", () => {
  // Utilities that take a colour, and the suffixes of the same prefixes that aren't colours.
  const COLOUR_UTILITY =
    /(?<![\w-])(?:[a-z0-9-]+:)*(bg|text|border|divide|decoration|outline|ring)-([a-z0-9-]+)(?:\/\d+)?(?![\w-])/g;
  const NOT_A_COLOUR =
    /^(\d+|[xytblrse](-\d+)?|xs|sm|base|lg|\d?xl|center|left|right|start|end|balance|pretty|wrap|nowrap|collapse|separate|solid|dashed|dotted|none|offset-\d+)$/;
  // Not colours of their own: see-through, and the text's own colour. Tailwind's white, black
  // and palette shades are no longer allowed (12A.1: they'd stay the same in the dark theme).
  const BUILT_IN = /^(transparent|current)$/;

  it("every colour class names a token (a typo would style nothing; a palette colour ignores the theme)", () => {
    const tokens = themeTokens();
    const unknown: string[] = [];
    let checked = 0;
    for (const file of uiFiles) {
      for (const m of read(`${UI_DIR}/${file}`).matchAll(COLOUR_UTILITY)) {
        const colour = m[2]!;
        if (NOT_A_COLOUR.test(colour)) continue;
        checked++;
        if (!tokens.has(colour) && !BUILT_IN.test(colour)) unknown.push(`${file}: ${m[0]}`);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(unknown).toEqual([]);
  });

  // Phase 18: the design's phone buttons are 52px (still well over 44px); staff fields stay 56px.
  it("tap targets: office buttons and fields at least 44px, staff buttons 52px, staff fields 56px", () => {
    for (const cls of [...Object.values(btn), field])
      expect(cls).toMatch(/(?<![\w-])min-h-11(?![\w-])/);
    for (const cls of Object.values(staffBtn)) expect(cls).toMatch(/(?<![\w-])min-h-13(?![\w-])/);
    expect(staffField).toMatch(/(?<![\w-])min-h-14(?![\w-])/);
  });

  it("StatusChip: each tone has its own colours and its own icon", () => {
    const tones: StatusTone[] = ["urgent", "attention", "done", "quiet"];
    const rendered = tones.map((tone) => {
      const html = renderToStaticMarkup(StatusChip({ tone, children: "Open" }));
      const className = html.match(/^<span class="([^"]+)">/)?.[1] ?? "";
      expect(className).toBe(`${chip.base} ${chip[tone]}`);
      // Every tone, urgent too (Phase 17), is a pale tint with dark words: never a solid fill.
      expect(className.split(" ")).toContain(`bg-${tone}-soft`);
      expect(className.split(" ")).toContain(`text-${tone}-ink`);
      expect(className).not.toMatch(/(?<![\w-])bg-\w+-fill(?![\w-])/);
      expect(html.match(/<svg\b/g)).toHaveLength(1);
      return { className, icon: html.match(/<svg[^>]*>(.*)<\/svg>/)?.[1] ?? "" };
    });
    expect(new Set(rendered.map((r) => r.className)).size).toBe(tones.length);
    expect(new Set(rendered.map((r) => r.icon)).size).toBe(tones.length);
    for (const { icon } of rendered) expect(icon).not.toBe("");
  });

  it("Icon: every icon is a drawn, hidden SVG", () => {
    const source = read(`${UI_DIR}/icons.tsx`);
    const paths = source.slice(source.indexOf("const PATHS = {"), source.indexOf("} satisfies"));
    const names = [...paths.matchAll(/^ {2}([a-z]+): /gm)].map((m) => m[1] as IconName);
    expect(names).toEqual(expect.arrayContaining(["home", "logout", "chevron"]));
    for (const name of names) {
      const html = renderToStaticMarkup(createElement(Icon, { name, className: "x" }));
      expect(html, name).toMatch(
        /^<svg aria-hidden="true" focusable="false"[^>]*class="shrink-0 x">/,
      );
      expect(html, name).toMatch(/<(path|circle|rect|ellipse)\b/);
    }
  });

  it("stay hook-free and dependency-free: no client directive, no hooks, no package code", () => {
    expect(uiFiles).toEqual(
      expect.arrayContaining(["classes.ts", "icons.tsx", "page-header.tsx", "status-chip.tsx"]),
    );
    for (const file of uiFiles) {
      const text = read(`${UI_DIR}/${file}`);
      expect(text, file).not.toMatch(/^\s*["']use (client|server)["']/m);
      expect(text, file).not.toMatch(/\buse[A-Z]\w*\s*\(/);
      // Value imports only from the folder itself; `import type` (erased) from anywhere.
      const valueFrom = [...text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)];
      for (const m of valueFrom) expect(m[1], `${file} imports ${m[1]}`).toMatch(/^\.\//);
      expect(text, file).not.toMatch(/^import\s+["']/m);
    }
  });
});

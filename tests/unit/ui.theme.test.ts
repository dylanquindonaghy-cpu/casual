import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_COOKIE, themeFromCookie } from "@/app/theme";

// The theme, the type scale and the fonts (docs/office-v2.md 3.1; PLAN.md 12A.1, Phase 18): the
// sd-theme cookie's reading and its wiring into <html>, no colour or text size outside the tokens
// anywhere in src/, and Instrument Sans and Instrument Serif (Phase 20) served from the app itself.
// tests/e2e/theme.spec.ts checks the pages a browser gets.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : [path];
  });
const SOURCE = files("src").filter((f) => /\.(tsx?|css)$/.test(f));

describe("the sd-theme cookie", () => {
  it("light or dark; anything else (or none) follows the device", () => {
    expect(THEME_COOKIE).toBe("sd-theme");
    expect(themeFromCookie("light")).toBe("light");
    expect(themeFromCookie("dark")).toBe("dark");
    for (const value of [undefined, "", "Dark", "dark ", "auto", "blue", "dark;light"]) {
      expect(themeFromCookie(value), String(value)).toBeUndefined();
    }
  });

  it("the root layout reads it on the server and writes it onto <html>, with both colour schemes", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/const theme = themeFromCookie\(jar\.get\(THEME_COOKIE\)\?\.value\);/);
    expect(layout).toMatch(/<html lang="en-GB" data-theme=\{theme\} className=\{/);
    expect(layout).toMatch(/colorScheme: "light dark",/);
    // No script decides the theme after the page arrives (it would flash).
    expect(layout).not.toMatch(/<script|dangerouslySetInnerHTML|"use client"/);
  });
});

describe("colours: tokens only", () => {
  // A colour utility naming white, black or a palette shade: the same in both themes.
  const PALETTE =
    /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border|divide|decoration|outline|ring|fill|stroke|from|via|to|shadow|accent|caret|placeholder)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950))(?![\w-])/g;
  // A colour written into a class: bg-[#fff], text-[rgb(…)], [color:…].
  const ARBITRARY =
    /-\[(?:#|rgb|hsl|oklch|oklab|lab|lch|hwb|color-mix)|\[(?:color|background|background-color|border-color):/g;
  // A colour value in code. Allowed only where it's the firm's brand colour (data, not the
  // app's look) and the home screen's splash (the web app manifest can't follow a theme).
  const HEX = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi;
  const HEX_ALLOWED = [
    "src/app/manifest.ts",
    "src/lib/db/admin/seed-data.ts",
    "src/lib/tenancy/brand-values.ts",
    "src/lib/tenancy/brand.ts",
  ];

  it("no palette colour or colour value in a class, anywhere in src/", () => {
    const found = SOURCE.flatMap((file) =>
      [...read(file).matchAll(PALETTE), ...read(file).matchAll(ARBITRARY)].map(
        (m) => `${file}: ${m[0]}`,
      ),
    );
    expect(SOURCE.length).toBeGreaterThan(200);
    expect(found).toEqual([]);
  });

  it("colour values only in the tokens, the brand colour's code and data, and the manifest", () => {
    const found = SOURCE.filter(
      (f) => f !== "src/app/globals.css" && !HEX_ALLOWED.includes(f),
    ).flatMap((file) => [...read(file).matchAll(HEX)].map((m) => `${file}: ${m[0]}`));
    expect(found).toEqual([]);
    // In the CSS, a colour value only defines a token.
    const css = read("src/app/globals.css");
    const hasColour = new RegExp(HEX.source, "i");
    const outside = css.split("\n").filter(
      (line) =>
        hasColour.test(line) &&
        !/^\s*--color-[a-z-]+: #[0-9a-f]{6};/.test(line) &&
        // The five depth tokens (Phase 20; the pass's since Phase 18): tokens too.
        !/^\s*--(?:shadow-(?:lift|panel|pass|bar)|inset-shadow-sunk): [^;]+;$/.test(line),
    );
    expect(outside).toEqual([]);
  });

  // Phase 18: the firm's bar takes the firm's colour from the page's tokens too, so no page sets
  // a colour in a style; the firm's colour reaches the page only as <body>'s --firm-* values.
  it("no style colour anywhere: the firm's colour arrives as <body>'s checked values", () => {
    const styled = SOURCE.filter((f) => /style=\{\{[^}]*\b(color|background)/i.test(read(f)));
    expect(styled).toEqual([]);
    expect(read("src/app/layout.tsx")).toMatch(/style=\{firmColours\}/);
  });
});

describe("one type scale", () => {
  it("the only sizes are 12, 13, 15, 18, 24, 30 and 40px", () => {
    const theme = read("src/app/globals.css").match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(theme).toContain("--text-*: initial;");
    const sizes = Object.fromEntries(
      [...theme.matchAll(/--text-([a-z0-9]+): ([\d.]+)rem;/g)].map((m) => [
        m[1],
        Number(m[2]) * 16,
      ]),
    );
    expect(sizes).toEqual({ xs: 12, sm: 13, base: 15, lg: 18, "2xl": 24, "3xl": 30, "4xl": 40 });
  });

  it("no page uses a size outside it", () => {
    const outside = SOURCE.flatMap((file) =>
      [
        ...read(file).matchAll(
          /(?<![\w-])(?:[a-z0-9-]+:)*text-(?:xl|[5-9]xl|\[[\d.]+(?:px|rem|em)\])(?![\w-])/g,
        ),
      ].map((m) => `${file}: ${m[0]}`),
    );
    expect(outside).toEqual([]);
  });

  it("40px only for the sign figures (a shift's time, a count) and the greetings (Phase 20)", () => {
    const uses = SOURCE.flatMap((file) =>
      [...read(file).matchAll(/"[^"\n]*(?<![\w-])text-4xl(?![\w-])[^"\n]*"/g)].map((m) => [
        file,
        m[0],
      ]),
    );
    expect(uses.length).toBeGreaterThan(2);
    // The date tile's sizes live in a table beside its font-sign day.
    const notSign = uses.filter(
      ([file, cls]) =>
        !/(?<![\w-])font-(?:sign|greet)(?![\w-])/.test(cls!) && file !== "src/app/ui/sign.tsx",
    );
    expect(notSign).toEqual([]);
    expect(read("src/app/ui/sign.tsx")).toMatch(/className=\{`block font-sign [^`]*\$\{t\.day\}/);
    // The greetings: Home's and the dashboard's, each in the serif at 40px.
    expect(read("src/app/home-view.tsx")).toMatch(
      /className="font-greet text-4xl[^"]*">Hi \{firstName\}/,
    );
    expect(read("src/app/office/dashboard-view.tsx")).toMatch(
      /className="block font-greet text-4xl"/,
    );
  });

  it("every digit fixed-width; office fields don't make a phone zoom in", () => {
    expect(read("src/app/globals.css")).toMatch(
      /body \{\s*font-variant-numeric: tabular-nums;\s*\}/,
    );
    expect(read("src/app/ui/classes.ts")).toMatch(
      /export const field =\s*"[^"]*\btext-base\b[^"]*\bpointer-coarse:text-lg\b[^"]*";/,
    );
  });
});

describe("the font", () => {
  it("Instrument Sans and Instrument Serif from their npm packages, through next/font/local", () => {
    const fonts = read("src/app/fonts.ts");
    expect(fonts).toMatch(/^import localFont from "next\/font\/local";/m);
    const sources = [...fonts.matchAll(/src: "([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toEqual([
      "../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
      "../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-ext-wght-normal.woff2",
      "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
      "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-ext-400-normal.woff2",
    ]);
    for (const src of sources)
      expect(statSync(join(ROOT, "src/app", src!)).size).toBeGreaterThan(5000);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/instrument-sans"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies["@fontsource/instrument-serif"]).toMatch(/^\d+\.\d+\.\d+$/);
    // The faces before them are gone (Phase 18's, and 12A.1's).
    for (const old of [
      "@fontsource-variable/public-sans",
      "@fontsource/barlow-condensed",
      "@fontsource-variable/plus-jakarta-sans",
    ])
      expect(pkg.dependencies[old], old).toBeUndefined();
    // Only the latin faces are fetched before they're needed.
    expect(fonts.match(/preload: false/g)).toHaveLength(2);
    expect(read("src/app/layout.tsx")).toContain("className={fontVariables}");
    expect(read("src/app/global-error.tsx")).toContain("className={fontVariables}");
    // Words in Instrument Sans; the sign figures in its semibold with fixed-width digits; the
    // greetings in Instrument Serif.
    const css = read("src/app/globals.css");
    expect(css).toMatch(/--font-sans:\s*var\(--font-instrument\), var\(--font-instrument-ext\),/);
    expect(css).toMatch(
      /@utility font-sign \{\s*font-family:\s*var\(--font-instrument\), var\(--font-instrument-ext\),[^}]*font-weight: 600;\s*font-variant-numeric: tabular-nums;/,
    );
    expect(css).toMatch(
      /@utility font-greet \{\s*font-family:\s*var\(--font-instrument-serif\), var\(--font-instrument-serif-ext\),[^}]*font-weight: 400;/,
    );
  });

  it("nothing from Google: no Google font loader and no Google font address in src/", () => {
    const google = SOURCE.filter((f) =>
      /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(read(f)),
    );
    expect(google).toEqual([]);
  });
});

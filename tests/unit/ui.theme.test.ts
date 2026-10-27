import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_COOKIE, themeFromCookie } from "@/app/theme";

// The theme, the type scale and the font (docs/office-v2.md 3.1; PLAN.md 12A.1, Phase 18): the
// sd-theme cookie's reading and its wiring into <html>, no colour or text size outside the tokens
// anywhere in src/, and Geist (Phase 24, round 7: one face for the office and the casual app, in
// place of Instrument Sans and Serif and the office's Plus Jakarta Sans) served from the app
// itself. tests/e2e/theme.spec.ts checks the pages a browser gets.

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
    // In the CSS, a colour value only defines a token (Phase 24): a colour token (#rrggbb, or
    // rgb(r g b / a) for the glass), or one of the glass's own variables (its rims, drops and
    // gradients' ends, the wash's lights, the bar's edge), in a theme's block or a fallback's.
    // Read declaration by declaration, since a long one wraps onto several lines.
    const css = read("src/app/globals.css");
    const hasColour = new RegExp(HEX.source, "i");
    const GLASS_VARS =
      "glass-rim|glass-drop|glass-drop-sm|glass-sunk|float-shadow|tile-top|tile-bottom|button-top|button-bottom|button-rim|tint-rim|lens-shadow|edge-fill|wash-[a-d]";
    const tokens = new RegExp(
      String.raw`^\s*--(?:color-[a-z-]+: (?:#[0-9a-f]{6}|rgb\(\d+ \d+ \d+ \/ [\d.]+\))|(?:${GLASS_VARS}):[^;]+);`,
      "gm",
    );
    const outside = css
      .replace(tokens, "")
      .split("\n")
      .filter((line) => hasColour.test(line));
    expect(outside).toEqual([]);
    // And every colour token is one colour, nothing else: no var(), no mix, no gradient.
    const colourDefs = [...css.matchAll(/^\s*--color-([a-z-]+):\s*([^;]+);/gm)];
    expect(colourDefs.length).toBeGreaterThan(200);
    for (const [, name, value] of colourDefs)
      expect(value, name).toMatch(
        /^(?:#[0-9a-f]{6}|rgb\(\d+ \d+ \d+ \/ [\d.]+\)|var\(--firm-[a-z-]+\)|color-mix\(in srgb, var\(--color-brand\) 12%, transparent\))$/,
      );
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
  // Round 7's sizes (Phase 24): the casual app's 12, 14, 16, 18, 20, 28 and 44px; the office's
  // (body:has([data-office])) 13, 15, 17, 30 and 40px in place of 14, 16, 18, 28 and 44.
  const sizes = (block: string) =>
    Object.fromEntries(
      [...block.matchAll(/--text-([a-z0-9]+): ([\d.]+)rem;/g)].map((m) => [
        m[1],
        Number(m[2]) * 16,
      ]),
    );
  it("the only sizes are 12, 14, 16, 18, 20, 28 and 44px; the office's 12, 13, 15, 17, 20, 30 and 40px", () => {
    const css = read("src/app/globals.css");
    const theme = css.match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(theme).toContain("--text-*: initial;");
    expect(sizes(theme)).toEqual({
      xs: 12,
      sm: 14,
      base: 16,
      lg: 18,
      "2xl": 20,
      "3xl": 28,
      "4xl": 44,
    });
    const office = css.match(/body:has\(\[data-office\]\) \{([^}]*)\}/)?.[1] ?? "";
    expect(sizes(office)).toEqual({ sm: 13, base: 15, lg: 17, "3xl": 30, "4xl": 40 });
    expect({ ...sizes(theme), ...sizes(office) }).toEqual({
      xs: 12,
      sm: 13,
      base: 15,
      lg: 17,
      "2xl": 20,
      "3xl": 30,
      "4xl": 40,
    });
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

  it("the biggest size (44px; 40 in the office) only for the sign figures (a shift's time, a count), the greetings (Phase 20) and the office's counts (`font-stat`)", () => {
    const uses = SOURCE.flatMap((file) =>
      [...read(file).matchAll(/"[^"\n]*(?<![\w-])text-4xl(?![\w-])[^"\n]*"/g)].map((m) => [
        file,
        m[0],
      ]),
    );
    expect(uses.length).toBeGreaterThan(2);
    expect(read("src/app/ui/sign.tsx")).toMatch(/className=\{`block font-sign [^`]*\$\{t\.day\}/);
    // The greetings: Home's at the biggest size (`font-greet`: Geist medium since Phase 24); the
    // dashboard's inside its one <h1>, at a page headline's size (no display serif).
    expect(read("src/app/home-view.tsx")).toMatch(
      /className="font-greet text-4xl[^"]*">Hi \{firstName\}/,
    );
    // The date tile's sizes live in a table beside its font-sign day. In the office, its big
    // counts in their own figures (`font-stat`); no display serif (gone in Phase 23).
    const notSign = uses.filter(
      ([file, cls]) =>
        !/(?<![\w-])font-(?:sign|greet|stat)(?![\w-])/.test(cls!) && file !== "src/app/ui/sign.tsx",
    );
    expect(notSign).toEqual([]);
    expect(read("src/app/office/dashboard-view.tsx")).toMatch(
      /<h1 className="text-title text-ink">Dashboard<\/h1>/,
    );
    expect(SOURCE.filter((f) => /(?<![\w-])font-display(?![\w-])/.test(read(f)))).toEqual([]);
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
  it("Geist from its npm package, through next/font/local: latin, and latin-ext only when it's needed", () => {
    const fonts = read("src/app/fonts.ts");
    expect(fonts).toMatch(/^import localFont from "next\/font\/local";/m);
    const sources = [...fonts.matchAll(/src: "([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toEqual([
      "../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
      "../../node_modules/@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2",
    ]);
    for (const src of sources)
      expect(statSync(join(ROOT, "src/app", src!)).size).toBeGreaterThan(5000);
    // Each subset covers what the package says it does (its own wght.css), and no more.
    const packageCss = read("node_modules/@fontsource-variable/geist/wght.css");
    const range = (file: string) =>
      new RegExp(
        String.raw`src: url\(\./files/${file}\) format\('woff2-variations'\);\s*unicode-range: ([^;]+);`,
      ).exec(packageCss)?.[1];
    const ranges = [...fonts.matchAll(/value:\s*"(U\+[^"]+)"/g)].map((m) => m[1]);
    expect(ranges).toEqual([
      range("geist-latin-wght-normal.woff2"),
      range("geist-latin-ext-wght-normal.woff2"),
    ]);
    expect(ranges.every(Boolean)).toBe(true);
    // One exact version; the faces before it are gone (Phase 18's, the office's round 2's, Phase
    // 20's Instrument Sans and Serif and Phase 23's Plus Jakarta Sans).
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/geist"]).toBe("5.3.0");
    for (const old of [
      "@fontsource-variable/public-sans",
      "@fontsource/barlow-condensed",
      "@fontsource-variable/dm-sans",
      "@fontsource/dm-mono",
      "@fontsource-variable/newsreader",
      "@fontsource-variable/instrument-sans",
      "@fontsource/instrument-serif",
      "@fontsource-variable/plus-jakarta-sans",
    ])
      expect(pkg.dependencies[old], old).toBeUndefined();
    expect(
      SOURCE.filter((f) => /instrument[- ]?(?:sans|serif)|plus[- ]?jakarta/i.test(read(f))),
    ).toEqual([]);
    // Only the latin face is fetched before it's needed; both on <html>, the error screen's too.
    expect(fonts.match(/preload: false/g)).toHaveLength(1);
    expect(fonts).toMatch(/export const fontVariables = \[geist, geistExt\]/);
    expect(read("src/app/layout.tsx")).toContain("className={fontVariables}");
    expect(read("src/app/global-error.tsx")).toContain("className={fontVariables}");
    // Words in Geist, and every one of its uses: the sign figures in its semibold with fixed-width
    // digits, a page's headline, the big numbers, the greetings (its medium).
    const css = read("src/app/globals.css");
    expect(css).toMatch(/--font-sans:\s*var\(--font-geist\), var\(--font-geist-ext\),/);
    for (const utility of ["font-sign", "text-title", "font-stat", "font-greet"])
      expect(css, utility).toMatch(
        new RegExp(
          String.raw`@utility ${utility} \{\s*font-family: var\(--font-geist\), var\(--font-geist-ext\), ui-sans-serif, system-ui, sans-serif;`,
        ),
      );
    expect(css).toMatch(
      /@utility font-sign \{[^}]*font-weight: 600;\s*font-variant-numeric: tabular-nums;/,
    );
    expect(css).toMatch(/@utility font-greet \{[^}]*font-weight: 500;/);
    // The office's own face file is gone (Phase 23's office-fonts.ts).
    expect(SOURCE).not.toContain("src/app/office/office-fonts.ts");
  });

  it("nothing from Google: no Google font loader and no Google font address in src/", () => {
    const google = SOURCE.filter((f) =>
      /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(read(f)),
    );
    expect(google).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_COOKIE, themeFromCookie } from "@/app/theme";

// The theme, the type scale and the font (docs/office-v2.md 3.1; PLAN.md 12A.1): the sd-theme
// cookie's reading and its wiring into <html>, no colour or text size outside the tokens anywhere
// in src/, and Plus Jakarta Sans served from the app itself. tests/e2e/theme.spec.ts checks the
// pages a browser gets.

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
    const outside = css
      .split("\n")
      .filter((line) => hasColour.test(line) && !/^\s*--color-[a-z-]+: #[0-9a-f]{6};/.test(line));
    expect(outside).toEqual([]);
  });

  it("a style colour only from the firm's brand (the brand bar)", () => {
    const styled = SOURCE.filter((f) => /style=\{\{[^}]*\b(color|background)/i.test(read(f)));
    expect(styled).toEqual(["src/app/brand-bar.tsx"]);
  });
});

describe("one type scale", () => {
  it("the only sizes are 12, 13, 15, 18, 24 and 30px", () => {
    const theme = read("src/app/globals.css").match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(theme).toContain("--text-*: initial;");
    const sizes = Object.fromEntries(
      [...theme.matchAll(/--text-([a-z0-9]+): ([\d.]+)rem;/g)].map((m) => [
        m[1],
        Number(m[2]) * 16,
      ]),
    );
    expect(sizes).toEqual({ xs: 12, sm: 13, base: 15, lg: 18, "2xl": 24, "3xl": 30 });
  });

  it("no page uses a size outside it", () => {
    const outside = SOURCE.flatMap((file) =>
      [
        ...read(file).matchAll(
          /(?<![\w-])(?:[a-z0-9-]+:)*text-(?:xl|[4-9]xl|\[[\d.]+(?:px|rem|em)\])(?![\w-])/g,
        ),
      ].map((m) => `${file}: ${m[0]}`),
    );
    expect(outside).toEqual([]);
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
  it("Plus Jakarta Sans from its npm package, through next/font/local, latin and latin-ext", () => {
    const fonts = read("src/app/fonts.ts");
    expect(fonts).toMatch(/^import localFont from "next\/font\/local";/m);
    const sources = [...fonts.matchAll(/src: "([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toEqual([
      "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
      "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2",
    ]);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/plus-jakarta-sans"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read("src/app/layout.tsx")).toContain("${jakarta.variable} ${jakartaExt.variable}");
  });

  it("nothing from Google: no Google font loader and no Google font address in src/", () => {
    const google = SOURCE.filter((f) =>
      /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(read(f)),
    );
    expect(google).toEqual([]);
  });
});

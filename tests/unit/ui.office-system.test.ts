import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextPending, pendingPage, SKELETON_AFTER_MS } from "@/app/office/menu-pending";
import { DashboardSkeleton, PageSkeleton } from "@/app/office/office-skeleton";
import {
  btn,
  card,
  count,
  field,
  h2,
  page,
  quietLink,
  row,
  rows,
  sectionGap,
  table,
} from "@/app/ui/classes";

// The office's system (Phase 21; docs/ui-design.md "The office's system"; Dylan's brief: "Every
// component uses these tokens. No one-off values."): every office file and the office's own class
// strings use only the system's spacing (4, 8, 12, 16, 24, 32 and 48px), its corners (20px cards,
// 14px rows, round pills), its sizes, its one shadow and its 150–200ms transitions; the faces are
// the office's (Geist; the display serif and the stat figures by their utilities), not the casual
// app's; and the office's tokens hold the brief's values. tests/unit/ui.contrast.test.ts checks
// their contrast.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : [path];
  });
const OFFICE = files("src/app/office").filter((f) => /\.tsx?$/.test(f));
const OFFICE_CLASSES = [
  ...Object.values(btn),
  quietLink,
  field,
  card,
  rows,
  row,
  ...Object.values(table),
  count,
  h2,
  sectionGap.office,
  page.office,
  page.officeForm,
].join(" ");
// Comments are words, not classes ("one rounded list"): left out.
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const SOURCES: [string, string][] = [
  ...OFFICE.map((f): [string, string] => [f, code(read(f))]),
  ["src/app/ui/classes.ts (the office's strings)", OFFICE_CLASSES],
];

// A utility with its variants (`lg:`, `hover:`, `group-open/filled:`), optionally negative.
const V = String.raw`(?<![\w\[-])(?:[a-z0-9/[\]&=_-]+:)*-?`;
const END = String.raw`(?![\w-])`;
const SPACING = new RegExp(
  `${V}(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-([0-9.]+|px|\\[[^\\]]+\\])${END}`,
  "g",
);
const STEPS = new Set(["0", "1", "2", "3", "4", "6", "8", "12"]);
const RADIUS = new RegExp(
  `${V}rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?(?:-([a-z0-9]+|\\[[^\\]]+\\]))?${END}`,
  "g",
);
const TEXT_SIZE = new RegExp(`${V}text-(\\d?xl|xs|sm|base|lg|\\[[^\\]]+\\])${END}`, "g");
const SHADOW = new RegExp(`${V}((?:inset-|drop-)?shadow(?:-[a-z0-9]+|-\\[[^\\]]+\\])?)${END}`, "g");
const DURATION = new RegExp(`${V}duration-(\\d+|\\[[^\\]]+\\])${END}`, "g");

function found(re: RegExp, ok: (value: string, all: string) => boolean): string[] {
  return SOURCES.flatMap(([file, text]) =>
    [...text.matchAll(re)].filter((m) => !ok(m[1] ?? "", m[0])).map((m) => `${file}: ${m[0]}`),
  );
}

describe("the office's files use only the system (src/app/office, and the office's classes)", () => {
  it("finds the office's files and strings", () => {
    expect(OFFICE.length).toBeGreaterThan(80);
    expect(OFFICE_CLASSES).toContain("rounded-card");
    // The patterns find what they should, and leave the rest.
    const sample = 'className="px-3.5 lg:gap-1.5 -mt-1 p-4 gap-[3px] group-open/x:pl-6 mx-auto"';
    expect([...sample.matchAll(SPACING)].map((m) => m[0])).toEqual([
      "px-3.5",
      "lg:gap-1.5",
      "-mt-1",
      "p-4",
      "gap-[3px]",
      "group-open/x:pl-6",
    ]);
    expect([...'"rounded-2xl lg:rounded-card rounded-t-row rounded"'.matchAll(RADIUS)].length).toBe(
      4,
    );
  });

  // Not a gap but a measure: the room under the menu for its foot, fixed to the window's bottom
  // from 1024px (you, the pay week and the moon/sun button: about 128px tall).
  const MEASURES = ["src/app/office/office-frame.tsx: lg:pb-32"];

  it("spacing: 4, 8, 12, 16, 24, 32 and 48px only (and none, and auto)", () => {
    expect(found(SPACING, (v) => STEPS.has(v)).filter((f) => !MEASURES.includes(f))).toEqual([]);
    expect(found(SPACING, (v) => STEPS.has(v))).toEqual(MEASURES);
  });

  it("corners: 20px cards, 14px rows, round pills (or none)", () => {
    expect(found(RADIUS, (v) => ["card", "row", "full", "none"].includes(v))).toEqual([]);
  });

  it("sizes: the scale's seven steps (12, 13, 15, 17, 20, 28 and 40px in the office)", () => {
    expect(
      found(TEXT_SIZE, (v) => ["xs", "sm", "base", "lg", "2xl", "3xl", "4xl"].includes(v)),
    ).toEqual([]);
  });

  it("one shadow: the soft one (or none)", () => {
    expect(found(SHADOW, (v) => v === "shadow-soft" || v === "shadow-none")).toEqual([]);
  });

  it("transitions of 150ms (the default) or 200ms", () => {
    expect(found(DURATION, (v) => v === "150" || v === "200")).toEqual([]);
  });

  it("the office's faces: no casual-app face, the serif only for a headline", () => {
    const casualFaces = SOURCES.flatMap(([file, text]) =>
      [...text.matchAll(/(?<![\w-])font-(?:sign|greet)(?![\w-])/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(casualFaces).toEqual([]);
    // The display serif: the dashboard's greeting (every other headline is PageHeader's
    // text-title).
    const display = SOURCES.filter(([, text]) => /(?<![\w-])font-display(?![\w-])/.test(text)).map(
      ([file]) => file,
    );
    expect(display).toEqual(["src/app/office/dashboard-view.tsx"]);
    expect(read("src/app/office/dashboard-view.tsx")).toMatch(
      /<h1 className="text-ink">\s*<span className="block font-display text-4xl">/,
    );
  });
});

describe("the office's tokens (src/app/globals.css)", () => {
  const css = read("src/app/globals.css");
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };
  const light = block("body:has([data-office])");
  const value = (name: string) => light.match(new RegExp(`--${name}: ([^;]+);`))?.[1];

  it("a warm off-white page, white cards, near-black main buttons", () => {
    const canvas = value("color-canvas")!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(canvas.slice(i, i + 2), 16));
    // Warm: red above green above blue; off-white: light, but not white.
    expect(r! > g! && g! > b!).toBe(true);
    expect(Math.min(r!, g!, b!)).toBeGreaterThan(0xe8);
    expect(canvas).not.toBe("#ffffff");
    expect(value("color-card")).toBe("#ffffff");
    // The main button is ink, and the firm's colour (brand) is ink in the office too.
    expect(read("src/app/ui/classes.ts")).toMatch(/primary: `\$\{office\} border-ink bg-ink /);
    expect(value("color-brand")).toBe(value("color-ink"));
    const ink = value("color-ink")!;
    expect(Math.max(...[1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16)))).toBeLessThan(0x30);
  });

  it("the type scale's office values: 17, 20 and 28px in place of 18, 24 and 30", () => {
    expect(value("text-lg")).toBe("1.0625rem");
    expect(value("text-2xl")).toBe("1.25rem");
    expect(value("text-3xl")).toBe("1.75rem");
    // A headline in the display serif.
    expect(light).toMatch(/--title-font:\s*var\(--font-instrument-serif\)/);
    expect(value("title-size")).toBe("var(--text-3xl)");
  });

  it("corners, the one shadow, the faces", () => {
    expect(css).toMatch(/--radius-card: 1\.25rem;/);
    expect(css).toMatch(/--radius-row: 0\.875rem;/);
    expect(css).toMatch(/--shadow-soft:/);
    expect(css).toMatch(
      /\[data-office\] \{\s*font-family:\s*var\(--font-geist\),\s*var\(--font-geist-ext\),/,
    );
    expect(css).toMatch(
      /@utility font-stat \{\s*font-family:\s*var\(--font-geist-mono\),\s*var\(--font-geist-mono-ext\),[^}]*font-variant-numeric: tabular-nums;/,
    );
    expect(css).toMatch(
      /@utility font-display \{\s*font-family:\s*var\(--font-instrument-serif\),\s*var\(--font-instrument-serif-ext\),/,
    );
  });

  it("match docs/ui-design.md's office table, both ways, in both themes", () => {
    const own = (b: string) =>
      Object.fromEntries(
        [...b.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]),
      );
    const dark = block(':root[data-theme="dark"] body:has([data-office])');
    const doc = read("docs/ui-design.md");
    const section = doc.slice(
      doc.indexOf("## Phase 21: the office's system"),
      doc.indexOf("## Phase 20: the pass redesign"),
    );
    const fromDoc = { light: {} as Record<string, string>, dark: {} as Record<string, string> };
    for (const line of section.split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 5 || !cells[1]!.startsWith("`")) continue;
      const names = [...cells[1]!.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]!);
      for (const [column, into] of [
        [cells[2]!, fromDoc.light],
        [cells[3]!, fromDoc.dark],
      ] as const) {
        const values = [...column.matchAll(/`(#[0-9a-f]{6})`/g)].map((m) => m[1]!);
        expect(values, line).toHaveLength(names.length);
        names.forEach((n, i) => (into[n] = values[i]!));
      }
    }
    expect(Object.keys(fromDoc.light).length).toBeGreaterThan(40);
    expect(fromDoc.light).toEqual(own(light));
    expect(fromDoc.dark).toEqual(own(dark));
  });

  it("every office page carries [data-office], with the office's faces on it", () => {
    const layout = read("src/app/office/layout.tsx");
    expect(layout).toMatch(
      /<div data-office="" className=\{`contents \$\{officeFontVariables\}`\}>/,
    );
    expect(layout.match(/<OfficeLook>/g)).toHaveLength(2);
    const fonts = read("src/app/office/office-fonts.ts");
    expect([...fonts.matchAll(/src: "([^"]+)"/g)].map((m) => m[1])).toEqual([
      "../../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
      "../../../node_modules/@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2",
      "../../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
      "../../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-ext-wght-normal.woff2",
    ]);
    for (const src of fonts.matchAll(/src: "([^"]+)"/g))
      expect(statSync(join(ROOT, "src/app/office", src[1]!)).size).toBeGreaterThan(5000);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/geist"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies["@fontsource-variable/geist-mono"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// The skeletons (docs/ui-design.md "States"): shown while a page picked in the menu is on its way,
// never from a route-wide loading.tsx (it would start every page's answer before its access check,
// so a page a role can't open would answer 200, not 404).
describe("the office's loading skeletons", () => {
  it("no loading.tsx anywhere in the office", () => {
    expect(files("src/app/office").filter((f) => /(^|\/)loading\.(t|j)sx?$/.test(f))).toEqual([]);
  });

  it("show the page picked while it's on its way, from the page it was picked on", () => {
    let state = nextPending(null, "/office/casuals", true, "/office");
    expect(pendingPage(state, "/office")).toBe("/office/casuals");
    // Arrived: the address has moved on, and the link's report clears it.
    expect(pendingPage(state, "/office/casuals")).toBeNull();
    state = nextPending(state, "/office/casuals", false, "/office/casuals");
    expect(state).toBeNull();
  });

  it("the last link picked wins; the one given up doesn't clear it", () => {
    let state = nextPending(null, "/office/casuals", true, "/office");
    state = nextPending(state, "/office/pay", true, "/office");
    state = nextPending(state, "/office/casuals", false, "/office");
    expect(pendingPage(state, "/office")).toBe("/office/pay");
    expect(nextPending(state, "/office/pay", false, "/office")).toBeNull();
  });

  it("never for the page you're on, nor once you've gone elsewhere", () => {
    expect(pendingPage(nextPending(null, "/office", true, "/office"), "/office")).toBeNull();
    const state = nextPending(null, "/office/pay", true, "/office");
    expect(pendingPage(state, "/office/log")).toBeNull();
    expect(pendingPage(null, "/office")).toBeNull();
  });

  it("only after 150ms (a quick page never flashes one)", () => {
    expect(SKELETON_AFTER_MS).toBe(150);
  });

  it("the frame swaps the page for the right skeleton, and keeps the page mounted", () => {
    const frame = read("src/app/office/office-frame.tsx");
    expect(frame).toContain(
      '{loading && (loading === "/office" ? <DashboardSkeleton /> : <PageSkeleton />)}',
    );
    expect(frame).toContain("<div hidden={loading !== null}>{children}</div>");
    expect(read("src/app/office/office-nav.tsx")).toContain(
      "<MenuPendingReporter href={link.href} />",
    );
  });

  it("say they're loading to a screen reader and hide their bars", () => {
    for (const [Skeleton, what] of [
      [DashboardSkeleton, "the dashboard"],
      [PageSkeleton, "the page"],
    ] as const) {
      const html = renderToStaticMarkup(createElement(Skeleton));
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain(`<p class="sr-only">Loading ${what}…</p>`);
      expect(html).toMatch(/<div aria-hidden="true"/);
    }
  });
});

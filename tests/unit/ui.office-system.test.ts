import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { nextPending, pendingPage, SKELETON_AFTER_MS } from "@/app/office/menu-pending";
import { DashboardSkeleton, PageSkeleton } from "@/app/office/office-skeleton";
import * as classes from "@/app/ui/classes";

const { btn, field, quietLink } = classes;

// The office's system (Phase 21; docs/ui-design.md "The office's system"; Dylan's brief: "Every
// component uses these tokens. No one-off values."): every office file and the office's own class
// strings use only the system's spacing (4, 8, 12, 16, 24, 32 and 48px), its corners (20px cards,
// 14px rows, round pills), its sizes, its one shadow and its 150–200ms transitions; the faces are
// the office's (Geist; the display serif and the stat figures by their utilities), not the casual
// app's; and the office's tokens hold the brief's values. tests/unit/ui.contrast.test.ts checks
// their contrast. The shared parts an office page renders (found by following the office's
// imports: the chips, the seats, the login link page, the guide's steps; and the firm's bar above
// the office's login pages) may keep the casual app's values, but only beside the office's own
// (`rounded-lg office:rounded-row`, the `office:` variant in globals.css).

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : [path];
  });
// Comments are words, not classes ("one rounded list"): left out.
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const OFFICE = files("src/app/office").filter((f) => /\.tsx?$/.test(f));

// Every file under src/app an office page renders from outside src/app/office: what the office's
// files import, what those import, and the root layout's (the firm's bar, the demo bar).
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(join(ROOT, from)), spec)
      : null;
  if (!base) return null;
  const hit = [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")].find(
    (f) => existsSync(f),
  );
  return hit ? relative(ROOT, hit) : null;
}
const reached = new Set<string>();
const queue = [...OFFICE, "src/app/layout.tsx"];
while (queue.length > 0) {
  const file = queue.pop()!;
  if (reached.has(file)) continue;
  reached.add(file);
  for (const m of code(read(file)).matchAll(/from "([^"]+)"/g)) {
    const next = resolveImport(file, m[1]!);
    if (next?.startsWith("src/app/")) queue.push(next);
  }
}
const SHARED = [...reached]
  .filter((f) => !f.startsWith("src/app/office/") && f !== "src/app/ui/classes.ts")
  .sort();

// The class strings (src/app/ui/classes.ts) those files use: an object's members by name
// (`btn.primary`), all of them when it's indexed (`chip[tone]`), or the string itself.
const CLASSES = classes as unknown as Record<string, string | Record<string, string>>;
const USED = new Map<string, string>();
for (const file of [...OFFICE, ...SHARED]) {
  const text = code(read(file));
  for (const m of text.matchAll(/import \{([^}]+)\} from "([^"]+)"/g)) {
    if (resolveImport(file, m[2]!) !== "src/app/ui/classes.ts") continue;
    for (const part of m[1]!
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)) {
      const [name = "", alias] = part.split(/\s+as\s+/);
      const local = alias ?? name;
      const value = CLASSES[name];
      if (typeof value === "string") {
        USED.set(name, value);
        continue;
      }
      if (!value) continue;
      const named = [...text.matchAll(new RegExp(`(?<![\\w.])${local}\\.(\\w+)`, "g"))]
        .map((a) => a[1]!)
        .filter((k) => k in value);
      const indexed = new RegExp(`(?<![\\w.])${local}\\[`).test(text);
      for (const key of indexed || named.length === 0 ? Object.keys(value) : named)
        USED.set(`${name}.${key}`, value[key]!);
    }
  }
}

// What's scanned: the office's own files strictly; the shared parts and the strings with the
// office's own values allowed to stand in (`overridden`).
type Source = { file: string; text: string; shared: boolean };
const SOURCES: Source[] = [
  ...OFFICE.map((file) => ({ file, text: code(read(file)), shared: false })),
  ...SHARED.map((file) => ({ file, text: code(read(file)), shared: true })),
  ...[...USED].map(([name, text]) => ({
    file: `classes.ts ${name}`,
    text: `"${text}"`,
    shared: true,
  })),
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

// A shared part's value outside the system stands when the same class string gives the office its
// own: the same utility with the same other variants, under `office:` ("rounded-lg
// office:rounded-row", "sm:py-16 sm:office:py-12"). The office's value is itself checked.
function overridden(literal: string, match: string, value: string): boolean {
  const parts = match.replace(/^-/, "").split(":");
  const util = parts.pop()!.replace(/^-/, "");
  const root = value && util.endsWith(`-${value}`) ? util.slice(0, -value.length - 1) : util;
  const others = parts.sort().join(":");
  return literal.split(/[\s"'`]+/).some((token) => {
    const variants = token.split(":");
    const tokenUtil = variants.pop()!.replace(/^-/, "");
    if (!variants.includes("office")) return false;
    const tokenOthers = variants
      .filter((v) => v !== "office")
      .sort()
      .join(":");
    return tokenOthers === others && (tokenUtil === root || tokenUtil.startsWith(`${root}-`));
  });
}
const LITERAL = /"[^"\n]*"|`[^`]*`|'[^'\n]*'/g;

function found(re: RegExp, ok: (value: string, all: string) => boolean): string[] {
  return SOURCES.flatMap(({ file, text, shared }) =>
    (shared ? [...text.matchAll(LITERAL)].map((l) => l[0]) : [text]).flatMap((literal) =>
      [...literal.matchAll(re)]
        .filter((m) => !ok(m[1] ?? "", m[0]))
        .filter((m) => !shared || !overridden(literal, m[0], m[1] ?? ""))
        .map((m) => `${file}: ${m[0]}`),
    ),
  );
}

describe("the office's files use only the system (src/app/office, the shared parts it renders, and their classes)", () => {
  it("finds the office's files, the shared parts it renders and their strings", () => {
    expect(OFFICE.length).toBeGreaterThan(80);
    expect(SHARED).toEqual(
      expect.arrayContaining([
        "src/app/brand-bar.tsx",
        "src/app/help/guide-parts.tsx",
        "src/app/l/link-login.tsx",
        "src/app/too-many-tries.tsx",
        "src/app/ui/page-header.tsx",
        "src/app/ui/seats.tsx",
        "src/app/ui/status-chip.tsx",
      ]),
    );
    // Not the casual app's own pages, nor the signs only it shows.
    expect(SHARED.filter((f) => /^src\/app\/(shifts|pay|profile|requests)\//.test(f))).toEqual([]);
    expect(SHARED).not.toContain("src/app/ui/sign.tsx");
    expect([...USED.keys()]).toEqual(
      expect.arrayContaining([
        "btn.primary",
        "btn.secondary",
        "chip.base",
        "chip.urgent",
        "count",
        "countNeeds",
        "countWaiting",
        "countUrgent",
        "field",
        "officeLoginCard",
        "page.office",
        "page.officeLogin",
        "staffBtn.primary",
        "table.wrap",
      ]),
    );
    expect([...USED.keys()]).not.toContain("page.staff");
    expect([...USED.keys()]).not.toContain("staffCount");
    // A shared part's casual value stands only beside the office's own.
    expect(overridden('"rounded-lg office:rounded-row"', "rounded-lg", "lg")).toBe(true);
    expect(overridden('"sm:py-16 sm:office:py-12"', "sm:py-16", "16")).toBe(true);
    expect(overridden('"sm:py-16 office:py-12"', "sm:py-16", "16")).toBe(false);
    expect(overridden('"px-2.5 office:py-1"', "px-2.5", "2.5")).toBe(false);
    expect(overridden('"rounded-lg"', "rounded-lg", "lg")).toBe(false);
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

  // Not a gap but a measure: the room over the menu for the firm and you, fixed to the window's top
  // from 1024px (the header's own height, 56px; Phase 22: the menu's foot until then, lg:pb-32).
  const MEASURES = ["src/app/office/office-frame.tsx: lg:pt-14"];

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

  // Phase 22 (round 2): the office's layers, each its own depth token (ui.flat.test.ts pins
  // where): a card (`soft`), what's raised off it (`raise`), what floats over the page (`float`),
  // the page itself (`sheet`), the colour cards (`tint`) and a groove (`sunk`). One shadow in
  // Phase 21.
  it("depth: the office's layers' tokens only (or none)", () => {
    const LAYERS = [
      "shadow-soft",
      "shadow-raise",
      "shadow-float",
      "shadow-sheet",
      "shadow-tint",
      "inset-shadow-sunk",
      "shadow-none",
    ];
    expect(found(SHADOW, (v) => LAYERS.includes(v))).toEqual([]);
  });

  it("transitions of 150ms (the default) or 200ms", () => {
    expect(found(DURATION, (v) => v === "150" || v === "200")).toEqual([]);
  });

  it("the office's faces: no casual-app face, the serif only for a headline", () => {
    const casualFaces = SOURCES.filter((s) => !s.shared).flatMap(({ file, text }) =>
      [...text.matchAll(/(?<![\w-])font-(?:sign|greet)(?![\w-])/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(casualFaces).toEqual([]);
    // The display serif: the dashboard's greeting (every other headline is PageHeader's
    // text-title).
    const display = SOURCES.filter(({ text }) => /(?<![\w-])font-display(?![\w-])/.test(text)).map(
      ({ file }) => file,
    );
    expect(display).toEqual(["src/app/office/dashboard-view.tsx"]);
    expect(read("src/app/office/dashboard-view.tsx")).toMatch(
      /<h1 className="text-ink">\s*<span className="block font-display text-4xl">/,
    );
  });
});

describe("the office's controls: hover, focus and pressed (Dylan's brief)", () => {
  const has = (cls: string, variant: string) =>
    new RegExp(`(?<![\\w-])${variant}:[\\w/-]+`).test(cls);

  it("every button and link-like control changes under the pointer and while pressed", () => {
    for (const [name, cls] of Object.entries(btn)) {
      expect(has(cls, "hover"), `btn.${name}`).toBe(true);
      expect(has(cls, "active") || has(cls, "office:active"), `btn.${name}`).toBe(true);
    }
    expect(has(quietLink, "hover") && has(quietLink, "active")).toBe(true);
    // The one main button near-black; the others grey pills; a destructive one red words on grey.
    expect(btn.primary).toMatch(
      / bg-ink text-on-ink hover:border-ink-hover hover:bg-ink-hover active:border-ink-press active:bg-ink-press$/,
    );
    expect(btn.secondary).toMatch(
      /rounded-full .* bg-button text-ink hover:border-button-hover hover:bg-button-hover active:border-button-press active:bg-button-press$/,
    );
    expect(btn.danger).toMatch(
      /rounded-full .* bg-button text-urgent hover:border-button-hover hover:bg-button-hover active:border-button-press active:bg-button-press$/,
    );
    // A field: its edge darkens under the pointer; focused, the ring (globals.css, everywhere).
    expect(has(field, "hover")).toBe(true);
    expect(read("src/app/globals.css")).toMatch(/:focus-visible\s*\{[^}]*outline/);
    // The office's file button: a grey pill like the others, with its hover and pressed fills.
    const css = read("src/app/globals.css");
    expect(css).toMatch(
      /body:has\(\[data-office\]\) input\[type="file"\]::file-selector-button \{[^}]*border-radius: 9999px;[^}]*background-color: var\(--color-button\);/,
    );
    expect(css).toContain(
      'body:has([data-office]) input[type="file"]:not(:disabled)::file-selector-button:hover {',
    );
    expect(css).toContain(
      'body:has([data-office]) input[type="file"]:not(:disabled)::file-selector-button:active {',
    );
  });

  // Phase 22 (Dylan: "subtle reactive on click responses"): what you press dips to 97% at once
  // and springs back when you let go, its colours at their usual pace; with reduced motion it
  // doesn't move. Every office button and link-like control carries it (`btn.link` only in the
  // office: the casual app keeps Phase 20's look; a link inside a sentence is text, and doesn't).
  it("everything you press dips to 97% and springs back: about 90ms down, 300ms back", () => {
    const css = read("src/app/globals.css");
    const start = css.indexOf("@utility press {");
    const press = css.slice(start, css.indexOf("\n}\n", start) + 2);
    expect(start).toBeGreaterThan(-1);
    expect(css).toContain("--ease-spring: cubic-bezier(0.34, 1.45, 0.64, 1);");
    expect(press).toMatch(
      /transition-property:\s+color, background-color, border-color, text-decoration-color, scale, translate;/,
    );
    expect(press).toMatch(
      /transition-timing-function:\s+var\(--ease-sd\), var\(--ease-sd\), var\(--ease-sd\), var\(--ease-sd\), var\(--ease-spring\),\s+var\(--ease-spring\);/,
    );
    // Back, on the spring: 300ms.
    expect(press).toContain("transition-duration: 150ms, 150ms, 150ms, 150ms, 300ms, 300ms;");
    // Down: 97%, in 90ms; never for a control that can't be pressed.
    expect(press).toMatch(
      /&:active:not\(:disabled, \[aria-disabled="true"\]\) \{\s+scale: 0\.97;\s+transition-duration: 150ms, 150ms, 150ms, 150ms, 90ms, 90ms;\s+\}/,
    );
    // Reduced motion: nothing dips or lifts, inside the utility so `office:press` carries it.
    expect(press).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s+&:active,\s+&:hover \{\s+scale: none !important;\s+translate: none !important;\s+\}\s+\}/,
    );
    for (const [name, cls] of Object.entries(btn))
      expect(cls.split(" "), `btn.${name}`).toContain(name === "link" ? "office:press" : "press");
    expect(quietLink.split(" ")).toContain("press");
    // A page's way back ("‹ Dashboard"), in the office.
    expect(read("src/app/ui/page-header.tsx")).toMatch(
      /className="[^"]* min-h-11 [^"]* office:press"/,
    );
  });

  it("the chips on the office's spacing; the `office:` variant scoped to its pages", () => {
    expect(classes.chip.base).toMatch(/ office:px-3 office:py-1 office:leading-4 /);
    // One line while it fits; wrapped rather than wider than a phone (never shrunk in a row).
    expect(classes.chip.base).toMatch(
      / office:max-w-full office:shrink-0 office:whitespace-normal$/,
    );
    expect(read("src/app/globals.css")).toContain(
      "@custom-variant office (&:where(body:has([data-office]) *));",
    );
  });

  // The dark round button over the menu's foot was Next's own development button (`next dev`
  // only; bottom-left by default, where the menu's foot is): drawn bottom-right instead. The
  // browser tests run a production build, which never draws it, so only this can see it.
  it("Next's development button sits bottom-right, off the menu's foot", () => {
    expect(nextConfig.devIndicators).toEqual({ position: "bottom-right" });
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

  // Phase 22 (round 2): the page is a sheet set into a warm grey window; Phase 21's page was the
  // off-white `canvas` itself.
  it("a warm off-white page on a warm grey window, white cards, near-black main buttons", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const sheet = value("color-sheet")!;
    const [r, g, b] = rgb(sheet);
    // Warm: red above green above blue; off-white: light, but not white.
    expect(r! > g! && g! > b!).toBe(true);
    expect(Math.min(r!, g!, b!)).toBeGreaterThan(0xe8);
    expect(sheet).not.toBe("#ffffff");
    // The window: warm too, and darker than the page, so the page reads as a sheet on it.
    const [wr, wg, wb] = rgb(value("color-canvas")!);
    expect(wr! > wg! && wg! > wb!).toBe(true);
    expect(wr! + wg! + wb!).toBeLessThan(r! + g! + b! - 30);
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
    // A headline in the display serif: Newsreader semibold (Phase 22; Instrument Serif in 21).
    // On the office's wrapper, where the faces' variables are (on <body> it couldn't read them,
    // and every headline but the dashboard's fell back to the casual app's sans).
    expect(light).not.toMatch(/--title-font:/);
    expect(css).toMatch(
      /\[data-office\] \{\s*font-family:[^}]*--title-font:\s*var\(--font-newsreader\), var\(--font-newsreader-ext\),/,
    );
    expect(value("title-weight")).toBe("600");
    expect(value("title-size")).toBe("var(--text-3xl)");
  });

  // Phase 22: hilos's faces, DM Sans for words, DM Mono for the big numbers, Newsreader semibold
  // for a headline (Geist, Geist Mono and Instrument Serif in Phase 21).
  it("corners, the layers' depth, the faces", () => {
    expect(css).toMatch(/--radius-card: 1\.25rem;/);
    expect(css).toMatch(/--radius-row: 0\.875rem;/);
    for (const token of ["soft", "raise", "float", "sheet", "tint"])
      expect(css).toMatch(new RegExp(`--shadow-${token}:`));
    expect(css).toMatch(
      /\[data-office\] \{\s*font-family:\s*var\(--font-dm-sans\),\s*var\(--font-dm-sans-ext\),/,
    );
    expect(css).toMatch(
      /@utility font-stat \{\s*font-family:\s*var\(--font-dm-mono\),\s*var\(--font-dm-mono-ext\),[^}]*font-weight: 500;[^}]*font-variant-numeric: tabular-nums;/,
    );
    expect(css).toMatch(
      /@utility font-display \{\s*font-family:\s*var\(--font-newsreader\),\s*var\(--font-newsreader-ext\),[^}]*font-weight: 600;/,
    );
  });

  // Phase 22 (Dylan: "remove the gradients"): no gradient in the office's styles but the menu's
  // edge fade, a mask rather than a colour (globals.css `fade-edges`).
  it("no gradients: the one the office keeps is the menu's fade, a mask", () => {
    const gradient =
      /(?:repeating-)?(?:linear|radial|conic)-gradient\(|(?<![\w-])bg-(?:linear|radial|conic|gradient)-/;
    const inOffice = SOURCES.filter(({ text }) => gradient.test(text)).map(({ file }) => file);
    expect(inOffice).toEqual([]);
    const lines = css.split("\n").filter((l) => gradient.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, line).toMatch(/^\s*mask-image: linear-gradient\(/);
    expect(css).toMatch(/@utility fade-edges \{/);
  });

  it("match docs/ui-design.md's office table, both ways, in both themes", () => {
    const own = (b: string) =>
      Object.fromEntries(
        [...b.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]),
      );
    const dark = block(':root[data-theme="dark"] body:has([data-office])');
    const doc = read("docs/ui-design.md");
    // Round 2's table (Phase 22) holds the office's values now.
    const section = doc.slice(
      doc.indexOf("## Phase 22: the office's look, round 2"),
      doc.indexOf("## Phase 21: the office's system"),
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
      "../../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-opsz-normal.woff2",
      "../../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-ext-opsz-normal.woff2",
      "../../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2",
      "../../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-ext-500-normal.woff2",
      "../../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2",
      "../../../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-ext-opsz-normal.woff2",
    ]);
    for (const src of fonts.matchAll(/src: "([^"]+)"/g))
      expect(statSync(join(ROOT, "src/app/office", src[1]!)).size).toBeGreaterThan(5000);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    for (const name of [
      "@fontsource-variable/dm-sans",
      "@fontsource/dm-mono",
      "@fontsource-variable/newsreader",
    ])
      expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    // Phase 21's faces left with it.
    expect(pkg.dependencies["@fontsource-variable/geist"]).toBeUndefined();
  });
});

// The skeletons (docs/ui-design.md "States"): shown while a page picked in the menu is on its way,
// never from a route-wide loading.tsx (it would start every page's answer before its access check,
// so a page a role can't open would answer 200, not 404).
// Phase 22 (round 2) on every other page: raised white rows on a grained wash with the soft depth
// (Needs attention's page, as the dashboard's panels); fields set into the surface; the second
// step before something destructive one red wash with its edge and the soft depth; an answer a
// white slip raised off its form.
describe("round 2's parts on the office's other pages", () => {
  it("Needs attention's page: raised white rows on grained washes, as the dashboard's", async () => {
    const src = read("src/app/office/needs-items.tsx");
    expect(src).toContain('const item = "rounded-row bg-card px-4 py-3 text-ink shadow-raise";');
    expect(src).toContain(
      'className="grain-soft rounded-card border border-attention-line bg-attention-soft p-4 shadow-soft sm:p-6"',
    );
    const { AlsoNeedsYou } = await import("@/app/office/needs-items");
    const also = renderToStaticMarkup(
      createElement(AlsoNeedsYou, {
        urgent: { places: 2, firstStartsAt: new Date("2026-11-07T10:00:00Z") },
        timeZone: "Europe/London",
      }),
    );
    expect(also).toMatch(/<section [^>]*class="grain-soft [^"]*bg-urgent-soft [^"]*shadow-soft /);
    expect(also).toMatch(/class="[^"]*lg:col-span-4"/);
    expect(read("src/app/office/needs-attention/page.tsx")).toContain(
      '<div className="min-w-0 lg:col-span-8">',
    );
  });

  it("fields set in as grooves; every second step a wash with depth; answers raised", () => {
    expect(field.split(" ")).toEqual(expect.arrayContaining(["bg-card", "inset-shadow-sunk"]));
    // Red before something destructive; grey before a change that takes nothing away.
    expect(classes.confirmStep).toBe(
      "rounded-row border border-urgent-line bg-urgent-soft p-4 shadow-soft",
    );
    expect(classes.checkStep).toBe(
      "rounded-row border border-quiet-line bg-quiet-soft p-4 shadow-soft",
    );
    // Every second "Yes" in the office: on one of them, with no wash of its own.
    for (const [file, steps] of [
      ["src/app/office/settings/integrations/key-forms.tsx", ["confirmStep"]],
      ["src/app/office/settings/integrations/webhook-forms.tsx", ["confirmStep"]],
      ["src/app/office/shifts/[id]/firm-change-forms.tsx", ["confirmStep"]],
      ["src/app/office/data/workers/[id]/page.tsx", ["confirmStep"]],
      ["src/app/office/casuals/[id]/access-forms.tsx", ["confirmStep"]],
      ["src/app/office/team/member-actions.tsx", ["confirmStep", "checkStep"]],
      ["src/app/office/shifts/[id]/attendance-forms.tsx", ["checkStep"]],
      ["src/app/office/shift-actions.tsx", ["checkStep"]],
    ] as const) {
      const src = read(file);
      for (const step of steps)
        expect(src, file).toMatch(new RegExp(`\\$\\{${step}\\}|\\{${step}\\}`));
      // (A hover or pressed fill is a state, not a wash: `hover:bg-quiet-soft`.)
      expect(src, file).not.toMatch(/(?<![\w:-])bg-(?:urgent|quiet)-soft/);
    }
    // Any wash with an edge (a notice, a status, a step) has the soft depth (Phase 22).
    for (const file of OFFICE) {
      const src = code(read(file));
      for (const m of src.matchAll(
        /["`][^"`]*border border-(urgent|attention|done|wait|quiet)-line bg-\1-soft[^"`]*["`]/g,
      ))
        expect(m[0], file).toMatch(/ shadow-soft[ "`]/);
    }
    // And no office file keeps Phase 21's flat panels.
    for (const file of OFFICE) {
      const src = read(file);
      expect(src, file).not.toMatch(/"rounded-row border p-4"|border border-line bg-card p-[34]/);
    }
    expect(read("src/app/office/shifts/shift-tones.ts")).toContain(
      'export const resultBox = "rounded-row bg-card px-3 py-2 font-semibold text-ink shadow-raise";',
    );
  });
});

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

  it("the dashboard's has a part for every section", () => {
    const html = renderToStaticMarkup(createElement(DashboardSkeleton));
    expect([...html.matchAll(/data-skeleton-part="([a-z]+)"/g)].map((m) => m[1])).toEqual([
      "header",
      "cards",
      "urgent",
      "week",
      "attention",
      "waiting",
      "sorted",
    ]);
    // The panels in their own tints, the rows white and raised, as the dashboard's (Phase 22).
    expect(html).toContain("border-attention-line bg-attention-soft");
    expect(html).toContain("border-wait-line bg-wait-soft");
    expect(html).toContain("border-done-line bg-done-soft");
    expect(html).toContain("rounded-row bg-card shadow-raise");
    // Its bars wait with a slow fade (Phase 22; still in Phase 21), every one of them.
    const bars = [...html.matchAll(/class="([^"]*bg-raised[^"]*)"/g)].map((m) => m[1]!);
    expect(bars.length).toBeGreaterThan(10);
    for (const bar of bars.filter((b) => !b.includes("inset-shadow-sunk")))
      expect(bar).toContain("animate-wait");
  });

  it("the page's skeleton waits with the same slow fade, every bar of it (Phase 22)", () => {
    const html = renderToStaticMarkup(createElement(PageSkeleton));
    const bars = [...html.matchAll(/class="([^"]*bg-raised[^"]*)"/g)].map((m) => m[1]!);
    expect(bars.length).toBeGreaterThan(5);
    for (const bar of bars) expect(bar).toContain("animate-wait");
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

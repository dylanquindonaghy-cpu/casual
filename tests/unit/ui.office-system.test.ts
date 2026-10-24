import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { nextPending, pendingPage, SKELETON_AFTER_MS } from "@/app/office/menu-pending";
import { DashboardSkeleton, PageSkeleton } from "@/app/office/office-skeleton";
import { resultBox } from "@/app/office/shifts/shift-tones";
import * as classes from "@/app/ui/classes";

const { btn, field, quietLink } = classes;

// The office's system (Phase 21; docs/ui-design.md "The office's system"; Dylan's brief: "Every
// component uses these tokens. No one-off values."): every office file and the office's own class
// strings use only the system's spacing (4, 8, 12, 16, 24, 32 and 48px), its corners (since Phase
// 23: 28px page and menu cards, 22px cards inside a page, 14px rows, round pills), its sizes, its
// one overlay (only on what floats: tests/unit/ui.flat.test.ts) and its 150–200ms transitions;
// the face is the office's (Plus Jakarta Sans since Phase 23, the big numbers by `font-stat`), not
// the casual app's; and the office's tokens hold the approved mock-up's values (docs/ui-design.md
// "Phase 23"). tests/unit/ui.contrast.test.ts checks their contrast. The shared parts an office page renders (found by following the office's
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

  // Phase 23's shared parts, each in use: the "Show" tabs and the events board's filters, the
  // notices (what the AI or the voicemail line did, what a key will show once), the keys shown
  // once.
  it("finds Phase 23's parts in use: the tabs, the notices, the code boxes", () => {
    expect([...USED.keys()]).toEqual(
      expect.arrayContaining(["tabs", "tab", "tabCurrent", "notice", "codeBox"]),
    );
  });

  // Not a gap but a measure: none since Phase 23. The top bar is in the page's flow at every width
  // (64px from 1024px, its own height), so nothing makes room for it; the menu card's place under
  // it is a position (`lg:top-20`) and its height a limit (`lg:max-h-[…]`), not spacing (Phase 22:
  // the room over the menu for the firm and you, `lg:pt-14`; Phase 21: the menu's foot, lg:pb-32).
  const MEASURES: string[] = [];

  it("spacing: 4, 8, 12, 16, 24, 32 and 48px only (and none, and auto)", () => {
    expect(found(SPACING, (v) => STEPS.has(v)).filter((f) => !MEASURES.includes(f))).toEqual([]);
    expect(found(SPACING, (v) => STEPS.has(v))).toEqual(MEASURES);
  });

  // Phase 23 (round 3): the page and menu cards 28px (`card`), the cards, lists and tables inside a
  // page 22px (`inner`), rows 14px, pills round (Phase 21: 20px cards, 14px rows); a chart's bar
  // 4px round at its data end (`mark`), in the dashboard's charts only.
  it("corners: 28px page and menu cards, 22px cards inside, 14px rows, round pills (or none)", () => {
    const CHARTS = "src/app/office/dashboard/charts.tsx";
    expect(
      found(RADIUS, (v) => ["card", "inner", "row", "full", "none", "mark"].includes(v)),
    ).toEqual([]);
    const marks = found(RADIUS, (v) => v !== "mark");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.filter((m) => !m.startsWith(`${CHARTS}: `))).toEqual([]);
  });

  it("sizes: the scale's seven steps (12, 13, 15, 17, 20, 28 and 40px in the office)", () => {
    expect(
      found(TEXT_SIZE, (v) => ["xs", "sm", "base", "lg", "2xl", "3xl", "4xl"].includes(v)),
    ).toEqual([]);
  });

  // Phase 23 (round 3, flat): one overlay, `float`, only on what floats over the page
  // (ui.flat.test.ts pins where); nothing at rest has depth: no card, row, button, field, groove,
  // page or colour card (round 2's `soft`, `raise`, `sheet`, `tint` and the casual app's `sunk`).
  it("depth: the one overlay only (or none)", () => {
    const LAYERS = ["shadow-float", "shadow-none"];
    expect(found(SHADOW, (v) => LAYERS.includes(v))).toEqual([]);
    const atRest = SOURCES.filter(({ shared }) => !shared).flatMap(({ file, text }) =>
      [
        ...text.matchAll(
          /(?<![\w-])(?:[a-z0-9/[\]&=_-]+:)*(?:shadow-(?:soft|raise|sheet|tint)|inset-shadow-sunk)(?![\w-])/g,
        ),
      ].map((m) => `${file}: ${m[0]}`),
    );
    expect(atRest).toEqual([]);
  });

  it("transitions of 150ms (the default) or 200ms", () => {
    expect(found(DURATION, (v) => v === "150" || v === "200")).toEqual([]);
  });

  it("the office's face: no casual-app face, and no display serif (Phase 23)", () => {
    const casualFaces = SOURCES.filter((s) => !s.shared).flatMap(({ file, text }) =>
      [...text.matchAll(/(?<![\w-])font-(?:sign|greet)(?![\w-])/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(casualFaces).toEqual([]);
    // Round 2's display serif (`font-display`, the dashboard's greeting) is gone: every word,
    // headline and number is Plus Jakarta Sans.
    expect(read("src/app/globals.css")).not.toMatch(/font-display/);
    const display = SOURCES.filter(({ text }) => /(?<![\w-])font-display(?![\w-])/.test(text)).map(
      ({ file }) => file,
    );
    expect(display).toEqual([]);
    // The greeting is the headline's own style (Plus Jakarta 800, -0.025em, the office's title
    // size) in the dashboard's one <h1>.
    expect(read("src/app/office/dashboard-view.tsx")).toMatch(
      /<h1 className="text-ink">\s*<span className="block text-title">/,
    );
  });

  // The one exception: keys and secrets on Integrations keep the system's mono, so O and 0, l and
  // 1 differ (`codeBox`, and a role's or a scope's name in a sentence there).
  it("the system's mono only for keys and secrets on Integrations", () => {
    expect(classes.codeBox.split(" ")).toContain("font-mono");
    const mono = SOURCES.filter(
      ({ shared, text }) => !shared && /(?<![\w-])font-mono(?![\w-])/.test(text),
    ).map(({ file }) => file);
    expect(mono.length).toBeGreaterThan(0);
    for (const file of mono) expect(file).toMatch(/^src\/app\/office\/settings\/integrations\//);
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
    // The one main button sky blue with near-black words (Phase 23); the others white pills whose
    // grey edge stays under the pointer and pressed; a destructive one red words on white.
    expect(btn.primary).toMatch(
      / border-accent bg-accent text-on-accent hover:border-accent-hover hover:bg-accent-hover active:border-accent-press active:bg-accent-press$/,
    );
    expect(btn.secondary).toMatch(
      /rounded-full .* border-button-line bg-button text-ink hover:bg-button-hover active:bg-button-press$/,
    );
    expect(btn.danger).toMatch(
      /rounded-full .* border-button-line bg-button text-urgent hover:bg-button-hover active:bg-button-press$/,
    );
    expect(btn.dangerSolid).toMatch(/ border-urgent-fill bg-urgent-fill text-on-urgent /);
    // A tab (Phase 23): darker words under the pointer, a fill pressed; the current one a white
    // pill with a 3:1 edge on the grey track (never the sky button), every one 44px.
    expect(has(classes.tab, "hover") && has(classes.tab, "active")).toBe(true);
    for (const cls of [classes.tab, classes.tabCurrent]) {
      expect(cls.split(" ")).toEqual(
        expect.arrayContaining(["press", "min-h-11", "rounded-full", "border"]),
      );
      expect(cls).not.toMatch(/(?<![\w-])(?:[a-z-]+:)*(?:bg|border|text)-(?:accent|on-accent)/);
    }
    expect(classes.tab.split(" ")).toContain("border-transparent");
    expect(classes.tabCurrent.split(" ")).toEqual(
      expect.arrayContaining(["border-line-strong", "bg-card", "text-ink", "font-semibold"]),
    );
    expect(classes.tabs.split(" ")).toEqual(
      expect.arrayContaining(["rounded-full", "border", "border-line", "bg-raised", "p-1"]),
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
    expect(classes.tab.split(" ")).toContain("press");
    expect(classes.tabCurrent.split(" ")).toContain("press");
    // No lift under the pointer (Phase 23: flat), in the office's own strings.
    for (const [name, value] of Object.entries(classes)) {
      const strings = typeof value === "string" ? [value] : Object.values(value);
      for (const cls of strings) expect(cls, name).not.toMatch(/hover:-?translate-y-/);
    }
    // A page's way back ("‹ Dashboard"), in the office.
    expect(read("src/app/ui/page-header.tsx")).toMatch(
      /className="[^"]* min-h-11 [^"]* office:press"/,
    );
  });

  it("the chips on the office's spacing; the `office:` variant scoped to its pages", () => {
    // Phase 23: a borderless tinted pill at least 28px tall in the office (the casual app's keep
    // their edge: `border` before the `office:` values).
    expect(classes.chip.base).toMatch(
      / border .* office:min-h-7 office:border-0 office:px-3 office:py-1 office:leading-4 /,
    );
    // One line while it fits; wrapped rather than wider than a phone (never shrunk in a row).
    expect(classes.chip.base).toMatch(
      / office:max-w-full office:shrink-0 office:whitespace-normal$/,
    );
    // The blue tone (Phase 23): waiting on someone else.
    expect(classes.chip.wait).toBe("border-wait-line bg-wait-soft text-wait-ink");
    // Every count a flat tinted pill, with no edge (Phase 23).
    for (const [name, cls] of Object.entries({
      countPill: classes.countPill,
      countNeeds: classes.countNeeds,
      countWaiting: classes.countWaiting,
      countUrgent: classes.countUrgent,
      count: classes.count,
    })) {
      expect(cls, name).not.toMatch(/(?<![\w:-])border(?:-[a-z]+)*(?![\w-])/);
      expect(cls, name).toMatch(/(?<![\w:-])bg-(?:count|hivis|wait-tile|urgent-tile)(?![\w-])/);
      expect(cls.split(" "), name).toContain("rounded-full");
    }
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

  // Phase 23 (round 3): white cards (the page, the menu, everything in them) on a cool light grey
  // ground; one sky blue main button. Phase 22's page was a warm off-white sheet on a warm grey
  // window, its main button near-black.
  it("white cards on a cool light grey ground, the sky main button with near-black words", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const dark = block(':root[data-theme="dark"] body:has([data-office])');
    const darkValue = (name: string) => dark.match(new RegExp(`--${name}: ([^;]+);`))?.[1];
    // The ground: cool (blue above green above red) and light, but not white.
    const canvas = value("color-canvas")!;
    const [r, g, b] = rgb(canvas);
    expect(b! > g! && g! > r!).toBe(true);
    expect(Math.min(r!, g!, b!)).toBeGreaterThan(0xe8);
    expect(canvas).toBe("#f2f4f7");
    // The page card (`sheet`, as `card`) and every card white; in dark, dark grey on near-black.
    expect(value("color-card")).toBe("#ffffff");
    expect(value("color-sheet")).toBe(value("color-card"));
    expect(value("color-panel")).toBe(canvas);
    expect([darkValue("color-canvas"), darkValue("color-card"), darkValue("color-sheet")]).toEqual([
      "#0c0e12",
      "#15181d",
      "#15181d",
    ]);
    // The main button is the sky, with near-black words, lighter under the pointer, darker
    // pressed; in dark, a paler sky.
    expect(read("src/app/ui/classes.ts")).toMatch(
      /primary: `\$\{office\} border-accent bg-accent text-on-accent /,
    );
    expect(
      ["color-accent", "color-accent-hover", "color-accent-press", "color-on-accent"].map(value),
    ).toEqual(["#0ea5e9", "#38bdf8", "#0284c7", "#06131f"]);
    expect(
      ["color-accent", "color-accent-hover", "color-accent-press", "color-on-accent"].map(
        darkValue,
      ),
    ).toEqual(["#7dd3fc", "#a5e1fd", "#38bdf8", "#06131f"]);
    // `brand` (the board's today bar, the login link page's button) is the sky too, never the
    // firm's colour: its pressed shade in light, as the sky itself is under 3:1 on white
    // (ui.contrast.test.ts holds brand on card at 3:1); words in ink.
    expect([value("color-brand"), value("color-on-brand")]).toEqual([
      value("color-accent-press"),
      value("color-on-accent"),
    ]);
    expect([darkValue("color-brand"), darkValue("color-on-brand")]).toEqual([
      darkValue("color-accent"),
      darkValue("color-on-accent"),
    ]);
    expect(value("color-brand-ink")).toBe(value("color-ink"));
    // Ink: a cool near-black.
    const ink = value("color-ink")!;
    expect(ink).toBe("#0f1728");
    expect(Math.max(...rgb(ink))).toBeLessThan(0x30);
  });

  it("the type scale's office values: 17, 20 and 28px in place of 18, 24 and 30", () => {
    expect(value("text-lg")).toBe("1.0625rem");
    expect(value("text-2xl")).toBe("1.25rem");
    expect(value("text-3xl")).toBe("1.75rem");
    // A headline in Plus Jakarta Sans extrabold, a little tight (Phase 23; Newsreader semibold in
    // 22, Instrument Serif in 21). On the office's wrapper, where the face's variables are (on
    // <body> it couldn't read them, and every headline would fall back to the casual app's sans).
    expect(light).not.toMatch(/--title-font:/);
    expect(css).toMatch(
      /\[data-office\] \{\s*font-family:[^}]*--title-font:\s*var\(--font-plus-jakarta\), var\(--font-plus-jakarta-ext\),/,
    );
    expect(value("title-weight")).toBe("800");
    expect(value("title-tracking")).toBe("-0.025em");
    expect(value("title-size")).toBe("var(--text-3xl)");
    // Section headings bold (the shared `h2`, by its `office:` value).
    expect(classes.h2.split(" ")).toContain("office:font-bold");
  });

  // Phase 23 (round 3): one face, Plus Jakarta Sans, for words, headlines and the big numbers
  // (DM Sans, DM Mono and Newsreader in Phase 22; Geist, Geist Mono and Instrument Serif in 21).
  it("corners, the one overlay, the face", () => {
    expect(css).toMatch(/--radius-card: 1\.75rem;/);
    expect(css).toMatch(/--radius-inner: 1\.375rem;/);
    expect(css).toMatch(/--radius-row: 0\.875rem;/);
    for (const token of ["soft", "raise", "sheet", "tint"])
      expect(css).not.toMatch(new RegExp(`--shadow-${token}:`));
    expect(css).toContain("--shadow-float: var(--overlay);");
    expect(css).toMatch(
      /\[data-office\] \{\s*font-family:\s*var\(--font-plus-jakarta\),\s*var\(--font-plus-jakarta-ext\),/,
    );
    expect(css).toMatch(
      /@utility font-stat \{\s*font-family:\s*var\(--font-plus-jakarta\),\s*var\(--font-plus-jakarta-ext\),[^}]*font-weight: 800;\s*font-variant-numeric: tabular-nums;\s*letter-spacing: -0\.03em;\s*\}/,
    );
    expect(css).not.toMatch(/@utility font-display|--font-(?:dm-sans|dm-mono|newsreader)/);
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

  // Phase 23 (round 3): no grain, stripes, glows or colour cards (round 2's), and no background
  // image at all, in the office's sources or the styles.
  it("no grain, stripes, glows, tinted cards or background images", () => {
    expect(css).not.toMatch(/--(?:grain|stripes|tint-|card-chip|glow-)/);
    expect(css).not.toMatch(/@utility (?:grain|stripes|tint-|card-chip)/);
    expect(css).not.toMatch(/background-image|url\(|feTurbulence/);
    // Nor round 2's colour cards' own tokens.
    expect(css).not.toMatch(/--color-(?:urgent|attention|wait|done)-card/);
    const texture =
      /(?<![\w-])(?:[a-z0-9/[\]&=_-]+:)*(?:grain|grain-soft|stripes|card-chip|tint-(?:urgent|attention|wait|done)|bg-\[url)(?![\w-])/g;
    const inOffice = SOURCES.flatMap(({ file, text }) =>
      [...text.matchAll(texture)].map((m) => `${file}: ${m[0]}`),
    );
    expect(inOffice).toEqual([]);
  });

  it("match docs/ui-design.md's office table, both ways, in both themes", () => {
    const own = (b: string) =>
      Object.fromEntries(
        [...b.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]),
      );
    const dark = block(':root[data-theme="dark"] body:has([data-office])');
    const doc = read("docs/ui-design.md");
    // Round 3's table (Phase 23) holds the office's values now.
    const at = doc.indexOf("## Phase 23: the office's look, round 3");
    expect(at).toBeGreaterThan(-1);
    const section = doc.slice(at, doc.indexOf("## Phase 22: the office's look, round 2"));
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
    // Phase 23: Plus Jakarta Sans, one variable face (200 to 800) in latin and latin-ext, through
    // next/font/local. The consts' names become the families' (the browser tests look for
    // "plusJakarta"); only the latin face is fetched ahead, and it has no metric-matched fallback
    // (it would cover "Ł" before the latin-ext face).
    const fonts = read("src/app/office/office-fonts.ts");
    expect(fonts).toMatch(/^import localFont from "next\/font\/local";/m);
    expect([...fonts.matchAll(/src: "([^"]+)"/g)].map((m) => m[1])).toEqual([
      "../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
      "../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2",
    ]);
    for (const src of fonts.matchAll(/src: "([^"]+)"/g))
      expect(statSync(join(ROOT, "src/app/office", src[1]!)).size).toBeGreaterThan(5000);
    expect([...fonts.matchAll(/export const (\w+) = localFont\(/g)].map((m) => m[1])).toEqual([
      "plusJakartaSans",
      "plusJakartaSansExt",
    ]);
    expect(fonts.match(/weight: "200 800",/g)).toHaveLength(2);
    expect(fonts.match(/adjustFontFallback: false,/g)).toHaveLength(1);
    expect(fonts.match(/preload: false,/g)).toHaveLength(1);
    expect(fonts.indexOf("adjustFontFallback: false")).toBeLessThan(
      fonts.indexOf("export const plusJakartaSansExt"),
    );
    expect(fonts.indexOf("preload: false")).toBeGreaterThan(
      fonts.indexOf("export const plusJakartaSansExt"),
    );
    expect([...fonts.matchAll(/variable: "([^"]+)"/g)].map((m) => m[1])).toEqual([
      "--font-plus-jakarta",
      "--font-plus-jakarta-ext",
    ]);
    expect(fonts).toMatch(
      /export const officeFontVariables = \[plusJakartaSans, plusJakartaSansExt\]/,
    );
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/plus-jakarta-sans"]).toBe("5.3.0");
    // Round 2's faces left with it, as Phase 21's did.
    for (const name of [
      "@fontsource-variable/dm-sans",
      "@fontsource/dm-mono",
      "@fontsource-variable/newsreader",
      "@fontsource-variable/geist",
    ])
      expect(pkg.dependencies[name], name).toBeUndefined();
  });
});

// The skeletons (docs/ui-design.md "States"): shown while a page picked in the menu is on its way,
// never from a route-wide loading.tsx (it would start every page's answer before its access check,
// so a page a role can't open would answer 200, not 404).
// Phase 23 (round 3) on every other page: flat. Every white box inside the white page card has its
// 1px hairline and no depth (Needs attention's rows and parts, an enquiry's message, a shift's
// instructions, the code boxes, an answer); fields white with their 3:1 edge, set in no more; the
// second step before something destructive one red wash with its edge, and before a change that
// takes nothing away the same in grey; a notice an amber wash with its edge.
describe("round 3's parts on the office's other pages", () => {
  it("Needs attention's page: its parts flat, beside the column they've always had", async () => {
    const { AlsoNeedsYou } = await import("@/app/office/needs-items");
    const also = renderToStaticMarkup(
      createElement(AlsoNeedsYou, {
        urgent: { places: 2, firstStartsAt: new Date("2026-11-07T10:00:00Z") },
        timeZone: "Europe/London",
      }),
    );
    const section = /<section [^>]*class="([^"]*)"/.exec(also)?.[1];
    expect(section, also).toBeDefined();
    expect(section).toMatch(/(?:^| )lg:col-span-4(?: |$)/);
    expect(section!.split(" ")).toEqual(
      expect.arrayContaining(["rounded-inner", "border", "border-urgent-line", "bg-urgent-soft"]),
    );
    // No depth and no grain, here or anywhere in what it draws.
    expect(also).not.toMatch(/(?<![\w-])(?:[a-z0-9-]+:)*(?:inset-)?shadow-(?!none)/);
    expect(also).not.toMatch(/(?<![\w-])grain/);
    expect(read("src/app/office/needs-attention/page.tsx")).toContain(
      '<div className="min-w-0 lg:col-span-8">',
    );
  });

  it("fields with their edge; every second step and notice a wash with its edge; all flat", () => {
    // A field: white with the 3:1 edge (line-strong), darker under the pointer, no depth.
    expect(field.split(" ")).toEqual(
      expect.arrayContaining([
        "rounded-row",
        "border",
        "border-line-strong",
        "bg-card",
        "hover:border-ink-muted",
      ]),
    );
    expect(field).not.toMatch(/shadow/);
    // Red before something destructive; grey before a change that takes nothing away.
    expect(classes.confirmStep).toBe("rounded-row border border-urgent-line bg-urgent-soft p-4");
    expect(classes.checkStep).toBe("rounded-row border border-quiet-line bg-quiet-soft p-4");
    // A notice (what the AI or the voicemail line did, what a key will show once): amber.
    expect(classes.notice).toBe(
      "rounded-row border border-attention-line bg-attention-soft px-4 py-3 text-attention-ink",
    );
    // A key or secret shown once: white with its hairline, in the system's mono.
    expect(classes.codeBox).toBe(
      "block rounded-row border border-line bg-card px-3 py-2 font-mono text-base break-all text-ink select-all",
    );
    // An answer under a button: a pale grey slip with its hairline (shifts/shift-tones.ts).
    expect(resultBox).toBe(
      "rounded-row border border-line bg-quiet-soft px-3 py-2 font-semibold text-ink",
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
    // Any wash with an edge (a notice, a status, a step) is flat (Phase 23; with the soft depth
    // in Phase 22), and there is at least one.
    let washes = 0;
    for (const file of OFFICE) {
      const src = code(read(file));
      for (const m of src.matchAll(
        /["`][^"`]*border border-(urgent|attention|done|wait|quiet)-line bg-\1-soft[^"`]*["`]/g,
      )) {
        washes++;
        expect(m[0], file).not.toMatch(/shadow/);
      }
    }
    expect(washes).toBeGreaterThan(0);
    // And no office file keeps a bare edge with no colour of its own.
    for (const file of OFFICE) expect(read(file), file).not.toMatch(/"rounded-row border p-4"/);
  });

  // Inside the white page card a white box needs its hairline, or it vanishes (Phase 23): every
  // string in the office's files and its own class strings that draws a white box with an edge
  // gives it the line colour (`line`, or `line-strong` for a field's) and no depth. A mark that
  // isn't a box (no card, inner or row corners: the events board's open places and its legend's
  // swatch, as the seats) may have the stronger grey outline instead. Round 2 pinned the boxes one
  // by one (Needs attention's rows, an enquiry's message, a shift's instructions, the code boxes,
  // an answer), each raised off its form.
  it("every white box with an edge: the hairline, and no depth", () => {
    const LITERALS = [
      ...OFFICE.flatMap((file) =>
        [...code(read(file)).matchAll(LITERAL)].map((m) => ({ file, text: m[0] })),
      ),
      ...Object.entries(classes).flatMap(([name, value]) =>
        (typeof value === "string" ? [[name, value]] : Object.entries(value)).map(([k, v]) => ({
          file: `classes.ts ${name}${typeof value === "string" ? "" : `.${k}`}`,
          text: `"${v}"`,
        })),
      ),
    ];
    // White: a card's, a button's or the page's own white.
    const white = /(?<![\w:-])(?:sm:|lg:)?bg-(?:card|button|sheet)(?![\w/-])/;
    // An edge: `border`, one side's, or a set width (`border-2`, `border-[1.5px]`).
    const edged = /(?<![\w:-])(?:sm:|lg:)?border(?:-[trblxy])?(?:-\d+|-\[[\d.]+px\])?(?![\w-])/;
    const boxes = LITERALS.filter(({ text }) => white.test(text) && edged.test(text));
    expect(boxes.length).toBeGreaterThan(10);
    // The hairline, the field's 3:1 edge, or a quiet button's grey edge.
    const hairline = /(?<![\w:-])(?:sm:|lg:)?border-(?:line(?:-strong)?|button-line)(?![\w-])/;
    // The board's open places and its key's swatch (and only there) keep the stronger grey outline.
    const OUTLINED = [
      "src/app/office/events/board-parts.tsx",
      "src/app/office/events/event-row.tsx",
    ];
    const markOutline = (file: string, text: string) =>
      OUTLINED.includes(file) &&
      /(?<![\w:-])border-ink-muted(?![\w-])/.test(text) &&
      !/(?<![\w-])(?:[a-z0-9-]+:)*rounded-(?:[trblse]{1,2}-)?(?:card|inner|row)(?![\w-])/.test(
        text,
      );
    const wrong = boxes
      .filter(
        ({ file, text }) =>
          !(hairline.test(text) || markOutline(file, text)) ||
          /(?<![\w-])(?:[a-z0-9-]+:)*(?:inset-|drop-)?shadow-(?!none(?![\w-]))/.test(text),
      )
      .map(({ file, text }) => `${file}: ${text}`);
    expect(wrong).toEqual([]);
    // And every white box (a card's, an inner card's or a row's corners) has that edge: white on
    // white with none would vanish. What floats over the page has its overlay's ring instead.
    const corners =
      /(?<![\w-])(?:[a-z0-9-]+:)*rounded-(?:[trblse]{1,2}-)?(?:card|inner|row|full)(?![\w-])/;
    const floats = /(?<![\w-])(?:[a-z0-9-]+:)*shadow-float(?![\w-])/;
    const white2 = LITERALS.filter(({ text }) => white.test(text) && corners.test(text));
    expect(white2.length).toBeGreaterThan(10);
    const bare = white2
      .filter(
        ({ file, text }) =>
          !floats.test(text) &&
          !(edged.test(text) && (hairline.test(text) || markOutline(file, text))),
      )
      .map(({ file, text }) => `${file}: ${text}`);
    expect(bare).toEqual([]);
    // 28px corners are the page's and the menu's (the frame) and the login card's only; a card
    // inside a page is 22px (rounded-inner), a row 14px.
    const big = /(?<![\w-])(?:[a-z0-9-]+:)*rounded-(?:[trblse]{1,2}-)?card(?![\w-])/;
    const bigFiles = OFFICE.filter((file) => big.test(code(read(file))));
    expect(bigFiles).toEqual(["src/app/office/office-frame.tsx"]);
    expect(
      Object.entries(classes)
        .flatMap(([name, value]) =>
          (typeof value === "string" ? [[name, value]] : Object.entries(value)).map(([k, v]) => [
            typeof value === "string" ? name : `${name}.${k}`,
            v,
          ]),
        )
        .filter(([, v]) => big.test(String(v)))
        .map(([n]) => n),
    ).toEqual(["officeLoginCard"]);
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

  // Phase 23: the dashboard's sections are the counts, the urgent places and the six charts (the
  // week strip and the three text panels went).
  it("the dashboard's has a part for every section", () => {
    const html = renderToStaticMarkup(createElement(DashboardSkeleton));
    expect([...html.matchAll(/data-skeleton-part="([a-z]+)"/g)].map((m) => m[1])).toEqual([
      "header",
      "cards",
      "urgent",
      "places",
      "events",
      "offers",
      "waited",
      "cancels",
      "licences",
    ]);
    // Flat, as the dashboard's (Phase 23): white cards with their hairline, no tints, no depth, no
    // grain.
    expect(html).toContain("border border-line");
    expect(html).toMatch(/(?<![\w:-])bg-card(?![\w/-])/);
    expect(html).not.toMatch(/(?<![\w-])(?:[a-z0-9-]+:)*(?:inset-)?shadow-(?!none)/);
    expect(html).not.toMatch(/(?<![\w-])grain/);
    expect(html).not.toMatch(/(?<![\w:-])bg-(?:urgent|attention|wait|done)-(?:soft|card)/);
    // Its bars wait with a slow fade (Phase 22; still in Phase 21), every one of them.
    const bars = [...html.matchAll(/class="([^"]*bg-raised[^"]*)"/g)].map((m) => m[1]!);
    expect(bars.length).toBeGreaterThan(10);
    for (const bar of bars) expect(bar).toContain("animate-wait");
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

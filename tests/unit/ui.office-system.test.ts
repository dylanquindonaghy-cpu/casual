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
// 24: a 24px menu card, 22px sections, 14px rows, round pills), its sizes, its depth (only the
// glass's own, and the few solid things pinned in tests/unit/ui.glass.test.ts) and its 150–200ms
// transitions; the face is Geist (Phase 24: the casual app's too, the big numbers by `font-stat`)
// with none of the casual app's sign figures; and since Phase 24 the office has no colours of its
// own (its block in globals.css sets only its sizes): it takes the app's tokens and its glass
// (docs/ui-design.md "Phase 24"), and tests/unit/ui.contrast.test.ts checks them. The shared parts
// an office page renders (found by following the office's imports: the chips, the seats, the login
// link page, the guide's steps; and the firm's bar above the office's login pages) may keep the
// casual app's values, but only beside the office's own (`rounded-lg office:rounded-row`, the
// `office:` variant in globals.css).

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

  // Phase 24 (round 7): the rail 24px (`card`; the menu card's in 24.1, 28px in Phase 23, with the
  // page card that's gone), the sections on a page 22px (`inner`), rows 14px, pills round (Phase
  // 21: 20px cards, 14px rows); a chart's bar 4px round at its data end, and its key's swatches
  // (`mark`), in the dashboard's places chart only (24.3; Phase 23's six charts until then).
  it("corners: a 24px rail, 22px sections, 14px rows, round pills (or none)", () => {
    const CHARTS = "src/app/office/dashboard/places-chart.tsx";
    expect(
      found(RADIUS, (v) => ["card", "inner", "row", "full", "none", "mark"].includes(v)),
    ).toEqual([]);
    const marks = found(RADIUS, (v) => v !== "mark");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.filter((m) => !m.startsWith(`${CHARTS}: `))).toEqual([]);
  });

  it("sizes: the scale's seven steps (12, 13, 15, 17, 20, 30 and 40px in the office)", () => {
    expect(
      found(TEXT_SIZE, (v) => ["xs", "sm", "base", "lg", "2xl", "3xl", "4xl"].includes(v)),
    ).toEqual([]);
  });

  // Phase 24 (round 7): depth is the glass's own rim and drop (its utilities); a class names one
  // only for a solid thing: `float` under a chart's tooltip (solid ink, floating),
  // `lift` under a switch's knob (ui.glass.test.ts pins each file). Nothing else: no groove (the
  // casual app's `sunk`), and none of round 2's layers (`soft`, `raise`, `sheet`, `tint`).
  it("depth: a floating ink thing's, a knob's (or none)", () => {
    const LAYERS = ["shadow-float", "shadow-lift", "shadow-none"];
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

  it("the office's face: none of the casual app's sign figures, and no display serif", () => {
    const casualFaces = SOURCES.filter((s) => !s.shared).flatMap(({ file, text }) =>
      [...text.matchAll(/(?<![\w-])font-(?:sign|greet)(?![\w-])/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(casualFaces).toEqual([]);
    // Round 2's display serif (`font-display`, the dashboard's greeting) is gone: every word,
    // headline and number is Geist (Phase 24; Plus Jakarta Sans in Phase 23).
    expect(read("src/app/globals.css")).not.toMatch(/font-display/);
    const display = SOURCES.filter(({ text }) => /(?<![\w-])font-display(?![\w-])/.test(text)).map(
      ({ file }) => file,
    );
    expect(display).toEqual([]);
    // The dashboard's one <h1> is the office's title style (Geist semibold, -0.025em, its title
    // size): "Dashboard" (Phase 24; the greeting until then).
    expect(read("src/app/office/dashboard-view.tsx")).toMatch(
      /<h1 className="text-title text-ink">Dashboard<\/h1>/,
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
    // Pressed: a fill of its own, or glass's swell and brightening (`press-glass`, below).
    for (const [name, cls] of Object.entries(btn)) {
      expect(has(cls, "hover"), `btn.${name}`).toBe(true);
      expect(
        has(cls, "active") || has(cls, "office:active") || cls.split(" ").includes("press-glass"),
        `btn.${name}`,
      ).toBe(true);
    }
    expect(has(quietLink, "hover") && has(quietLink, "active")).toBe(true);
    // Phase 24 (round 7): the one main button tinted glass in the firm's colour, a little brighter
    // under the pointer (never Phase 23's sky); the others clear glass, brighter under the pointer
    // and pressed; a destructive one red words on clear glass; the final destructive click solid
    // red.
    expect(btn.primary).toMatch(/ glass-tint hover:brightness-105$/);
    expect(btn.secondary).toMatch(
      /rounded-full .* glass-button text-ink hover:bg-button-hover active:bg-button-press$/,
    );
    expect(btn.danger).toMatch(
      /rounded-full .* glass-button text-urgent hover:bg-button-hover active:bg-button-press$/,
    );
    expect(btn.dangerSolid).toMatch(
      / bg-urgent-fill text-on-urgent hover:bg-urgent-fill-hover active:bg-urgent-fill-hover$/,
    );
    for (const [name, cls] of Object.entries(btn))
      expect(cls, `btn.${name}`).not.toMatch(
        /(?<![\w-])(?:[a-z-]+:)*(?:bg|border|text)-(?:accent|on-accent)(?![\w-])/,
      );
    // A tab: darker words under the pointer, a fill pressed; the current one under a lens of
    // bright glass on the glass track (never the main button), every one 44px.
    expect(has(classes.tab, "hover") && has(classes.tab, "active")).toBe(true);
    for (const cls of [classes.tab, classes.tabCurrent]) {
      expect(cls.split(" ")).toEqual(
        expect.arrayContaining(["press-glass", "min-h-11", "rounded-full"]),
      );
      expect(cls).not.toMatch(/(?<![\w-])(?:[a-z-]+:)*(?:bg|border|text)-(?:accent|on-accent)/);
      expect(cls).not.toMatch(/(?<![\w-])glass-tint(?![\w-])/);
    }
    expect(classes.tab.split(" ")).not.toContain("lens");
    expect(classes.tabCurrent.split(" ")).toEqual(
      expect.arrayContaining(["lens", "text-ink", "font-semibold"]),
    );
    expect(classes.tabs.split(" ")).toEqual(
      expect.arrayContaining(["glass", "rounded-full", "p-1"]),
    );
    // A field: its edge shows under the pointer; focused, the ring (globals.css, everywhere).
    expect(has(field, "hover")).toBe(true);
    expect(read("src/app/globals.css")).toMatch(/:focus-visible\s*\{[^}]*outline/);
    // The file button is the app's, a clear glass pill (ui.design-system.test.ts): the office has
    // none of its own any more.
    expect(read("src/app/globals.css")).not.toMatch(
      /body:has\(\[data-office\]\) input\[type="file"\]/,
    );
  });

  // Phase 22 (Dylan: "subtle reactive on click responses"): what you press dips to 97% at once
  // and springs back when you let go, its colours at their usual pace; with reduced motion it
  // doesn't move. Phase 24 (round 7, as Liquid Glass does): glass you press swells to 104% and
  // brightens instead, on the same spring. Every office button and link-like control carries one
  // (`btn.link` only in the office: the casual app keeps Phase 20's look; a link inside a sentence
  // is text, and doesn't).
  it("everything you press dips to 97% (glass swells to 104%) and springs back: about 90ms down, 300ms back", () => {
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
    // Glass: 104% and a little brighter, in 90ms; back in 300ms on the spring; still with reduced
    // motion.
    const gStart = css.indexOf("@utility press-glass {");
    const glass = css.slice(gStart, css.indexOf("\n}\n", gStart) + 2);
    expect(gStart).toBeGreaterThan(-1);
    expect(glass).toMatch(
      /transition-property: color, background-color, border-color, scale, filter;/,
    );
    expect(glass).toMatch(
      /transition-timing-function:\s+var\(--ease-sd\), var\(--ease-sd\), var\(--ease-sd\), var\(--ease-spring\), var\(--ease-sd\);/,
    );
    expect(glass).toContain("transition-duration: 150ms, 150ms, 150ms, 300ms, 200ms;");
    expect(glass).toMatch(
      /&:active:not\(:disabled, \[aria-disabled="true"\]\) \{\s+scale: 1\.04;\s+filter: brightness\(1\.06\);\s+transition-duration: 150ms, 150ms, 150ms, 90ms, 90ms;\s+\}/,
    );
    expect(glass).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s+&:active \{\s+scale: none !important;\s+\}\s+\}/,
    );
    const PRESS: Record<string, string> = { link: "office:press", text: "press" };
    for (const [name, cls] of Object.entries(btn))
      expect(cls.split(" "), `btn.${name}`).toContain(PRESS[name] ?? "press-glass");
    expect(quietLink.split(" ")).toContain("press");
    expect(classes.tab.split(" ")).toContain("press-glass");
    expect(classes.tabCurrent.split(" ")).toContain("press-glass");
    // No lift under the pointer, in the office's own strings.
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
    // Every count a pill with no edge (Phase 23): the grey one clear glass since Phase 24, the
    // others tinted.
    for (const [name, cls, fill] of [
      ["countPill", classes.countPill, "glass-button"],
      ["count", classes.count, "glass-button"],
      ["countNeeds", classes.countNeeds, "bg-hivis"],
      ["countWaiting", classes.countWaiting, "bg-wait-tile"],
    ] as const) {
      expect(cls, name).not.toMatch(/(?<![\w:-])border(?:-[a-z]+)*(?![\w-])/);
      expect(cls.split(" "), name).toEqual(expect.arrayContaining([fill, "rounded-full"]));
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

  // Phase 24 (round 7): one look for the office and the casual app. The office's block sets its
  // sizes and its headline's weight and tracking, and nothing else: no colour (Phase 23's white
  // cards on a cool grey ground and the sky main button are gone), no face, and no dark block of
  // its own. Its main button is the app's: tinted glass in the firm's colour.
  it("the office takes the app's colours and glass: its block sets only its sizes", () => {
    expect([...light.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1])).toEqual([
      "text-sm",
      "text-sm--line-height",
      "text-base",
      "text-base--line-height",
      "text-lg",
      "text-lg--line-height",
      "text-3xl",
      "text-3xl--line-height",
      "text-4xl",
      "text-4xl--line-height",
      "tracking-heading",
      "title-weight",
      "title-tracking",
    ]);
    expect(css.match(/body:has\(\[data-office\]\)\s*\{/g)).toHaveLength(1);
    expect(css).not.toMatch(/\[data-theme="dark"\] body:has\(\[data-office\]\)/);
    expect(css).not.toMatch(/:root:not\(\[data-theme="light"\]\) body:has\(\[data-office\]\)/);
    expect(css).not.toMatch(/\[data-office\] \{\s*font-family/);
    expect(read("src/app/ui/classes.ts")).toMatch(/primary: `\$\{office\} glass-tint /);
    // And the firm's colour reaches the office as everywhere (Phase 23 kept it off its buttons).
    expect(block("body[data-firm-colour]")).toContain("--color-tint: var(--firm-fill);");
  });

  it("the type scale's office values: 13, 15, 17, 30 and 40px in place of 14, 16, 18, 28 and 44", () => {
    expect(value("text-sm")).toBe("0.8125rem");
    expect(value("text-base")).toBe("0.9375rem");
    expect(value("text-lg")).toBe("1.0625rem");
    expect(value("text-3xl")).toBe("1.875rem");
    expect(value("text-4xl")).toBe("2.5rem");
    expect(value("text-2xl")).toBeUndefined();
    // A headline in Geist semibold, a little tight (round 7; Plus Jakarta Sans extrabold in 23,
    // Newsreader semibold in 22, Instrument Serif in 21); the casual app's medium.
    expect(value("title-weight")).toBe("600");
    expect(value("title-tracking")).toBe("-0.025em");
    expect(value("tracking-heading")).toBe("-0.015em");
    expect(css).toMatch(
      /@utility text-title \{[^}]*font-size: var\(--text-3xl\);[^}]*font-weight: var\(--title-weight, 500\);\s*letter-spacing: var\(--title-tracking, -0\.02em\);/,
    );
    expect(css).not.toMatch(/--title-(?:font|size):/);
    // Section headings bold (the shared `h2`, by its `office:` value).
    expect(classes.h2.split(" ")).toContain("office:font-bold");
  });

  // Phase 24: Geist for every word, headline and number (Plus Jakarta Sans in 23; DM Sans, DM Mono
  // and Newsreader in 22; Geist, Geist Mono and Instrument Serif in 21).
  it("corners, the depth tokens, the face", () => {
    expect(css).toMatch(/--radius-card: 1\.5rem;/);
    expect(css).toMatch(/--radius-inner: 1\.375rem;/);
    expect(css).toMatch(/--radius-row: 0\.875rem;/);
    for (const token of ["soft", "raise", "sheet", "tint"])
      expect(css).not.toMatch(new RegExp(`--shadow-${token}:`));
    expect(css).toContain("--shadow-float: var(--float-shadow);");
    expect(css).toMatch(
      /@utility font-stat \{\s*font-family:\s*var\(--font-geist\),\s*var\(--font-geist-ext\),[^}]*font-weight: 600;\s*font-variant-numeric: tabular-nums;\s*letter-spacing: -0\.03em;\s*\}/,
    );
    expect(css).not.toMatch(
      /@utility font-display|--font-(?:dm-sans|dm-mono|newsreader|plus-jakarta|instrument)/,
    );
  });

  // Phase 24 (round 7): gradients are the glass's: a tile's, a clear button's and the main
  // button's fills, the wash's four lights and the top bar's edge, and the masks that fade an edge
  // (the menu's, the bar's). None anywhere in the office's own files.
  it("gradients only in the glass, the wash and the masks", () => {
    const gradient =
      /(?:repeating-)?(?:linear|radial|conic)-gradient\(|(?<![\w-])bg-(?:linear|radial|conic|gradient)-/;
    const inOffice = SOURCES.filter(({ text }) => gradient.test(text)).map(({ file }) => file);
    expect(inOffice).toEqual([]);
    // Each gradient in the stylesheet, by the rule it's in.
    const owners: string[] = [];
    let current = "";
    for (const line of css.split("\n")) {
      const opens =
        /^(@utility [a-z-]+|\s*body::before|\s*&::before|\s*&\[data-more="[a-z]+"\]) \{/.exec(line);
      if (opens) current = opens[1]!.trim();
      if (/^@utility [a-z-]+ \{/.test(line)) current = line.replace(/ \{$/, "");
      if (gradient.test(line)) owners.push(`${current}: ${line.trim().split(":")[0]}`);
    }
    expect(owners).toEqual([
      "body::before: radial-gradient(70rem 48rem at -4% -10%, var(--wash-a), transparent 62%),",
      "body::before: radial-gradient(62rem 48rem at 104% 4%, var(--wash-b), transparent 58%),",
      "body::before: radial-gradient(62rem 50rem at 62% 104%, var(--wash-c), transparent 60%),",
      "body::before: radial-gradient(56rem 44rem at 4% 96%, var(--wash-d), transparent 60%);",
      "@utility glass-tile: background-image",
      "@utility glass-button: background-image",
      "@utility glass-tint: background-image",
      "&::before: background",
      "&::before: mask-image",
      '&[data-more="below"]: mask-image',
      '&[data-more="above"]: mask-image',
      '&[data-more="both"]: mask-image',
    ]);
    expect(css).toMatch(/@utility fade-edges \{/);
  });

  // No grain, stripes, glows or colour cards (round 2's), and no picture: the only images are the
  // glass's gradients and the only url() the refraction filter's (ui.glass.test.ts).
  it("no grain, stripes, glows, tinted cards or pictures", () => {
    expect(css).not.toMatch(
      /--(?:grain|stripes|tint-(?:urgent|attention|wait|done)|card-chip|glow-)/,
    );
    expect(css).not.toMatch(/@utility (?:grain|stripes|tint-|card-chip)/);
    expect(css.match(/background-image:/g)).toHaveLength(3);
    expect(css.match(/url\(/g)).toEqual(["url("]);
    expect(css).toContain("url(#lg-refract)");
    // Nor round 2's colour cards' own tokens.
    expect(css).not.toMatch(/--color-(?:urgent|attention|wait|done)-card/);
    const texture =
      /(?<![\w-])(?:[a-z0-9/[\]&=_-]+:)*(?:grain|grain-soft|stripes|card-chip|tint-(?:urgent|attention|wait|done)|bg-\[url)(?![\w-])/g;
    const inOffice = SOURCES.flatMap(({ file, text }) =>
      [...text.matchAll(texture)].map((m) => `${file}: ${m[0]}`),
    );
    expect(inOffice).toEqual([]);
  });

  // The office's table (Phase 23) is history: its values are the app's now, matched against the
  // doc's one token table (tests/unit/ui.design-system.test.ts), and the doc says so.
  it("docs/ui-design.md: the office's colours are the app's (Phase 24)", () => {
    const doc = read("docs/ui-design.md");
    const p24 = doc
      .slice(doc.indexOf("## Phase 24: Liquid Glass"), doc.indexOf("## Phase 23"))
      .replace(/\s+/g, " ");
    expect(p24).toContain("The office has no colours of its own any more");
    expect(p24).toContain("the office's 12, 13, 15, 17, 20, 30 and 40px");
    const p23 = doc.slice(doc.indexOf("## Phase 23"), doc.indexOf("## Phase 22"));
    expect(p23).toMatch(/^## Phase 23: the office's look, round 3\n\nReplaced by Phase 24/);
  });

  it("every office page carries [data-office]; one face for the office and the casual app", () => {
    const layout = read("src/app/office/layout.tsx");
    expect(layout).toMatch(/<div data-office="" className="contents">/);
    expect(layout.match(/<OfficeLook>/g)).toHaveLength(2);
    expect(layout).not.toMatch(/officeFontVariables|office-fonts/);
    // Phase 23's office face (Plus Jakarta Sans, src/app/office/office-fonts.ts) is gone: Geist
    // (src/app/fonts.ts, on <html> for every page: tests/unit/ui.theme.test.ts).
    expect(existsSync(join(ROOT, "src/app/office/office-fonts.ts"))).toBe(false);
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/geist"]).toBe("5.3.0");
    for (const name of [
      "@fontsource-variable/plus-jakarta-sans",
      "@fontsource-variable/dm-sans",
      "@fontsource/dm-mono",
      "@fontsource-variable/newsreader",
    ])
      expect(pkg.dependencies[name], name).toBeUndefined();
  });
});

// Phase 24 (round 7) on every other page: glass. A box on a page is a glass part (a section's
// frost, a tile's or a clear button's clear glass), a status's tint with its edge, or a solid
// fill (ink, red, green): never Phase 23's white box with a hairline. Fields clear glass, their
// edge showing under the pointer; the second step before something destructive one red wash with
// its edge, and before a change that takes nothing away the same in grey; a notice an amber wash
// with its edge.
describe("round 7's parts on the office's other pages", () => {
  it("Needs attention's page: its parts, beside the column they've always had", async () => {
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
    // No shadow class and no grain, here or anywhere in what it draws.
    expect(also).not.toMatch(/(?<![\w-])(?:[a-z0-9-]+:)*(?:inset-)?shadow-(?!none)/);
    expect(also).not.toMatch(/(?<![\w-])grain/);
    expect(read("src/app/office/needs-attention/page.tsx")).toContain(
      '<div className="min-w-0 lg:col-span-8">',
    );
  });

  it("fields clear glass with their edge under the pointer; every second step and notice a wash with its edge", () => {
    // A field: clear glass, its 3:1 edge (line-strong) under the pointer, no shadow class.
    expect(field.split(" ")).toEqual(
      expect.arrayContaining([
        "glass-tile",
        "rounded-row",
        "border",
        "border-transparent",
        "hover:border-line-strong",
      ]),
    );
    expect(field).not.toMatch(/shadow|(?<![\w-])bg-card(?![\w-])/);
    // Red before something destructive; grey before a change that takes nothing away.
    expect(classes.confirmStep).toBe("rounded-row border border-urgent-line bg-urgent-soft p-4");
    expect(classes.checkStep).toBe("rounded-row border border-quiet-line bg-quiet-soft p-4");
    // A notice (what the AI or the voicemail line did, what a key will show once): amber.
    expect(classes.notice).toBe(
      "rounded-row border border-attention-line bg-attention-soft px-4 py-3 text-attention-ink",
    );
    // A key or secret shown once: clear glass, in the system's mono.
    expect(classes.codeBox).toBe(
      "glass-tile block rounded-row px-3 py-2 font-mono text-base break-all text-ink select-all",
    );
    // An answer under a button: a pale grey slip with its edge (shifts/shift-tones.ts).
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
    // Any wash with an edge (a notice, a status, a step) has no shadow class, and there is at
    // least one.
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

  // Phase 24: no white box. Every string in the office's files and its own class strings that
  // gives a box its corners (a section's, a row's) and a white fill (`card`, `button`, `sheet`) is
  // a glass part instead; the white fills stay only on the events board's open seats and its key's
  // swatch (marks with the stronger grey outline, not boxes). And there's glass on the pages:
  // sections, tiles, clear buttons and what floats, each used.
  it("no white boxes: every box a glass part, a tint or a solid fill", () => {
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
    const white = /(?<![\w:-])(?:[a-z0-9-]+:)*bg-(?:card|button|sheet)(?![\w/-])/;
    const OUTLINED = [
      "src/app/office/events/board-parts.tsx",
      "src/app/office/events/event-row.tsx",
    ];
    const whites = LITERALS.filter(({ text }) => white.test(text)).map(
      ({ file, text }) => `${file}: ${text}`,
    );
    expect(whites.filter((w) => !OUTLINED.some((f) => w.startsWith(`${f}: `)))).toEqual([]);
    for (const w of whites) {
      expect(w).toMatch(/(?<![\w:-])border-ink-muted(?![\w-])/);
      expect(w).not.toMatch(
        /(?<![\w-])(?:[a-z0-9-]+:)*rounded-(?:[trblse]{1,2}-)?(?:card|inner|row)(?![\w-])/,
      );
    }
    // The glass, in use on the office's pages.
    const count = (re: RegExp) => LITERALS.filter(({ text }) => re.test(text)).length;
    expect(count(/(?<![\w-])glass(?![\w-])/)).toBeGreaterThan(8);
    expect(count(/(?<![\w-])glass-tile(?![\w-])/)).toBeGreaterThan(4);
    expect(count(/(?<![\w-])glass-button(?![\w-])/)).toBeGreaterThan(4);
    expect(count(/(?<![\w-])glass-float(?![\w-])/)).toBeGreaterThan(4);
    // 24px corners are what floats beside the page: the rail's (Phase 24: the menu card's, in the
    // frame, until then) and the dashboard's offer panel's (24.3, the mock-up's sheet), and the
    // login card's; a section on a page is 22px (rounded-inner), a row 14px.
    const big = /(?<![\w-])(?:[a-z0-9-]+:)*rounded-(?:[trblse]{1,2}-)?card(?![\w-])/;
    const bigFiles = OFFICE.filter((file) => big.test(code(read(file))));
    expect(bigFiles).toEqual([
      "src/app/office/dashboard/offer-panel.tsx",
      "src/app/office/office-rail.tsx",
    ]);
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
    ).toEqual(["loginCard", "officeLoginCard"]);
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

  // Phase 24 (24.3): the dashboard's sections are its head and track, the places chart, the detail
  // card and the board's four columns (Phase 23's counts, urgent places and six charts went).
  it("the dashboard's has a part for every section", () => {
    const html = renderToStaticMarkup(createElement(DashboardSkeleton));
    expect([...html.matchAll(/data-skeleton-part="([a-z]+)"/g)].map((m) => m[1])).toEqual([
      "header",
      "places",
      "detail",
      "offer",
      "offered",
      "overnight",
      "mark",
    ]);
    // Glass, as the dashboard's (Phase 24): its sections frosted, no white card, no tints, no
    // shadow class, no grain.
    expect(html).toContain("glass rounded-inner");
    expect(html).not.toMatch(/(?<![\w:-])bg-(?:card|sheet)(?![\w/-])/);
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

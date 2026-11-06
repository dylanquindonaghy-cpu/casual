import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 28's look guard (28.16; docs/screens.md "### 28.16"): the casual app reached the office's
// look. The comparison found about 70 ad-hoc corners in the staff pages against none in the
// office; this scans every file under src/app outside the office for what Phase 28 took out:
//   - a corner that isn't one of the tokens (rounded-card, rounded-inner, rounded-row,
//     rounded-mark, rounded-full, rounded-none): an arbitrary one (rounded-[14px]), Tailwind's own
//     (rounded-2xl, rounded-3xl, and rounded-xl, rounded-lg, rounded-md, rounded-sm, plain rounded);
//   - a gradient (bg-gradient-*, linear-gradient);
//   - the pass's old band (glass-band);
//   - a 2px edge (border-2), except the chosen choice card's (staffChoice in classes.ts, whose
//     transparent 2px edge turns ink when picked, so nothing moves).
// globals.css isn't scanned: it's the stylesheet both halves share, where the glass utilities are
// defined (their gradients' two ends are one value since 28.1: tests/unit/ui.p28-classes.test.ts).
//
// The allow-list is named, each entry with its reason, and each entry must still be needed (a
// stale entry fails too). The spec named one more, the pass's gate plate (src/app/next-pass.tsx's
// "Gate 2"): since 28.7 it is clear glass with a token corner (glass-button rounded-row), so it
// trips nothing and needs no entry.

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// Every .ts/.tsx under src/app that isn't the office's own.
const CASUAL = walk(APP)
  .map((p) => relative(ROOT, p).split("\\").join("/"))
  .filter((p) => /\.tsx?$/.test(p) && !p.startsWith("src/app/office/"))
  .sort();

// Comments are words, not classes.
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

// A corner utility with its variants (`sm:`, `office:`): rounded, rounded-t-row, rounded-[14px].
const RADIUS =
  /(?<![\w[-])(?:[a-z0-9/[\]&=_-]+:)*rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl))?(?:-([a-z0-9]+|\[[^\]]+\]))?(?![\w-])/g;
const TOKEN_CORNERS = new Set(["card", "inner", "row", "mark", "full", "none"]);
const GRADIENT = /(?<![\w-])(?:bg-gradient-[a-z-]+|bg-linear-[a-z0-9-]+|linear-gradient)(?![\w-])/g;
const BAND = /(?<![\w-])glass-band(?![\w-])/g;
const BORDER2 = /(?<![\w-])(?:[a-z0-9-]+:)*border-2(?![\w-])/g;

interface Hit {
  file: string;
  rule: "corner" | "gradient" | "band" | "border-2";
  token: string;
  line: string;
}

// The named allow-list: file, rule, the line it's on (a part of it), and why.
const ALLOWED: { file: string; rule: Hit["rule"]; line: string; reason: string }[] = [
  {
    file: "src/app/ui/classes.ts",
    rule: "border-2",
    line: "has-checked:border-ink has-checked:bg-active",
    reason:
      "staffChoice: the choice card's 2px edge, transparent until it's chosen, so nothing moves (28.1)",
  },
];

function hitsIn(file: string, source: string): Hit[] {
  const lines = code(source).split("\n");
  const hits: Hit[] = [];
  lines.forEach((line) => {
    for (const m of line.matchAll(RADIUS))
      if (!TOKEN_CORNERS.has(m[1] ?? "")) hits.push({ file, rule: "corner", token: m[0], line });
    for (const m of line.matchAll(GRADIENT))
      hits.push({ file, rule: "gradient", token: m[0], line });
    for (const m of line.matchAll(BAND)) hits.push({ file, rule: "band", token: m[0], line });
    for (const m of line.matchAll(BORDER2))
      hits.push({ file, rule: "border-2", token: m[0], line });
  });
  return hits;
}

const allowedBy = (hit: Hit) =>
  ALLOWED.find((a) => a.file === hit.file && a.rule === hit.rule && hit.line.includes(a.line));

const ALL_HITS = CASUAL.flatMap((file) => hitsIn(file, readFileSync(join(ROOT, file), "utf8")));

describe("the casual app's look guard (Phase 28, 28.16)", () => {
  it("finds the casual files: the pages, the shared parts, and not the office's", () => {
    expect(CASUAL.length).toBeGreaterThan(100);
    expect(CASUAL).toEqual(
      expect.arrayContaining([
        "src/app/home-view.tsx",
        "src/app/next-pass.tsx",
        "src/app/ui/classes.ts",
        "src/app/pay/code-gate.tsx",
        "src/app/profile/fold.tsx",
        "src/app/shifts/booked-view.tsx",
        "src/app/too-many-tries.tsx",
      ]),
    );
    expect(CASUAL.filter((f) => f.startsWith("src/app/office/"))).toEqual([]);
  });

  it("sees what it checks (a sample with each kind, comments left out)", () => {
    const sample = [
      'const a = "rounded-[14px] p-2"; // rounded-3xl in a comment is words',
      'const b = "rounded-2xl rounded-xl sm:rounded-lg rounded rounded-card office:rounded-row";',
      'const c = "bg-gradient-to-b from-white"; const d = "glass-band";',
      'const e = `background: linear-gradient(red, blue)`; const f = "border-2 hover:border-2";',
      'const g = "border-[1.5px] rounded-full rounded-mark rounded-t-inner border";',
      "/* glass-band border-2 rounded-[3px] */",
    ].join("\n");
    const found = hitsIn("sample.tsx", sample).map((h) => `${h.rule}:${h.token}`);
    expect(found).toEqual([
      "corner:rounded-[14px]",
      "corner:rounded-2xl",
      "corner:rounded-xl",
      "corner:sm:rounded-lg",
      "corner:rounded",
      "gradient:bg-gradient-to-b",
      "band:glass-band",
      "gradient:linear-gradient",
      "border-2:border-2",
      "border-2:hover:border-2",
    ]);
  });

  it("no casual file has an ad-hoc corner, a gradient, the old band or a stray 2px edge", () => {
    const stray = ALL_HITS.filter((h) => !allowedBy(h)).map(
      (h) => `${h.file}: ${h.rule} "${h.token}" in ${h.line.trim()}`,
    );
    expect(stray).toEqual([]);
  });

  it("every allow-list entry is still needed, and says why", () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(20);
      const used = ALL_HITS.some((h) => allowedBy(h) === entry);
      expect(used, `${entry.file} (${entry.rule}): not needed any more`).toBe(true);
    }
  });

  it("the 2px edge allowed is the choice card's only (staffChoice)", async () => {
    const classes = await import("@/app/ui/classes");
    expect(classes.staffChoice).toMatch(/(?<![\w-])border-2 border-transparent(?![\w-])/);
    const edges = ALL_HITS.filter((h) => h.rule === "border-2");
    expect(edges.map((h) => h.file)).toEqual(["src/app/ui/classes.ts"]);
    expect(edges[0]?.line.trim()).toBe(`"${classes.staffChoice}";`);
  });
});

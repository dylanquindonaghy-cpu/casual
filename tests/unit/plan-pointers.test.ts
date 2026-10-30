import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Where the plan's parts moved (PLAN.md P1, 2026-10-29): CLAUDE.md, the commands and the agents
// point at files that exist and never send anyone to the old places in PLAN.md; each heading left
// in PLAN.md as a pointer leads to its moved file; and every month of the logs is listed in its
// index.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const inDir = (dir: string) =>
  readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${dir}/${name}`);
const GUIDES = ["CLAUDE.md", ...inDir(".claude/commands"), ...inDir(".claude/agents")];

// Every path a guide names in backticks, under the repo's own folders; not what a run writes in
// `.claude/state/` (a fresh checkout has none).
const named = (text: string) =>
  [...text.matchAll(/`((?:docs|scripts|src|tests|\.claude)\/[^`\s]+)`/g)]
    .map((m) => m[1] ?? "")
    .filter((path) => !path.startsWith(".claude/state/"));

// A path with YYYY-MM in it stands for each month's file: at least one must exist.
function exists(path: string): boolean {
  if (!path.includes("YYYY-MM")) return existsSync(join(ROOT, path));
  const slash = path.lastIndexOf("/");
  const shape = new RegExp(
    `^${path
      .slice(slash + 1)
      .replace(/[.]/g, "\\.")
      .replace("YYYY-MM", "\\d{4}-\\d{2}")}$`,
  );
  return readdirSync(join(ROOT, path.slice(0, slash))).some((name) => shape.test(name));
}

// The old places, as the guides said them before the move.
const OLD_PLACES = [
  /Parking lot in `?PLAN\.md/,
  /Hours log"? table at the bottom of `?PLAN\.md/,
  /append a section to `docs\/work-log\.md`/,
  /^`docs\/overnight-log\.md`, newest at the bottom/m,
];

describe("the guides point at the plan's new places", () => {
  it.each(GUIDES)("%s: every path it names exists", (guide) => {
    const missing = named(read(guide)).filter((path) => !exists(path));
    expect(missing).toEqual([]);
  });

  it.each(GUIDES)("%s: never the old places in PLAN.md", (guide) => {
    const text = read(guide);
    expect(OLD_PLACES.filter((old) => old.test(text)).map(String)).toEqual([]);
  });

  it("the guides name the moved files at all (the check above isn't empty)", () => {
    const all = GUIDES.flatMap((guide) => named(read(guide)));
    for (const path of [
      "docs/plan/parking-lot.md",
      "docs/plan/hours-log.md",
      "docs/plan/blocked.md",
      "docs/archive/plan-done.md",
      "docs/logs/work-YYYY-MM.md",
    ]) {
      expect(all, path).toContain(path);
    }
  });
});

describe("PLAN.md's pointers to its moved parts", () => {
  const plan = read("PLAN.md");
  // The text under a heading, up to the next one.
  const under = (heading: string) => {
    const at = plan.indexOf(`\n${heading}\n`);
    if (at < 0) return null;
    const rest = plan.slice(at + heading.length + 2);
    const next = rest.search(/^## /m);
    return next < 0 ? rest : rest.slice(0, next);
  };

  it.each([
    ["## Decisions waiting for Dylan", "docs/plan/decisions-waiting.md"],
    ["## Parking lot", "docs/plan/parking-lot.md"],
    ["## Hours log", "docs/plan/hours-log.md"],
    ["## Still open from earlier phases", "docs/archive/plan-done.md"],
  ])("%s leads to %s, which holds it", (heading, path) => {
    expect(under(heading), heading).toContain(`\`${path}\``);
    expect(existsSync(join(ROOT, path))).toBe(true);
    if (path.startsWith("docs/plan/")) expect(read(path)).toContain(`\n${heading}\n`);
  });
});

describe("the logs by month", () => {
  it.each([
    ["docs/work-log.md", "work"],
    ["docs/overnight-log.md", "overnight"],
  ])("%s lists every month's file", (index, kind) => {
    const months = readdirSync(join(ROOT, "docs/logs")).filter((name) =>
      new RegExp(`^${kind}-\\d{4}-\\d{2}\\.md$`).test(name),
    );
    expect(months.length).toBeGreaterThan(0);
    const text = read(index);
    expect(months.filter((name) => !text.includes(`(logs/${name})`))).toEqual([]);
  });
});

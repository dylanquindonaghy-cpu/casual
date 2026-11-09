import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedFirms } from "@/lib/db/admin/seed-data";
import { dramaMobile, SPARE_MOBILES } from "../e2e/spare-mobiles";

// The browser specs hand out numbers at run time only from SPARE_MOBILES' blocks
// (tests/e2e/spare-mobiles.ts, unusedMobile in tests/e2e/db.ts). A fixed number inside a block can
// be picked first by another spec, and then the spec that owns it finds someone else's casual
// (main's CI on #42: comingUpScene took 28.9's Idris's 07700 900829). This keeps every fixed
// number, the browser specs' and the seed's, out of the blocks, and the blocks apart.

const root = process.cwd();
const DRAMA = /(?:\+447700900|07700 ?900 ?)(\d{3})(?!\d)/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const blocks = Object.entries(SPARE_MOBILES);
const inBlock = (n: number) => blocks.find(([, [from, to]]) => n >= from && n <= to)?.[0];

describe("the browser specs' spare numbers", () => {
  it("no fixed number in a browser spec falls in a spare block", () => {
    const clashes: string[] = [];
    for (const path of files(join(root, "tests/e2e"))) {
      if (path.endsWith("spare-mobiles.ts")) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(DRAMA)) {
          const block = inBlock(Number(m[1]));
          if (block) clashes.push(`${path.slice(root.length + 1)}:${i + 1} ${m[0]} (${block})`);
        }
      });
    }
    expect(clashes).toEqual([]);
  });

  it("no seeded casual, story casual or shifts line falls in a spare block", () => {
    const seeded = seedFirms(new Date("2026-11-06T09:00:00Z")).flatMap((f) =>
      f.workers.map((w) => w.mobileE164),
    );
    expect(seeded.length).toBeGreaterThan(0);
    const story = readFileSync(join(root, "src/lib/db/admin/seed-story.ts"), "utf8");
    // The story's casuals are `+447700900${400 + n}`, n from person("zoe", 0, ...).
    expect(story).toContain("mobileE164: `+447700900${400 + n}`");
    const storyNumbers = [...story.matchAll(/person\("\w+", (\d+),/g)].map((m) =>
      dramaMobile(400 + Number(m[1])),
    );
    expect(storyNumbers.length).toBeGreaterThan(0);
    const literals = files(join(root, "src")).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(DRAMA)].map((m) => dramaMobile(Number(m[1]))),
    );
    const clashes = [...seeded, ...storyNumbers, ...literals].filter((m) =>
      inBlock(Number(m.slice(-3))),
    );
    expect(clashes).toEqual([]);
  });

  it("every UK mobile in a browser spec is in Ofcom's drama range, 07700 900000 to 900999 (golden rule 7)", () => {
    // A number outside it (07700 930210, say) could be a real person's.
    const outside: string[] = [];
    for (const path of files(join(root, "tests/e2e"))) {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(/\+447(?!700900)|\b07(?!700 ?900)\d{3} ?\d/g))
            outside.push(`${path.slice(root.length + 1)}:${i + 1} ${m[0]}`);
        });
    }
    expect(outside).toEqual([]);
  });

  it("the blocks don't overlap and stay inside 000 to 999", () => {
    const sorted = blocks.map(([, r]) => r).sort((a, b) => a[0] - b[0]);
    sorted.forEach(([from, to], i) => {
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeLessThanOrEqual(999);
      expect(from).toBeLessThanOrEqual(to);
      const next = sorted[i + 1];
      if (next) expect(to).toBeLessThan(next[0]);
    });
    expect(dramaMobile(7)).toBe("+447700900007");
  });
});

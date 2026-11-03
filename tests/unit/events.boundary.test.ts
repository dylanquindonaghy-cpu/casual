import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The action log's times (golden rule 5): every entry is written at the database's now(), so nobody
// can log a change as if it happened earlier. The one exception is the made-up demo's history
// (Phase 26.10, fix-8), loaded by the seed with its story's own times: only the seed's modules may
// call recordEventAt(). Tests are exempt.

const ROOT = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

// Code only: comments may name it freely.
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = sourceFiles(ROOT).map((path) => ({
  path: relative(process.cwd(), path).replace(/\\/g, "/"),
  text: withoutComments(readFileSync(path, "utf8")),
}));

describe("the action log's times", () => {
  it("only the seed writes an entry at a time of its own", () => {
    const callers = files.filter((f) => /\brecordEventAt\b/.test(f.text)).map((f) => f.path);
    expect(callers.sort()).toEqual(
      [
        "src/lib/db/admin/seed-story-load.ts",
        "src/lib/db/admin/seed.ts",
        "src/lib/events/record.ts",
      ].sort(),
    );
  });

  it("nothing else writes events' created_at", () => {
    // The events writer is the only place the column is set, and only from recordEventAt's time.
    const setters = files
      .filter((f) => f.path !== "src/lib/events/record.ts")
      .filter((f) => /insert\(events\)[\s\S]{0,200}createdAt/.test(f.text))
      .map((f) => f.path);
    expect(setters).toEqual([]);
  });
});

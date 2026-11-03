import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The action log's times (golden rule 5): every entry is written at the database's now(), so nobody
// can log a change as if it happened earlier. The one exception is the made-up demo's history
// (Phase 26.10, fix-8), loaded by the seed with its story's own times: only the seed's log may call
// recordEventAt() (which refuses any firm but the demo's: tests/integration/demo.reset.test.ts), in
// the app and in the scripts alike. Tests are exempt.

const ROOTS = ["src", "scripts"].map((dir) => join(process.cwd(), dir));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

// Code only: comments may name it freely.
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = ROOTS.flatMap(sourceFiles).map((path) => ({
  path: relative(process.cwd(), path).replace(/\\/g, "/"),
  text: withoutComments(readFileSync(path, "utf8")),
}));

describe("the action log's times", () => {
  it("only the seed writes an entry at a time of its own", () => {
    const callers = files.filter((f) => /\brecordEventAt\b/.test(f.text)).map((f) => f.path);
    expect(callers.sort()).toEqual(
      ["src/lib/db/admin/seed-log.ts", "src/lib/events/record.ts"].sort(),
    );
  });

  it("nothing else writes events' created_at", () => {
    // The events writer is the only place the column is set, and only from recordEventAt's time:
    // Drizzle's insert into the table is the writer's alone, and the owner scripts' SQL inserts
    // (each a firm's set-up step, logged) leave created_at to the database.
    const drizzle = files
      .filter((f) => f.path !== "src/lib/events/record.ts")
      .filter((f) => /\.insert\(\s*events\s*\)/.test(f.text))
      .map((f) => f.path);
    expect(drizzle).toEqual([]);
    const sqlInserts = files.flatMap((f) =>
      [...f.text.matchAll(/insert\s+into\s+(?:public\.)?events\s*\(([^)]*)\)/gi)].map((m) => ({
        f: f.path,
        columns: m[1] ?? "",
      })),
    );
    expect(sqlInserts.length).toBeGreaterThan(0);
    for (const { f, columns } of sqlInserts) {
      expect([f, columns]).not.toEqual([f, expect.stringMatching(/created_at/)]);
    }
  });
});

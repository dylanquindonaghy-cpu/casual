import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// rules.table.test.ts must test every case in docs/rules-and-credentials.md ("Test cases":
// "table-driven, all must pass"). This reads both and fails if a row in the doc has no test named
// after it, or the doc's block of tests has one the doc doesn't list: a case added on either side
// can't go unnoticed.

const doc = readFileSync("docs/rules-and-credentials.md", "utf8");
const tests = readFileSync("tests/unit/rules.table.test.ts", "utf8");

// Dashes and quotes as a test name can spell them.
const normalise = (text: string) =>
  text.replace(/[–−]/g, "-").replace(/[`'"]/g, "").replace(/\s+/g, " ").trim();

function docCases(): string[] {
  const start = doc.indexOf("## Test cases");
  const end = doc.indexOf("\n## ", start + 1);
  const rows = doc
    .slice(start, end === -1 ? undefined : end)
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2); // the header and the |---| line
  return rows.map((row) => normalise(row.split("|")[1] ?? ""));
}

function testNames(): string[] {
  const start = tests.indexOf('describe("docs/rules-and-credentials.md test cases"');
  const end = tests.indexOf("\ndescribe(", start + 1);
  const block = tests.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/\bit\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => normalise(m[1] ?? ""));
}

describe("rules.table covers docs/rules-and-credentials.md", () => {
  const cases = docCases();
  const names = testNames();

  it("reads a sensible table and test block", () => {
    expect(cases.length).toBeGreaterThanOrEqual(19);
    expect(names.length).toBe(cases.length);
  });

  it.each(cases)("the doc's case %s has a test named after it", (docCase) => {
    const named = names.filter((n) => n.startsWith(docCase));
    expect(named).toHaveLength(1);
  });

  it("every test in the doc's block is a case the doc lists", () => {
    const orphans = names.filter((n) => !cases.some((c) => n.startsWith(c)));
    expect(orphans).toEqual([]);
  });
});

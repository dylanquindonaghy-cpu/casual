import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// One booking path (ADR-014): only the booking code may run the rules for a booking, check a
// booking, or call a roster plug's assign; only the cancel path and the sync may cancel.
// Anywhere else, a pass could be minted from made-up input to book around the real rows, the
// authorisation and the action log, or a cancellation could skip its notice-hours event. Tests
// are exempt (the contract suite mints passes on purpose).

const ROOT = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

// Code only: comments may name these functions freely ("the pass checkEligibility() issued").
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = sourceFiles(ROOT).map((path) => ({
  path: relative(process.cwd(), path).replace(/\\/g, "/"),
  text: withoutComments(readFileSync(path, "utf8")),
}));

const CALLS: [string, RegExp, string[]][] = [
  [
    "checkEligibility(",
    /\bcheckEligibility\(/,
    ["src/lib/rules/eligibility.ts", "src/lib/roster/book.ts"],
  ],
  [
    "checkBooking(",
    /\bcheckBooking\(/,
    ["src/lib/roster/book.ts", "src/lib/roster/sheets/sync.ts"],
  ],
  [
    "a plug's assign(",
    /(?<!Object)\.assign\(/,
    ["src/lib/roster/book.ts", "src/lib/roster/sheets/sync.ts"],
  ],
  // Cancellations: every one writes its event with the notice hours (cancel.ts, or the sync).
  [
    "a plug's markCancelled(",
    /\.markCancelled\(/,
    ["src/lib/roster/cancel.ts", "src/lib/roster/sheets/sync.ts"],
  ],
];

describe("the booking boundary", () => {
  it.each(CALLS)("only the booking code calls %s", (_name, pattern, allowed) => {
    const callers = files.filter((f) => pattern.test(f.text)).map((f) => f.path);
    expect(callers.sort()).toEqual([...allowed].sort());
  });
});

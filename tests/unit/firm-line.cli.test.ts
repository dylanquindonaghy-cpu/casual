import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// `npm run firm:line` (scripts/firm-line.ts): an unknown or malformed option, or a missing one,
// prints the usage line and stops before touching any database (audit L82: an unknown flag used to
// print a stack trace).

const run = (...args: string[]) =>
  spawnSync("node", ["--import", "tsx", "scripts/firm-line.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    // No database to reach: a run that got past the usage check would fail differently.
    env: { ...process.env, DATABASE_ADMIN_URL: "" },
  });

const USAGE =
  'Usage: npm run firm:line -- --firm <slug> (--number "+44 7700 900000" [--replace] | --clear)';

describe("npm run firm:line, given the wrong options", () => {
  it.each([
    [["--firm", "acme", "--nmuber", "+447700900000"]], // a typo
    [["--firm"]], // no value
    [["--firm", "acme"]], // nothing to do
    [["--firm", "acme", "--number", "+447700900000", "--clear"]], // both
  ])("%j: the usage line, exit 2, no stack trace", (args) => {
    const r = run(...args);
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toBe(USAGE);
    expect(r.stdout).toBe("");
  });
});

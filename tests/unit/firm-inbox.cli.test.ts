import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// `npm run firm:inbox` (scripts/firm-inbox.ts, P7.1): an unknown or malformed option, or a missing
// one, prints the usage line and stops before touching any database (as firm:line's).

const run = (...args: string[]) =>
  spawnSync("node", ["--import", "tsx", "scripts/firm-inbox.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    // No database to reach: a run that got past the usage check would fail differently.
    env: { ...process.env, DATABASE_ADMIN_URL: "" },
  });

const USAGE =
  "Usage: npm run firm:inbox -- --firm <slug> (--address <address> [--replace] | --clear)";

describe("npm run firm:inbox, given the wrong options", () => {
  it.each([
    [["--firm", "acme", "--adress", "staffing@inbound.example.test"]], // a typo
    [["--firm"]], // no value
    [["--firm", "acme"]], // nothing to do
    [["--firm", "acme", "--address", "staffing@inbound.example.test", "--clear"]], // both
  ])("%j: the usage line, exit 2, no stack trace", (args) => {
    const r = run(...args);
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toBe(USAGE);
    expect(r.stdout).toBe("");
  });
});

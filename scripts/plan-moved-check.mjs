#!/usr/bin/env node
// Nothing lost in P1's move (PLAN.md P1.1 to P1.3): every line of PLAN.md before the move is still
// in PLAN.md, the frozen archive or docs/plan/, at least as many times as it was; and each log's
// sections, cut by month into docs/logs/, still start with the old body byte for byte (later
// sections may follow). A box ticked since the move counts as the same line.
//   node scripts/plan-moved-check.mjs [commit]   (default: the one before the archive was added)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const before =
  process.argv[2] ??
  `${git("log", "--diff-filter=A", "--format=%H", "-1", "--", "docs/archive/plan-done.md").trim()}~1`;
if (before === "~1") {
  console.error("no archive yet: pass the commit before the move");
  process.exit(2);
}
const read = (path) => readFileSync(path, "utf8");
const problems = [];

// PLAN.md's lines, counted.
const key = (line) => line.replace(/\[[ xX]\]/, "[ ]").trimEnd();
const count = (text, into = new Map()) => {
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    into.set(key(line), (into.get(key(line)) ?? 0) + 1);
  }
  return into;
};
const now = count(read("PLAN.md"));
count(read("docs/archive/plan-done.md"), now);
for (const name of readdirSync("docs/plan")) count(read(join("docs/plan", name)), now);
const was = count(git("show", `${before}:PLAN.md`));
let lines = 0;
for (const [line, n] of was) {
  lines += n;
  if ((now.get(line) ?? 0) < n)
    problems.push(`PLAN.md: lost ${JSON.stringify(line.slice(0, 100))}`);
}

// The logs: the month files' sections, joined in order, start with the old body.
for (const [kind, src] of [
  ["work", "docs/work-log.md"],
  ["overnight", "docs/overnight-log.md"],
]) {
  const old = git("show", `${before}:${src}`);
  const body = old.slice(old.search(/^## /m));
  const months = readdirSync("docs/logs")
    .filter((name) => new RegExp(`^${kind}-\\d{4}-\\d{2}\\.md$`).test(name))
    .sort();
  const joined = months
    .map((name) => {
      const text = read(join("docs/logs", name));
      const cut = text.indexOf("\n---\n\n");
      if (cut < 0) problems.push(`${name}: no "---" after its header`);
      return text.slice(cut + 6);
    })
    .join("");
  if (!joined.startsWith(body))
    problems.push(`${src}: the month files don't start with its old body`);
  const index = read(src);
  for (const name of months) {
    if (!index.includes(`(logs/${name})`)) problems.push(`${src}: doesn't list logs/${name}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`nothing lost since ${before}: ${lines} lines of PLAN.md, and both logs`);

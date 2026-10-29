#!/usr/bin/env node
// Nothing lost in P1's move (PLAN.md P1.1 to P1.3), checked on the commit that made it against the
// one before: every line of PLAN.md before is in PLAN.md, the frozen archive or docs/plan/ after,
// at least as many times as it was; and each log's sections, cut by month into docs/logs/, are
// the old body byte for byte, joined. Later edits to these files don't change the answer.
//   node scripts/plan-moved-check.mjs [commit]   (default: the commit that added the archive)
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const move =
  process.argv[2] ??
  git("log", "--diff-filter=A", "--format=%H", "-1", "--", "docs/archive/plan-done.md").trim();
if (move === "") {
  console.error("no archive yet: pass the commit that made the move");
  process.exit(2);
}
const before = `${move}~1`;
const at = (rev, path) => git("show", `${rev}:${path}`);
const files = (rev, dir) =>
  git("ls-tree", "--name-only", `${rev}:${dir}`)
    .split("\n")
    .filter((name) => name !== "");
const problems = [];

// PLAN.md's lines, counted.
const count = (text, into = new Map()) => {
  for (const line of text.split("\n")) {
    const key = line.trimEnd();
    if (key.trim() !== "") into.set(key, (into.get(key) ?? 0) + 1);
  }
  return into;
};
const after = count(at(move, "PLAN.md"));
count(at(move, "docs/archive/plan-done.md"), after);
for (const name of files(move, "docs/plan")) count(at(move, `docs/plan/${name}`), after);
let lines = 0;
for (const [line, n] of count(at(before, "PLAN.md"))) {
  lines += n;
  if ((after.get(line) ?? 0) < n)
    problems.push(`PLAN.md: lost ${JSON.stringify(line.slice(0, 100))}`);
}

// The logs: the month files' sections, joined in order, are the old body; the index lists each
// month.
for (const [kind, src] of [
  ["work", "docs/work-log.md"],
  ["overnight", "docs/overnight-log.md"],
]) {
  const old = at(before, src);
  const body = old.slice(old.search(/^## /m));
  const months = files(move, "docs/logs")
    .filter((name) => new RegExp(`^${kind}-\\d{4}-\\d{2}\\.md$`).test(name))
    .sort();
  const joined = months
    .map((name) => {
      const text = at(move, `docs/logs/${name}`);
      const cut = text.indexOf("\n---\n\n");
      if (cut < 0) problems.push(`${name}: no "---" after its header`);
      return text.slice(cut + 6);
    })
    .join("");
  if (joined !== body) problems.push(`${src}: the month files, joined, aren't its old body`);
  const index = at(move, src);
  for (const name of months) {
    if (!index.includes(`(logs/${name})`)) problems.push(`${src}: doesn't list logs/${name}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`nothing lost in ${move.slice(0, 7)}: ${lines} lines of PLAN.md, and both logs`);

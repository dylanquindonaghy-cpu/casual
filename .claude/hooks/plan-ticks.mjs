#!/usr/bin/env node
// Which tasks would a change to PLAN.md tick? Shared by the tick guards (audit L1 and L3):
//   node plan-ticks.mjs edit             < an Edit, MultiEdit or Write hook payload on stdin
//   node plan-ticks.mjs compare BEFORE AFTER   (two files)
// Prints each newly ticked task's first line, one per line, or nothing. A tick is a task line
// whose box was "[ ]" before and is "[x]" or "[X]" after (a tick moved from one task to another
// included), or more ticked boxes than before (a line added already ticked). Rewording a task
// that was already ticked isn't a tick. Exits 2 when it can't tell (the guards then refuse).
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BOX = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.*\S)\s*$/;

function boxes(text) {
  const ticked = [];
  const open = new Set();
  for (const line of text.split("\n")) {
    const m = BOX.exec(line);
    if (!m) continue;
    const key = m[2].replace(/\s+/g, " ");
    if (m[1] === " ") open.add(key);
    else ticked.push(key);
  }
  return { ticked, open };
}

export function newlyTicked(before, after) {
  const b = boxes(before);
  const a = boxes(after);
  const was = new Set(b.ticked);
  const fromOpen = a.ticked.filter((k) => b.open.has(k) && !was.has(k));
  if (fromOpen.length > 0) return fromOpen;
  if (a.ticked.length > b.ticked.length) {
    const added = a.ticked.filter((k) => !was.has(k));
    return added.length > 0 ? added : ["(a ticked box was added)"];
  }
  return [];
}

// The file's text after an Edit, MultiEdit or Write, as the tool would leave it. An edit whose
// old text isn't in the file fails in the tool anyway: its own old and new text are compared.
export function afterEdit(current, toolInput) {
  if (typeof toolInput.content === "string") return { before: current, after: toolInput.content };
  const edits = Array.isArray(toolInput.edits)
    ? toolInput.edits
    : [
        {
          old_string: toolInput.old_string,
          new_string: toolInput.new_string,
          replace_all: toolInput.replace_all,
        },
      ];
  let text = current;
  for (const e of edits) {
    const oldS = String(e.old_string ?? "");
    const newS = String(e.new_string ?? "");
    if (oldS === "" || !text.includes(oldS)) {
      const own = edits.map((x) => String(x.old_string ?? "")).join("\n");
      const ownNew = edits.map((x) => String(x.new_string ?? "")).join("\n");
      return { before: own, after: ownNew };
    }
    text = e.replace_all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
  }
  return { before: current, after: text };
}

function main() {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === "compare") {
    const out = newlyTicked(readFileSync(a, "utf8"), readFileSync(b, "utf8"));
    if (out.length) process.stdout.write(out.map((t) => t.slice(0, 120)).join("\n") + "\n");
    return;
  }
  if (mode === "edit") {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const input = payload.tool_input ?? {};
    let current = "";
    try {
      current = readFileSync(String(input.file_path), "utf8");
    } catch {
      current = "";
    }
    const { before, after } = afterEdit(current, input);
    const out = newlyTicked(before, after);
    if (out.length) process.stdout.write(out.map((t) => t.slice(0, 120)).join("\n") + "\n");
    return;
  }
  process.stderr.write("usage: plan-ticks.mjs edit | compare BEFORE AFTER\n");
  process.exit(2);
}

function runAsScript() {
  try {
    return !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (runAsScript()) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`plan-ticks: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

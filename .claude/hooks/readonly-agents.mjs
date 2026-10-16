#!/usr/bin/env node
// The reviewers and the auditor are read-only by tool, not just by instruction (audit L6). For a
// tool call made inside one of them (the hook input's `agent_type`), Edit and Write are refused,
// and a shell command only runs if every part of it is a command that reads: git's reading
// subcommands, cat, grep, sed without -i, find without -exec or -delete, and the like, with no
// output redirected into a file. Anything else (npm, node, python, rm, tee, `>` …) is refused.
// Calls from the main session and other agents pass untouched.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const READ_ONLY_AGENTS = new Set(["claims-auditor", "guardrails-reviewer", "doc-fact-checker"]);

const READERS = new Set([
  "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "sed", "awk", "wc", "ls", "find", "jq",
  "sort", "uniq", "cut", "tr", "diff", "cmp", "comm", "sha256sum", "md5sum", "stat", "file",
  "echo", "printf", "date", "basename", "dirname", "realpath", "readlink", "pwd", "true", "false",
  "test", "[", "nl", "column", "fold", "tac", "rev", "paste", "join", "seq", "expr", "od", "xxd",
  "cd", "which", "du", "df", "less", "more", "zcat", "git",
]);
const GIT_READERS = new Set([
  "diff", "log", "show", "status", "rev-parse", "ls-files", "ls-tree", "grep", "blame",
  "merge-base", "rev-list", "cat-file", "describe", "shortlog", "name-rev", "whatchanged",
  "for-each-ref", "show-ref", "count-objects", "diff-tree", "diff-index", "diff-files",
]);
// Prefixes that run the command after them: their own words are skipped.
const WRAPPERS = new Set(["time", "nice", "command", "builtin"]);
const SCRIPTS = [/^(\.\/|.*\/)?\.claude\/hooks\/tree-hash\.sh$/];

// Quoted text can't run anything by itself: blank it out before reading the command's shape.
function unquote(cmd) {
  return cmd
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

export function readOnlyCommand(command) {
  const shape = unquote(command);
  // Output redirected into a file: every `>` (with any stream number, `>>`, `>|`, `&>`) must point
  // at /dev/null or another stream (`>&2`, `2>&1`).
  for (let i = shape.indexOf(">"); i !== -1; i = shape.indexOf(">", i + 1)) {
    if (shape[i - 1] === ">") continue;
    let rest = shape.slice(i).replace(/^>+\|?/, "").trimStart();
    if (/^&[0-9-]/.test(rest)) continue;
    rest = rest.replace(/^&/, "");
    if (/^\/dev\/null(\s|$|[;|&)])/.test(rest)) continue;
    return { ok: false, why: "it writes output to a file (`>`)" };
  }
  if (/<\(|>\(/.test(shape)) return { ok: false, why: "it uses process substitution" };
  if (/(^|[^\w-])awk\b/.test(shape) && /system\s*\(|print[^;|]*>|\|\s*"/.test(command))
    return { ok: false, why: "its awk program writes or runs commands" };
  const parts = shape.split(/\|\||&&|;|\||&(?![0-9>])|\n|\$\(|`|\(|\)/);
  for (const raw of parts) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    while (words.length && WRAPPERS.has(words[0])) words.shift();
    if (words[0] === "timeout") {
      words.shift();
      while (words.length && (words[0].startsWith("-") || /^[0-9.]+[smhd]?$/.test(words[0]))) words.shift();
    }
    if (!words.length) continue;
    const [cmd, ...args] = words;
    if (SCRIPTS.some((re) => re.test(cmd))) continue;
    if (cmd === "xargs") {
      const next = args.find((a) => !a.startsWith("-"));
      if (!next || !READERS.has(next) || next === "git") return { ok: false, why: "xargs runs a command that isn't a reader" };
      continue;
    }
    if (!READERS.has(cmd)) return { ok: false, why: `\`${cmd}\` isn't one of the read-only commands` };
    if (cmd === "git") {
      const sub = args.find((a) => !a.startsWith("-") && !/^-C$|^-c$/.test(a));
      const idx = args.indexOf(sub ?? "");
      const prev = idx > 0 ? args[idx - 1] : "";
      if (prev === "-C" || prev === "-c") return { ok: false, why: "git with -C or -c isn't checked here" };
      const showCurrent = sub === "branch" && args.includes("--show-current");
      if (!sub || (!GIT_READERS.has(sub) && !showCurrent)) return { ok: false, why: `\`git ${sub ?? ""}\` can change the repository` };
      if (args.some((a) => a === "--output" || a.startsWith("--output="))) return { ok: false, why: "git --output writes a file" };
    }
    if (cmd === "sed" && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place")))
      return { ok: false, why: "`sed -i` edits files" };
    if (cmd === "find" && args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/.test(a)))
      return { ok: false, why: "`find` would run or delete something" };
  }
  return { ok: true };
}

export function decide(payload) {
  const agent = payload.agent_type;
  if (!agent || !READ_ONLY_AGENTS.has(agent)) return null;
  const tool = payload.tool_name;
  if (tool === "Bash") {
    const verdict = readOnlyCommand(String(payload.tool_input?.command ?? ""));
    if (verdict.ok) return null;
    return `${agent} is read-only: this command is refused because ${verdict.why}. Read, search and git's reading commands still work.`;
  }
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool))
    return `${agent} is read-only: it can't change files.`;
  return null;
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
if (import.meta.url === invoked) {
  let reason = null;
  try {
    reason = decide(JSON.parse(readFileSync(0, "utf8")));
  } catch {
    reason = null;
  }
  if (reason)
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
      }),
    );
}

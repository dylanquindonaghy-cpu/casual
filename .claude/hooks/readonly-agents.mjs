#!/usr/bin/env node
// The reviewers and the auditor are read-only by tool, not just by instruction (audit L6). For a
// tool call made inside one of them (the hook input's `agent_type`), Edit and Write are refused,
// and a shell command only runs if every part of it is a command that reads: git's reading
// subcommands, cat, grep, sed with a script that only prints or substitutes, find without -exec or
// -delete, and the like, with no output redirected into a file. Anything else (npm, node, python,
// rm, tee, `>`, a variable or `$(…)` whose value could become an option …) is refused. The command
// is read the way the shell reads it (quotes, escapes, comments), so `"-i"` is seen as -i; when
// it can't be read with certainty, it's refused. Calls from the main session and other agents
// pass untouched.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const READ_ONLY_AGENTS = new Set(["claims-auditor", "guardrails-reviewer", "doc-fact-checker"]);

const READERS = new Set([
  "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "sed", "awk", "wc", "ls", "find", "jq",
  "sort", "uniq", "cut", "tr", "diff", "cmp", "comm", "sha256sum", "md5sum", "stat", "echo",
  "printf", "date", "basename", "dirname", "realpath", "readlink", "pwd", "true", "false", "test",
  "[", "nl", "column", "fold", "tac", "rev", "paste", "join", "seq", "expr", "od", "cd", "which",
  "du", "df", "zcat", "git", "xargs",
]);
const GIT_READERS = new Set([
  "diff", "log", "show", "status", "rev-parse", "ls-files", "ls-tree", "grep", "blame",
  "merge-base", "rev-list", "cat-file", "describe", "shortlog", "name-rev", "whatchanged",
  "for-each-ref", "show-ref", "count-objects", "diff-tree", "diff-index", "diff-files",
]);
// git's own options allowed before the subcommand. Others (-C, -c, --exec-path, --git-dir …)
// change which repository, settings or programs git uses.
const GIT_GLOBAL = new Set(["--no-pager", "-P", "--no-optional-locks"]);
// What xargs may run: commands no option or file name read from its input can turn into a write.
const XARGS_SAFE = new Set([
  "grep", "egrep", "fgrep", "cat", "head", "tail", "wc", "ls", "stat", "sha256sum", "md5sum",
  "echo", "basename", "dirname", "realpath", "readlink",
]);
// Prefixes that run the command after them: their own words are skipped.
const WRAPPERS = new Set(["time", "command", "builtin"]);
// The project's own fingerprint script, by its path in this repository only.
const PROJECT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPTS = new Set([
  ".claude/hooks/tree-hash.sh",
  "./.claude/hooks/tree-hash.sh",
  join(PROJECT, ".claude/hooks/tree-hash.sh"),
]);

class Refused extends Error {}
const refuse = (why) => {
  throw new Refused(why);
};

// --- Reading the command as the shell does --------------------------------------------------

// Split a command into simple commands, each a list of words with quotes and escapes removed.
// `bare` is the word with every quoted or escaped character replaced by \0, to see what the shell
// would still expand. Redirections are checked here and left out of the words.
function simpleCommands(c) {
  const commands = [];
  let words = [];
  let word = null;
  let redirect = null; // "in" | "out": the next word is that redirection's target
  const add = (ch, quoted) => {
    word ??= { text: "", bare: "" };
    word.text += ch;
    word.bare += quoted ? "\0" : ch;
  };
  const endWord = () => {
    if (!word) return;
    if (/\{[^{}]*(,|\.\.)[^{}]*\}/.test(word.bare))
      refuse("it uses brace expansion, which can turn one word into options");
    if (redirect === "out" && word.text !== "/dev/null")
      refuse("it writes output to a file (`>`)");
    if (!redirect) words.push(word);
    redirect = null;
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (redirect) refuse("a redirection has no target");
    if (words.length) commands.push(words);
    words = [];
  };

  let i = 0;
  while (i < c.length) {
    const ch = c[i];
    if (ch === "\\") {
      if (c[i + 1] === "\n") i += 2;
      else if (i + 1 < c.length) {
        add(c[i + 1], true);
        i += 2;
      } else refuse("it ends with a backslash");
    } else if (ch === "'") {
      const end = c.indexOf("'", i + 1);
      if (end === -1) refuse("a quote isn't closed");
      word ??= { text: "", bare: "" };
      for (const q of c.slice(i + 1, end)) add(q, true);
      i = end + 1;
    } else if (ch === '"') {
      word ??= { text: "", bare: "" };
      i++;
      while (i < c.length && c[i] !== '"') {
        if (c[i] === "\\" && i + 1 < c.length && '$`"\\\n'.includes(c[i + 1])) {
          if (c[i + 1] !== "\n") add(c[i + 1], true);
          i += 2;
          continue;
        }
        if (c[i] === "`") refuse("it runs a command in backquotes");
        if (c[i] === "$" && /[A-Za-z0-9_{([@*#?$!-]/.test(c[i + 1] ?? ""))
          refuse("it uses `$` (a variable or `$(…)`), whose value could become an option");
        add(c[i], true);
        i++;
      }
      if (i >= c.length) refuse("a quote isn't closed");
      i++;
    } else if (ch === "`") {
      refuse("it runs a command in backquotes");
    } else if (ch === "$") {
      // A `$` before a space, an operator or `)` is a plain dollar sign; `$(`, `$((` and every
      // other `$…` expand.
      if (i + 1 < c.length && !/[\s;&|)<>]/.test(c[i + 1]))
        refuse("it uses `$` (a variable, `$(…)` or `$'…'`), whose value could become an option");
      add("$", false);
      i++;
    } else if (ch === "#" && !word) {
      // A comment, to the end of the line.
      while (i < c.length && c[i] !== "\n") i++;
    } else if (ch === " " || ch === "\t") {
      endWord();
      i++;
    } else if (ch === "\n" || ch === ";" || ch === "(" || ch === ")") {
      endCommand();
      i++;
    } else if (ch === "|") {
      endCommand();
      i += c[i + 1] === "|" || c[i + 1] === "&" ? 2 : 1;
    } else if (ch === "&" && c[i + 1] !== ">") {
      endCommand();
      i += c[i + 1] === "&" ? 2 : 1;
    } else if (ch === "<" || ch === ">" || ch === "&") {
      // A stream number written straight before the arrow (2>) belongs to the redirection.
      if (word && /^[0-9]+$/.test(word.bare)) word = null;
      endWord();
      if (redirect) refuse("a redirection has no target");
      const op = /^(&>>?|>>|>\||>&|>|<<|<>|<&|<)/.exec(c.slice(i))[0];
      i += op.length;
      if (op === "<<") refuse("it uses a here-document");
      if (op === "<>") refuse("it opens a file for writing (`<>`)");
      if (c[i] === "(") refuse("it uses process substitution");
      if (op === ">&" || op === "<&") {
        // Copying a stream (2>&1, >&2, <&0) writes no file.
        const dup = /^([0-9]+|-)(?=$|[\s;&|()<>])/.exec(c.slice(i));
        if (dup) {
          i += dup[0].length;
          continue;
        }
        if (op === "<&") refuse("a redirection isn't one the check can read");
      }
      redirect = op.includes(">") ? "out" : "in";
      while (c[i] === " " || c[i] === "\t") i++;
    } else {
      add(ch, false);
      i++;
    }
  }
  endCommand();
  return commands;
}

// --- Options -----------------------------------------------------------------------------------

const isShort = (a) => a.length > 1 && a[0] === "-" && a[1] !== "-";
// A long option or any abbreviation of it (getopt accepts `--out` for `--output`).
function isLong(a, name) {
  if (!a.startsWith("--")) return false;
  const given = a.slice(2).split("=")[0];
  return given.length > 0 && (name.startsWith(given) || given.startsWith(name));
}

function checkGit(args) {
  let k = 0;
  while (k < args.length && args[k].startsWith("-")) {
    if (!GIT_GLOBAL.has(args[k])) refuse(`git's option \`${args[k]}\` before the command isn't checked here`);
    k++;
  }
  const sub = args[k];
  const rest = args.slice(k + 1);
  if (sub === "branch") {
    if (rest.length === 1 && rest[0] === "--show-current") return;
    refuse("`git branch` can change the repository (only --show-current reads)");
  }
  if (!sub || !GIT_READERS.has(sub)) refuse(`\`git ${sub ?? ""}\` can change the repository`);
  if (rest.some((a) => isLong(a, "output"))) refuse("git --output writes a file");
  if (sub === "grep" && rest.some((a) => (isShort(a) && a.includes("O")) || isLong(a, "open-files-in-pager")))
    refuse("`git grep -O` runs a program on the files");
}

const SED_LONG = new Set([
  "--quiet", "--silent", "--posix", "--debug", "--sandbox", "--separate", "--unbuffered",
  "--null-data", "--zero-terminated", "--regexp-extended",
]);

function checkSed(args) {
  const scripts = [];
  const operands = [];
  let explicit = false;
  let ended = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (ended || a === "-" || !a.startsWith("-")) {
      operands.push(a);
    } else if (a === "--") {
      ended = true;
    } else if (a.startsWith("--")) {
      if (a.startsWith("--expression=")) scripts.push(a.slice("--expression=".length));
      else if (a === "--expression") scripts.push(args[++k] ?? "");
      else if (/^--line-length=[0-9]+$/.test(a)) continue;
      else if (a === "--line-length") k++;
      else if (SED_LONG.has(a)) continue;
      else refuse(`sed's option \`${a}\` isn't one the check knows (--in-place and --file aren't allowed)`);
      if (a.startsWith("--expression")) explicit = true;
    } else {
      for (let j = 1; j < a.length; j++) {
        const f = a[j];
        if ("nErsuz".includes(f)) continue;
        if (f === "e") {
          scripts.push(a.slice(j + 1) || (args[++k] ?? ""));
          explicit = true;
        } else if (f === "l") {
          if (!a.slice(j + 1)) k++;
        } else if (f === "i") {
          refuse("`sed -i` edits files");
        } else refuse(`sed's option \`-${f}\` isn't one the check knows`);
        break;
      }
    }
  }
  if (!explicit && operands.length) scripts.push(operands[0]);
  for (const s of scripts)
    if (!sedScriptReads(s))
      refuse("its sed script isn't one that only prints or substitutes (w, W, e, r and the like aren't allowed)");
}

// A sed script that only reads: addresses, then p P d D n N g G h H x z = F l q Q, { }, and s with
// flags that only match or print (g p i I m M and a number). w, W, e, s///w, s///e, r and every
// other command are refused. Regular expressions are read as GNU sed reads them (a delimiter
// inside [...] doesn't end one); a bracket expression is only accepted in its plain form.
const SED_PLAIN = new Set(["p", "P", "d", "D", "n", "N", "g", "G", "h", "H", "x", "z", "=", "F"]);
const SED_DELIMITERS = "/|#,:@%_~+!=";
const BRACKET = /^\[\^?\]?(?:\[:[a-z]+:\]|[^\][\\\n])*\]/;

export function sedScriptReads(s) {
  let i = 0;
  const digits = () => {
    const start = i;
    while (/[0-9]/.test(s[i] ?? "")) i++;
    return i > start;
  };
  const blanks = () => {
    while (s[i] === " " || s[i] === "\t") i++;
  };
  const regex = (d) => {
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\n") return false;
      if (ch === "\\") {
        if (i + 1 >= s.length || s[i + 1] === "\n" || s[i + 1] === "c") return false;
        i += 2;
      } else if (ch === d) {
        i++;
        return true;
      } else if (ch === "[") {
        const m = BRACKET.exec(s.slice(i));
        if (!m || m[0].includes(d)) return false;
        i += m[0].length;
      } else i++;
    }
    return false;
  };
  const replacement = (d) => {
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\n") return false;
      if (ch === "\\") {
        if (i + 1 >= s.length || s[i + 1] === "\n" || s[i + 1] === "c") return false;
        i += 2;
      } else if (ch === d) {
        i++;
        return true;
      } else i++;
    }
    return false;
  };
  // true: read one; null: there's none here; false: one that can't be read.
  const address = () => {
    if (digits()) {
      if (s[i] === "~") {
        i++;
        if (!digits()) return false;
      }
      return true;
    }
    if (s[i] === "$") {
      i++;
      return true;
    }
    if (s[i] === "/" || s[i] === "\\") {
      let d = "/";
      if (s[i] === "\\") {
        d = s[i + 1] ?? "";
        if (!d || !SED_DELIMITERS.includes(d)) return false;
        i++;
      }
      i++;
      if (!regex(d)) return false;
      while (s[i] === "I" || s[i] === "M") i++;
      return true;
    }
    return null;
  };

  for (;;) {
    while (/[\s;]/.test(s[i] ?? "")) i++;
    if (i >= s.length) return true;
    const first = address();
    if (first === false) return false;
    if (first && s[i] === ",") {
      i++;
      if (s[i] === "+" || s[i] === "~") {
        i++;
        if (!digits()) return false;
      } else if (address() !== true) return false;
    }
    blanks();
    if (s[i] === "!") {
      i++;
      blanks();
    }
    const cmd = s[i++];
    if (cmd === "s") {
      const d = s[i++] ?? "";
      if (!d || !SED_DELIMITERS.includes(d)) return false;
      if (!regex(d) || !replacement(d)) return false;
      while (/[gpiImM0-9]/.test(s[i] ?? "")) i++;
    } else if (cmd === "q" || cmd === "Q" || cmd === "l") {
      blanks();
      digits();
    } else if (cmd === "{" || cmd === "}") {
      continue;
    } else if (!cmd || !SED_PLAIN.has(cmd)) {
      return false;
    }
    blanks();
    if (i < s.length && !/[;\n}]/.test(s[i])) return false;
  }
}

// A short-option cluster: does `letter` appear as an option before one that takes the rest of the
// word as its value (`-to` is -t with "o")?
function inCluster(a, letter, takesValue) {
  if (!isShort(a)) return false;
  for (const f of a.slice(1)) {
    if (f === letter) return true;
    if (takesValue.includes(f)) return false;
  }
  return false;
}

function checkSort(args) {
  for (const a of args) {
    if (inCluster(a, "o", "ktST")) refuse("`sort -o` writes a file");
    if (isLong(a, "output")) refuse("`sort --output` writes a file");
    if (isLong(a, "compress-program")) refuse("`sort --compress-program` runs a program");
  }
}

// uniq's second file name is where it writes: `uniq in out`.
function checkUniq(args) {
  let operands = 0;
  let ended = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (ended || a === "-" || !a.startsWith("-")) operands++;
    else if (a === "--") ended = true;
    else if (a.startsWith("--")) {
      if (!a.includes("=") && ["skip-fields", "skip-chars", "check-chars"].some((n) => isLong(a, n))) k++;
    } else if (/[fsw]$/.test(a)) k++;
  }
  if (operands >= 2) refuse("`uniq` with two file names writes the second");
}

function checkAwk(args) {
  let program = null;
  for (let k = 0; k < args.length && program === null; k++) {
    const a = args[k];
    if (a === "--") {
      program = args[k + 1] ?? "";
    } else if (a === "-F" || a === "-v") {
      k++;
    } else if (/^-[Fv]./.test(a)) {
      continue;
    } else if (a.startsWith("-") && a !== "-") {
      refuse(`awk's option \`${a}\` isn't one the check knows (-f, -o, -p and the like aren't allowed)`);
    } else program = a;
  }
  if (program === null) return;
  if (/\bsystem\b/.test(program) || /@/.test(program)) refuse("its awk program runs commands");
  if (/(^|[^|])\|(?!\|)/.test(program)) refuse("its awk program uses a pipe (`|`), which runs a command");
  if (/print[^;|]*>/.test(program)) refuse("its awk program writes to a file");
}

function checkXargs(args) {
  const withArg = new Set(["-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s"]);
  let k = 0;
  while (k < args.length && args[k].startsWith("-")) {
    if (args[k] === "--") {
      k++;
      break;
    }
    if (isLong(args[k], "process-slot-var")) refuse("`xargs --process-slot-var` sets a variable");
    if (withArg.has(args[k])) k++;
    k++;
  }
  const [cmd, ...rest] = args.slice(k);
  if (!cmd || !XARGS_SAFE.has(cmd))
    refuse("xargs runs a command that its input could turn into a write (only grep, cat, head, wc and the like)");
  checkWords([cmd, ...rest]);
}

function checkWords(words) {
  words = [...words];
  while (words.length && WRAPPERS.has(words[0])) words.shift();
  if (words[0] === "timeout") {
    words.shift();
    while (words.length && (words[0].startsWith("-") || /^[0-9.]+[smhd]?$/.test(words[0]))) words.shift();
  }
  if (!words.length) return;
  const [cmd, ...args] = words;
  if (SCRIPTS.has(cmd)) return;
  if (!READERS.has(cmd)) refuse(`\`${cmd}\` isn't one of the read-only commands`);
  if (cmd === "git") checkGit(args);
  else if (cmd === "sed") checkSed(args);
  else if (cmd === "sort") checkSort(args);
  else if (cmd === "uniq") checkUniq(args);
  else if (cmd === "awk") checkAwk(args);
  else if (cmd === "xargs") checkXargs(args);
  else if (cmd === "find" && args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/.test(a)))
    refuse("`find` would run or delete something, or write a file");
  else if (cmd === "rg" && args.some((a) => /^--(pre|hostname-bin)(=|$)/.test(a)))
    refuse("`rg --pre` and `--hostname-bin` run a program");
  else if (cmd === "printf" && args.some((a) => a === "-v" || /^-v./.test(a)))
    refuse("`printf -v` sets a variable");
  else if (cmd === "date" && args.some((a) => inCluster(a, "s", "dfIr") || isLong(a, "set")))
    refuse("`date -s` sets the clock");
}

export function readOnlyCommand(command) {
  try {
    for (const words of simpleCommands(command)) {
      // A variable set for a command (GIT_EXTERNAL_DIFF=rm git diff) or for the rest of the
      // shell (PATH=…) can make a reading command run something else.
      if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(words[0].bare))
        refuse("it sets a variable or a command's environment");
      checkWords(words.map((w) => w.text));
    }
    return { ok: true };
  } catch (error) {
    // Anything the check itself can't handle is refused too.
    return { ok: false, why: error instanceof Refused ? error.message : "the check couldn't read it" };
  }
}

export function decide(payload) {
  const agent = payload.agent_type;
  if (!agent || !READ_ONLY_AGENTS.has(agent)) return null;
  const tool = payload.tool_name;
  if (tool === "Bash") {
    const verdict = readOnlyCommand(String(payload.tool_input?.command ?? ""));
    if (verdict.ok) return null;
    return `${agent} is read-only: this command is refused because ${verdict.why}. Read, search and git's reading commands still work; run each part as its own command.`;
  }
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool))
    return `${agent} is read-only: it can't change files.`;
  return null;
}

function runAsScript() {
  try {
    return !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (runAsScript()) {
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

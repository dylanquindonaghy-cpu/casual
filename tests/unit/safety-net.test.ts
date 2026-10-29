import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The safety net (Phase 13 task 13.1; audit L1 to L6, L61, L62): the hooks and checks that keep
// "done" meaning verified. Each runs as Claude Code runs it, a separate process given JSON on
// stdin, here inside a throwaway git repository with a copy of the hooks.

const REPO = process.cwd();
const HOOKS = join(REPO, ".claude/hooks");
const PLAN = "# Plan\n\n- [ ] First task (1.1)\n- [ ] Second task (1.2)\n- [x] Done task (1.0)\n";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

// A repository with the hooks and a PLAN.md, committed.
function sandbox(plan = PLAN) {
  const dir = mkdtempSync(join(tmpdir(), "safety-net-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  cpSync(HOOKS, join(dir, ".claude/hooks"), { recursive: true });
  for (const f of readdirSync(join(dir, ".claude/hooks")))
    chmodSync(join(dir, ".claude/hooks", f), 0o755);
  writeFileSync(join(dir, ".gitignore"), ".claude/state/\n");
  writeFileSync(join(dir, "PLAN.md"), plan);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "start");
  return dir;
}

function hook(dir: string, name: string, payload: object) {
  const file = join(dir, ".claude/hooks", name);
  const r = spawnSync(name.endsWith(".mjs") ? "node" : "bash", [file], {
    cwd: dir,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  const out = r.stdout.trim();
  return { status: r.status, json: out ? (JSON.parse(out) as Record<string, unknown>) : null };
}

const decision = (json: Record<string, unknown> | null) =>
  (json?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision ??
  "allow";

function stamp(dir: string, over: { ok?: boolean; e2e?: boolean; tree?: string } = {}) {
  const tree =
    over.tree ??
    spawnSync("bash", [join(dir, ".claude/hooks/tree-hash.sh")], {
      cwd: dir,
      encoding: "utf8",
    }).stdout.trim();
  mkdirSync(join(dir, ".claude/state"), { recursive: true });
  writeFileSync(
    join(dir, ".claude/state/verified.json"),
    JSON.stringify({ ok: over.ok ?? true, tree, e2e: over.e2e ?? true, at: "test" }),
  );
}

const edit = (dir: string, oldS: string, newS: string) => ({
  tool_name: "Edit",
  tool_input: { file_path: join(dir, "PLAN.md"), old_string: oldS, new_string: newS },
});

describe("the hooks are wired where Claude Code runs them (.claude/settings.json)", () => {
  type Entry = { matcher?: string; hooks: { type: string; command: string }[] };
  const settings = JSON.parse(readFileSync(join(REPO, ".claude/settings.json"), "utf8")) as {
    hooks: Record<string, Entry[]>;
  };
  // Every hook command on that event whose matcher covers the tool.
  const wired = (event: string, tool?: string) =>
    (settings.hooks[event] ?? [])
      .filter((e) => !tool || !e.matcher || new RegExp(`^(${e.matcher})$`).test(tool))
      .flatMap((e) => e.hooks.map((h) => h.command));
  const runs = (event: string, tool: string | undefined, hookFile: string) =>
    wired(event, tool).some((c) => c.includes(`/.claude/hooks/${hookFile}`));

  it("each tool's guards run before it, the shell's check after it, the claims check at the end", () => {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      expect(runs("PreToolUse", tool, "guard-plan-tick.sh"), tool).toBe(true);
      expect(runs("PreToolUse", tool, "readonly-agents.mjs"), tool).toBe(true);
    }
    expect(runs("PreToolUse", "NotebookEdit", "readonly-agents.mjs")).toBe(true);
    expect(runs("PreToolUse", "Bash", "plan-bash-snapshot.sh")).toBe(true);
    expect(runs("PreToolUse", "Bash", "readonly-agents.mjs")).toBe(true);
    expect(runs("PostToolUse", "Bash", "plan-bash-check.sh")).toBe(true);
    expect(runs("Stop", undefined, "stop-unverified-claims.sh")).toBe(true);
    // Each named file exists, and the shell ones can run.
    for (const command of Object.keys(settings.hooks).flatMap((e) => wired(e))) {
      const file = /\/\.claude\/hooks\/([\w.-]+)/.exec(command)?.[1] ?? "";
      expect(file, command).not.toBe("");
      const path = join(HOOKS, file);
      if (file.endsWith(".mjs")) expect(command, command).toMatch(/^node /);
      else expect(statSync(path).mode & 0o111, path).not.toBe(0);
    }
  });
});

describe("which edits tick a task (plan-ticks.mjs)", () => {
  const ticks = (before: string, after: string) => {
    const dir = sandbox();
    writeFileSync(join(dir, "b.md"), before);
    writeFileSync(join(dir, "a.md"), after);
    const r = spawnSync(
      "node",
      [join(dir, ".claude/hooks/plan-ticks.mjs"), "compare", "b.md", "a.md"],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    expect(r.status).toBe(0);
    return r.stdout.trim().split("\n").filter(Boolean);
  };

  it("a plain tick, an uppercase [X], a numbered list's box and a new line added already ticked", () => {
    expect(ticks("- [ ] A\n", "- [x] A\n")).toEqual(["A"]);
    expect(ticks("- [ ] A\n", "- [X] A\n")).toEqual(["A"]);
    expect(ticks("1. [ ] A\n", "1. [x] A\n")).toEqual(["A"]);
    expect(ticks("- [ ] A\n", "- [ ] A\n- [x] B\n")).toEqual(["B"]);
  });

  it("a tick moved from one task to another (the count stays the same: audit L3)", () => {
    expect(ticks("- [x] A\n- [ ] B\n", "- [ ] A\n- [x] B\n")).toEqual(["B"]);
  });

  it("not a tick: unticking, rewording a ticked task, an ordinary edit", () => {
    expect(ticks("- [x] A\n", "- [ ] A\n")).toEqual([]);
    expect(ticks("- [x] A (1.1)\n", "- [x] A, reworded (1.1)\n")).toEqual([]);
    expect(ticks(PLAN, PLAN + "\n## Parking lot\n- an idea\n")).toEqual([]);
  });
});

describe("the tick guard for Edit and Write (guard-plan-tick.sh)", () => {
  it("refuses a tick with no stamp, a failed one, one without the browser tests, or a stale one", () => {
    const dir = sandbox();
    const tick = edit(dir, "- [ ] First task (1.1)", "- [x] First task (1.1)");
    expect(decision(hook(dir, "guard-plan-tick.sh", tick).json)).toBe("deny");
    stamp(dir, { ok: false });
    expect(decision(hook(dir, "guard-plan-tick.sh", tick).json)).toBe("deny");
    stamp(dir, { e2e: false });
    const noE2e = hook(dir, "guard-plan-tick.sh", tick).json;
    expect(decision(noE2e)).toBe("deny");
    expect(JSON.stringify(noE2e)).toContain("browser tests");
    stamp(dir, { tree: "0000000000000000" });
    expect(decision(hook(dir, "guard-plan-tick.sh", tick).json)).toBe("deny");
  });

  it("allows a tick on a passing stamp with the browser tests for these exact files", () => {
    const dir = sandbox();
    stamp(dir);
    const tick = edit(dir, "- [ ] First task (1.1)", "- [x] First task (1.1)");
    expect(decision(hook(dir, "guard-plan-tick.sh", tick).json)).toBe("allow");
  });

  it("refuses a moved tick and an uppercase [X] (audit L3); allows an ordinary edit", () => {
    const dir = sandbox();
    const moved = {
      tool_name: "MultiEdit",
      tool_input: {
        file_path: join(dir, "PLAN.md"),
        edits: [
          { old_string: "- [x] Done task (1.0)", new_string: "- [ ] Done task (1.0)" },
          { old_string: "- [ ] Second task (1.2)", new_string: "- [x] Second task (1.2)" },
        ],
      },
    };
    expect(decision(hook(dir, "guard-plan-tick.sh", moved).json)).toBe("deny");
    const upper = edit(dir, "- [ ] First task (1.1)", "- [X] First task (1.1)");
    expect(decision(hook(dir, "guard-plan-tick.sh", upper).json)).toBe("deny");
    const write = {
      tool_name: "Write",
      tool_input: {
        file_path: join(dir, "PLAN.md"),
        content: PLAN.replace("- [ ] Second", "- [x] Second"),
      },
    };
    expect(decision(hook(dir, "guard-plan-tick.sh", write).json)).toBe("deny");
    const ordinary = edit(dir, "# Plan", "# Plan\n\nA note.");
    expect(decision(hook(dir, "guard-plan-tick.sh", ordinary).json)).toBe("allow");
  });
});

describe("ticks made from the shell (plan-bash-snapshot.sh, plan-bash-check.sh: audit L1)", () => {
  const bash = (dir: string, id: string, command: string, run: () => void) => {
    const pre = hook(dir, "plan-bash-snapshot.sh", {
      tool_name: "Bash",
      tool_use_id: id,
      tool_input: { command },
    });
    if (decision(pre.json) === "deny") return { pre: "deny", post: null };
    run();
    return {
      pre: "allow",
      post: hook(dir, "plan-bash-check.sh", {
        tool_name: "Bash",
        tool_use_id: id,
        tool_input: { command },
      }).json,
    };
  };
  const tickFirst = (dir: string) => {
    const p = join(dir, "PLAN.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("- [ ] First task", "- [x] First task"));
  };

  it("a shell tick without a stamp is reported, and commits and pushes are refused until it's undone", () => {
    const dir = sandbox();
    const r = bash(dir, "t1", "sed -i s/x/y/ PLAN.md", () => tickFirst(dir));
    expect(r.post).toMatchObject({ decision: "block" });
    expect(String(r.post?.reason)).toContain("First task (1.1)");
    // Nothing was rewritten: undoing is Claude's job.
    expect(readFileSync(join(dir, "PLAN.md"), "utf8")).toContain("- [x] First task (1.1)");
    expect(bash(dir, "t2", "git commit -am tick", () => {}).pre).toBe("deny");
    expect(bash(dir, "t3", "git push origin main", () => {}).pre).toBe("deny");
    expect(bash(dir, "t4", "git status", () => {}).pre).toBe("allow");
    // Unticked again: commits are allowed.
    const p = join(dir, "PLAN.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("- [x] First task", "- [ ] First task"));
    expect(bash(dir, "t5", "git commit -am note", () => {}).pre).toBe("allow");
  });

  it("a shell edit that ticks nothing passes; so does a tick on a valid stamp", () => {
    const dir = sandbox();
    const p = join(dir, "PLAN.md");
    const plain = bash(dir, "n1", "echo >> PLAN.md", () =>
      writeFileSync(p, readFileSync(p, "utf8") + "\nA note.\n"),
    );
    expect(plain.post).toBeNull();
    git(dir, "commit", "-qam", "note");
    stamp(dir);
    expect(bash(dir, "n2", "sed -i ...", () => tickFirst(dir)).post).toBeNull();
  });

  it("ticks that arrive with commits already on a remote branch (a merge of main) pass", () => {
    const remote = mkdtempSync(join(tmpdir(), "safety-net-remote-"));
    dirs.push(remote);
    git(remote, "init", "-q", "--bare", "-b", "main");
    const dir = sandbox();
    git(dir, "remote", "add", "origin", remote);
    git(dir, "push", "-q", "origin", "main");
    // Another clone ticks a task (verified there) and pushes it.
    const other = mkdtempSync(join(tmpdir(), "safety-net-other-"));
    dirs.push(other);
    git(other, "clone", "-q", remote, ".");
    git(other, "config", "user.email", "test@example.com");
    git(other, "config", "user.name", "Test");
    tickFirst(other);
    git(other, "commit", "-qam", "tick");
    git(other, "push", "-q", "origin", "main");
    const r = bash(dir, "m1", "git pull", () =>
      git(dir, "pull", "-q", "--ff-only", "origin", "main"),
    );
    expect(r.post).toBeNull();
    expect(readFileSync(join(dir, "PLAN.md"), "utf8")).toContain("- [x] First task (1.1)");
  });
});

describe("the Stop hook (stop-unverified-claims.sh: audit L2)", () => {
  const stop = (dir: string, text: string, active = false) =>
    hook(dir, "stop-unverified-claims.sh", {
      session_id: "s1",
      stop_hook_active: active,
      last_assistant_message: text,
    }).json;

  it("blocks more ways of saying done when nothing is verified", () => {
    const dir = sandbox();
    for (const text of [
      "Phase 0 is done.",
      "Done. Phase 0 complete.",
      "All 2665 tests pass.",
      "The task is now complete and all tests pass.",
      "Everything's finished, ready to merge.",
    ])
      expect(stop(dir, text), text).toMatchObject({ decision: "block" });
  });

  it("lets through a message that says plainly what isn't verified, or makes no claim", () => {
    const dir = sandbox();
    expect(stop(dir, "The code is written but not verified yet: verify is running.")).toBeNull();
    expect(stop(dir, "I've started the build. It isn't done yet.")).toBeNull();
    expect(stop(dir, "Here's the plan for tomorrow.")).toBeNull();
  });

  it("blocks a repeated claim on the next stop too, at most 3 times in a row", () => {
    const dir = sandbox();
    expect(stop(dir, "It's done.")).toMatchObject({ decision: "block" });
    expect(stop(dir, "It's done.", true)).toMatchObject({ decision: "block" });
    expect(stop(dir, "It's done.", true)).toMatchObject({ decision: "block" });
    expect(stop(dir, "It's done.", true)).toBeNull();
    // A fresh stop starts counting again.
    expect(stop(dir, "It's done.")).toMatchObject({ decision: "block" });
  });

  it("passes the claim when verify passed, with the browser tests, on these files", () => {
    const dir = sandbox();
    stamp(dir);
    expect(stop(dir, "Phase 0 is done.")).toBeNull();
    stamp(dir, { e2e: false });
    expect(stop(dir, "Phase 0 is done.")).toMatchObject({ decision: "block" });
  });
});

describe("the reviewers and the auditor are read-only (readonly-agents.mjs: audit L6)", () => {
  const ask = (agent: string | undefined, tool: string, command = "") => {
    const dir = sandbox();
    return decision(
      hook(dir, "readonly-agents.mjs", {
        ...(agent ? { agent_type: agent } : {}),
        tool_name: tool,
        tool_input: { command, file_path: join(dir, "x.ts") },
      }).json,
    );
  };

  it("reading commands run for them", () => {
    for (const command of [
      "git diff d337e4c..HEAD -- src",
      "git log --oneline -5 | cat",
      "grep -rn foo src | head",
      "cat .claude/state/verified.json && ./.claude/hooks/tree-hash.sh",
      "sed -n 1,20p src/x.ts 2>/dev/null",
      "ls | xargs grep foo",
      'grep "a > b" file',
    ])
      expect(ask("claims-auditor", "Bash", command), command).toBe("allow");
  });

  it("writing or running the project is refused, and Edit and Write", () => {
    for (const command of [
      "echo hi > out.txt",
      "cat x 2>err.txt",
      "sed -i s/a/b/ f",
      "git commit -m x",
      "git checkout main",
      "rm -rf x",
      "npm test",
      "node -e 1",
      "find . -name x -delete",
      "cat x | tee f",
      "echo $(rm x)",
      "xargs rm",
    ])
      expect(ask("guardrails-reviewer", "Bash", command), command).toBe("deny");
    expect(ask("doc-fact-checker", "Edit")).toBe("deny");
    expect(ask("claims-auditor", "Write")).toBe("deny");
  });

  it("the main session and other agents are untouched", () => {
    expect(ask(undefined, "Bash", "rm -rf x")).toBe("allow");
    expect(ask("Explore", "Bash", "npm test")).toBe("allow");
    expect(ask(undefined, "Edit")).toBe("allow");
  });

  // Many commands through the check in one process: [command, why] for each refused one.
  const verdicts = (commands: string[]) => {
    const r = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `import { readFileSync } from "node:fs";
         import { readOnlyCommand } from ${JSON.stringify(join(HOOKS, "readonly-agents.mjs"))};
         const cs = JSON.parse(readFileSync(0, "utf8"));
         process.stdout.write(JSON.stringify(cs.map((c) => readOnlyCommand(c))));`,
      ],
      { input: JSON.stringify(commands), encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(r.stderr);
    const out = JSON.parse(r.stdout) as { ok: boolean; why?: string }[];
    expect(out).toHaveLength(commands.length);
    return new Map(commands.map((c, i) => [c, out[i] ?? { ok: false, why: "no verdict" }]));
  };
  const expectRefused = (commands: string[], why: RegExp) => {
    for (const [command, v] of verdicts(commands)) {
      expect(v.ok, command).toBe(false);
      expect(v.why, command).toMatch(why);
    }
  };
  const expectAllowed = (commands: string[]) => {
    for (const [command, v] of verdicts(commands)) expect(v, command).toEqual({ ok: true });
  };

  it("commands whose options write or run something are refused (audit 13.1 round 1)", () => {
    expectRefused(
      [
        "sort -o out f",
        "sort -uo out f",
        "sort --output=out f",
        "sort --output out f",
        "sort --out=out f",
      ],
      /sort -o|sort --output/,
    );
    expectRefused(
      [
        "sed -n '1w out' f",
        "sed -n '/x/W out' f",
        "sed '1e rm x' f",
        "sed 's/a/b/w out' f",
        "sed 's/a/b/gw out' f",
        "sed 's/a/b/e' f",
        "sed -e p -e 'w out' f",
        "sed --expression='1w out' f",
        "sed 's/[/]/X/w out' f",
        "sed -n '/a/r other' f",
      ],
      /sed script/,
    );
    expectRefused(["uniq in out", "uniq -c in out", "uniq - out"], /uniq/);
    expectRefused(["rg --pre cat foo", "rg --pre=cat foo", "rg --hostname-bin=x foo"], /rg --pre/);
    expectRefused(
      [
        "git grep -O foo",
        "git grep -nOvim foo",
        "git grep --open-files-in-pager foo",
        "git grep --open foo",
      ],
      /git grep -O/,
    );
    expectRefused(
      ["GIT_EXTERNAL_DIFF=rm git diff", "GIT_PAGER=rm git log", "X=1 git log", "PATH=/tmp; cat f"],
      /sets a variable/,
    );
  });

  it("quoting, variables and expansions can't sneak an option or a command past the check", () => {
    expectRefused(['sed "-i" s/a/b/ f', "sed s/a/b/ -i f"], /sed -i/);
    expectRefused(['find . "-delete"', "find . -exe\\c rm {} ;"], /find/);
    expectRefused(
      [
        'echo "$(rm x)"',
        "echo $(rm x)",
        "sort $(echo -o out)",
        'O="-o out"; sort $O f',
        "echo $'\\x2do'",
      ],
      /\$/,
    );
    expectRefused(["echo `rm x`", 'echo "`rm x`"'], /backquotes/);
    expectRefused(["sort {-o,out} f"], /brace expansion/);
    expectRefused(["echo -o out | xargs sort f", "xargs -n1 sort", "xargs rm"], /xargs/);
    expectRefused(
      ["git --exec-path=/tmp diff", "git -c core.pager=rm log", "git -C /tmp log"],
      /before the command/,
    );
    expectRefused(["git log --output=x", "git log --outp=x"], /git --output/);
    expectRefused(
      ["cat f 2>err", "cat f &>out", "cat f >& out", "echo a\\#b > x"],
      /writes output/,
    );
    expectRefused(["cat <> f"], /for writing/);
    expectRefused(["cat <<EOF"], /here-document/);
    expectRefused(["diff <(cat a) b"], /process substitution/);
    // A comment hides nothing: the quote after # doesn't swallow the next line's command.
    expectRefused(["cat f #'\nrm x\n'", "cat f;#x\nrm y"], /rm|quote/);
    expectRefused(
      [
        "awk 'BEGIN{\"rm x\" | getline}'",
        "awk 'BEGIN{system(\"x\")}'",
        "awk '{print > \"out\"}' f",
      ],
      /awk/,
    );
    expectRefused(
      ["awk -f prog.awk f", "printf -v PATH /tmp", "date -s 2020-01-01", "less f", "xxd a b"],
      /./,
    );
  });

  it("the auditor's usual reading commands still run", () => {
    expectAllowed([
      "sed -n '/^## Phase 13/,/^## Stage 2/p' PLAN.md",
      "sed -n '1,5p;10p' f",
      "sed -E 's#(x)#\\1#g' f",
      "sed 's/[[:space:]]*$//' f",
      "sed -n '/x/{p;q}' f",
      "grep -c x f | sort | uniq -c",
      "sort -u f",
      "sort -t, -k2 f",
      "uniq -f 1 f",
      "rg -n --pretty foo src",
      "git grep -n foo",
      "git --no-pager log -3",
      "awk -F: '$3 > 100 {print $1}' f",
      "awk '/a/ || /b/' f",
      "date -Iseconds",
      "cat f # a comment with > and $(x)",
      "git log \\\n | head",
      "timeout 60 git status --short",
      "git show HEAD@{1}",
    ]);
  });
});

describe("the browser tests' reports (check-e2e-report.mjs: audit L62)", () => {
  const check = (report: object) => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-report-"));
    dirs.push(dir);
    const file = join(dir, "r.json");
    writeFileSync(file, JSON.stringify(report));
    return spawnSync("node", [join(REPO, "scripts/check-e2e-report.mjs"), file], {
      encoding: "utf8",
    });
  };
  const report = (...tests: { expectedStatus: string; status: string }[]) => ({
    suites: [
      {
        suites: [
          { specs: tests.map((t, i) => ({ file: "a.spec.ts", title: `t${i}`, tests: [t] })) },
        ],
      },
    ],
    errors: [],
  });
  const ok = { expectedStatus: "passed", status: "expected" };

  it("passes when every browser test ran and passed", () => {
    expect(check(report(ok, ok)).status).toBe(0);
  });

  it("fails on a skipped or fixme test, one marked to fail, a flaky or failed one, or none at all", () => {
    for (const bad of [
      { expectedStatus: "skipped", status: "skipped" },
      { expectedStatus: "failed", status: "expected" },
      { expectedStatus: "passed", status: "flaky" },
      { expectedStatus: "passed", status: "unexpected" },
    ])
      expect(check(report(ok, bad)).status, JSON.stringify(bad)).toBe(1);
    expect(check(report()).status).toBe(1);
    expect(check({ ...report(ok), errors: [{ message: "webServer exited" }] }).status).toBe(1);
  });
});

// A directory of stand-in commands put first on PATH, each a small shell script.
function stubs(scripts: Record<string, string>) {
  const bin = mkdtempSync(join(tmpdir(), "safety-net-bin-"));
  dirs.push(bin);
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return bin;
}

// Settings a verify run inside these tests must not inherit from the verify run around them.
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["RUN_E2E", "VERIFY_E2E", "E2E_JSON_DIR", "E2E_JSON_REPORT"]) delete env[k];
  return Object.assign(env, extra);
}

describe("the project invariants on sample trees (invariants.sh checks 1, 5, 7 and 8)", () => {
  // Written in pieces so this file doesn't trip the very checks it tests.
  const call = (obj: string, fn: string) => `${obj}.${fn}(`;
  const SDK = ["twi", "lio"].join("");

  // A tree that passes every check. drizzle-kit (check 4) is a stand-in reporting no schema
  // changes, and the test results (check 3) are one passing test: these tests are about the
  // others. The test setups are the real ones, with their pins (check 6).
  function sampleTree() {
    const dir = mkdtempSync(join(tmpdir(), "invariants-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "user.name", "Test");
    const files: Record<string, string> = {
      ".gitignore": ".claude/state/\n",
      ".claude/state/vitest.json": JSON.stringify({
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
      }),
      "drizzle/0000_start.sql": "select 1;\n",
      "src/lib/db/scoped.ts": "// select set_config('app.current_firm_id', $1, true)\n",
      "tests/unit/ok.test.ts": 'it("adds", () => expect(1 + 1).toBe(2));\n',
      "tests/setup/env.ts": readFileSync(join(REPO, "tests/setup/env.ts"), "utf8"),
      "playwright.config.ts": readFileSync(join(REPO, "playwright.config.ts"), "utf8"),
      "scripts/invariants.sh": readFileSync(join(REPO, "scripts/invariants.sh"), "utf8"),
    };
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    chmodSync(join(dir, "scripts/invariants.sh"), 0o755);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "start");
    return dir;
  }
  const bin = () => stubs({ npx: 'echo "No schema changes, nothing to migrate"' });
  const run = (dir: string, path?: string, body?: string) => {
    if (path && body !== undefined) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    const r = spawnSync("bash", [join(dir, "scripts/invariants.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: cleanEnv({ PATH: `${bin()}:${process.env.PATH}`, VERIFY_E2E: "false" }),
    });
    return { status: r.status, out: r.stdout };
  };

  it("the sample tree passes every check", () => {
    const r = run(sampleTree());
    expect(r.out).toContain("ok: no .only/.skip/.todo in tests");
    expect(r.out).toContain("ok: only withFirm");
    expect(r.out).toContain("ok: no test imports the Twilio SDK");
    expect(r.out).toContain("ok: no code or test file is git-ignored");
    expect(r.out).not.toContain("FAIL");
    expect(r.status).toBe(0);
  });

  it("refuses a browser test turned off: fixme, marked to fail, or skipped at run time (check 1)", () => {
    for (const body of [
      `${call("test", "fixme")}"later", async () => {});\n`,
      `${call("test", "fail")}"broken", async () => {});\n`,
      `test("x", async ({}, testInfo) => { ${call("testInfo", "skip")}true, "later"); });\n`,
      `test("x", async () => { ${call("test.info()", "fixme")}); });\n`,
      `${call("test", "skip")}"later", async () => {});\n`,
    ]) {
      const r = run(sampleTree(), "tests/e2e/flow.spec.ts", body);
      expect(r.out, body).toContain("FAIL: focused/skipped tests found:");
      expect(r.out, body).toContain("tests/e2e/flow.spec.ts:1:");
      expect(r.status, body).toBe(1);
    }
  });

  it("passes browser tests that only read their test info or group tests (check 1)", () => {
    const r = run(
      sampleTree(),
      "tests/e2e/flow.spec.ts",
      [
        'test.describe("flow", () => {',
        '  test("x", async ({}, testInfo) => {',
        '    testInfo.annotations.push({ type: "note" });',
        '    expect(test.info().title).toBe("x");',
        "  });",
        "});",
      ].join("\n"),
    );
    expect(r.out).toContain("ok: no .only/.skip/.todo in tests");
    expect(r.status).toBe(0);
  });

  it("refuses a new script or app file that sets the firm itself (check 5)", () => {
    const line = "await sql`select set_config('app.current_firm_id', ${id}, true)`;\n";
    for (const path of ["scripts/new-tool.ts", "src/lib/reports/export.ts"]) {
      const r = run(sampleTree(), path, line);
      expect(r.out, path).toContain("FAIL: app.current_firm_id used outside");
      expect(r.out, path).toContain(`${path}:1:`);
      expect(r.status, path).toBe(1);
    }
  });

  it("passes the named owner commands that set the firm (check 5)", () => {
    const line = "await sql`select set_config('app.current_firm_id', ${id}, true)`;\n";
    const r = run(sampleTree(), "scripts/firm-create-owner.ts", line);
    expect(r.out).toContain("ok: only withFirm");
    expect(r.status).toBe(0);
  });

  it("refuses a test that imports the Twilio SDK, however it's written (check 7)", () => {
    for (const body of [
      `import twilio from "${SDK}";\n`,
      `import { validateRequest } from '${SDK}/lib/webhooks/webhooks';\n`,
      `const client = require("${SDK}");\n`,
      `const { default: t } = await import("${SDK}");\n`,
    ]) {
      const r = run(sampleTree(), "tests/unit/sms.test.ts", body);
      expect(r.out, body).toContain("FAIL: a test imports the Twilio SDK:");
      expect(r.out, body).toContain("tests/unit/sms.test.ts:1:");
      expect(r.status, body).toBe(1);
    }
  });

  it("refuses a code or test file that git ignores, so no commit would carry it (check 8)", () => {
    // An ignore rule for key files (secrets/) that also matched a code folder (P5.1).
    for (const path of ["src/lib/secrets/crypto.ts", "tests/unit/secrets/seal.test.ts"]) {
      const dir = sampleTree();
      writeFileSync(join(dir, ".gitignore"), ".claude/state/\nsecrets/\n");
      const r = run(dir, path, "export const x = 1;\n");
      expect(r.out, path).toContain("FAIL: files under src, tests, scripts, drizzle or public");
      expect(r.out, path).toContain(path);
      expect(r.status, path).toBe(1);
    }
    // The same rule leaves the deploy folder's own secrets/ alone.
    const dir = sampleTree();
    writeFileSync(join(dir, ".gitignore"), ".claude/state/\nsecrets/\n");
    const r = run(dir, "deploy/secrets/key.json", "{}\n");
    expect(r.out).toContain("ok: no code or test file is git-ignored");
    expect(r.status).toBe(0);
  });

  it("passes a test that imports the app's own Twilio adapter or only names it (check 7)", () => {
    const r = run(
      sampleTree(),
      "tests/unit/sms.test.ts",
      `import { send } from "../../src/lib/messaging/${SDK}";\nconst name = "${SDK}";\n`,
    );
    expect(r.out).toContain("ok: no test imports the Twilio SDK");
    expect(r.status).toBe(0);
  });
});

describe("verify.sh itself, with stand-in commands in a throwaway repository (audit L4, L61)", () => {
  // npm is a stand-in that logs each call (with the settings that matter) and passes, unless
  // told to fail a step or to change a file in the repository while the tests run.
  const NPM = [
    'step="$1"; [ "$1" = run ] && step="$3"',
    'echo "$step NODE_ENV=${NODE_ENV:-} APP_BASE_DOMAIN=${APP_BASE_DOMAIN:-} E2E_JSON_DIR=${E2E_JSON_DIR:-}" >> "$STUB_LOG"',
    '[ "$step" = test ] && [ -n "${STUB_TOUCH:-}" ] && echo changed >> "$STUB_TOUCH"',
    '[ "$step" = "${STUB_FAIL:-}" ] && exit 1',
    "exit 0",
  ].join("\n");

  function verifyTree(invariants: "ok" | "missing" | "not-executable" = "ok") {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "user.name", "Test");
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, ".claude/hooks"), { recursive: true });
    cpSync(join(REPO, "scripts/verify.sh"), join(dir, "scripts/verify.sh"));
    cpSync(join(HOOKS, "tree-hash.sh"), join(dir, ".claude/hooks/tree-hash.sh"));
    chmodSync(join(dir, "scripts/verify.sh"), 0o755);
    chmodSync(join(dir, ".claude/hooks/tree-hash.sh"), 0o755);
    writeFileSync(join(dir, ".gitignore"), ".claude/state/\n");
    writeFileSync(join(dir, "playwright.config.ts"), "export default {};\n");
    if (invariants !== "missing") {
      writeFileSync(
        join(dir, "scripts/invariants.sh"),
        '#!/usr/bin/env bash\necho "invariants VERIFY_E2E=${VERIFY_E2E:-}" >> "$STUB_LOG"\n',
      );
      chmodSync(join(dir, "scripts/invariants.sh"), invariants === "ok" ? 0o755 : 0o644);
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "start");
    return dir;
  }

  const verify = (dir: string, env: Record<string, string> = {}) => {
    const log = join(mkdtempSync(join(tmpdir(), "verify-log-")), "calls.log");
    dirs.push(join(log, ".."));
    writeFileSync(log, "");
    const r = spawnSync("bash", [join(dir, "scripts/verify.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: cleanEnv({ PATH: `${stubs({ npm: NPM })}:${process.env.PATH}`, STUB_LOG: log, ...env }),
    });
    const stampFile = join(dir, ".claude/state/verified.json");
    return {
      status: r.status,
      out: r.stdout,
      calls: readFileSync(log, "utf8").trim().split("\n"),
      stamp: JSON.parse(readFileSync(stampFile, "utf8")) as {
        ok: boolean;
        tree: string;
        e2e: boolean;
      },
    };
  };
  const treeHash = (dir: string) =>
    spawnSync("bash", [join(dir, ".claude/hooks/tree-hash.sh")], {
      cwd: dir,
      encoding: "utf8",
    }).stdout.trim();

  it("every step passing, browser tests included: VERIFIED, with a stamp for these files", () => {
    const dir = verifyTree();
    const r = verify(dir, { RUN_E2E: "1" });
    expect(r.out).toContain(`VERIFIED tree=${treeHash(dir)} e2e=true`);
    expect(r.stamp).toMatchObject({ ok: true, e2e: true, tree: treeHash(dir) });
    expect(r.status).toBe(0);
    // Every step ran, the browser tests with their reports kept for invariants.sh.
    expect(r.calls.map((c) => c.split(" ")[0])).toEqual([
      "typecheck",
      "lint",
      "build",
      "test",
      "e2e",
      "invariants",
    ]);
    expect(r.calls.find((c) => c.startsWith("e2e"))).toMatch(/ E2E_JSON_DIR=\.claude\/state$/);
    expect(r.calls).toContain("invariants VERIFY_E2E=true");
  });

  it("runs the production build, with the image's placeholder settings, and refuses the stamp if it fails", () => {
    const dir = verifyTree();
    const ok = verify(dir, { RUN_E2E: "1" });
    expect(ok.calls).toContain(
      "build NODE_ENV=production APP_BASE_DOMAIN=build.invalid E2E_JSON_DIR=",
    );
    const failed = verify(dir, { RUN_E2E: "1", STUB_FAIL: "build" });
    expect(failed.out).toContain("== build ... FAILED");
    expect(failed.out).toContain("NOT VERIFIED");
    expect(failed.stamp.ok).toBe(false);
    expect(failed.status).toBe(1);
  });

  it("without RUN_E2E=1 the stamp says the browser tests didn't run", () => {
    const r = verify(verifyTree());
    expect(r.out).toContain("e2e=false");
    expect(r.stamp).toMatchObject({ ok: true, e2e: false });
    expect(r.calls.some((c) => c.startsWith("e2e"))).toBe(false);
    expect(r.calls).toContain("invariants VERIFY_E2E=false");
  });

  it("a file changed while the checks ran: NOT VERIFIED, even though every step passed", () => {
    const dir = verifyTree();
    const r = verify(dir, { RUN_E2E: "1", STUB_TOUCH: join(dir, "notes.txt") });
    expect(r.out).not.toContain("FAILED");
    expect(r.out).toContain("== files changed while the checks ran");
    expect(r.out).toContain("NOT VERIFIED");
    expect(r.stamp.ok).toBe(false);
    expect(r.status).toBe(1);
  });

  it("a missing or non-executable invariants.sh: NOT VERIFIED, never skipped", () => {
    for (const kind of ["missing", "not-executable"] as const) {
      const r = verify(verifyTree(kind), { RUN_E2E: "1" });
      expect(r.out, kind).toContain("== invariants ... FAILED");
      expect(r.out, kind).toContain("scripts/invariants.sh is missing or not executable");
      expect(r.out, kind).toContain("NOT VERIFIED");
      expect(
        r.calls.some((c) => c.startsWith("invariants")),
        kind,
      ).toBe(false);
      expect(r.stamp.ok, kind).toBe(false);
      expect(r.status, kind).toBe(1);
    }
  });
});

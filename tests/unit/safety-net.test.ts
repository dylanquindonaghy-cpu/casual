import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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

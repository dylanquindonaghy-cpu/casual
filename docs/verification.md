# Verification: how "done" is enforced

The problem this solves: an agent reads its own summary, believes it, and reports a pass that
never happened. Or it edits PLAN.md to `[x]` because it *intended* to finish. The fix is not a
smarter prompt. It's making "done" something only a script can say, and making the tick
mechanically impossible without it.

## The three layers

```
 Layer 1: scripts/verify.sh              deterministic. runs typecheck, lint, tests.
          |                              writes .claude/state/verified.json = {ok, tree-hash}
          v
 Layer 2: claims-auditor agent           fresh context, read-only, never sees the builder's
          |                              summary. checks each acceptance claim against code,
          |                              tests and the verify logs. hunts fakes.
          v
 Layer 3: hooks                          guard-plan-tick: no new [x] in PLAN.md unless the
                                         stamp is ok AND matches the current file tree.
                                         stop-unverified-claims: "done"-sounding final messages
                                         are blocked unless the stamp is valid.
```

Only Layer 1 can create a passing stamp, and the stamp is tied to a fingerprint of the working
tree. Change one byte after it passed and the stamp is stale. So the sequence is forced:
verify → audit → tick, in that order, on those exact files.

## Why the auditor is a separate agent

Anthropic's subagent design gives each subagent its own context. The auditor is spawned with
nothing but the task text. It cannot be fooled by the builder's narrative because it never
reads it. It's read-only (`Read, Grep, Glob, Bash`) so it can't "fix" things to make its own
verdict come out right. It runs on Sonnet: capable enough to spot a mocked test, cheap enough
to run on every task.

The same principle covers `guardrails-reviewer` (golden rules) and `doc-fact-checker` (docs).
Reviewers never edit. Builders never grade themselves.

## What the auditor looks for

- Tests that are `.skip`/`.only`, have no assertions, or mock the very thing under test.
- `TODO`, `not implemented`, hard-coded returns on the code path the claim depends on.
- A claim with code but no test (PARTIAL), or a test but incomplete behaviour (PARTIAL).
- Evidence that contradicts the claim (FAKED).

Verdict is DONE only when every claim is PROVEN. Three rounds maximum, then it stops and
reports what's still open. That cap matters: an agent that loops forever "fixing" is the
tangle you're trying to avoid.

## The commands

| Command | What it does |
|---|---|
| `/next-task` | Picks the next task, plans, waits for your OK on risky changes, builds, then hands off to `/close-task`. It never ticks. |
| `/close-task` | verify.sh → claims-auditor → tick. The only path to `[x]`. |
| `/verify` | Runs verify.sh and reports failures only. |
| `./scripts/selftest.sh` (terminal) | Proves the hooks work on this machine: runs them against fake payloads. Run once after setup, and again if hooks ever seem silent. |
| `/fact-check <doc or all>` | One `doc-fact-checker` per file. Fixes objective errors (maths, dead links, cross-doc contradictions); lists factual and wording issues for you. |

## Habits that keep agents untangled

1. **One task per session.** `/clear` after `/close-task`. The next task starts with the docs,
   not with a memory of the last one.
2. **Handoff by files, not chat.** PLAN.md, docs/ and the verify logs are the shared state.
   Agents read those, never each other's messages.
3. **Builders never grade.** If the builder is asked "is it done?", the answer is "run
   /close-task", not an opinion.
4. **Scripts decide, agents interpret.** verify.sh is boring on purpose. It doesn't reason.
5. **Ban the phrases.** "Should work", "I believe this passes", "all tests pass" without a
   pasted VERIFIED line. The stop hook enforces the last one.
6. **Cap the loops.** Three audit rounds, then a human. Never an unbounded fix-and-retry.
7. **Read the auditor, not the builder.** When you come back to a session, the auditor's
   verdict block is the summary you trust.

## Adding project invariants

Put extra checks in `scripts/invariants.sh` (exit non-zero on failure). verify.sh runs it if
present. Good candidates from `docs/testing.md`: every firm-scoped table has RLS enabled; no
`.only` in tests; no secrets in tracked files; phone numbers never appear in logs.

## Cost

verify.sh costs no tokens. The auditor is one Sonnet call per task with a small context
(task text + files it chooses to open). The fact-checker is one Sonnet call per doc. On a
subscription this is a few percent of a session, and it replaces the far more expensive
failure: an evening spent building on top of something that was never actually working.

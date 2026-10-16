# Verification: how "done" is enforced

The problem this solves: an agent reads its own summary, believes it, and reports a pass that
never happened. Or it edits PLAN.md to `[x]` because it *intended* to finish. The fix is not a
smarter prompt. It's making "done" something only a script can say, and making the tick
mechanically impossible without it.

## The three layers

```
 Layer 1: scripts/verify.sh              deterministic. runs typecheck, lint, a production
          |                              build, tests, the browser tests (RUN_E2E=1) and the
          |                              invariants. writes .claude/state/verified.json =
          |                              {ok, tree-hash, e2e}, the fingerprint taken at the start.
          v
 Layer 2: claims-auditor agent           fresh context, read-only (a hook), never sees the
          |                              builder's summary. checks each acceptance claim against
          |                              code, tests and the verify logs. hunts fakes.
          v
 Layer 3: hooks                          guard-plan-tick: no tick in PLAN.md by Edit or Write
                                         unless the stamp is ok, has e2e, and matches the files.
                                         plan-bash-snapshot/-check: the same for shell commands.
                                         stop-unverified-claims: "done"-sounding final messages
                                         are blocked unless the stamp is valid.
                                         readonly-agents: the reviewers and the auditor can't
                                         change anything.
```

What the stamp covers: typecheck, lint, a **production build** (`next build` with the same
placeholder settings as the Dockerfile), the unit and integration tests and the safety checks
always; with `RUN_E2E=1` (`"e2e": true` in the stamp) also the browser tests, including the
walkthrough run against a production build (`playwright.walkthrough.config.ts`). **A tick needs
`"e2e": true`**: the tick guards and the Stop hook refuse a stamp without the browser tests, and
`/close-task` runs `RUN_E2E=1 ./scripts/verify.sh`. A plain `./scripts/verify.sh` is a quicker
check while you work.

Only Layer 1 can create a passing stamp, and the stamp is tied to a fingerprint of the working
tree, **taken when the run starts**: if any file changes while the checks run, there is no stamp
(the results couldn't be tied to one set of files). Change one byte after it passed and the stamp
is stale. So the sequence is forced: verify → audit → tick, in that order, on those exact files.

What the hooks catch (Phase 13 task 13.1, closing the audit's L1 to L6, L61, L62 and L65):

- **A tick is any task newly ticked**: a box from `[ ]` to `[x]` or `[X]`, a tick moved from one
  task to another, or a line added already ticked (`.claude/hooks/plan-ticks.mjs`). Rewording a
  task that's already ticked isn't a tick.
- **Edit and Write** are refused before they run (`guard-plan-tick.sh`).
- **Shell commands** can't be read in advance, so they're checked after: a copy of PLAN.md is
  kept before each one (`plan-bash-snapshot.sh`) and compared after it (`plan-bash-check.sh`). A
  tick without a valid stamp is reported, and `git commit` and `git push` are refused until it's
  unticked or verified. Nothing is rewritten for you, so a stash, merge or reset can't lose work.
  Ticks that arrive with commits already on a remote branch (a pull, a merge of `main`) pass:
  they were verified where they were made.
- **The Stop hook** catches the short ways of saying it too ("Phase 0 is done.", "All 2665 tests
  pass."), lets through a message that says plainly what isn't verified, and blocks a repeated
  claim again on the next stop, at most 3 times in a row.
- **The invariants** (`scripts/invariants.sh`, never skipped) refuse Playwright's `fixme`, `fail`
  and run-time skips, both in the code and in the browser tests' own JSON reports
  (`scripts/check-e2e-report.mjs`, which Playwright doesn't count as failures); they check
  `scripts/` as well as `src/` for anything setting the firm outside `withFirm()` (the owner-run
  admin commands are named one by one); and no test imports the Twilio SDK.

## Why the auditor is a separate agent

Anthropic's subagent design gives each subagent its own context. The auditor is spawned with
nothing but the task text. It cannot be fooled by the builder's narrative because it never
reads it. It's read-only so it can't "fix" things to make its own verdict come out right: its
tools are `Read, Grep, Glob, Bash`, and a hook (`.claude/hooks/readonly-agents.mjs`) refuses any
edit and any shell command that writes or runs the project. Reading, searching and git's reading
commands (`git diff`, `git log`) still work. It runs on Sonnet: capable enough to spot a mocked test, cheap enough
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
| `./scripts/selftest.sh` (terminal) | Proves the hooks work on this machine: runs them against fake payloads. Run once after setup, and again if hooks ever seem silent. (`tests/unit/safety-net.test.ts` runs every hook in a throwaway repository on each verify.) |
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

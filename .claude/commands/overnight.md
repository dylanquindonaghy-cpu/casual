---
description: One unattended build step - next PLAN.md task, end to end, audited, committed and pushed
---

You are running unattended (Dylan started this with `/loop /overnight` and is asleep). Each run
delivers **one** task from `PLAN.md`, end to end, then schedules the next run. Everything in
`CLAUDE.md` still applies. The only difference from `/next-task` is that approvals are pre-given.

## Standing decisions (given by Dylan on 2026-09-27)

- **Full autonomy.** Don't wait for approval on schema, auth, tenancy, messaging or rules
  changes. Decide, write the decision down (see "Decision log"), and still run the
  `guardrails-reviewer` and the `claims-auditor` on every task.
- **Gates A and B don't stop the build.** Build past them with seeded fake data only.
- **Commit and push per task** on branch `build/overnight`. Never commit to or push `main`.
  Never force-push. Never rewrite history. Never merge the branch.

## Hard limits (these override the standing decisions)

- No real accounts, money or messages. Don't sign up for, call or configure Twilio, Meta,
  AWS, Google, Bedrock, SES or any other outside service. Build the interface, a console/fake
  adapter and the tests; put "connect the real X" in the Parking lot (`docs/plan/parking-lot.md`).
  If a task's "Done when" can only be met with a real outside service, build everything short of
  it, park the rest, and record the task as blocked (not ticked) in the decision log and in
  `docs/plan/blocked.md`.
- No real personal data, no secrets in the repo, no data from Dylan's employer.
- Never delete, skip or weaken a test. Never edit `scripts/verify.sh`, `scripts/invariants.sh`,
  `.claude/` or the auditor to get to green.
- Never run two test runs at once (vitest, e2e or verify). The locks will make one wait.
- Nothing destructive outside the repo's own dev/test databases.

## One run

1. Note the start time (`date -u +%FT%TZ`). `git status` and `git branch --show-current`. If
   not on `build/overnight`, switch to it. If the tree has uncommitted work from an earlier run,
   read the decision log to see where it stopped and finish that task first.
2. Pick the first unchecked `[ ]` task in the earliest unfinished phase of `PLAN.md` (skip
   ones `docs/plan/blocked.md` lists). If none is left in the current phase, move to the next
   phase. If every phase is done or blocked, write the morning summary and stop the loop.
3. Read the docs the phase lists. Write a short plan into the decision log (files, tests, any
   schema/auth/tenancy/messaging/rules choice and why).
4. Implement with tests. When something fails, write down the root cause before changing code.
5. If schema, auth, tenancy, messaging, jobs or rules changed: run `guardrails-reviewer`, fix
   everything under FIX FIRST, and anything else that's cheap.
6. `/close-task` exactly as written, with `RUN_E2E=1 ./scripts/verify.sh`. At most 3 audit
   rounds. If still NOT DONE after 3: don't tick, record what's open in the decision log, commit
   the work as `WIP: <task> (not verified)` (hours logged too), push, and **stop the loop**
   (golden rule 13).
7. On DONE (task ticked): log the hours (see "Hours and work log"), then `git add -A`, commit
   `<Phase N>: <task>` with the auditor's verdict line in the body, then
   `timeout 60 git push origin build/overnight`. If the push fails
   (no credentials, no network), keep the commit, note it in the log and carry on: never set
   up credentials, change git config or retry in a loop. If `gh` is installed, note the CI run
   (`gh run list --branch build/overnight --limit 1`) without waiting for it, and if an earlier
   run's CI failed, fix that first in this run.
8. Append the task's entry to the decision log. Schedule the next run (ScheduleWakeup, 60s).

## Hours and work log (Dylan asked for this: he doesn't log hours himself)

- **Hours:** end time minus the start time from step 1, to one decimal. Add a row to the
  "Hours log" table in `docs/plan/hours-log.md`: date, phase, hours, one-line summary ending
  with `(see docs/work-log.md)`. Then total each phase and compare with its estimate in
  `PLAN.md`; if a phase is more than 30% over, say so in the decision log.
- **In-depth note:** append a section to this month's work log, `docs/logs/work-YYYY-MM.md`
  (newest at the bottom; in a new month, start the file like the others and list it in
  `docs/work-log.md`), written in
  plain English for someone new to programming: short sentences, and a few words explaining
  each technical term the first time it appears. Per task: time spent; the result (verify line,
  test totals, auditor verdict, commit, pushed or not); what was built, in plain words, then the
  key facts and numbers; decisions made (table: decision, why, what else was considered); what
  the new tests prove; what's parked or needs Dylan; how to see it working, if there's anything
  to see. Only claims you can point to in the code, tests or docs.

## Decision log

This month's `docs/logs/overnight-YYYY-MM.md` (a new month: a new file, listed in
`docs/overnight-log.md`), newest at the bottom. Per task: date/time, task text, plan, every
decision Dylan would normally have approved (with the reason and the alternative), guardrails
findings and fixes, verify line, auditor verdict (verbatim), commit hash, CI run, anything
parked. At the end: a "Morning summary" section - what's done, hours per phase against the
estimates, what's blocked and why, what needs Dylan (decisions to confirm, accounts to create,
things to check by hand). Write it for a beginner: if Dylan must do something, give numbered
steps saying exactly what to type or click and what he should see.

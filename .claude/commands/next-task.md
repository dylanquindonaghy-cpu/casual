---
description: Pick up the next unchecked task in PLAN.md and deliver it end to end
argument-hint: "[optional: phase number or task text]"
---

1. Read `CLAUDE.md` and `PLAN.md`. If $ARGUMENTS is given, use that phase or task; otherwise
   take the first unchecked `[ ]` task in the earliest unfinished phase.
2. Check the gates in `PLAN.md`. If the task is beyond Phase 3 and Gate A isn't marked passed,
   stop and remind me to do the discovery calls first.
3. Read only the docs the task needs (the phase lists them).
4. Reply with a short plan: files to create/change, tests to write, any schema/auth/tenancy
   impact. **Wait for my OK** before writing code if it touches schema, auth, tenancy,
   messaging or the rules engine.
5. Implement with tests. Follow the golden rules in `CLAUDE.md`.
6. If the change touched schema, auth, tenancy, messaging or rules, run the
   `guardrails-reviewer` agent and fix anything it flags.
7. Run `/close-task` for this task. It runs verify, then an independent audit, and only then
   ticks the task. Never tick a task yourself; the guard hook will block it anyway.
8. Put anything deferred in the Parking lot. Summarise: what changed, what the auditor
   verified, and the next task.

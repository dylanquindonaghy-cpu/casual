---
description: Close the current task the safe way — verify, independent audit, then tick
argument-hint: "[task text or phase]"
---

This is the ONLY way a task gets ticked. Follow it exactly. Do not skip steps or paraphrase
results.

1. Run `RUN_E2E=1 ./scripts/verify.sh` (with the browser tests: the tick guard refuses a stamp
   without them). Paste the summary lines it prints (the `==` lines and the final
   VERIFIED / NOT VERIFIED line). If NOT VERIFIED: fix the root cause, re-run, and repeat.
   Never delete, skip or weaken a test to get to green.
2. Run the `claims-auditor` agent. Give it ONLY: the exact task text from `PLAN.md` ($ARGUMENTS
   if provided, else the task you are working on) and the phase's "Done when" line. Do not
   give it your own summary of the work.
3. Paste the auditor's verdict block verbatim.
4. If the verdict is NOT DONE: address each item in "To reach DONE", then go back to step 1.
   Maximum 3 rounds; after that stop and report what is still open.
5. If the verdict is DONE: tick the task in `PLAN.md` (the guard hook will allow it only if the
   stamp matches the current files).
6. Finish with: what changed (files), what the auditor verified, and anything it listed as
   unverifiable that I must check by hand.

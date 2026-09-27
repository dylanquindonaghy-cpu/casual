---
description: Fact-check and proofread a doc against the codebase and other docs
argument-hint: "<path to a doc, or 'all'>"
---

For $ARGUMENTS (a single file, or every file in `docs/` plus `PLAN.md` and `CLAUDE.md` if
"all"), run the `doc-fact-checker` agent on each file, one agent per file, in parallel where
possible. Give each agent only the file path.

Collect the findings blocks verbatim. Then:
1. Fix every [MATH], [DEAD-LINK] and [XREF] problem in the docs directly (these are objective).
2. For [FACT] problems, fix them if the correct value is on disk; otherwise list them for me.
3. For [WORDING], propose the edits and wait for my OK.
4. Re-run the fact-checker on any file you changed. Stop when it reports 0 objective problems.
Report: files checked, problems found, problems fixed, problems left for me.

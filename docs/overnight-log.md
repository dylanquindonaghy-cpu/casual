# Overnight build log

Written by the unattended `/overnight` loop (see `.claude/commands/overnight.md`). One entry per
task, newest at the bottom. Every decision that would normally wait for Dylan's OK is recorded
here with its reason, so it can be confirmed or reversed in the morning.

Standing instructions (Dylan, 2026-09-27): full autonomy on schema/auth/tenancy/messaging/rules
decisions (still reviewed by `guardrails-reviewer` and audited by `claims-auditor`); Gates A and B
don't stop the build; commit and push per task on `build/overnight`.

**By month, since 2026-10-29 (P1.3):** the sections are in `docs/logs/`, one file a month, newest at
the bottom of each. Add each new section to the current month's file; in a new month, start a new
file like the others and list it here. Line numbers that older docs give for this file are its own
as it was before the cut.

- [September 2026](logs/overnight-2026-09.md)
- [October 2026](logs/overnight-2026-10.md)

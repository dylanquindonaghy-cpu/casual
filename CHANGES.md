# Changes

## v4 — 27 September 2026

**Operating guide and self-test**
- `START-HERE.md`: the step-by-step guide for the founder. One-off setup (WSL2 on Windows),
  the per-session loop, the three prompt checks, a table of phrases that cause fake progress and
  what to type instead, what to do when things go wrong, usage habits, which skills and plugins
  to add (and which to avoid), the first week day by day, and ten rules on a card.
- `scripts/selftest.sh`: proves the safety net works on this machine before anything is built.
  Checks tools, git, executable bits, `settings.json`, and runs the tick guard and stop hook
  against fake payloads (deny without stamp, allow normal edit, deny stale stamp, allow valid
  stamp, block false "done", allow honest message). Backs up and restores any real stamp.
- `CLAUDE.md` "How to work each task" step 3: state the root cause before changing code; never
  patch the symptom; never delete, skip or weaken a test.
- `PLAN.md` Phase 0 and Phase 1 kickoff prompts now hand off to `/close-task` instead of
  "tick the tasks".
- `README.md` points to `START-HERE.md` and the self-test.

## v3 — 27 September 2026

**Verification layer (see `docs/verification.md`)**
- `scripts/verify.sh`: single definition of "done". Runs typecheck, lint, tests (and
  `scripts/invariants.sh` if present), writes `.claude/state/verified.json` with a fingerprint of
  the working tree. Only a full pass produces `ok: true`.
- Hooks (`.claude/settings.json`):
  - `guard-plan-tick.sh` (PreToolUse on Edit/Write/MultiEdit): blocks any new `[x]` in PLAN.md
    unless the stamp passed on the current files.
  - `stop-unverified-claims.sh` (Stop): blocks "done / complete / all tests pass" final messages
    without a valid stamp.
  - `filter-test-output.sh` (PreToolUse on Bash): failures-only test output, saves context.
  - All four hooks tested against real hook payloads (deny, allow, stale, failing, block, pass).
- Agents: `claims-auditor` (independent, read-only, evidence-only, hunts fake tests) and
  `doc-fact-checker` (proofreads and fact-checks docs against the repo and each other).
- Commands: `/close-task` (verify → audit → tick, max 3 rounds) and `/fact-check <doc|all>`.
  `/next-task` no longer ticks; `/verify` runs the script.
- `CLAUDE.md` rule 13: only the script says done; builders never grade their own work.
- `.gitignore` now excludes `.claude/state/`, `.env*` (except `.env.example`), `node_modules/`.
- Requires `jq` on the machine running Claude Code.

## v2 — 25 September 2026

**New docs**
- `docs/screens.md` — every staff and office screen, routes, empty/error states, copy rules.
- `docs/api-and-jobs.md` — all webhooks and server actions, the background job catalogue with
  payloads, schedules and retries, the offer-wave ranking algorithm, firm-initiated change logging.
- `docs/rules-and-credentials.md` — the eligibility engine as pure functions, checks in order with
  worker-facing reasons, credential packs per sector (SIA, PTS, Sentinel, D&A, CSCS, DBS...),
  the SIA "applied" allowance, expiry warnings, and a full table of test cases.
- `docs/messaging-templates.md` — the notification policy (push → WhatsApp → SMS, quiet hours,
  daily caps, opt-outs) and the complete template catalogue with exact copy.
- `docs/testing.md` — test layers, the named must-have tests, the demo seed (two fake firms) and
  the pre-pilot checklist.
- `docs/runbooks.md` — deploy, rollback, restore, event-morning outage, WhatsApp, Sheets, domains,
  GDPR requests, offboarding.
- `docs/pilot-playbook.md` — baseline capture, weekly rhythm, metric definitions, report template,
  conversion and referral.

**Plan changes (`PLAN.md`)**
- Firm-initiated cancel/move/curtail added as compliance-critical (Phase 5, P0).
- Credential expiry scan and block added (Phase 2, P0).
- Availability, shift reminders (24 h / 2 h), offline "My shifts", "Add to home screen" prompt,
  blocked-shift reasons with "ask the office to review" (Phases 3–4, P1).
- GDPR export/delete, retention purge, alerts, and a rehearsed runbook (Phase 8).
- STOP/opt-out handling and signature contract tests (Phase 7).
- Baseline week and week-4 report added to Phase 9.
- Named tests per phase so `/verify` and the reviewer can find them.
- Estimates now ~200–290 hours (17–21 weeks). Cut order if time runs short: call-to-text →
  payroll digest → fair rotation → offline My shifts. Never cut tenancy, rules, event log, notice report.
- Stage 2 adds a reference-period hours report (guaranteed-hours rules) and translations.

**Spec changes (`docs/product-spec.md`)**
- P0-14 firm-initiated changes, P0-15 credential expiry handling.
- P1-7 availability, P1-8 reminders, P1-9 offline My shifts, P1-10 GDPR export/delete.

**Project memory (`CLAUDE.md`)**
- Two new rules: copy is product (plain-English, confirmation after every action); firm-initiated
  changes are logged like worker ones.
- Docs index updated.

## v1 — 25 September 2026
Initial pack: CLAUDE.md, PLAN.md, product spec, architecture, data model, decisions, business case,
go-to-market, compliance, commands and reviewer agent.

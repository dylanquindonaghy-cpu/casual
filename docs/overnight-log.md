# Overnight build log

Written by the unattended `/overnight` loop (see `.claude/commands/overnight.md`). One entry per
task, newest at the bottom. Every decision that would normally wait for Dylan's OK is recorded
here with its reason, so it can be confirmed or reversed in the morning.

Standing instructions (Dylan, 2026-09-27): full autonomy on schema/auth/tenancy/messaging/rules
decisions (still reviewed by `guardrails-reviewer` and audited by `claims-auditor`); Gates A and B
don't stop the build; commit and push per task on `build/overnight`.

## 2026-09-27: Phase 1 closed (before the loop started)

- Task: "Tests: `rls.every-table`, `tenancy.isolation`, expired/used links rejected, events written"
- Added after the guardrails review: office link expiry (1 ms before and exactly at 15 min),
  reuse and disabled-user tests; 10-way races for office and worker login, each with a
  read-then-write control; a full-row event contract for every `auth.*` action and all 7 rate
  limits (`tests/integration/auth.events.test.ts`); tests for `recordEvent`'s personal-data guard
  (`tests/integration/events.record.test.ts`); effective-privilege, PUBLIC-grant, view, function
  and sequence checks in `rls.every-table`; tests now pick their events by event id, not by
  clock; test runs and e2e runs take an advisory lock so two runs can't drop each other's
  database.
- verify.sh: `VERIFIED tree=7c0303e01c7dc68b e2e=true` (31 files, 595 tests)
- claims-auditor: `VERDICT: DONE`
- Commit: `cef6425 Phase 1: tenancy, data model, login` on `build/overnight`
- Push: first attempt **failed** (`could not read Username`): git's credential helper path had an
  unescaped space in "Program Files". Fixed on 2026-09-28 (the helper path is now escaped) and
  `build/overnight` pushed to GitHub. Pushes from WSL now work through the Windows credential
  manager.
- Hours: Phase 1 took 4.5 h (0.6 h proposal, 3.9 h build); logged in `PLAN.md` with the in-depth
  note in `docs/work-log.md`. From now on each task logs its own hours the same way.
- Decision: after 3 failed audit rounds on a task, the loop stops (golden rule 13) rather than
  skipping to the next task. Tasks it can't finish without a real outside service are recorded
  as blocked and skipped, not stopped on.

## 2026-09-28 16:37 UTC: Phase 2, "Schema: shifts, assignments, requests, offers, credential_rules (per sector/role)"

**Plan.** New `src/lib/db/schema/roster.ts` with the five tables, exported from the schema index;
`npm run db:generate` writes migration `0004`; `TABLE_ACCESS` entries; isolation fixtures for each
table and each new composite foreign key (`tests/helpers/tenant-rows.ts`), so `rls.every-table`,
`tenancy.isolation` and `rls.mutation` cover the new tables automatically; a new
`tests/integration/roster.schema.test.ts` for the constraints, run as the app role; docs
(`docs/data-model.md`) updated to match what is built.

**Decisions (would normally wait for Dylan's OK):**

| Decision | Why | Alternative considered |
|---|---|---|
| Every link between the new tables is a composite `(firm_id, x_id)` foreign key (shift→site, assignment→shift/worker, request→worker/shift/office user, offer→shift/worker) | Postgres checks foreign keys without RLS, so a plain key would let Firm A point at Firm B's rows (CLAUDE.md convention) | Plain keys as in the old DDL sketch: unsafe |
| The app may SELECT, INSERT and UPDATE `shifts`, `assignments`, `requests` and `offers`, but not DELETE them | These rows are the evidence behind the notice report (golden rules 5 and 12). Shifts are cancelled, assignments are cancelled, never removed | Full CRUD like the Phase 1 tables: simpler, but lets a bug erase evidence |
| `credential_rules` gets full CRUD | The office will edit which credentials a role needs (changes logged as events) | Read-only: blocks a Phase 5 settings screen |
| Foreign keys from the new tables have no ON DELETE action (a delete of a referenced worker, site or shift fails) | Deleting a worker must never silently delete or orphan their assignment history. Phase 8's GDPR delete will need an explicit anonymise-or-purge step (parked) | CASCADE (loses evidence) or SET NULL (a filled slot would look open) |
| One assignment row per slot *per holder*: a partial unique index allows only one "live" row per `(shift_id, slot)` (live = not cancelled). A cancellation keeps its row (with reason and notice hours) and a new open row reopens the slot | Keeps who cancelled and their notice hours on the row, and "first yes wins" still works: `UPDATE ... WHERE id = $slot AND worker_id IS NULL` | `unique (shift_id, slot)` from the old sketch: reopening a slot would mean wiping the cancelled worker off the row |
| A second partial unique index: one worker can't hold two live slots on the same shift | Stops a double-assign of the same person (golden rule 4) at the database level | Leave it to code only |
| CHECK constraints: open slot ⇔ no worker; confirmed/no-show/completed need `confirmed_at`; a cancelled row must have `cancelled_at`, a non-blank reason and `notice_hours` | Golden rule 12 (reason and notice hours per worker) enforced by the database, not just by code | Code-only checks |
| `notice_hours` is `numeric(8,2)` and may be negative (a cancel after the start) | Hours to two decimals is enough for the report; a late cancel must still be recorded | `integer` hours: too coarse for a 48 h threshold |
| `credential_rules` has a `sector` column (one of the four sectors), `role`, `required_types text[]`, unique per `(firm_id, role)` | "Per sector/role": a firm working in two sectors (rail and civils) keeps each pack's rules labelled; the rules engine looks up by role | Take the sector from `firms.sector`: breaks for multi-sector firms |
| `required_types` must be credential type codes (`^[A-Z][A-Z0-9_]*$`, no nulls); roles in `shifts` and `credential_rules` must be `snake_case` | A typo (`sia_ds`, `Door Supervisor`) would silently never match and could let the rules skip a check | No format checks |
| `shifts` has `unique (firm_id, source, external_ref)` | The Sheets and CSV sync can upsert a sheet row without creating duplicates | Match on times and site: fragile |
| Offers are unique per `(shift_id, worker_id, wave)` | Makes the `offer-wave` job safe to retry (its idempotency key is `shift:wave`) while still allowing a later wave after a new dropout | Unique per `(shift_id, worker_id)`: blocks re-offering after a refill |
| Requests: `time_change` and `swap` must name a shift; `approved`/`declined` must have `resolved_at` and `resolved_by`; `open`/`escalated` must have neither | Every office decision is attributable | Code-only |
| The isolation test's "can't update or delete" check is split into one update check and one delete check, each keyed on its own privilege | Tables with UPDATE but no DELETE (the new ones) need it. Nothing is weakened: each old assertion still runs | Give the new tables DELETE just to fit the old test |
| `credential_types` (mentioned in `docs/rules-and-credentials.md`) is not in this task | Belongs to the "Credential packs seeded" task; decided there | Build it now |

**Built.** `src/lib/db/schema/roster.ts` (5 tables, 23 CHECK constraints, 8 composite foreign keys,
5 unique keys beyond the `(firm_id, id)` ones), migration
`drizzle/0004_phase2_roster.sql`, `TABLE_ACCESS` entries, fixtures in `tests/helpers/tenant-rows.ts`
(the rota rows point at a second "rota" worker and site, because their foreign keys have no ON
DELETE action and the isolation tests delete the first ones, rolled back), and
`tests/integration/roster.schema.test.ts` (39 tests). Local dev database rebuilt with
`npm run db:reset` (0004 was regenerated after the review).

**Guardrails review** (`guardrails-reviewer`): verdict FIX FIRST, one item. All fixed except where
noted:

- FIX FIRST F1: three unique keys (`assignments_one_live_per_slot`,
  `assignments_one_live_per_worker`, the offers wave key) didn't start with `firm_id`. Postgres
  checks unique indexes before foreign keys, so Firm A pointing a row at Firm B's shift got a
  duplicate-key error (slot filled) instead of a foreign-key error: a one-bit leak between firms.
  **Fixed**: `firm_id` leads all three (the offers key is now
  `offers_firm_id_shift_id_worker_id_wave_key`). New tests: each probe from another firm gets only
  `23503` (foreign key), next to a control in the owning firm that gets `23505`. New catalogue test
  in `rls.every-table`: every unique index on a firm table starts with `firm_id`, except the four
  random-token ones. It flagged the same pattern in Phase 1's `otp_codes_one_live_per_session`,
  also **fixed** (now `(firm_id, session_id)`) in the same migration.
- SHOULD FIX S1 (a missing credential rule could skip the licence check): **fixed in the docs**:
  `docs/rules-and-credentials.md` now says no rule for the role means not eligible (fail closed),
  with two new rows in the test table for the rules-engine task. A foreign key
  shifts→credential_rules was rejected: it would make a Sheets import fail on any new role.
- SHOULD FIX S2 (the first-yes-wins statement didn't check the shift is open): **fixed**: the
  documented statement (roster.ts comment, data-model.md) now joins `shifts` and requires
  `status = 'open'`; tested for draft, filled and cancelled. Parked: race-safe `offered → confirmed`
  and retiring open slots of a cancelled shift.
- NOTE, comma inside one type code (`{"SIA_DS,SIA_SG"}`) passed the check: **fixed** (cardinality
  comparison) and tested. Other notes (any-of credentials, `notice_hours` computed by the app,
  derived `filled` status, logging rule edits, one pack per role name) are documented or parked.
  The old "offered → accepted" wording in data-model.md is corrected.

**Verify, round 1:** NOT VERIFIED, 1 of 733 tests failed: `tenancy.current-firm` expected exactly
1 worker in a test firm. Root cause: the fixture now gives every test firm a second (rota) worker,
so the firm really has 2; the test hardcoded the old fixture's count. Fix: compare with the
superuser's count of that firm's workers and require the all-firms total to be higher (still
proves RLS filters, no longer tied to the fixture size).

**Verify, round 2:** `VERIFIED tree=75c75b23ec0d408d e2e=true` (733 tests, 10 e2e).

**claims-auditor (round 1), verbatim:**

```
VERDICT: DONE (for the specific task audited: "Schema: shifts, assignments, requests, offers, credential_rules (per sector/role)")

Step 1 check: `.claude/state/verified.json` = `{"ok":true,"tree":"75c75b23ec0d408d","e2e":true,"at":"2026-09-28T17:00:18Z"}`. `./.claude/hooks/tree-hash.sh` = `75c75b23ec0d408d` — matches. Proceeding.

Claims:
- `shifts` table (status, source, role, headcount, dedupe by external_ref per source, site FK, firm isolation) — PROVEN — code: /home/dylan/shiftdesk-starter/src/lib/db/schema/roster.ts:101-138; migration: /home/dylan/shiftdesk-starter/drizzle/0004_phase2_roster.sql; tests: tests/integration/roster.schema.test.ts:67-156 (`describe("shifts")`, 6 tests), all passing per .claude/state/test.log:284-290.
- `assignments` table (one row per slot, first-yes-wins conditional UPDATE, cancel evidence, one-live-per-slot/worker) — PROVEN — code: roster.ts:147-215; tests: roster.schema.test.ts:158-346 (9 tests incl. "first yes wins: the conditional update fills an open slot once, and a second taker changes nothing"), passing per test.log:291-298.
- `requests` table (time_change/swap/availability/general, resolution evidence) — PROVEN — code: roster.ts:219-275; tests: roster.schema.test.ts:348-450 (3 tests), passing per test.log:299-301.
- `offers` table (wave/channel, one-per-worker-per-wave, response timing) — PROVEN — code: roster.ts:278-324; tests: roster.schema.test.ts:452-510 (3 tests), passing per test.log:302-304.
- `credential_rules` per sector/role — PROVEN — code: roster.ts:63-99 (sector enum check, role format check, required_types array-format check, one rule per firm+role); tests: roster.schema.test.ts:512-575 (3 tests), passing per test.log:305-307.
- Tenant isolation / RLS wiring for all 5 new tables — PROVEN — src/lib/db/admin/access.ts:31-35 (`credential_rules: CRUD`, others `NO_DELETE`); tests/helpers/tenant-rows.ts:9-24 (`EXPECTED_TABLES` includes all 5); table-driven tests/integration/rls.every-table.test.ts pass for each (e.g. test.log lines for "table assignments/credential_rules/offers ... has row level security enabled and forced / exactly the tenant policy / grants exactly TABLE_ACCESS"). Cross-firm leak-proofing for unique keys explicitly tested: roster.schema.test.ts:581-623 ("unique keys never reveal another firm's rows").
- Full test run: 733/733 tests passed, 32/32 files, per .claude/state/test.log tail ("Test Files 32 passed (32)", "Tests 733 passed (733)").

Fakes found: none. No `.only`/`.skip`/`xdescribe` in roster.schema.test.ts (grep confirmed empty). No TODO/not-implemented in roster.ts. Constraints are exercised both as refusals (check/duplicate/foreign-key error codes) and as accepted controls, not just happy-path assertions.

Scope note (not a defect in this task, but relevant to the phase-level "Done when" given): this task is only the first bullet of Phase 2. The phase's own "Done when" line ("rules tests pass; a seeded Sheet syncs both ways; double-assign impossible under a race test") is NOT yet satisfied by what's on disk:
- No `RosterPlug` interface or adapters exist (`grep -rl RosterPlug src/` → no matches).
- No `rules.table.test.ts`, `assign.race.test.ts`, or `sheets.sync.test.ts` exist (docs/testing.md:29,31,36 name these; none found under tests/).
- The only "race"-flavoured coverage is a sequential double-take check inside roster.schema.test.ts:322-345, not the concurrent 10-caller race test docs/testing.md:29 specifies.
All of PLAN.md's Phase 2 checkboxes (lines 105-119) remain unticked `[ ]`, consistent with this.

To reach DONE for this schema task: nothing — it is proven by code and passing tests.
To reach DONE for the whole Phase 2 (if that's what's ultimately being closed): 1) build the `RosterPlug` interface + native/Sheets/CSV adapters, 2) build the rules engine and seed credential packs, 3) write and pass `rules.table.test.ts`, `assign.race.test.ts` (concurrent), `sheets.sync.test.ts`.
```

(The auditor's scope note matches the plan: the phase's "Done when" is met by later Phase 2 tasks.)

**Ticked** in `PLAN.md` after the DONE verdict. **Parked** (in `PLAN.md`): GDPR worker delete
vs. rota foreign keys; a retention-purge path; retiring open slots when a shift is cancelled or
shrunk; race-safe `offered → confirmed` and one pure `notice_hours` function; the derived `filled`
status; logging credential-rule edits; any-of credentials; zod check of `workers.roles` spelling;
the office_users DELETE grant (now unblocked).

**Hours:** 0.5 h (16:37 to 17:04 UTC). Phase 2 so far: 0.5 h of the 30-40 h estimate.

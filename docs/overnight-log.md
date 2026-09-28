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

**Commit:** `5cdc003 Phase 2: Schema: shifts, assignments, requests, offers, credential_rules (per
sector/role)` on `build/overnight`. **Push:** succeeded (`b957b94..5cdc003`). **CI:** not checked
(`gh` isn't installed here); see the Actions tab on GitHub for the `build/overnight` run.

## 2026-09-28 17:07 UTC: Phase 2, "`RosterPlug` interface: `listStaff`, `getShifts`, `assign`, `markCancelled`, `canWrite`"

**Plan.** `src/lib/roster/plug.ts`: the `RosterPlug` interface, the shapes it returns
(`RosterStaff`, `RosterShift`), zod schemas every adapter uses to check data from its source at the
boundary, and result types for `assign` and `markCancelled`. `src/lib/roster/notice.ts`: one pure
`noticeHours()` function. A shared **contract suite** (`tests/helpers/roster-contract.ts`): named
checks every adapter must pass (native, Sheets and CSV run it in their own tasks), against a fixed
scenario each adapter seeds into its own source. It runs now against an in-memory reference
adapter (`tests/helpers/memory-roster-plug.ts`, a test double), plus "the contract can fail"
checks with deliberately broken variants (like `rls.mutation`). Unit tests for the schemas and
`noticeHours()`. `docs/architecture.md` updated.

**Decisions (would normally wait for Dylan's OK):**

| Decision | Why | Alternative considered |
|---|---|---|
| Reads return records keyed by `ref`, the source's own key (our worker/shift id for native, the sheet or CSV row key otherwise); writes take our ids (`assign(shiftId, workerId)`, as in architecture.md) | The sync job upserts by `(source, external_ref)`; the portal only knows our ids. Each adapter maps between them | Refs everywhere (the portal would need to know sheet keys) or ids everywhere (a sheet row has no id until synced) |
| `markCancelled(shiftId, workerId, { reason, by: "worker" \| "firm" })` | Golden rule 12: a firm cancel is logged like a worker cancel, and the database needs `cancelled_worker` vs `cancelled_firm`. A blank reason is refused | `reason` only (can't tell who cancelled) |
| Results are tagged unions: assign → `assigned` / `filled` / `already_assigned` / `not_open` / `not_found` / `needs_approval`; cancel → `cancelled` (with `noticeHours`) / `not_assigned` / `not_found` / `needs_approval` | Each outcome needs different copy ("Just filled", etc.); matches the auth code's result style | Throwing errors for normal outcomes |
| `canWrite: false` means `assign`/`markCancelled` change nothing and return `needs_approval` | architecture.md: "prepare the change, office taps approve". The approve queue itself comes later | Throwing on write |
| The plug doesn't check eligibility | "AI reads, code decides" stays in one place: the rules engine, called by the take-shift service before `assign` | Rules inside every adapter |
| `getShifts(from, to)` returns shifts *starting* in `[from, to)`, every status (draft and cancelled included), with who holds each slot | The sync job mirrors the whole source; the portal filters. A window must end after it starts | Open shifts only |
| `noticeHours(startsAt, cancelledAt)`: hours to 2 decimals, rounded half away from zero, negative after the start, never `-0` | Matches `assignments.notice_hours numeric(8,2)` exactly; one function for every adapter (parked from the schema task) | Each adapter computing its own |
| `ROLE_PATTERN` is exported from the schema and used by both the database CHECK and the zod schema | One spelling rule by construction, not by a test that keeps two copies in step | Two copies |
| The in-memory adapter lives in `tests/helpers`, not `src` | It is a test double that proves the contract suite; no firm uses it | A "memory" source in the app |

**Built.** `src/lib/roster/plug.ts` (interface, boundary schemas, result types, and the decisions
above written into its header), `src/lib/roster/notice.ts`, `ROLE_PATTERN` and `WORKER_STATUSES`
shared from the schema (no migration change: drift check clean),
`tests/helpers/roster-contract.ts` (21 named checks), `tests/helpers/memory-roster-plug.ts` (13
faults), `tests/unit/roster.contract.test.ts` and `tests/unit/roster.plug.test.ts`.

**Guardrails review** (`guardrails-reviewer`): verdict FIX FIRST, one item.

- FIX FIRST 1: the "office cancellation is recorded the same way (golden rule 12)" check could
  never fail: nothing read back what an adapter stored, so an adapter that saved every cancel as
  the worker's, or dropped the reason, would pass. **Fixed**: the fixture now has
  `cancellations()` (for native: the assignments row's status, reason and notice hours); both
  cancel checks assert who, why and the notice hours; new `ignore_by` and `drop_reason` faults
  prove the checks catch it.
- SHOULD FIX 2 (notice counted from when the call runs): **fixed**: `cancel.at` (when the person
  asked) is required, notice counts from it, and a `cancel.at` after the plug's clock is refused.
  Two new checks and two faults (`notice_from_clock`, `future_at_ok`). Parked: saving the pending
  change on `needs_approval`.
- SHOULD FIX 3 (who owns the transaction and the event row): **decided and written into
  plug.ts**: adapters that write our tables are built on the caller's `withFirm` transaction; the
  caller writes the `events` row from the result in the same transaction. The "at once" check is
  renamed to say what it proves (one plug, calls in flight); the cross-connection race stays with
  `assign.race`.
- SHOULD FIX 4 (eligibility pass and worker lock): **parked** for the rules engine and atomic
  assign tasks (they don't exist yet; a branded type now would have no creator).
- SHOULD FIX 5 (no cross-firm check in the contract): **fixed**: the harness must supply two
  firms; a new check requires the other firm's rows to be unlisted, `not_found` by id and
  unchanged, with a `cross_firm` fault proving it can fail.
- Notes: worker statuses now one shared list (`WORKER_STATUSES`); the pasted `ROLE_PATTERN`
  refuses `'` or `\`; the real venue name in test data replaced by the seed's "Acme Demo Arena";
  plug.ts now says the plug assigns inactive workers or past shifts if asked (the rules engine
  must stop that) and that staff views must leave out drafts. Not changed: the memory double
  reports `source: "native"` (harmless), and `rosterShiftSchema` doesn't force "filled" to mean
  every slot held (a derived status that may lag; the read must not fail on it).

**Verify:** `VERIFIED tree=20703b1cd636b217 e2e=true` (802 tests, 10 e2e), first run.

**claims-auditor (round 1), verbatim:**

```
VERDICT: DONE

Task audited: PLAN.md Phase 2 bullet — "`RosterPlug` interface: `listStaff`, `getShifts`, `assign`, `markCancelled`, `canWrite`" (still unchecked `[ ]` in PLAN.md at the time of this audit — auditor does not tick it).

Step 1 gate: `.claude/state/verified.json` → `{"ok":true,"tree":"20703b1cd636b217","e2e":true,...}`. `./.claude/hooks/tree-hash.sh` → `20703b1cd636b217`. Match, so proceeding.

Claims:
- Interface defines all 5 members with correct signatures — PROVEN — `src/lib/db/schema/roster.ts:32` (ROLE_PATTERN, SHIFT_SOURCES, SHIFT_STATUSES) and `src/lib/roster/plug.ts:114-129` declare `RosterPlug { source, canWrite, listStaff(), getShifts(from,to), assign(shiftId,workerId), markCancelled(shiftId,workerId,cancel) }` exactly matching the bullet, plus `AssignResult`/`CancelResult` result-type unions (lines 93-112) and zod schemas `rosterStaffSchema`/`rosterShiftSchema`/`shiftWindowSchema`/`cancelInputSchema` (lines 34-91).
- Schema/type validation is real, not a stub — PROVEN — `tests/unit/roster.plug.test.ts:37-135` exercises `rosterStaffSchema`, `rosterShiftSchema`, `shiftWindowSchema`, `cancelInputSchema` with accept/reject cases, plus `ROLE_PATTERN` cross-checked against live Postgres CHECK constraints (`roster.ts:36`, test lines 122-135) so zod and DB agree. `noticeHours()` (`src/lib/roster/notice.ts:7-11`) covers rounding, DST, negative notice (test lines 137-170).
- A general contract suite exists so every adapter (native/Sheets/CSV) is checked identically — PROVEN — `tests/helpers/roster-contract.ts` defines 20 `ContractCheck`s covering listStaff, getShifts (window, copies), assign (first-yes-wins, concurrent race, multi-slot, already_assigned, not_open, not_found), markCancelled (store evidence, notice from `cancel.at` not clock, blank reason/future `at` rejected, not_assigned), read-only mode, and cross-firm isolation.
- Contract suite is actually run and is not a fake — PROVEN — `tests/unit/roster.contract.test.ts` runs `describeRosterContract()` against a full in-memory reference adapter (`tests/helpers/memory-roster-plug.ts`), and separately proves every check can fail via 15 deliberately-broken "fault" variants (`double_assign`, `ignore_window`, `zero_notice`, `cross_firm`, etc., lines 59-82) — this rules out vacuous/tautological tests.
- No fakes/skips — PROVEN — `grep` for `.skip`, `.only`, `TODO`, `not implemented` across `src/lib/roster/`, `tests/helpers/{roster-contract,memory-roster-plug}.ts`, `tests/unit/roster.{contract,plug}.test.ts` returned nothing.
- Tests actually pass in the logged run for the current tree — PROVEN — `.claude/state/test.log:572-608` and `:717-` show every `roster.contract.test.ts` and `roster.plug.test.ts` test with `✓`, and the run summary at the end of the log reads "Test Files 34 passed (34) / Tests 802 passed (802)". `test.log` mtime (Sep 28 18:26) postdates the `verified.json` timestamp write and matches the current tree hash.
- Docs updated consistently — PROVEN — `docs/architecture.md:115-156` documents the same interface shape, result unions, contract-suite guarantees and adapter table; matches `src/lib/roster/plug.ts` verbatim in shape.

Fakes found: none.

Scope note: only the interface bullet was in scope here. The next unchecked bullets (native adapter, Sheets adapter, rules engine, race test, `sheets.sync`) are correctly still unchecked in PLAN.md and were not claimed as done — the Phase 2 "Done when" (rules tests pass, Sheet syncs both ways, race-proof double-assign) is a phase-level bar for later tasks, not this one; the interface task doesn't yet require an adapter, and none was found or claimed.

To reach DONE: nothing further needed for this specific bullet.
```

(Count check: the contract has 21 checks, `grep -c '^    name: '`; the auditor's "20" is a
miscount. "15 fault variants" is the 15 fault cases, covering 13 kinds of fault.)

**Ticked** in `PLAN.md` after the DONE verdict. **Parked** (in `PLAN.md`): an `EligibilityPass`
for `assign` plus a worker lock (rules engine / atomic assign tasks); saving pending changes on
`needs_approval` before any read-only source goes live.

**Hours:** 0.4 h (17:07 to 17:29 UTC). Phase 2 so far: 0.9 h of the 30-40 h estimate.

**Commit:** `adb8743 Phase 2: RosterPlug interface ...` on `build/overnight`. **Push:** succeeded
(`950bbd6..adb8743`). **CI:** not checked (`gh` isn't installed here).

## 2026-09-28 17:32 UTC: Phase 2, "Native adapter (our tables are the rota) — for firms with nothing else"

**Plan.** `src/lib/roster/native.ts`: `nativeRosterPlug(tx, { clock })`, a `RosterPlug` over our
own tables, built on the caller's `withFirm` transaction (as plug.ts says). Tests:
`tests/integration/roster.native.test.ts` runs the shared contract (the 19 checks that apply; the 2
read-only ones don't, since native is always writable) against it on
the real database, as the restricted app role, each call in its own `withFirm` transaction (like
one web request each), plus native-only tests: a 10-way race for one slot (the existing `race()`
barrier helper), slot rows created on demand, what the database stores on cancel, that a rollback
of the caller's transaction undoes the plug's writes, and garbage ids.

**Decisions (would normally wait for Dylan's OK):**

| Decision | Why | Alternative considered |
|---|---|---|
| `assign` locks the shift row (`select ... for update`), then does the documented conditional `UPDATE ... WHERE worker_id IS NULL` on the lowest open slot | The lock serialises takers of one shift, so `shifts.status` goes to `filled` exactly when the last slot goes (without it, two takers of a 2-slot shift can each see "1 of 2" and never mark it filled). The conditional update still guarantees first yes wins on its own (golden rule 4) | Conditional update alone (status can drift); `SKIP LOCKED` (same drift) |
| Missing open slot rows (up to the headcount) are created on demand by `assign` (`insert ... on conflict do nothing` against the one-live-row-per-slot index) | Every path that makes shifts (office, CSV, sheet sync, seed) would otherwise have to remember to create slot rows, and a forgotten one makes a shift look full | Rely on every creator to insert slot rows |
| `markCancelled` only cancels an `offered` or `confirmed` slot; a `completed` or `no_show` one is `not_assigned` | A worked or missed shift can't be cancelled after the fact | Allow any live status |
| A cancel stores `cancelled_at = cancel.at` (when the person asked), the reason, `cancelled_worker`/`cancelled_firm` and the notice hours, then inserts a new open row for the slot and reopens a `filled` shift | Evidence for the notice report (golden rule 12) and the slot can be taken again | Clearing the worker off the row |
| Times written by the plug (`confirmed_at`) come from the injected clock, not SQL `now()` | Same rule as the auth code: tests can pin time exactly | `now()` |
| Reads map our rows straight to `RosterStaff`/`RosterShift` (ref = our id) without re-parsing them | Our own tables aren't external input; their CHECKs already hold. The contract still parses every row it gets | Parse every row (one odd legacy row would break the whole listing) |
| Ids that aren't UUIDs are `not_found` (checked with zod before any SQL) | A bad id from a URL must not become a database error | Let Postgres raise 22P02 |

**Built.** `src/lib/roster/native.ts` and `tests/integration/roster.native.test.ts` (19 contract
checks + 12 native-only tests). A deliberate break (removing the shift lock and the `worker_id IS
NULL` condition, in a scratch copy, then restored) made both 10-way race tests fail: every one of
the 10 got "assigned". So the race test has teeth.

**Root causes found while building:** (1) a TypeScript error: an `interface` isn't a
`Record<string, unknown>` for drizzle's raw `execute<T>()`; a `type` alias is. (2) 7 test
failures, `startsAt.getTime is not a function`: drizzle's raw `execute()` returns timestamps as
text (only its query builder maps them to `Date`). Reads moved to the query builder; raw SQL kept
for the conditional writes.

**Guardrails review** (`guardrails-reviewer`): verdict SAFE TO COMMIT, no FIX FIRST. SHOULD FIX
items, all fixed except where noted:

1. A cancel of a slot above a lowered headcount reopened a still-full shift: **fixed** (reopen
   only when the slot row is reinserted) + test.
2. No lower bound on `cancel.at` (a cancel could be dated before the booking, inflating notice):
   **fixed**: a `cancel.at` before the row's `confirmed_at` is refused; the seed's bookings moved
   to a week before NOW; + test. (A database CHECK `cancelled_at >= confirmed_at` would be a
   schema change: not done.)
3. An `offered` row cancelled by the worker was stored as a worker cancellation with notice:
   **fixed**: only `confirmed` bookings can be cancelled (declining an offer isn't a cancel;
   what `offered` means is still open for Dylan) + test.
4. `getShifts` can report a holder above a lowered headcount, which fails `rosterShiftSchema`;
   and architecture.md said every adapter parses: **doc fixed** (outside sources parse; native
   maps its own rows); the headcount case **parked** for Phase 5.
5. `.for("update")` → `.for("no key update")`: **fixed** (doesn't block foreign-key checks
   against the shift).
6. Race test never raced the on-demand slot rows: **fixed**: a third race case with no slot rows
   made beforehand.
7. Log said "all 21 checks": **corrected** to the 19 that apply.

Notes parked in `PLAN.md`: results should say whether the shift filled or reopened (Phase 4 needs
it); a fixed lock order once a worker lock exists; nothing may call `assign` before the rules
engine and events. Written into native.ts: every writer of a shift's slots must lock the shift row
first. The cancelled-status list is now built from the shared constant.

**Verify:** `VERIFIED tree=5db71de30fa855ae e2e=true` (833 tests, 10 e2e), first run.

**claims-auditor (round 1), verbatim:**

```
VERDICT: DONE

Preliminary check: `.claude/state/verified.json` = `{"ok":true,"tree":"5db71de30fa855ae","e2e":true,"at":"2026-09-28T17:47:27Z"}`; `./.claude/hooks/tree-hash.sh` = `5db71de30fa855ae` — matches. Proceeding.

Claims (task bullet: "Native adapter (our tables are the rota) — for firms with nothing else"):

- Implements the `RosterPlug` interface (listStaff, getShifts, assign, markCancelled, canWrite) on our own tables — PROVEN. `src/lib/roster/native.ts:47-243`, `nativeRosterPlug()`. Runs inside the caller's `withFirm` tx (no own transaction), matching the interface contract in `src/lib/roster/plug.ts:1-22`.
- Passes the shared RosterPlug contract suite against a real Postgres DB, real app role, real RLS — PROVEN. `tests/integration/roster.native.test.ts:145` (`describeRosterContract(...)`) using `tests/helpers/roster-contract.ts`. Log: `.claude/state/test.log:26-44`, 19 contract cases all `✓`, including tenant isolation ("another firm's staff and shifts are out of reach", `test.log:44`).
- Atomic assign, "first yes wins", double-assign impossible under a real concurrent race — PROVEN. `src/lib/roster/native.ts:146-184` (row-locked shift + single conditional `UPDATE ... WHERE a.worker_id IS NULL ... RETURNING`). Race test uses real concurrent Postgres connections with a barrier (`tests/helpers/race.ts:9-35`, `max: n` pool, all transactions gated until all arrive — not a fake sequential loop). Three parametrised cases (1/1, 3/3, 2/2 winners, incl. slot rows created on demand) pass at `.claude/state/test.log:45-47`.
- Cancellation preserves the cancelled row as evidence, reopens the slot, computes notice hours, blocks cancelling non-`confirmed`/backdated rows, and correctly leaves slots above a lowered headcount closed — PROVEN. Code: `src/lib/roster/native.ts:186-241`. Tests: `test.log:50-54` (all pass), including the lowered-headcount edge cases and the worked/no-show and pre-booking-date guards.
- Slots created on demand when a shift has no pre-existing slot rows — PROVEN. `src/lib/roster/native.ts:73-79` (`openMissingSlots`); test `test.log:48`.

Fakes found: none. No `.only`/`.skip`/TODO/"not implemented" in `src/lib/roster/native.ts`, `tests/integration/roster.native.test.ts`, `tests/helpers/roster-contract.ts`, or `tests/helpers/race.ts` (checked by grep). The race test uses genuinely concurrent DB connections (barrier + separate pool), not a mock of the thing under test. Test.log timestamp (18:46) and tree hash (18:47) both correspond to the current working tree, including the two untracked files (`tree-hash.sh` hashes untracked files too, confirmed by reading the script).

Note (not a defect, just status): PLAN.md line 107 still shows `- [ ] Native adapter ...` unchecked — consistent with the workflow ("never tick a task yourself... run `/close-task`... and only then ticks the task"), so this audit is presumably the gate before ticking, not evidence against DONE.

To reach DONE: nothing — implementation and tests for this specific task are proven on disk and in the passing verified run. (Whoever is driving `/close-task` should now tick PLAN.md line 107 and commit `src/lib/roster/native.ts` and `tests/integration/roster.native.test.ts`, which are currently untracked.)
```

**Ticked** in `PLAN.md` after the DONE verdict. **Needs Dylan:** what an `offered` slot means
(cancels are limited to confirmed bookings until then).

**Hours:** 0.3 h (17:32 to 17:50 UTC). Phase 2 so far: 1.2 h of the 30-40 h estimate.

**Commit:** `9d4c8f1 Phase 2: Native adapter ...` on `build/overnight`. **Push:** succeeded.
**CI:** not checked (`gh` isn't installed here).

## 2026-09-28 17:52 UTC: Phase 2, "Google Sheets adapter: service account, column mapping per firm, sync job every 1–2 min on event days, batch writes, never read the sheet per request"

**Hard limit applied:** no Google account, service account or real sheet is created or called.
Everything is built and tested against a fake Sheets service (docs/testing.md already specifies
"Sheets adapter against a mocked Sheets API"); the real Google client is written and tested with a
fake network and a throwaway key generated inside the test. "Create the service account, share a
test sheet, run one real sync" is parked for Dylan.

**Plan.**
- Schema (migration 0005): `roster_sources` (one per firm: kind `sheets`, spreadsheet id, column
  mapping, last sync, last error code, a sync lease); `workers.external_ref` (the sheet's staff
  id, unique per firm); `shifts.synced_holders` (what the sheet's "assigned" cell held after the
  last successful sync: the base for a three-way merge); function `app_firm_ids()` so the worker's
  once-a-minute tick can visit each firm.
- `src/lib/time/zoned.ts`: London wall-clock date and time to UTC (DST-aware, no library).
- `src/lib/roster/sheets/`: `mapping.ts` (per-firm column mapping, by header name), `parse.ts`
  (sheet rows to `RosterStaff`/`RosterShift` through the zod boundary schemas, bad rows reported
  by row number without their contents), `merge.ts` (pure three-way merge of who holds a shift),
  `client.ts` (the `SheetsClient` interface: one batch read, one batch write), `google.ts` (the
  real client: service-account JWT signed with node:crypto, token cache, fetch injected),
  `sync.ts` (the sync), `cadence.ts` (due every minute on event days, every 15 otherwise),
  `jobs.ts` (the `sheets-sync` firm job and the `sheets-sync-tick` cron).
- The Sheets RosterPlug: the native plug over the mirrored tables, with refs = the sheet's ids.
  Portal requests never touch the sheet; only the sync job does.
- Tests: `sheets.sync` (named in docs/testing.md) end to end on the real database with the fake
  sheet, the shared contract against the Sheets plug, and unit tests for each piece.

**Built.** Migrations `0005_phase2_sheets` (roster_sources, workers.external_ref,
shifts.synced_holders) and `0006_firm_ids` (hand-written `app_firm_ids()`), regenerated once
before commit (a column added after the review; local dev database rebuilt with `db:reset`);
`src/lib/time/zoned.ts`; `src/lib/roster/sheets/` (a1, client, mapping, parse, merge, google,
cadence, sync, jobs); `sheetsRosterPlug` beside the native plug; `FirmTask`/`runFirmTask` in the
job runner; the tick and sync wired into the worker behind a Sheets client; env
`SHEETS_TRANSPORT`. Tests: `sheets.sync` (19 contract checks + 30 sync tests), `sheets.jobs` (8),
`sheets.parse`, `sheets.merge`, `sheets.google`, `time.zoned`, a definer test for `app_firm_ids()`.

**Root causes found while building:** one test expectation was wrong: when the office swaps a
name and the portal adds one at once, the newcomer from the sheet takes the freed slot 1, so the
cell (written in slot order) reads "N003, N002", not "N002, N003". Fixed the test.

**Guardrails review** (`guardrails-reviewer`): verdict FIX FIRST.

- FIX FIRST 1: the sync books the office's sheet names with no eligibility or credential check
  (golden rule 6; and my own parking note said nothing may call `assign` before the rules
  engine). **Fixed by gating:** `SHEETS_TRANSPORT` accepts only `none`, so no real sheet can sync
  until the rules engine checks sheet bookings (the same way Twilio is deferred). The worker
  builds no Google client. Parked with exact steps. (Reporting sheet names as "not booked" was
  rejected: the write-back would then erase the office's names from its sheet.)
- SHOULD FIX 2 (an office edit between read and write was overwritten): **fixed**: the pre-write
  read takes each target row's id *and* Assigned cells in one request; a changed cell is skipped
  and merged next sync. Test.
- SHOULD FIX 3 (stale merge base after a failed or skipped write): **fixed**: the base becomes the
  cell as read in the mirror transaction, then the written value after a successful write. Test
  (office re-adds a name after a failed write: booked again).
- SHOULD FIX 4 (a holder with no staff id froze the shift silently): **fixed**: problem code
  `holder_not_in_sheet`, a conflict event, and the open/filled recompute still runs. Test.
- SHOULD FIX 5 (past shifts rewritten as firm cancellations; history booked on a first sync):
  **fixed**: started shifts are mirrored but never booked, cancelled or re-timed. Tests.
- SHOULD FIX 6 (worker fields overwritten silently; login is by mobile): **fixed**: events by
  field name (`worker.added`, `worker.updated`, `worker.linked`), a worker blocked here stays
  blocked, a changed mobile revokes sessions and unused login links. Tests.
- SHOULD FIX 7 (lease not fenced; job expiry longer than the lease): **fixed**: every later write
  to roster_sources is fenced on the claimed lease time; a lost lease returns `busy` and changes
  nothing; the queue expires jobs after 4 minutes (lease 5). Tests.
- SHOULD FIX 8 (failures retried every minute with an event each time): **fixed**:
  `last_attempted_at` column, back-off to 5 min (event day) / 30 min, `roster.sync_failed` only
  when the code changes. Tests.
- SHOULD FIX 9 (shift-level events missing): **fixed**: `shift.created`, `shift.changed` (field
  names), `shift.status_changed`. Test.
- SHOULD FIX 10 (no definer test for `app_firm_ids()`): **fixed** (directory.test).
- Notes: recompute now uses the shared cancelled-status list and only slots within the headcount;
  the env var name in google.ts's comment corrected; `SHEETS_TRANSPORT=google` can't be set at all
  now. Parked: the web can also call `app_firm_ids()` (ids only); lock/row churn on big sheets;
  telling workers about sheet-made changes (Phase 4/5).

**Verify:** `VERIFIED tree=b9d4915e8408d4fb e2e=true` (1004 tests, 10 e2e), first full run.

**claims-auditor (round 1), verbatim:**

```
VERDICT: DONE (for this task line only — see scope note below)

Step 1 check: `.claude/state/verified.json` = `{"ok":true,"tree":"b9d4915e8408d4fb",...}`; `./.claude/hooks/tree-hash.sh` = `b9d4915e8408d4fb`. Match, ok=true. Proceeded with audit.

Claims (task = PLAN.md:108-109, "Google Sheets adapter: service account, column mapping per firm, sync job every 1–2 min on event days, batch writes, never read the sheet per request"):

- Service account auth — PROVEN. `src/lib/roster/sheets/google.ts:26-38` (`loadServiceAccountKey`), `:66-81` (`serviceAccountJwt`, RS256), `:92-173` (`googleSheetsClient`, token caching/refresh). Tests: `tests/unit/sheets.google.test.ts` (`serviceAccountJwt`, `googleSheetsClient` token/refresh/error-code cases) — all pass, `.claude/state/test.log:669-682`.
- Column mapping per firm — PROVEN. `src/lib/roster/sheets/mapping.ts:15-75` (`sheetMappingSchema`, header lookup by text, `DEFAULT_SHEET_MAPPING`); stored per-firm in `roster_sources.mapping` jsonb, `src/lib/db/schema/roster.ts:340-370`. Tested: `tests/unit/sheets.parse.test.ts` "finds columns by header text in any order and any case" — `test.log:686`.
- Sync job every 1–2 min on event days — PROVEN. `src/lib/roster/sheets/cadence.ts:12-33` (`EVENT_DAY_EVERY_MS = MINUTE`, `sheetsSyncDue`), `src/lib/roster/sheets/jobs.ts:23-90` (cron `* * * * *`, singleton key, lease coordination). Tests: `tests/unit/sheets.merge.test.ts` (`sheetsSyncDue` cases, `test.log` sheets.merge section) and `tests/integration/sheets.jobs.test.ts` ("queues one sync for each firm that is due", "backs off while a firm's syncs are failing", "schedules the tick every minute" — `test.log:365-374`).
- Batch writes — PROVEN. `google.ts:160-171` `batchUpdate` sends one POST with all cell writes; `sync.ts` docstring lines 40-42 states one batch write per sync. Test `tests/integration/sheets.sync.test.ts:438-461` "a booking made in the portal reaches the sheet in one batch write" asserts `writes: 1` via `FakeSheets` call counter.
- Never read the sheet per request — PROVEN. `src/lib/roster/native.ts:47-56` (`sheetsRosterPlug` doc comment: "It never reads or writes the sheet... 'never read the sheet per request'"); `sheetsRosterPlug`/`nativeRosterPlug` share `tableRosterPlug` (native.ts:60+) which only queries our DB tables. Test `sheets.sync.test.ts:438-449` explicitly proves a portal booking + `listStaff` call leave `fake.reads`/`fake.writes` unchanged.
- "A seeded Sheet syncs both ways" (Phase done-when) — PROVEN. `tests/integration/sheets.sync.test.ts` sections "from the sheet into our tables" and "from our tables back to the sheet", all passing (`test.log:43-56`).
- "Double-assign impossible under a race test" (Phase done-when, as applied to this adapter) — PROVEN. `tests/helpers/roster-contract.ts:268-281` runs two concurrent `assign` calls, each via its own `withFirm` transaction (`tests/integration/sheets.sync.test.ts:163-177`, real Postgres pool `appRolePool(8)`), against `src/lib/roster/native.ts:172-203`'s atomic conditional `UPDATE ... WHERE worker_id IS NULL` under `for("no key update")` row lock — golden rule 4. Passing as part of the Sheets adapter's own contract suite: `test.log:32` "two assign calls in flight together on one plug for the last slot: exactly one gets it".

Fakes found: none in the Sheets code/tests — no `.only`/`.skip`/`.todo` (`grep` clean), `invariants.log` confirms "no .only/.skip/.todo in tests" and "1004 tests: 1004 passed, 0 failed, 0 skipped, 0 todo". No mocking of the thing under test: `googleSheetsClient` is tested against an injected `fetch` (network boundary), and the sync/roster-plug tests run against real Postgres.

Scope note (not a fake, but important): the Sheets client is deliberately **not wired into the running worker yet**. `src/lib/env.ts:70` restricts `SHEETS_TRANSPORT` to `z.enum(["none"])`; `src/worker/index.ts:20-22` sets `const sheets = undefined` with a comment explaining this is intentional until the (separate, still unchecked) rules engine exists to vet sheet-booked names against credential rules (golden rule 6). This gating is itself tested (`sheets.jobs.test.ts` "with/without a Sheets client" cases, `test.log:373-374`) and documented in `PLAN.md:346-352,360-363`. PLAN.md still has this exact bullet unchecked (`PLAN.md:108-109`), consistent with it awaiting this audit before ticking.

Also out of scope for this task but relevant to the Phase 2 "Done when" line as a whole: the **rules engine** (`- [ ] Rules engine...`, `PLAN.md:111-113`) and a standalone `assign.race.test.ts` / `rules.table.test.ts` (`PLAN.md:119`, `docs/testing.md:29,31`) do not exist yet (`find src/lib/rules` → not found; no `tests/**/assign.race*` or `rules.table*` files). These are separate, still-open PLAN.md bullets, not part of the "Google Sheets adapter" line item — Phase 2 overall is not complete, but that is not this task's claim.

To reach DONE: nothing further for this specific task line ("Google Sheets adapter: service account, column mapping per firm, sync job every 1–2 min on event days, batch writes, never read the sheet per request") — all sub-claims are PROVEN with passing, non-fake tests on the current verified tree. If the intent was to audit the whole Phase 2 "Done when" line, note separately that the rules engine and its dedicated tests remain unimplemented.
```

**Ticked** in `PLAN.md` after the DONE verdict. **Not blocked, but not live:** a real sync needs a
Google service account (Dylan, parked with steps) and the rules engine (next Phase 2 tasks);
`SHEETS_TRANSPORT` stays `none` until both exist.

**Hours:** 0.8 h (17:52 to 18:41 UTC). Phase 2 so far: 2.0 h of the 30-40 h estimate.

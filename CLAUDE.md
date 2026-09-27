# ShiftDesk (working name) — project memory for Claude Code

Read this first, every session. Details live in `docs/`. The build order lives in `PLAN.md`.

## What we're building

A branded staff portal and shifts line for casual workers, sold to UK staffing firms that
still run on spreadsheets, email and WhatsApp. First sector: event security and stewarding.
Later: rail, civils, construction, cleaning.

Casual workers use a link on WhatsApp (no app download) to see their shifts, grab open
shifts, cancel or ask for time changes, see urgent dropouts and check pay info. Everything
is answered instantly and logged. The office (resourcers, payroll) gets a dashboard, a
clean action log and summaries instead of 60+ emails and constant calls a day.

The product sits alongside whatever the firm already uses. It never forces staff to move.

## Who uses it

| Person | What they need |
|---|---|
| Casual worker | Instant answers: my shifts, open shifts, cancel, change, pay dates. No waiting for a reply. |
| Resourcer / coordinator | Fewer emails and calls, gaps filled fast, nothing missed, one log. |
| Payroll | One grouped summary of pay queries instead of the whole workforce messaging. |
| Firm admin / owner | Evidence of every offer, change and cancellation (Employment Rights Act 2027), fewer no-shows, no extra admin hire at peak. |

## Golden rules (non-negotiable)

1. **AI reads, code decides.** Eligibility, credentials, assignments and pay figures come from
   firm data through plain TypeScript. AI only classifies free text, drafts and summarises.
   A model never decides who gets a shift or what someone is paid.
2. **Tenant isolation.** Every table has `firm_id`. All queries go through the scoped data
   layer. Postgres Row Level Security is on. Cross-tenant tests must exist and pass.
3. **Idempotent inbound.** Every webhook stores `provider_message_id` (unique). Handlers
   verify signatures, write one row, queue a job and return 200 fast. Work happens in jobs.
4. **First yes wins.** Assigning a shift is one conditional `UPDATE ... WHERE assigned_to IS NULL`.
   Zero rows changed means already filled. Never double-assign.
5. **Log every state change.** Write an `events` row (append-only) for every offer, accept,
   cancel, change, credential check and message. The notice and cancellation log is a product
   feature, not debug output.
6. **Credentials in date.** No offer or assignment if a required credential (SIA, CSCS, PTS,
   Sentinel, DBS...) is missing or expired, except a firm-configured "applied/in progress"
   allowance. Credential rules are data per sector, never hardcoded to SIA.
7. **No real employer data.** Dev, tests and demos use seeded fake data only. Never commit
   secrets or real personal data. Never import data from the founder's employer until a
   signed agreement exists.
8. **Replies are signed "[Firm name] Shift Team".** Never invent a human name for automated
   replies.
9. **Pay disputes never get an AI answer.** They go to the payroll digest. Staff can see facts
   (hours logged, rates, pay dates) straight from imported pay data.
10. **Stay in scope.** Only build tasks in the current phase of `PLAN.md`. New ideas go to the
    Parking lot in `PLAN.md`.
11. **Copy is product.** Staff-facing text follows `docs/screens.md` and
    `docs/messaging-templates.md`: short sentences, plain words, buttons say what happens, every
    action ends with a confirmation. Large tap targets and readable sizes.
12. **Firm-initiated changes are logged like worker ones.** Cancel, move or curtail by the
    office always records a reason and notice hours per assigned worker.
13. **Only the script says done.** "Verified" means `scripts/verify.sh` printed VERIFIED on the
    current files. Builders never grade their own work; the `claims-auditor` does, from evidence
    on disk only. Reviewer agents are read-only. Three audit rounds, then stop and report.

## Stack

- **App:** Next.js (App Router) + TypeScript (strict), Tailwind, zod for all input validation.
- **Database:** PostgreSQL. Drizzle ORM + drizzle-kit migrations. RLS via `app.current_firm_id`.
- **Jobs and timers:** pg-boss (queue lives in Postgres, survives restarts).
- **Worker:** separate Node process (`src/worker/index.ts`) sharing the same codebase.
- **Messaging:** Twilio (UK numbers, SMS, WhatsApp). Web push via `web-push` (VAPID).
- **AI:** Claude on Amazon Bedrock, EU inference profile (Haiku for sorting, Sonnet only where needed).
- **Email:** Amazon SES (outbound now, inbound in Stage 2).
- **Hosting:** AWS London (eu-west-2): Lightsail instance (Docker Compose: web, worker, caddy)
  + Lightsail managed Postgres. Caddy handles HTTPS, including customer custom domains.
- **Tests:** Vitest (unit/integration against a real Postgres in Docker), Playwright (key flows).

## Repo layout (target)

```
src/
  app/                 # Next.js routes: (staff) portal, (office) dashboard, api/webhooks
  lib/
    db/                # drizzle schema, scoped client, RLS helpers
    tenancy/           # host -> firm resolution
    auth/              # magic links, sessions, OTP step-up
    rules/             # eligibility + credential rules (pure functions, heavily tested)
    roster/            # RosterPlug interface + adapters (native, sheets, csv)
    messaging/         # transport interface: console (dev) | twilio (prod); templates
    notify/            # web push + WhatsApp/SMS fallback ordering
    ai/                # Bedrock client, prompts, zod-validated outputs
    events/            # append-only action log writer
  worker/              # pg-boss job handlers (offer waves, syncs, digests)
tests/
docs/
```

## Commands

- `npm run dev` — web app
- `npm run worker` — job worker
- `npm run db:up` — start local Postgres (Docker)
- `npm run db:migrate` / `npm run db:seed`
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`
- `./scripts/verify.sh` — runs all of the above and writes the verified stamp

(Create these scripts in Phase 0 if missing.)

## Conventions

- UTC in the database; display in Europe/London.
- Money as integer pence. Phone numbers as E.164.
- No `any`. Validate every external input with zod at the boundary.
- Small modules. Pure functions for rules so they're easy to test.
- Every new table gets `firm_id`, `created_at`, RLS policy and a cross-tenant test.
- Dev messaging uses `MESSAGING_TRANSPORT=console` (prints outbound messages). Never hit
  Twilio from tests.

## How to work each task

1. Read the task in `PLAN.md` and the docs it links.
2. Propose a short plan: files to create or change, and tests to write. Wait for approval on
   anything touching schema, auth or tenancy.
3. Implement with tests. When something fails, state the root cause (the mechanism) before
   changing any code. Never patch the symptom. Never delete, skip or weaken a test to get green.
4. For schema, auth, tenancy, messaging or rules changes, run the `guardrails-reviewer` agent.
5. Run `/close-task`. It runs `scripts/verify.sh`, then the independent `claims-auditor`,
   and only then ticks the task. **Never tick a task yourself** (a hook blocks it), and never
   say "done", "complete" or "all tests pass" unless verify.sh printed VERIFIED on the
   current files (a hook blocks that too). If something isn't verified, say so plainly.
6. Add anything deferred to the Parking lot. Summarise what changed and what the auditor verified.

See `docs/verification.md` for how this is enforced and why.

## Docs index

- `docs/product-spec.md` — the product (PRD): users, stories, P0/P1/P2, metrics
- `docs/architecture.md` — components, flows, custom domains, notifications, AI use
- `docs/data-model.md` — tables and relationships
- `docs/decisions.md` — why we chose what we chose (ADRs)
- `docs/compliance.md` — UK GDPR, credentials, Employment Rights Act, AI disclosure
- `docs/business.md` — market, pricing, costs, competitors, evidence
- `docs/go-to-market.md` — who to sell to first and how
- `docs/screens.md` — every screen, route, state and copy rule
- `docs/api-and-jobs.md` — webhooks, server actions, job catalogue, offer-wave ranking
- `docs/rules-and-credentials.md` — eligibility checks, credential packs, test cases
- `docs/messaging-templates.md` — notification policy and all message copy
- `docs/testing.md` — test layers, must-have tests, demo seed, pre-pilot checklist
- `docs/runbooks.md` — deploy, rollback, restore, outages, WhatsApp/Sheets/domain issues
- `docs/pilot-playbook.md` — baseline, weekly rhythm, metrics, report template
- `docs/verification.md` — how "done" is enforced: verify script, auditor agent, hooks

## Glossary

- **Casual / worker:** zero-hours or ad-hoc staff member.
- **Resourcer / coordinator:** office person who fills shifts and answers staff.
- **Open shift:** shift with unfilled headcount. **Urgent:** open shift starting soon or after a dropout.
- **Offer wave:** batch of offers to the best eligible workers; next batch after a timeout.
- **Credential:** licence/card a role needs (SIA, CSCS, PTS, Sentinel, DBS).
- **Active worker:** worked at least one shift in the billing month (pricing unit).
- **Roster plug:** adapter to the firm's rota source (native, Google Sheets, CSV).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

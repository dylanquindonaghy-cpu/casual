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
- **AI:** Claude through the Anthropic API (`@anthropic-ai/sdk`) behind `AiClient` (Haiku for
  sorting, Sonnet only where needed); off unless `AI_TRANSPORT=anthropic`. No AWS (ADR-021).
- **Email:** any provider over SMTP (nodemailer, `EMAIL_TRANSPORT=smtp`); console in dev and tests.
  Outbound now, inbound in Stage 2.
- **Hosting:** any UK or EU Docker host (chosen later): Docker Compose (web, worker, caddy) +
  Postgres 16 (the host's managed one, or in Compose). Caddy handles HTTPS, including customer
  custom domains.
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
    messaging/         # transport interface: console (dev) | twilio for phones, SMTP for email; templates
    notify/            # web push + WhatsApp/SMS fallback ordering
    ai/                # Anthropic client behind AiClient, prompts, zod-validated outputs
    events/            # append-only action log writer
  worker/              # pg-boss job handlers (offer waves, syncs, digests)
tests/
docs/
```

## Commands

- `npm run dev` — web app and job worker together (`npm run dev:web` for the web app alone).
  Firms: `http://acme.localhost:3000`, `http://northline.localhost:3000` (after `npm run db:seed`)
- `npm run worker` — job worker
- `npm run db:up` — start local Postgres (Docker)
- `npm run db:migrate` / `npm run db:seed`
- `npm run db:reset` — local only: recreate the dev database with the owner/app/jobs roles and migrate
- `npm run db:generate` — write a migration from `src/lib/db/schema/`. Never use `drizzle-kit push`
  or `drizzle-kit migrate`: only `db:migrate` also forces RLS, applies grants and installs pg-boss
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e` (its own web app and worker on
  port 3100, an https front on 3443 for a firm's own domain (needs `openssl`), and its own `*_e2e`
  database; then the walkthrough's run on a production build, port 3200 (`npm run e2e:walkthrough`
  alone; `npm run e2e -- <file>` runs only that file of the first); stop `npm run dev` first)
- `npm run sim:whatsapp`, `sim:sms`, `sim:call` — the fake phone for the local shifts line;
  `npm run walkthrough:files` — the sample import files (`docs/walkthrough.md`)
- `npm run build` then `npm start` (with `npm run worker`) — the production-mode run locally;
  `npm run db:down` — stop the local database
- `./scripts/verify.sh` — runs all of the above and writes the verified stamp

(Create these scripts in Phase 0 if missing.)

## Conventions

- UTC in the database; display in Europe/London.
- Money as integer pence. Phone numbers as E.164.
- No `any`. Validate every external input with zod at the boundary.
- Small modules. Pure functions for rules so they're easy to test.
- Every new table gets `firm_id`, `created_at`, `.enableRLS()` with the tenant policy, a
  `TABLE_ACCESS` entry (`src/lib/db/admin/access.ts`) and isolation fixtures
  (`tests/helpers/tenant-rows.ts`). Links between firm tables are composite `(firm_id, x_id)` FKs.
- App code reaches the database only through `withFirm()` (and `resolveFirmBySlug()` for host
  lookup). Firm jobs extend `firmJobEnvelope`; payloads carry ids only.
- Dev messaging uses `MESSAGING_TRANSPORT=console` and `EMAIL_TRANSPORT=console` (prints
  outbound messages). Never hit Twilio, an SMTP server, Anthropic, TravelTime, postcodes.io or a
  planner from tests: the settings refuse each real sender under `NODE_ENV=test`, and
  `scripts/invariants.sh` checks the test setups' pins (email and Twilio today).

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

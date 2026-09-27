# ShiftDesk starter pack (working name)

Everything needed to start building in Claude Code: the product, the plan, the decisions,
the business case and the rules. No code yet — Claude Code builds it phase by phase.

## Start here

New to this pack? Read `START-HERE.md` first. It is the step-by-step operating guide: setup,
the per-session loop, how to prompt, what to do when things go wrong, and the first week.

Short version:

1. Unzip, `cd shiftdesk-starter`, `chmod +x scripts/*.sh .claude/hooks/*.sh`, `cp .env.example .env`,
   `git init && git add -A && git commit -m "starter pack"`.
2. `./scripts/selftest.sh` must print SELFTEST PASSED (needs `git` and `jq`).
3. `claude` from inside the folder. It reads `CLAUDE.md` automatically.
4. Paste the Phase 0 kickoff prompt from `PLAN.md`. After that, `/next-task` every session.
   `/close-task` is the only way a task gets ticked: verify script, then independent audit.
5. End each session with `/log-hours 2.5 Phase 1 login links` (your real hours), then `/clear`.

## What's in here

| File | What it's for |
|---|---|
| `START-HERE.md` | The operating guide for you: setup, session loop, prompting, first week |
| `CLAUDE.md` | Project memory: golden rules, stack, conventions, how to work |
| `PLAN.md` | Build + sell timeline, gates, phases with tasks and kickoff prompts, hours log |
| `docs/product-spec.md` | What we're building and why (PRD) |
| `docs/architecture.md` | How it fits together |
| `docs/data-model.md` | Tables and the Postgres sketch |
| `docs/decisions.md` | Why we chose what we chose |
| `docs/business.md` | Market, pricing, costs, competitors, evidence, sources |
| `docs/go-to-market.md` | First customers, call script, pilot offer, objections |
| `docs/compliance.md` | GDPR, credentials, 2027 rules, AI disclosure |
| `docs/screens.md` | Every screen and its states |
| `docs/api-and-jobs.md` | Webhooks, actions, background jobs |
| `docs/rules-and-credentials.md` | Eligibility rules and credential packs |
| `docs/messaging-templates.md` | All message copy and the notification policy |
| `docs/testing.md` | Tests that must exist, demo seed, pre-pilot checklist |
| `docs/runbooks.md` | What to do when things break |
| `docs/pilot-playbook.md` | How to run and measure the pilot |
| `CHANGES.md` | What changed in each version of this pack |
| `docs/verification.md` | How "done" is enforced, and why agents can't fool themselves |
| `scripts/verify.sh` | The only thing that can say "verified"; writes a stamp tied to the file tree |
| `scripts/selftest.sh` | Proves the hooks work on your machine (run once after unzipping) |
| `.claude/hooks/` | Blocks ticking tasks or claiming "done" without a matching passing stamp; filters test output |
| `.claude/commands/` | `/next-task`, `/close-task`, `/verify`, `/fact-check`, `/log-hours` |
| `.claude/agents/` | `claims-auditor` (is it really done?), `doc-fact-checker` (are the docs right?), `guardrails-reviewer` (golden rules). All read-only |

## The one rule about pace

Selling starts in week 1. Don't build past Phase 3 (the clickable demo) until 10 discovery
calls are done and at least 2 firms say they'd pay for a pilot (Gate A in `PLAN.md`).

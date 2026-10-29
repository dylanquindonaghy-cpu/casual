# src/lib/integrations: the planner API and its webhooks out

Read when working here (the root `CLAUDE.md` still applies). Docs: `docs/office-v2.md` §5.3.2 and
§5.3.3, `docs/integrations.md`, ADR-022 in `docs/decisions.md`.

- `/api/v1` is not a provider webhook (golden rule 3's exception): each write is one short
  transaction answered in the request, made idempotent by the planner's own ref. Every call to a
  route that exists goes through `handleApiRequest()` (`api.ts`) in its order: platform address only, the key's shape
  before any look-up, `resolveApiKey()` by sha256, the per-key throttle.
- Keys (`keys.ts`): only the sha256 and the last 4 characters are kept; the key is shown once and
  never logged.
- Sessions (`sessions.ts`): the planner's rules for a session, shared by a connector
  (`src/lib/roster/firm-caller.ts`): the caller's row held `for share` in the change's own
  transaction, Gate B on writes, and a network look-up never inside a transaction.
- The action log is the outbox (`outbox.ts`): `recordEvent()` queues `webhook-deliver` in the same
  transaction; the job carries ids only and builds the body when it sends (`deliver.ts`).
- Tests never reach a planner: `INTEGRATIONS_SECRET` is made up in the test setups
  (`scripts/invariants.sh` checks it).

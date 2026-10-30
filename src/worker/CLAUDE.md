# src/worker: the job worker

Read when working here (the root `CLAUDE.md` still applies). Docs: `docs/api-and-jobs.md` (the job
catalogue), ADR-027 (the database's time limits per transaction).

- A separate Node process sharing the codebase; pg-boss keeps the queue in Postgres. Every queue is
  in `jobs/queues.ts` (`db:migrate` creates them, and the worker brings them up to date on boot).
  Firm queues use the standard policy and are never partitioned: another policy would let one
  firm's job silently stop another firm's.
- Firm jobs extend `firmJobEnvelope` (`src/lib/jobs/firm-job.ts`) and carry ids only (pg-boss has
  no RLS); each runs marked with its firm (`runAsFirm`, `src/lib/tenancy/job-firm.ts`, which a
  sender reads) and reaches the database only through `withFirm()`, which scopes it.
- Webhook handlers write one row and queue a job; the work happens here (golden rule 3), so a
  retried job must never send or book twice: claim, then send with no transaction open, then record.
- Demo mode (ADR-025) only ever with the made-up demo firms (`src/lib/demo/guard.ts`).

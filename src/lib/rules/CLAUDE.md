# src/lib/rules: the rules engine

Read when working here (the root `CLAUDE.md` still applies). Docs: `docs/rules-and-credentials.md`
(its checks, packs and test cases), `docs/api-and-jobs.md` ("Offer-wave ranking").

- Golden rule 1: code decides who may take a shift, never a model. Everything here is pure: no
  database, no clock, no settings look-ups. Callers load the rows (`src/lib/roster/*-input.ts`)
  and pass them in, so the rules are tested as tables.
- `checkEligibility()` (`eligibility.ts`) gives every failing check's code and plain-English
  reason, in the doc's order, and an `EligibilityPass` only it can make, which booking requires.
  The office may override only a started shift, rest, weekly hours and unavailable, with a reason;
  never credentials, role, account, site or a double booking.
- Golden rule 6: credential rules are data per sector (`packs.ts`), never hardcoded to SIA.
  `tests/unit/credential.packs.test.ts` fails if the packs and the doc's table differ: change both.
- Input that makes no sense throws: it must never let a worker through.

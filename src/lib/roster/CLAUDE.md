# src/lib/roster: shifts, bookings and the rota's sources

Read when working here (the root `CLAUDE.md` still applies). Docs: `docs/architecture.md`
("Roster plugs", "Take an open shift", "Cancel"), `docs/data-model.md`, ADR-013 and ADR-026.

- A person's "yes" (a casual's, or the office placing someone) goes through `bookShift()`
  (`book.ts`): lock the shift, then the worker, rerun the rules on the current rows with
  `checkBooking()`, book through the plug's `assign()` and write the event, in one transaction. A
  rota sheet's sync and a connector book with `checkBooking()` and `assign()` themselves, the same
  rules. First yes wins (golden rule 4): one conditional update, zero rows means already filled.
- One booking is cancelled with `cancelBooking()` (`cancel.ts`); the firm cancels or moves a whole
  session with `cancelShiftByFirm()` (`cancel.ts`) and `moveShiftByFirm()` (`firm-change.ts`),
  each change with a reason and notice hours per booked casual (golden rules 5 and 12). Only
  booking reruns the rules.
- A `RosterPlug` (`plug.ts`) records; it doesn't decide. Every adapter passes the contract suite in
  `tests/helpers/roster-contract.ts`.
- A Google Sheet syncs in a job, never a request (`sheets/sync.ts`), under a lease; who holds a
  shift is a three-way merge (`sheets/merge.ts`): a booking a casual was told is confirmed is never
  dropped by a merge. A connector (`src/lib/connector/`) mirrors its bookings through the same merge.
- Who may change a whole session for the firm (`firm-caller.ts`): the office, the planner's key or a
  connector, the caller's row held `for share`; every firm change records a reason and notice hours
  per booked casual.

# src/lib/roster: shifts, bookings and the rota's sources

Read when working here (the root `CLAUDE.md` still applies). Docs: `docs/architecture.md`
("Roster plugs", "Take an open shift", "Cancel"), `docs/data-model.md`, ADR-013 and ADR-026.

- Every "yes" goes through `bookShift()` (`book.ts`) and every cancellation through
  `cancelBooking()` (`cancel.ts`), each in its own transaction: lock the shift, then the worker,
  rerun the rules on the current rows, write the event in the same transaction (golden rules 4, 5
  and 12). First yes wins: one conditional update, zero rows means already filled.
- A `RosterPlug` (`plug.ts`) records; it doesn't decide. Every adapter passes the contract suite in
  `tests/helpers/roster-contract.ts`.
- A Google Sheet syncs in a job, never a request (`sheets/sync.ts`), under a lease; who holds a
  shift is a three-way merge (`sheets/merge.ts`): a booking a casual was told is confirmed is never
  dropped by a merge. A connector (`src/lib/connector/`) mirrors its bookings through the same merge.
- Who may change a whole session for the firm (`firm-caller.ts`): the office, the planner's key or a
  connector, the caller's row held `for share`; every firm change records a reason and notice hours
  per booked casual.

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
  each change with a reason and notice hours per booked casual (golden rules 5 and 12). A move
  reruns the rules for each booked casual at the new time (`recheckHolders()`, `recheck.ts`) and is
  refused if one fails a check the office can't override (for the planner, any check); a
  cancellation runs no rules.
- A `RosterPlug` (`plug.ts`) records; it doesn't decide. Every adapter passes the contract suite in
  `tests/helpers/roster-contract.ts`.
- A Google Sheet syncs in a job, never a request (`sheets/sync.ts`), under a lease; who holds a
  shift is a three-way merge (`sheets/merge.ts`): a booking made here since the last sync is always
  kept, even past the headcount, and a name taken out of the sheet (or a casual's cancel) removes
  one. A connector (`src/lib/connector/`) mirrors its bookings through the same merge.
- Who may change a whole session for the firm (`firm-caller.ts`): an active admin or resourcer
  (`officeCanPlace()`, a plain read), the planner's key or a connector, the key's or the source's
  row held `for share` in the change's own transaction; every firm change records a reason and
  notice hours per booked casual.

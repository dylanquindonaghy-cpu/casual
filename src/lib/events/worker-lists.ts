// The entries whose data lists the workers they're about (`workers: [{workerId, …}]`): a refused
// move (src/lib/roster/firm-change.ts) and a refused rota sheet change
// (src/lib/roster/sheets/sync.ts). The action log finds them by worker through this list (Phase
// 25.3: src/lib/office/action-log.ts, also a casual's data export), so recordEvent() refuses a
// `workers` list under any other action: a new one is added here, or it would be missed.
export const WORKER_LIST_ACTIONS: readonly string[] = [
  "shift.move_refused",
  "roster.sheet_change_refused",
];

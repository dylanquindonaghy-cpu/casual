// Payroll's answers she has seen on Pay (Phase 28.10; docs/screens.md "### 28.10"). Pure and
// browser-safe: the Pay page's watcher (src/app/pay/pay-answers-seen.tsx) uses it.
//
// Her marker (workers.pay_answers_read_at) is one point in time: marking up to a time marks every
// answer sorted by then (src/lib/portal/request-answers.ts markPayAnswersSeen). So it may only move
// past an answer once that answer, and every unseen answer sorted before it, has been on her
// screen. An answer she hasn't scrolled to yet keeps counting, wherever it sits in the list (the
// list is newest query first, not in the order payroll answered).

export interface WatchedAnswer {
  resolvedAt: number; // when payroll sorted it (ms since 1970)
  inView: boolean; // it has been on her screen since the page was drawn
}

// The latest sorting time she has seen everything up to, or null when the earliest unseen answer
// hasn't been on her screen yet. Answers sorted in the same millisecond count together: one of them
// still off screen holds them all.
export function seenUpTo(answers: readonly WatchedAnswer[]): number | null {
  const sorted = [...answers].sort(
    (a, b) => a.resolvedAt - b.resolvedAt || Number(a.inView) - Number(b.inView),
  );
  let upTo: number | null = null;
  for (const a of sorted) {
    if (!a.inView) break;
    upTo = a.resolvedAt;
  }
  return upTo;
}

// The time sent to the seen action for `upTo`: one millisecond past it, since the database keeps
// microseconds and a Date only milliseconds (so the answer itself is never just missed), and never
// past when the page was drawn (`shownAt`), so an answer sorted since keeps counting.
export const markUntil = (upTo: number, shownAt: number): number => Math.min(upTo + 1, shownAt);

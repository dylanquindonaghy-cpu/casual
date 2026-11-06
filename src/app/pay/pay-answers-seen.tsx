"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { markUntil, seenUpTo, type WatchedAnswer } from "@/lib/portal/pay-answers-seen";
import { markPayAnswersSeenAction } from "./actions";

// Payroll's answers on her screen (Phase 28.10; docs/screens.md "### 28.10"): wraps her pay
// queries, behind the code. Each answer she hasn't seen is marked in the list (`data-pay-answer`,
// with when payroll sorted it in `data-resolved-at`: src/app/pay/pay-view.tsx). Each is watched on
// its own; once it is in view (above the tab bar), it counts as seen. The marker then moves, through
// an action, only as far as every unseen answer sorted by then has been on screen (seenUpTo), and
// never past when the page was drawn (`shownAt`): an answer still below the fold, or sorted after
// the page was drawn, keeps counting. The page loading by itself never marks anything. Then the page
// draws again, so the Pay tab's count goes. Where the browser can't watch the screen, it marks once
// the rows are drawn (they're on the page she opened to see them).
export function PayAnswersSeen({ shownAt, children }: { shownAt: string; children: ReactNode }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const marked = useRef(Number.NEGATIVE_INFINITY); // the furthest time sent and taken
  const sending = useRef(false);

  useEffect(() => {
    const el = box.current;
    const drawn = Date.parse(shownAt);
    if (!el || !Number.isFinite(drawn)) return;
    const rows = [...el.querySelectorAll<HTMLElement>("[data-pay-answer]")];
    const answers: (WatchedAnswer & { el: HTMLElement })[] = rows
      .map((row) => ({
        el: row,
        resolvedAt: Date.parse(row.dataset.resolvedAt ?? ""),
        inView: false,
      }))
      .filter((a) => Number.isFinite(a.resolvedAt));
    if (answers.length === 0) return;
    const mark = () => {
      const upTo = seenUpTo(answers);
      if (upTo === null || sending.current) return;
      const until = markUntil(upTo, drawn);
      if (until <= marked.current) return;
      sending.current = true;
      void markPayAnswersSeenAction(new Date(until).toISOString())
        .then((r) => {
          sending.current = false;
          if (r.status !== "seen" && r.status !== "nothing_new") return;
          marked.current = until;
          if (r.status === "seen") router.refresh();
          mark(); // more came into view while this one was on its way
        })
        .catch(() => {
          sending.current = false; // again when the next answer comes into view
        });
    };
    if (typeof IntersectionObserver === "undefined") {
      for (const a of answers) a.inView = true;
      mark();
      return;
    }
    // The bottom 96px is the tab bar's: a row only peeking out under it isn't on screen yet.
    const watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const answer = answers.find((a) => a.el === entry.target);
          if (answer) answer.inView = true;
          watch.unobserve(entry.target);
        }
        mark();
      },
      { rootMargin: "0px 0px -96px 0px" },
    );
    for (const a of answers) watch.observe(a.el);
    return () => watch.disconnect();
  }, [shownAt, router]);

  return <div ref={box}>{children}</div>;
}

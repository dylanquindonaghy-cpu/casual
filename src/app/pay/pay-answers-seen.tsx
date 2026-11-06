"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { markPayAnswersSeenAction } from "./actions";

// Payroll's answer on her screen (Phase 28.10; docs/screens.md "### 28.10"): wraps a sorted pay
// query's row, behind the code. Once any of it is in view (above the tab bar), it tells the server
// she has seen the answers sorted up to when the page was drawn (`shownAt`), through an action:
// the page loading by itself never marks anything. Then the page draws again, so the Pay tab's
// count goes. Once a page: a refresh keeps the mark done. Where the browser can't watch the screen,
// it marks once the row is drawn (it's on the page she opened to see it).
export function PayAnswersSeen({ shownAt, children }: { shownAt: string; children: ReactNode }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el || done.current) return;
    const mark = () => {
      if (done.current) return;
      done.current = true;
      void markPayAnswersSeenAction(shownAt)
        .then((r) => {
          if (r.status === "seen") router.refresh();
          else if (r.status === "error") done.current = false; // again when the page next draws
        })
        .catch(() => {
          done.current = false;
        });
    };
    if (typeof IntersectionObserver === "undefined") {
      mark();
      return;
    }
    // The bottom 96px is the tab bar's: a row only peeking out under it isn't on screen yet.
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          watch.disconnect();
          mark();
        }
      },
      { rootMargin: "0px 0px -96px 0px" },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [shownAt, router]);

  return (
    <div ref={box} data-pay-answer="">
      {children}
    </div>
  );
}

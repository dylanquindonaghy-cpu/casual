"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { markAnswersSeenAction } from "./actions";

// The office's answers on My requests are on her screen now (Phase 28.9; docs/screens.md "### 28.9"):
// once this part has shown in the browser, it tells the server through an action, never while the
// page is made, so a prefetch (which makes the page without showing it) can't clear the count.
// `shownAt` is when the page was made: only answers given by then are marked, so one that arrives
// while she reads still counts. If that moved the marker, the page is made again so the tab bar's
// count goes. Once per page; it draws nothing.
export function AnswersSeen({ shownAt }: { shownAt: string }) {
  const router = useRouter();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    markAnswersSeenAction(shownAt)
      .then((result) => {
        if (result.status === "seen" && result.moved) router.refresh();
      })
      .catch(() => {
        // No signal or a failed tap: the count stays until she next opens the page.
      });
  }, [router, shownAt]);
  return null;
}

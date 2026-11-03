"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { MARK_SEEN, markSeenResultText } from "@/lib/office/updates-copy";
import { btn } from "../../ui/classes";
import { markUpdatesSeenAction } from "./actions";

const failed = { status: "error" as const };

// "Mark all as seen" (Phase 26.4; the mock-up's Updates): what the page shows has been seen, as of
// when it was drawn (`shownAt`), so the bell and the "New" marks start again from there. Shown while
// something is new; the answer stays here once the page has drawn again with nothing new. Waits for
// the page (docs/ui-design.md "Forms wait for the page").
export function MarkSeen({ shownAt, newCount }: { shownAt: string; newCount: number }) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const mark = () =>
    start(async () => {
      const r = await markUpdatesSeenAction(shownAt).catch(() => failed);
      setMessage(markSeenResultText(r.status));
      if (r.status === "seen") router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {message && (
        <p role="status" className="text-sm text-ink-muted">
          {message}
        </p>
      )}
      {newCount > 0 && (
        <button type="button" onClick={mark} disabled={pending || !ready} className={btn.secondary}>
          {MARK_SEEN}
        </button>
      )}
    </div>
  );
}

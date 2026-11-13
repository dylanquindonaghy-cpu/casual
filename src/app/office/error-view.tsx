"use client";

import { btn, page } from "../ui/classes";
import { PageHeader } from "../ui/page-header";

// What an office page that fails says (Phase 37.6, w1-08): src/app/office/error.tsx shows it inside
// the office frame, and the root src/app/error.tsx on /office addresses (the frame itself failed:
// the office's words, without the frame). Its own file, so the casual app's ErrorBody stays as it
// is. "Try again" is Next's retry() (it fetches the page from the server again), disabled until
// the page is ready and while there's no signal, as the casual app's. "Back to the office" is a
// plain link, a full page load. No "contact the office" (they are the office) and no "Updated"
// time.
export function OfficeErrorView({
  online,
  ready,
  retry,
}: {
  online: boolean;
  ready: boolean;
  retry: () => void;
}) {
  return (
    <main className={page.officeForm}>
      <PageHeader title={online ? "Something went wrong" : "No signal"} stamp={false}>
        <p>
          {online ? "It's not you. Try again in a moment." : "Check your signal and try again."}
        </p>
      </PageHeader>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={retry} disabled={!ready || !online} className={btn.primary}>
          Try again
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose */}
        <a href="/office" className={btn.secondary}>
          Back to the office
        </a>
      </div>
    </main>
  );
}

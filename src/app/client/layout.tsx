import type { ReactNode } from "react";

// The client's pages (Phase 36.3): a client contact's login, its link page and their events, in the
// office's look (the mock-up's "in the office's look"). Each page checks its own session
// (requireClient); this only wraps them in [data-office] (the office's sizes and colours), drawing
// no box of its own.
export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <div data-office="" className="contents">
      {children}
    </div>
  );
}

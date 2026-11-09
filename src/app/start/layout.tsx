import type { ReactNode } from "react";

// The staffing demo's pages (Phase 31; docs/screens.md "Phase 31"): the login, "Choose a view", its
// phone frame and the quick guide. Outside the office shell, in the office's look ([data-office]:
// its sizes, colours and glass, as the office login has). Each page checks its own access.
export default function StartLayout({ children }: { children: ReactNode }) {
  return (
    <div data-office="" className="contents">
      {children}
    </div>
  );
}

import type { ReactNode } from "react";

// The client's pages (Phase 36.3): a client contact's login, its link page and, once logged in,
// their events and requests ((in)/layout.tsx draws their frame), in the office's look (the
// mock-up's "in the office's look, light"). Each page checks its own session (requireClient); this
// only wraps them in [data-office] (the office's sizes and colours), drawing no box of its own.
//
// Light by default (the approved mock-up): the office is dark with no theme picked, so with no
// sd-theme cookie this one line marks <html> light before the page is drawn (the root layout lets
// <html>'s own attributes differ: suppressHydrationWarning). Someone who picked dark keeps it.
const LIGHT_UNLESS_PICKED =
  'try{if(!/(?:^|; )sd-theme=/.test(document.cookie))document.documentElement.setAttribute("data-theme","light")}catch(e){}';

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <div data-office="" data-client="" className="contents">
      <script dangerouslySetInnerHTML={{ __html: LIGHT_UNLESS_PICKED }} />
      {children}
    </div>
  );
}

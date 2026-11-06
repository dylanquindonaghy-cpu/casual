// "Skip to the menu" (Phase 30.2; docs/screens.md "### 30.2"). From 1024px the casual app's tab bar
// is the rail at the window's left (src/app/tab-bar.tsx), but it's still last in the page, so the
// keyboard would reach it only after everything else. The root layout puts this link first on
// every firm page, after the firm's bar (which has no links): hidden until it has focus, as the
// office's "Skip to content" (src/app/office/office-frame.tsx), it jumps to the nav (its id).
// Shown only from 1024px and only on a page with the casual nav (globals.css, "Skip to the menu
// (30.2)": a[data-skip-menu]); on a phone the bar's at the screen's foot and the page reads first.
// Hook-free, no imports: the layout renders it for the office's pages too, where it never shows.

export const CASUAL_MENU_ID = "casual-menu";
export const SKIP_TO_MENU = "Skip to the menu";

export function SkipToMenu() {
  return (
    <a
      href={`#${CASUAL_MENU_ID}`}
      data-skip-menu=""
      className="sr-only focus:not-sr-only focus:bg-ink focus:px-4 focus:py-3 focus:text-base focus:font-semibold focus:text-on-ink"
    >
      {SKIP_TO_MENU}
    </a>
  );
}

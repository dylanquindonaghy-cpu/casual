import Link from "next/link";
import { Icon, type IconName } from "./ui/icons";

// The casual app's bottom tab bar (docs/office-v2.md 4.1; docs/screens.md "Casual app"; 12H.1;
// Phases 18, 20 and 24): Home · Shifts · Pay · Profile, four links (not a list: a page's own lists are
// counted alone), each with its icon and its word, on every page a logged-in casual uses (not Help,
// which anyone may open, nor the login pages, nor a shift's own page, which has its way back at the
// top and Take shift at the foot). Phase 24 (24.6, round 7 of the canvas): a capsule of the
// strongest glass floating 14px above the foot of the screen; the current tab (aria-current
// "page") under a lens of bright glass, its icon and word in the firm's colour and bold, so not by
// colour alone. While you scroll down it shrinks to its icons (54px tall, at most 290px wide: the
// words stay for screen readers); scrolling up, reaching the top, or a tap on it opens it again
// (ChromeWatch). Profile carries a to-do count (pale yellow), with words for screen readers, when
// something there needs her (a qualification to sort out, or her photo overdue or due soon).
// <TabBarSpace /> at the end of the page keeps the last of it clear. Plain links: it works with no
// JavaScript (always open), and in the offline copy.

export type CasualTab = "home" | "shifts" | "pay" | "profile";

const TABS: { tab: CasualTab; href: string; words: string; icon: IconName }[] = [
  { tab: "home", href: "/", words: "Home", icon: "home" },
  { tab: "shifts", href: "/shifts", words: "Shifts", icon: "shifts" },
  { tab: "pay", href: "/pay", words: "Pay", icon: "pay" },
  { tab: "profile", href: "/profile", words: "Profile", icon: "profile" },
];

// "1 thing needs doing", "2 things need doing".
export const profileCountWords = (n: number) =>
  n === 1 ? "1 thing needs doing" : `${n} things need doing`;

export function TabBar({
  current,
  profileCount = 0,
}: {
  current: CasualTab;
  profileCount?: number;
}) {
  return (
    <nav
      aria-label="Main"
      data-tab-bar=""
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[calc(0.875rem+env(safe-area-inset-bottom))]"
    >
      <div className="glass-float pointer-events-auto mx-auto grid h-17 max-w-md grid-cols-4 gap-1 rounded-full p-1.5 motion-safe:transition-[height,max-width] motion-safe:duration-300 motion-safe:ease-sd [html[data-tabs-mini]_&]:h-13.5 [html[data-tabs-mini]_&]:max-w-72.5 [html[data-tabs-mini]_&]:p-1.25">
        {TABS.map(({ tab, href, words, icon }) => {
          const here = tab === current;
          const count = tab === "profile" ? profileCount : 0;
          return (
            <Link
              key={tab}
              href={href}
              aria-current={here ? "page" : undefined}
              // One name, read as written: hidden words inside the link would be read after a gap
              // ("Profile , 1 thing…"), as the browser puts space around them.
              aria-label={count > 0 ? `${words}, ${profileCountWords(count)}` : undefined}
              className={`press-glass flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-sm focus-visible:-outline-offset-2 ${
                here
                  ? "lens font-semibold text-brand-ink"
                  : "font-medium text-ink-muted hover:text-ink"
              }`}
            >
              <span className="relative flex items-center justify-center">
                <Icon name={icon} size={22} />
                {count > 0 && (
                  <span
                    aria-hidden="true"
                    data-profile-count=""
                    className="absolute -top-2 -right-3 min-w-5 rounded-full bg-hivis px-1.5 text-center text-xs leading-5 font-semibold text-on-hivis"
                  >
                    {count}
                  </span>
                )}
              </span>
              <span className="leading-tight [html[data-tabs-mini]_&]:sr-only">{words}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// Room at the end of a page for the fixed bar, so the last button is never under it.
export function TabBarSpace() {
  return <div aria-hidden="true" className="h-28" />;
}

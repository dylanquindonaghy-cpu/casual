import Link from "next/link";
import { Icon, type IconName } from "./ui/icons";

// The casual app's bottom tab bar (docs/office-v2.md 4.1; docs/screens.md "Casual app"; 12H.1;
// Phases 18 and 20): Home · Shifts · Pay · Profile, four links (not a list: a page's own lists are
// counted alone), each with its icon and its word at 15px, on every page a logged-in casual uses
// (not Help, which anyone may open, nor the login pages). The current tab is marked (aria-current
// "page"): its word bold, its icon on a pill filled in the firm's colour, so not by colour alone.
// Profile carries a to-do count (pale yellow), with words for screen readers, when something
// there needs her (a qualification to sort out, or her photo overdue or due soon). Fixed to the
// bottom of the screen, floating over the page as it scrolls (Phase 20: the bar depth token, no
// line); <TabBarSpace /> at the end of the page keeps the last of it clear. Plain links: it works
// with no JavaScript, and in the offline copy.

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
      className="glass-float fixed inset-x-0 bottom-0 z-20 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid max-w-md grid-cols-4 px-2 pt-1.5 pb-2">
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
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-base focus-visible:-outline-offset-2 ${
                here ? "font-semibold text-ink" : "font-medium text-ink-muted hover:text-ink"
              }`}
            >
              <span
                className={`relative flex h-8 w-12 items-center justify-center rounded-full ${
                  here ? "bg-brand text-on-brand" : ""
                }`}
              >
                <Icon name={icon} size={22} />
                {count > 0 && (
                  <span
                    aria-hidden="true"
                    data-profile-count=""
                    className="absolute -top-1.5 -right-2.5 min-w-5 rounded-full bg-hivis px-1.5 text-center text-xs leading-5 font-semibold text-on-hivis"
                  >
                    {count}
                  </span>
                )}
              </span>
              <span>{words}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// Room at the end of a page for the fixed bar, so the last button is never under it.
export function TabBarSpace() {
  return <div aria-hidden="true" className="h-24" />;
}

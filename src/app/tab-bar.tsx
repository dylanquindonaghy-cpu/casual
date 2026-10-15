import Link from "next/link";
import { Icon, type IconName } from "./ui/icons";

// The casual app's bottom tab bar (docs/office-v2.md 4.1; docs/screens.md "Casual app"; 12H.1):
// Home · Shifts · Pay · Profile, four links (not a list: a page's own lists are counted alone), each with its icon and its word, on every page a logged-in
// casual uses (not Help, which anyone may open, nor the login pages). The current tab is marked
// (aria-current="page", bold and underlined, not by colour alone). Profile carries a dot, with
// words for screen readers, when something there needs her (a qualification to sort out, or her
// photo overdue or due soon). Fixed to the bottom of the screen; <TabBarSpace /> at the end of the
// page keeps the last of it clear. Plain links: it works with no JavaScript, and in the offline
// copy.

export type CasualTab = "home" | "shifts" | "pay" | "profile";

const TABS: { tab: CasualTab; href: string; words: string; icon: IconName }[] = [
  { tab: "home", href: "/", words: "Home", icon: "home" },
  { tab: "shifts", href: "/shifts", words: "Shifts", icon: "shifts" },
  { tab: "pay", href: "/pay", words: "Pay", icon: "pay" },
  { tab: "profile", href: "/profile", words: "Profile", icon: "profile" },
];

export const PROFILE_DOT_WORDS = "something needs updating";

export function TabBar({
  current,
  profileDot = false,
}: {
  current: CasualTab;
  profileDot?: boolean;
}) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ tab, href, words, icon }) => {
          const here = tab === current;
          const dot = tab === "profile" && profileDot;
          return (
            <Link
              key={tab}
              href={href}
              aria-current={here ? "page" : undefined}
              // One name, read as written: hidden words inside the link would be read after a gap
              // ("Profile , something…"), as the browser puts space around them.
              aria-label={dot ? `${words}, ${PROFILE_DOT_WORDS}` : undefined}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-sm focus-visible:-outline-offset-4 ${
                here
                  ? "font-bold text-ink underline decoration-2 underline-offset-4"
                  : "font-semibold text-ink-muted hover:text-ink"
              }`}
            >
              <span className="relative">
                <Icon name={icon} className="h-6 w-6" />
                {dot && (
                  <span
                    data-profile-dot=""
                    className="absolute -top-0.5 -right-1 h-2.5 w-2.5 rounded-full bg-urgent-fill ring-2 ring-card"
                  />
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

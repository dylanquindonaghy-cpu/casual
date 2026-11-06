import Link from "next/link";
import { messagesCountWords } from "@/lib/portal/messages-copy";
import { Icon, type IconName } from "./ui/icons";

// The casual app's bottom tab bar (docs/office-v2.md 4.1; docs/screens.md "Casual app"; 12H.1;
// Phases 18, 20 and 24; Messages since Phase 25.6): Home · Shifts · Messages · Pay · Profile, five
// links (not a list: a page's own lists are counted alone), each with its icon and its word, on
// every page a logged-in casual uses (not Help, which anyone may open, nor the login pages, nor a
// shift's own page, which has its way back at the top and Take shift at the foot). Phase 28 (28.1;
// docs/screens.md "The casual app, Phase 28"): the office rail on its side, a capsule of the
// strongest glass, 12px round, 12px from the screen's edges and its foot (over the phone's own safe
// area); each tab 8px round, and the current tab (aria-current "page") solid ink with its icon and
// word on it in bold, as the rail's lit item (round 7's lens and the firm's colour are gone), so
// not by colour alone. While you scroll down it shrinks to its icons (54px tall, at most 290px
// wide: the words stay for screen readers); scrolling up, reaching the top, or a tap on it opens it
// again (ChromeWatch). Counts, each with its words for screen readers in the link's name:
// Profile's (pale amber when something there needs doing, a qualification to sort out or her photo
// overdue or due soon; with the answers to her requests she hasn't seen added, in the firm's colour
// when it's only answers), Messages' (the office's replies she hasn't opened Messages since) and
// Pay's (payroll's answers to her pay queries she hasn't seen), both in the firm's colour. A count
// of 0 shows nothing. <TabBarSpace /> at the end of the page keeps the last of it clear. Plain links:
// it works with no JavaScript (always open), and in the offline copy.
//
// Phase 30 (30.2; docs/screens.md "### 30.2"): from 1024px the same nav is the office's rail at the
// window's left edge instead (one nav, one set of links: never two menus read twice). A glass
// column 96px wide, 12px from the window's top and left, that stays put as the page scrolls: the
// firm's mark at its top (its initial on its own colour, as the office rail's), then the five
// links one under the other, each a tile at least 64px tall with its icon and its word under it,
// the current one solid ink as here, the counts on the icons as here. It never shrinks (the words
// always show), and the room for the bar at the page's end goes. All of it is CSS (globals.css,
// the "Phase 30 (30.2)" block, which also moves the page right of the rail), so it works with no
// JavaScript and in the offline copy. `railOnly` draws the rail alone, with nothing below 1024px
// (data-rail-only): a shift's own page, with its own bar at the top and Take shift at the foot.

export type CasualTab = "home" | "shifts" | "messages" | "pay" | "profile";

const TABS: { tab: CasualTab; href: string; words: string; icon: IconName }[] = [
  { tab: "home", href: "/", words: "Home", icon: "home" },
  { tab: "shifts", href: "/shifts", words: "Shifts", icon: "shifts" },
  { tab: "messages", href: "/messages", words: "Messages", icon: "messages" },
  { tab: "pay", href: "/pay", words: "Pay", icon: "pay" },
  { tab: "profile", href: "/profile", words: "Profile", icon: "profile" },
];

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

// Profile's count, for screen readers (docs/screens.md "The casual app, Phase 28"): "1 thing needs
// doing", "2 things need doing"; with answers to her requests, "1 thing needs doing and 1 new
// answer"; answers alone, "1 new answer", "2 new answers".
export const profileCountWords = (needs: number, answers = 0) =>
  [
    needs > 0 ? plural(needs, "thing needs doing", "things need doing") : "",
    answers > 0 ? plural(answers, "new answer", "new answers") : "",
  ]
    .filter(Boolean)
    .join(" and ");

// Pay's count: "1 new answer from payroll", "2 new answers from payroll".
export const payCountWords = (n: number) =>
  `${plural(n, "new answer", "new answers")} from payroll`;

type Count = { n: number; words: string; mark: string; tone: "todo" | "new" };

function countFor(
  tab: CasualTab,
  c: { needs: number; answers: number; messages: number; pay: number },
): Count | null {
  const needs = Math.max(0, c.needs);
  const answers = Math.max(0, c.answers);
  if (tab === "profile" && needs + answers > 0)
    return {
      n: needs + answers,
      words: profileCountWords(needs, answers),
      mark: "data-profile-count",
      tone: needs > 0 ? "todo" : "new",
    };
  if (tab === "messages" && c.messages > 0)
    return {
      n: c.messages,
      words: messagesCountWords(c.messages),
      mark: "data-messages-count",
      tone: "new",
    };
  if (tab === "pay" && c.pay > 0)
    return { n: c.pay, words: payCountWords(c.pay), mark: "data-pay-count", tone: "new" };
  return null;
}

// The firm's initial on the rail's mark: its first letter or digit (as the firm's bar's).
export const railInitial = (name: string) => name.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "";

export function TabBar({
  current,
  profileCount = 0,
  answersCount = 0,
  messagesCount = 0,
  payCount = 0,
  firm = null,
  railOnly = false,
}: {
  current: CasualTab;
  profileCount?: number; // what needs doing on Profile
  answersCount?: number; // answers to her requests she hasn't seen (added to Profile's count)
  messagesCount?: number;
  payCount?: number; // payroll's answers to her pay queries she hasn't seen
  firm?: { name: string } | null; // the rail's mark (from 1024px); none, no mark
  railOnly?: boolean; // the rail from 1024px and nothing below it (a shift's own page)
}) {
  const counts = {
    needs: profileCount,
    answers: answersCount,
    messages: messagesCount,
    pay: payCount,
  };
  return (
    <nav
      aria-label="Main"
      data-tab-bar=""
      data-rail-only={railOnly ? "" : undefined}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <div className="glass-float pointer-events-auto mx-auto grid h-17 max-w-md grid-cols-5 gap-1 rounded-card p-1.5 motion-safe:transition-[height,max-width] motion-safe:duration-300 motion-safe:ease-sd [html[data-tabs-mini]_&]:h-13.5 [html[data-tabs-mini]_&]:max-w-72.5 [html[data-tabs-mini]_&]:p-1.25">
        {firm && (
          // The firm's mark at the rail's top (from 1024px only: the firm's bar names the firm).
          <span
            aria-hidden="true"
            data-rail-mark=""
            className="mx-auto mb-2 hidden size-10 shrink-0 items-center justify-center rounded-row bg-brand-bar text-lg font-bold text-on-brand-bar lg:flex"
          >
            {railInitial(firm.name)}
          </span>
        )}
        {TABS.map(({ tab, href, words, icon }) => {
          const here = tab === current;
          const count = countFor(tab, counts);
          return (
            <Link
              key={tab}
              href={href}
              aria-current={here ? "page" : undefined}
              // One name, read as written: hidden words inside the link would be read after a gap
              // ("Profile , 1 thing…"), as the browser puts space around them.
              aria-label={count ? `${words}, ${count.words}` : undefined}
              // The focus ring sits inside the tab; on the ink tab it's in the words' colour.
              className={`press-glass flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-row px-1 text-sm focus-visible:-outline-offset-2 ${
                here
                  ? "bg-ink font-semibold text-on-ink focus-visible:outline-on-ink"
                  : "font-medium text-ink-muted hover:bg-active hover:text-ink active:bg-button-press"
              }`}
            >
              <span className="relative flex items-center justify-center">
                <Icon name={icon} size={22} />
                {count && (
                  // Set off from the tab under it by a 2px edge of the page's own ground, so it
                  // shows on the ink tab too (the office rail's dot does the same).
                  <span
                    aria-hidden="true"
                    {...{ [count.mark]: "" }}
                    className={`absolute -top-2 -right-3 min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold outline-2 outline-canvas ${
                      count.tone === "todo" ? "bg-hivis text-on-hivis" : "glass-tint"
                    }`}
                  >
                    {count.n}
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

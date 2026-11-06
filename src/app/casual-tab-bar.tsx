import { tabCounts, type TabCounts } from "@/lib/portal/tab-counts";
import { TabBar, TabBarSpace, type CasualTab } from "./tab-bar";

// The casual tab bar with its counts, and the room it needs at the end of the page (12H.1; Phase
// 28.7: one count for every tab bar). Every casual page takes its numbers from one place, 28.2's
// tabCounts() (src/lib/portal/tab-counts.ts): Profile's (what needs doing, plus the answers to her
// requests she hasn't seen), Messages' (the office's replies she hasn't seen) and Pay's (payroll's
// answers to her pay queries she hasn't seen), so each tab shows the same badge on every page.
// Home and Booked load the counts with the rest of their data and pass them to <CountedTabBar>;
// every other page uses <CasualTabBar>, which loads them itself. Server components: put either
// last inside the page's <main>.

export async function CasualTabBar({
  firm,
  workerId,
  current,
}: {
  firm: { id: string };
  workerId: string;
  current: CasualTab;
}) {
  return <CountedTabBar current={current} counts={await tabCounts({ firm }, workerId)} />;
}

export function CountedTabBar({ current, counts }: { current: CasualTab; counts: TabCounts }) {
  return (
    <>
      <TabBarSpace />
      <TabBar
        current={current}
        profileCount={counts.needs}
        answersCount={counts.answers}
        messagesCount={counts.replies}
        payCount={counts.payAnswers}
      />
    </>
  );
}

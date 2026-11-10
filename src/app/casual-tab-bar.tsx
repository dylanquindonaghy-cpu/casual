import { tabCountsNow } from "@/lib/portal/request-cached";
import type { TabCounts } from "@/lib/portal/tab-counts";
import { getCurrentBrand } from "@/lib/tenancy/current-brand";
import { TabBar, TabBarSpace, type CasualTab } from "./tab-bar";

// The casual tab bar with its counts, and the room it needs at the end of the page (12H.1; Phase
// 28.7: one count for every tab bar). Every casual page takes its numbers from one place, 28.2's
// tabCounts() (src/lib/portal/tab-counts.ts): Profile's (what needs doing, plus the answers to her
// requests she hasn't seen), Messages' (the office's replies she hasn't seen) and Pay's (payroll's
// answers to her pay queries she hasn't seen), so each tab shows the same badge on every page.
// Home and Booked load the counts with the rest of their data and pass them to <CountedTabBar>;
// every other page uses <CasualTabBar>, which loads them itself. Server components: put either
// last inside the page's <main>.
//
// Phase 30 (30.2): from 1024px the bar is the office's rail at the window's left (tab-bar.tsx), with
// the firm's mark at its top: the firm's brand as the firm's bar shows it (the layout has already
// read it: cache()). A shift's own page has no bar on a phone but the rail on a laptop:
// <CasualRail>, with the same counts.

async function railFirm(): Promise<{ name: string } | null> {
  const brand = await getCurrentBrand();
  return brand ? { name: brand.name } : null;
}

export async function CasualTabBar({
  firm,
  workerId,
  current,
}: {
  firm: { id: string };
  workerId: string;
  current: CasualTab;
}) {
  return <CountedTabBar current={current} counts={await tabCountsNow(firm.id, workerId)} />;
}

export async function CountedTabBar({
  current,
  counts,
}: {
  current: CasualTab;
  counts: TabCounts;
}) {
  return (
    <>
      <TabBarSpace />
      <TabBar
        current={current}
        profileCount={counts.needs}
        answersCount={counts.answers}
        messagesCount={counts.replies}
        payCount={counts.payAnswers}
        firm={await railFirm()}
      />
    </>
  );
}

// The rail alone, from 1024px (nothing below it, and no room kept at the page's end).
export async function CasualRail({
  firm,
  workerId,
  current,
}: {
  firm: { id: string };
  workerId: string;
  current: CasualTab;
}) {
  // Read once per request with the top bar's (Phase 32: src/lib/portal/request-cached.ts).
  const counts = await tabCountsNow(firm.id, workerId);
  return (
    <TabBar
      current={current}
      profileCount={counts.needs}
      answersCount={counts.answers}
      messagesCount={counts.replies}
      payCount={counts.payAnswers}
      firm={await railFirm()}
      railOnly
    />
  );
}

import { profileNeedsYou } from "@/lib/portal/my-shifts";
import { TabBar, TabBarSpace, type CasualTab } from "./tab-bar";

// The tab bar for a casual page that doesn't load Needs updating itself (12H.1): it works out the
// Profile dot (src/lib/portal/my-shifts.ts) and adds the room the bar needs at the end of the page.
// A server component: put it last inside the page's <main>.
export async function CasualTabBar({
  firm,
  workerId,
  current,
}: {
  firm: { id: string };
  workerId: string;
  current: CasualTab;
}) {
  const dot = await profileNeedsYou({ firm }, workerId);
  return (
    <>
      <TabBarSpace />
      <TabBar current={current} profileDot={dot} />
    </>
  );
}

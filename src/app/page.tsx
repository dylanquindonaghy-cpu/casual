import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv, offlineCopyOn } from "@/lib/env";
import { myOffers } from "@/lib/portal/my-offers";
import { myNeedsAndPhoto, myShifts } from "@/lib/portal/my-shifts";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { myPayDay } from "@/lib/portal/pay-day";
import { mySortedMark } from "@/lib/portal/profile";
import { myReachPrompts } from "@/lib/portal/reach-me";
import { tabCounts } from "@/lib/portal/tab-counts";
import { parseHost } from "@/lib/tenancy/host";
import { CountedTabBar } from "./casual-tab-bar";
import { HomeView } from "./home-view";
import { OfflineCopy } from "./offline-copy";
import { refreshSessionAction } from "./session-actions";
import { SessionKeeper } from "./session-keeper";
import { page } from "./ui/classes";

// The root URL serves two sites: the ShiftDesk home page on the base domain, and each firm's
// portal on <slug>.<base domain> or the firm's own domain, where a logged-in casual sees Home
// (docs/office-v2.md 4.2; docs/screens.md, `/`; 12H.1). Any host that isn't the base domain is a
// firm's page: requireWorker() finds the firm (a name that isn't a firm's, or a custom domain not
// verified, is the 404 page). Her bookings are on the Shifts tab (`/shifts`): the old address of
// the last 90 days, `/?view=past`, goes there. Kept for when there's no signal (public/sw.js). Phase
// 28.7: the tab bar's counts from tabCounts(), as on every casual page, and the two "can we reach
// you" rows (src/lib/portal/reach-me.ts), online only. Phase 28.15: her offers still open to her
// ("Offered to you", src/lib/portal/my-offers.ts), and the office's latest "Mark as sorted", so a
// need it has in hand leaves "Do this" as it does on Profile.
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const match = parseHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  if (match && match.kind !== "apex") {
    if ((await searchParams).view === "past") redirect("/shifts?view=past");
    const { firm, worker, session } = await requireWorker();
    const now = new Date();
    const clock = { now: () => now };
    const [upcoming, needs, open, counts, reach, offers, sortedMark] = await Promise.all([
      myShifts({ firm, clock }, worker.id, "upcoming"),
      myNeedsAndPhoto({ firm, clock }, worker.id),
      openShiftsFor({ firm, clock }, worker.id),
      tabCounts({ firm, clock }, worker.id),
      myReachPrompts({ firm }, worker.id),
      myOffers({ firm, clock }, worker.id),
      mySortedMark({ firm }, worker.id),
    ]);
    const pay = await myPayDay({ firm, clock }, worker.id);
    return (
      <main className={page.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <OfflineCopy enabled={offlineCopyOn(appEnv())} renderedAt={now.getTime()} />
        <HomeView
          firstName={worker.firstName}
          lastName={worker.lastName}
          firmName={firm.name}
          timeZone={firm.timezone}
          now={now}
          next={upcoming[0] ?? null}
          needs={needs.needs}
          photo={needs.photo}
          open={open}
          pay={pay}
          reach={reach}
          offers={offers}
          sortedMark={sortedMark}
        />
        <CountedTabBar current="home" counts={counts} />
      </main>
    );
  }
  return (
    <main className={page.staff}>
      <h1 className="text-3xl font-bold">ShiftDesk</h1>
      <p className="mt-2">Staff portal coming soon.</p>
    </main>
  );
}

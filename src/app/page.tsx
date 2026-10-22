import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv, offlineCopyOn } from "@/lib/env";
import { myNeedsAndPhoto, myShifts, needsDoingCount } from "@/lib/portal/my-shifts";
import { openShiftsFor } from "@/lib/portal/open-shifts";
import { payWeekNow } from "@/lib/pay/pay-week";
import { parseHost } from "@/lib/tenancy/host";
import { HomeView } from "./home-view";
import { OfflineCopy } from "./offline-copy";
import { refreshSessionAction } from "./session-actions";
import { SessionKeeper } from "./session-keeper";
import { TabBar, TabBarSpace } from "./tab-bar";
import { page } from "./ui/classes";

// The root URL serves two sites: the ShiftDesk home page on the base domain, and each firm's
// portal on <slug>.<base domain> or the firm's own domain, where a logged-in casual sees Home
// (docs/office-v2.md 4.2; docs/screens.md, `/`; 12H.1). Any host that isn't the base domain is a
// firm's page: requireWorker() finds the firm (a name that isn't a firm's, or a custom domain not
// verified, is the 404 page). Her bookings are on the Shifts tab (`/shifts`): the old address of
// the last 30 days, `/?view=past`, goes there. Kept for when there's no signal (public/sw.js).
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const match = parseHost((await headers()).get("host"), appEnv().APP_BASE_DOMAIN);
  if (match && match.kind !== "apex") {
    if ((await searchParams).view === "past") redirect("/shifts?view=past");
    const { firm, worker, session } = await requireWorker();
    const now = new Date();
    const clock = { now: () => now };
    const [upcoming, needs, open] = await Promise.all([
      myShifts({ firm, clock }, worker.id, "upcoming"),
      myNeedsAndPhoto({ firm, clock }, worker.id),
      openShiftsFor({ firm, clock }, worker.id),
    ]);
    return (
      <main className={page.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <OfflineCopy enabled={offlineCopyOn(appEnv())} renderedAt={now.getTime()} />
        <HomeView
          firstName={worker.firstName}
          firmName={firm.name}
          timeZone={firm.timezone}
          now={now}
          next={upcoming[0] ?? null}
          needs={needs.needs}
          photo={needs.photo}
          open={open}
          payDay={payWeekNow(now, firm.timezone).payDay}
        />
        <TabBarSpace />
        <TabBar current="home" profileCount={needsDoingCount(needs)} />
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

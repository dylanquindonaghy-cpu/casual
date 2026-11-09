import type { Metadata } from "next";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv, offlineCopyOn } from "@/lib/env";
import { myShiftCounts, myShifts } from "@/lib/portal/my-shifts";
import { tabCounts } from "@/lib/portal/tab-counts";
import { BookedView } from "./booked-view";
import { CountedTabBar } from "../casual-tab-bar";
import { CasualTop } from "../casual-top-bar";
import { OfflineCopy } from "../offline-copy";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { page } from "../ui/classes";

export const metadata: Metadata = { title: "Booked shifts" };

// Booked (docs/office-v2.md 4.1, 4.3; docs/screens.md `/shifts`, "### 28.13"; 12H.1): her bookings,
// Upcoming or the last 90 days reliability counts (`?view=past`), each tab with its count, on the
// Shifts tab next to Open (`/shifts/open`). Kept for when there's no signal, as Home is (public/sw.js
// keeps both, and /shifts only with no query: Upcoming; OfflineCopy asks it to keep this one).
export default async function BookedPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; new?: string }>;
}) {
  const { firm, worker, session } = await requireWorker();
  const params = await searchParams;
  const view = params.view === "past" ? "past" : "upcoming";
  // Only ever compared with her own shifts' ids: anything else marks nothing.
  const newShiftId = typeof params.new === "string" ? params.new : undefined;
  const now = new Date();
  const clock = { now: () => now };
  // The tab bar's counts from tabCounts(), as on every casual page (Phase 28.7).
  const [shifts, viewCounts, counts] = await Promise.all([
    myShifts({ firm, clock }, worker.id, view),
    myShiftCounts({ firm, clock }, worker.id),
    tabCounts({ firm, clock }, worker.id),
  ]);
  return (
    <>
      <CasualTop firm={firm} worker={worker} />
      <main className={page.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <OfflineCopy enabled={offlineCopyOn(appEnv())} renderedAt={now.getTime()} page="/shifts" />
        <BookedView
          firmName={firm.name}
          timeZone={firm.timezone}
          now={now}
          view={view}
          shifts={shifts}
          counts={viewCounts}
          newShiftId={newShiftId}
        />
        <CountedTabBar current="shifts" counts={counts} />
      </main>
    </>
  );
}

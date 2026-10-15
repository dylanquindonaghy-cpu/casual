import type { Metadata } from "next";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv, offlineCopyOn } from "@/lib/env";
import { myShifts, profileNeedsYou } from "@/lib/portal/my-shifts";
import { BookedView } from "./booked-view";
import { OfflineCopy } from "../offline-copy";
import { refreshSessionAction } from "../session-actions";
import { SessionKeeper } from "../session-keeper";
import { TabBar, TabBarSpace } from "../tab-bar";
import { page } from "../ui/classes";

export const metadata: Metadata = { title: "Booked shifts" };

// Booked (docs/office-v2.md 4.1, 4.3; docs/screens.md `/shifts`; 12H.1): her bookings, Upcoming or
// the last 30 days (`?view=past`), on the Shifts tab next to Open (`/shifts/open`). Kept for when
// there's no signal, as Home is (public/sw.js keeps both; OfflineCopy asks it to keep this one).
export default async function BookedPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { firm, worker, session } = await requireWorker();
  const view = (await searchParams).view === "past" ? "past" : "upcoming";
  const now = new Date();
  const clock = { now: () => now };
  const [shifts, dot] = await Promise.all([
    myShifts({ firm, clock }, worker.id, view),
    profileNeedsYou({ firm, clock }, worker.id),
  ]);
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <OfflineCopy enabled={offlineCopyOn(appEnv())} renderedAt={now.getTime()} page="/shifts" />
      <BookedView
        eyebrow={firm.name}
        timeZone={firm.timezone}
        now={now}
        view={view}
        shifts={shifts}
      />
      <TabBarSpace />
      <TabBar current="shifts" profileDot={dot} />
    </main>
  );
}

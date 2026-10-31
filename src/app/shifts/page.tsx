import type { Metadata } from "next";
import { requireWorker } from "@/lib/auth/current-worker";
import { appEnv, offlineCopyOn } from "@/lib/env";
import { unreadReplies } from "@/lib/portal/messages";
import { myShifts, profileNeedsCount } from "@/lib/portal/my-shifts";
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
  searchParams: Promise<{ view?: string; new?: string }>;
}) {
  const { firm, worker, session } = await requireWorker();
  const params = await searchParams;
  const view = params.view === "past" ? "past" : "upcoming";
  // Only ever compared with her own shifts' ids: anything else marks nothing.
  const newShiftId = typeof params.new === "string" ? params.new : undefined;
  const now = new Date();
  const clock = { now: () => now };
  const [shifts, needsCount, replies] = await Promise.all([
    myShifts({ firm, clock }, worker.id, view),
    profileNeedsCount({ firm, clock }, worker.id),
    unreadReplies({ firm }, worker.id),
  ]);
  return (
    <main className={page.staff}>
      <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
      <OfflineCopy enabled={offlineCopyOn(appEnv())} renderedAt={now.getTime()} page="/shifts" />
      <BookedView
        firmName={firm.name}
        timeZone={firm.timezone}
        now={now}
        view={view}
        shifts={shifts}
        newShiftId={newShiftId}
      />
      <TabBarSpace />
      <TabBar current="shifts" profileCount={needsCount} messagesCount={replies} />
    </main>
  );
}

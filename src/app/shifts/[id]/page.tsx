import { systemClock } from "@/lib/auth/clock";
import { requireWorker } from "@/lib/auth/current-worker";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { getCurrentBrand } from "@/lib/tenancy/current-brand";
import { CasualRail } from "../../casual-tab-bar";
import { CasualTop } from "../../casual-top-bar";
import { refreshSessionAction } from "../../session-actions";
import { SessionKeeper } from "../../session-keeper";
import { page as pageWidth } from "../../ui/classes";
import { ShiftView } from "./shift-view";

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, worker, session } = await requireWorker();
  const { id } = await params;
  const now = systemClock.now();
  const page = await shiftForWorker({ firm, clock: { now: () => now } }, worker.id, id);
  // The firm's mark and name in the page's own bar (28.5): its brand as the firm's bar shows it
  // (the layout has already read it: cache()), or its name alone.
  const brand = await getCurrentBrand();
  return (
    <>
      <CasualTop firm={firm} worker={worker} railOnly />
      <main className={pageWidth.staff}>
        <SessionKeeper rotationDue={session.rotationDue} refresh={refreshSessionAction} />
        <ShiftView
          page={page}
          timeZone={firm.timezone}
          now={now}
          firm={{ name: brand?.name ?? firm.name, logoUrl: brand?.logoUrl ?? null }}
        />
        {/* No tab bar on a phone (its own bar and Take shift); the rail from 1024px (30.2). */}
        <CasualRail firm={firm} workerId={worker.id} current="shifts" />
      </main>
    </>
  );
}

import Link from "next/link";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import { ShiftGroup } from "../shifts/open/shift-group";
import { AreaPrompt, FurtherNote } from "../shifts/open/travel-notes";
import { emptyBox, staffBtn } from "../ui/classes";
import { PageHeader } from "../ui/page-header";

// The urgent board (docs/screens.md, `/urgent`): shifts marked urgent that this worker could take
// now, in her travel area, the nearest first, then the soonest (12G.3), each opening the shift's
// page, where she takes it (Phase 18). Since Phase 28 (28.8) they are grouped as Open shifts' urgent
// list is: one glass section, "Urgent, needed now" with the office's red leaf and the count inside,
// each shift a tile (src/app/shifts/open/shift-group.tsx). With none, the one empty state
// (`emptyBox`): "No urgent shifts right now." and "See open shifts". "Back to my shifts" goes to the
// Shifts tab (/shifts), where her shifts are. The tiles are the only list items on the page (the
// e2e test counts them).
export function UrgentView({
  list,
  timeZone,
  now,
}: {
  list: OpenShiftsList;
  timeZone: string;
  now: Date;
}) {
  return (
    <>
      <PageHeader title="Urgent shifts">
        <p>Shifts starting soon that need someone now.</p>
      </PageHeader>
      <AreaPrompt list={list} />
      {list.shifts.length === 0 ? (
        <div className={emptyBox}>
          <p>No urgent shifts right now.</p>
          <Link href="/shifts/open" className={staffBtn.primary}>
            See open shifts
          </Link>
        </div>
      ) : (
        <ShiftGroup
          id="urgent-heading"
          title="Urgent, needed now"
          urgent
          shifts={list.shifts}
          timeZone={timeZone}
          now={now}
        />
      )}
      <FurtherNote list={list} urgent />
      <Link href="/shifts" className={`${staffBtn.secondary} mt-8`}>
        Back to my shifts
      </Link>
    </>
  );
}

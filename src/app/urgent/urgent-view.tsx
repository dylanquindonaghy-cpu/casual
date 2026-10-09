import Link from "next/link";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import { OpenShiftCard } from "../shifts/open/open-shift-card";
import { AreaPrompt, FurtherNote } from "../shifts/open/travel-notes";
import { staffBtn } from "../ui/classes";
import { PageHeader } from "../ui/page-header";

// The urgent board (docs/screens.md, `/urgent`): shifts marked urgent that this worker could take
// now, in her travel area, the nearest first, then the soonest (12G.3), with big "Take shift"
// buttons. The cards are the only list items on the page
// (the e2e test counts them). Their list has role="list" (Safari stops announcing a list once its
// bullets are styled away); that adds no list item.
export function UrgentView({
  list,
  timeZone,
  now,
  eyebrow,
}: {
  list: OpenShiftsList;
  timeZone: string;
  now: Date;
  eyebrow?: string; // the firm's name above the heading
}) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title="Urgent shifts">
        <p>Shifts starting soon that need someone now.</p>
      </PageHeader>
      <AreaPrompt list={list} />
      {list.shifts.length === 0 ? (
        <div className="rounded-xl bg-quiet-soft p-4">
          <p>No urgent gaps right now.</p>
          <Link href="/shifts/open" className={`${staffBtn.primary} mt-3`}>
            See all open shifts
          </Link>
        </div>
      ) : (
        <ul role="list" className="flex flex-col gap-4">
          {list.shifts.map((s) => (
            <OpenShiftCard
              key={s.shiftId}
              shift={s}
              timeZone={timeZone}
              now={now}
              checkAgainHref="/urgent"
            />
          ))}
        </ul>
      )}
      <FurtherNote list={list} urgent />
      <Link href="/" className={`${staffBtn.secondary} mt-8`}>
        Back to my shifts
      </Link>
    </>
  );
}

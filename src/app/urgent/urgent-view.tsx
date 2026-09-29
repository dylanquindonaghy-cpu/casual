import Link from "next/link";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import { OpenShiftCard } from "../shifts/open/open-shift-card";

// The urgent board (docs/screens.md, `/urgent`): shifts marked urgent that this worker could take
// now, soonest first, with big "Take shift" buttons.
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
      <h1 className="text-3xl font-bold">Urgent shifts</h1>
      <p className="mt-2">Shifts starting soon that need someone now.</p>
      {list.shifts.length === 0 ? (
        <div className="mt-6">
          <p>No urgent gaps right now.</p>
          <Link
            href="/shifts/open"
            className="mt-3 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold"
          >
            See all open shifts
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
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
      <Link
        href="/"
        className="mt-8 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold"
      >
        Back to my shifts
      </Link>
    </>
  );
}

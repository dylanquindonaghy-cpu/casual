import type { ReactNode } from "react";
import type { OpenShift } from "@/lib/portal/open-shifts";
import { countPill, staffH2 } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { OpenShiftCard } from "./open-shift-card";

// A group of open shifts on Open shifts and the urgent board (docs/screens.md "The casual app,
// Phase 28", 28.8), grouped as the office's event card is: one glass section, 12px round, its
// heading and count inside it (the urgent one led by the office's 18px red leaf, its status mark),
// then each shift a clear glass tile 8px round, 8px apart (src/app/shifts/open/open-shift-card.tsx).
// The count is the office's grey pill; a screen reader hears it in words. With no shifts, the
// section keeps its frame and heading and shows `empty` (an `emptyBox`) instead. The tiles' list
// has role="list" (Safari stops announcing a list once its bullets are styled away); the header adds
// no list item (the browser tests count them). Hook-free.

const shiftsWord = (n: number) => (n === 1 ? "1 shift" : `${n} shifts`);

export function ShiftGroup({
  id,
  title,
  urgent = false,
  shifts,
  timeZone,
  now,
  empty,
}: {
  id: string; // the heading's id, the section's name
  title: string;
  urgent?: boolean;
  shifts: OpenShift[];
  timeZone: string;
  now: Date;
  empty?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="glass flex flex-col gap-2 rounded-inner p-3">
      <div className="flex items-center gap-3 px-1 pt-1">
        {urgent && <Icon name="leaf" size={18} className="text-mark-urgent" />}
        <h2 id={id} className={staffH2}>
          {title}
        </h2>
        {shifts.length > 0 && (
          <>
            <span aria-hidden="true" className={countPill}>
              {shifts.length}
            </span>
            <span className="sr-only">{shiftsWord(shifts.length)}</span>
          </>
        )}
      </div>
      {shifts.length > 0 ? (
        <ul role="list" className="flex flex-col gap-2">
          {shifts.map((s) => (
            <OpenShiftCard key={s.shiftId} shift={s} timeZone={timeZone} now={now} />
          ))}
        </ul>
      ) : (
        empty
      )}
    </section>
  );
}

import Link from "next/link";
import { roleLabel, shiftWhen, siteAddress, soonLabel } from "@/lib/portal/format";
import type { OpenShift } from "@/lib/portal/open-shifts";
import { btn, card, muted } from "../../ui/classes";
import { StatusChip } from "../../ui/status-chip";
import { TakeShiftButton } from "./take-shift-button";

// One shift on Open shifts or the urgent board: an "Urgent" label (and a red edge) when marked
// urgent, then when, role, site and address, places left, then "Take shift" (or, under fair
// rotation, when it opens).
export function OpenShiftCard({
  shift: s,
  timeZone,
  now,
  checkAgainHref,
}: {
  shift: OpenShift;
  timeZone: string;
  now: Date;
  checkAgainHref: string; // the board it's on, to look again after a hold
}) {
  const address = s.site ? siteAddress(s.site) : null;
  return (
    <li className={`${card}${s.isUrgent ? " border-l-4 border-l-urgent" : ""}`}>
      {s.isUrgent && (
        <div className="mb-2 flex">
          <StatusChip tone="urgent">Urgent</StatusChip>
        </div>
      )}
      <p className="text-lg font-bold tabular-nums">{shiftWhen(s.startsAt, s.endsAt, timeZone)}</p>
      <p className="mt-1 font-semibold">{roleLabel(s.role)}</p>
      {s.site && (
        <p className="mt-1">
          <span>{s.site.name}</span>
          {address && <span className={`block ${muted}`}>{address}</span>}
        </p>
      )}
      <p className={`mt-1 ${muted}`}>
        {s.placesLeft === 1 ? "1 place left" : `${s.placesLeft} places left`}
      </p>
      {s.opensAt ? (
        <div className="mt-4 rounded-xl bg-quiet-soft p-3">
          <p>
            Offered first to people with fewer hours that week. You can take it from{" "}
            {soonLabel(s.opensAt, now, timeZone)}.
          </p>
          <Link href={checkAgainHref} className={btn.link}>
            Check again
          </Link>
        </div>
      ) : (
        <TakeShiftButton shiftId={s.shiftId} />
      )}
    </li>
  );
}

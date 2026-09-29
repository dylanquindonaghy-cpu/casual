import Link from "next/link";
import { roleLabel, shiftWhen, siteAddress, soonLabel } from "@/lib/portal/format";
import type { OpenShift } from "@/lib/portal/open-shifts";
import { TakeShiftButton } from "./take-shift-button";

// One shift on Open shifts or the urgent board: when, role, site and address, places left, an
// "Urgent" label when marked urgent, then "Take shift" (or, under fair rotation, when it opens).
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
    <li className="rounded-2xl border-2 border-slate-300 p-4">
      {s.isUrgent && (
        <p className="mb-1 inline-block rounded-full bg-red-700 px-3 py-1 text-base font-bold text-white">
          Urgent
        </p>
      )}
      <p className="text-xl font-bold">{shiftWhen(s.startsAt, s.endsAt, timeZone)}</p>
      <p className="mt-1">{roleLabel(s.role)}</p>
      {s.site && (
        <p className="mt-1">
          <span className="font-semibold">{s.site.name}</span>
          {address && <span className="block text-base text-slate-700">{address}</span>}
        </p>
      )}
      <p className="mt-1 text-base text-slate-600">
        {s.placesLeft === 1 ? "1 place left" : `${s.placesLeft} places left`}
      </p>
      {s.opensAt ? (
        <div className="mt-3 rounded-xl bg-slate-100 p-3">
          <p>
            Offered first to people with fewer hours that week. You can take it from{" "}
            {soonLabel(s.opensAt, now, timeZone)}.
          </p>
          <Link href={checkAgainHref} className="mt-1 inline-block py-2 font-semibold underline">
            Check again
          </Link>
        </div>
      ) : (
        <TakeShiftButton shiftId={s.shiftId} />
      )}
    </li>
  );
}

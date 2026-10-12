import Link from "next/link";
import { perHour, roleAndEvent, shiftWhen, soonLabel } from "@/lib/portal/format";
import type { OpenShift } from "@/lib/portal/open-shifts";
import { travelLineText } from "@/lib/travel/line-copy";
import { btn, card, muted } from "../../ui/classes";
import { StatusChip } from "../../ui/status-chip";
import { RequirementChips } from "../requirement-chips";
import { TakeShiftButton } from "./take-shift-button";

// One shift on Open shifts or the urgent board (docs/office-v2.md 4.3; 12H.2): an "Urgent" label
// (and a red edge) when marked urgent, then role · event (a link to the shift's page), the site,
// "date and time · £/hour · post", what it needs as chips, places left, the travel line (both
// times, whichever ways she chose; "Distance not known yet" when it isn't: 12G.3), then "Take
// shift" (or, under fair rotation, when it opens). The address is on the shift's page.
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
  const facts = [
    shiftWhen(s.startsAt, s.endsAt, timeZone),
    s.payRatePence != null ? perHour(s.payRatePence) : null,
    s.post ?? null,
  ].filter(Boolean);
  return (
    <li className={`${card}${s.isUrgent ? " border-l-4 border-l-urgent" : ""}`}>
      {s.isUrgent && (
        <div className="mb-2 flex">
          <StatusChip tone="urgent">Urgent</StatusChip>
        </div>
      )}
      <p className="text-lg font-bold">
        <Link
          href={`/shifts/${s.shiftId}`}
          className="underline decoration-line-strong underline-offset-4"
        >
          {roleAndEvent(s.role, s.casualEvent)}
        </Link>
      </p>
      {s.site && <p className="mt-1">{s.site.name}</p>}
      <p className="mt-1 font-semibold tabular-nums">{facts.join(" · ")}</p>
      <RequirementChips requirements={s.requirements} className="mt-2" />
      <p className={`mt-2 ${muted}`}>
        {s.placesLeft === 1 ? "1 place left" : `${s.placesLeft} places left`}
      </p>
      <p className={`mt-1 ${muted}`} data-travel-line="">
        {travelLineText(s.travel, timeZone)}
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

import Link from "next/link";
import { perHour, roleLabel, soonLabel } from "@/lib/portal/format";
import type { OpenShift } from "@/lib/portal/open-shifts";
import { dateParts, placesLeftText, timeRange } from "@/lib/portal/sign-copy";
import { travelLineText } from "@/lib/travel/line-copy";
import { Icon } from "../../ui/icons";
import { Seats } from "../../ui/seats";
import { DateTile } from "../../ui/sign";

// One shift on Open shifts or the urgent board (docs/office-v2.md 4.3; 12H.2; Phases 18 and 20), a
// card lifted off the page that opens the shift's page (where she reads it in full and takes it):
// its date tile (pale red when urgent), the time in sign figures with the pay per hour across from
// it, the role, the event and post, the travel line (both times, whichever ways she chose, so no
// one is shown only a drive; "Distance not known yet" when it isn't: 12G.3), then its seats with
// the places left (red only when urgent); under fair rotation, when she can take it.
export function OpenShiftCard({
  shift: s,
  timeZone,
  now,
}: {
  shift: OpenShift;
  timeZone: string;
  now: Date;
}) {
  const day = dateParts(s.startsAt, timeZone);
  const t = timeRange(s.startsAt, s.endsAt, timeZone);
  const total = s.headcount ?? s.placesLeft;
  const place = [s.casualEvent ?? s.site?.name, s.post].filter(Boolean).join(", ");
  return (
    <li className="animate-in">
      <Link
        href={`/shifts/${s.shiftId}`}
        className="flex items-start gap-3.5 glass rounded-[22px] p-4 hover:bg-button-hover focus-visible:outline-offset-2"
      >
        <DateTile dow={day.dow} day={day.day} month={day.month} urgent={s.isUrgent} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {s.isUrgent && <span className="sr-only">Urgent. </span>}
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-sign text-lg leading-tight text-ink">{t.range}</span>
            {s.payRatePence != null && (
              <span className="shrink-0 text-base font-semibold tabular-nums">
                {perHour(s.payRatePence)}
              </span>
            )}
          </span>
          <span className="text-lg leading-snug font-medium">{roleLabel(s.role)}</span>
          {t.endsNote && <span className="text-base text-ink-muted">{t.endsNote}</span>}
          {place && <span className="text-base text-ink-muted">{place}</span>}
          {s.travel && (
            <span className="text-base text-ink-muted" data-travel-line="">
              {travelLineText(s.travel, timeZone)}
            </span>
          )}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Seats taken={total - s.placesLeft} total={total} urgent={s.isUrgent} />
            <span
              className={`text-base ${s.isUrgent ? "font-semibold text-urgent-ink" : "text-ink"}`}
            >
              {placesLeftText(s.placesLeft)}
            </span>
          </span>
          {s.opensAt && (
            <span className="mt-1.5 flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-hivis text-on-hivis">
                <Icon name="clock" size={16} />
              </span>
              You can take it from {soonLabel(s.opensAt, now, timeZone)}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

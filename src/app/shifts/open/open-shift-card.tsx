import Link from "next/link";
import { NO_RATE_TEXT, perHour, roleLabel, soonLabel } from "@/lib/portal/format";
import type { OpenShift } from "@/lib/portal/open-shifts";
import { dateParts, placesLeftText, timeRange } from "@/lib/portal/sign-copy";
import { travelLineText } from "@/lib/travel/line-copy";
import { Icon } from "../../ui/icons";
import { DateTile } from "../../ui/sign";

// "Casuals ask, you choose" (Phase 26.6): where the office chooses who works it.
const ASK_LINE = {
  ask: "The office chooses: ask for it",
  asked: "Asked: we'll tell you",
  not_this_time: "Not this time",
} as const;

// One shift on Open shifts or the urgent board (docs/office-v2.md 4.3; 12H.2; Phases 18, 20 and
// 24), a glass card that opens the shift's page (where she reads it in full and takes it): its date
// tile (pale red when urgent), the time with the pay per hour across from it ("Pay: ask the office"
// with no rate), the role, the event, site and post, the travel line after a car (both times, whichever ways she chose, so no one is shown
// only a drive; "Distance not known yet" when it isn't: 12G.3), then the places left on a little
// glass chip (red words when urgent) and a round arrow; under fair rotation, when she can take it.
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
  // The event, then the site by name (as an urgent text names it), then the post; a site named
  // like its event once.
  const site = s.site?.name && s.site.name !== s.casualEvent ? s.site.name : null;
  const place = [s.casualEvent, site, s.post].filter(Boolean).join(", ");
  // After the place, mid-sentence: "Night patrols, Station Road · finishes Tuesday morning".
  const ends =
    t.endsNote && place ? t.endsNote.charAt(0).toLowerCase() + t.endsNote.slice(1) : t.endsNote;
  return (
    <li className="animate-in">
      <Link
        href={`/shifts/${s.shiftId}`}
        className="group press glass flex items-start gap-4 rounded-[22px] p-4 hover:bg-button-hover focus-visible:outline-offset-2"
      >
        <DateTile dow={day.dow} day={day.day} month={day.month} urgent={s.isUrgent} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {s.isUrgent && <span className="sr-only">Urgent. </span>}
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-sign text-lg leading-tight text-ink">{t.range}</span>
            {s.payRatePence != null ? (
              <span className="shrink-0 text-lg font-medium text-ink tabular-nums">
                {perHour(s.payRatePence)}
              </span>
            ) : (
              <span className="text-right text-base text-ink-muted">{NO_RATE_TEXT}</span>
            )}
          </span>
          <span className="text-lg leading-snug text-ink">{roleLabel(s.role)}</span>
          {(place || ends) && (
            <span className="text-base text-ink-muted">
              {[place, ends].filter(Boolean).join(" · ")}
            </span>
          )}
          {s.travel && (
            <span
              className="mt-1 flex items-start gap-2 text-base text-ink-muted"
              data-travel-line=""
            >
              <Icon
                name={s.travel.kind === "estimated" ? "car" : "pin"}
                size={18}
                className="mt-0.5"
              />
              {travelLineText(s.travel, timeZone)}
            </span>
          )}
          <span className="mt-3 flex items-center justify-between gap-3">
            <span
              className={`glass-tile rounded-[10px] px-2.5 py-1 text-base font-medium ${
                s.isUrgent ? "text-urgent-ink" : "text-ink"
              }`}
            >
              {placesLeftText(s.placesLeft)}
            </span>
            <span
              aria-hidden="true"
              className="glass-tile flex size-10 shrink-0 items-center justify-center rounded-full text-ink group-hover:bg-ink group-hover:bg-none group-hover:text-on-ink"
            >
              <Icon name="arrow" size={20} />
            </span>
          </span>
          {s.ask && (
            <span className="mt-2 flex items-center gap-2 text-base" data-ask={s.ask}>
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                  s.ask === "asked"
                    ? "bg-done-fill text-on-done"
                    : s.ask === "not_this_time"
                      ? "bg-urgent-fill text-on-urgent"
                      : "bg-hivis text-on-hivis"
                }`}
              >
                <Icon
                  name={s.ask === "asked" ? "check" : s.ask === "not_this_time" ? "close" : "team"}
                  size={16}
                />
              </span>
              {ASK_LINE[s.ask]}
            </span>
          )}
          {s.opensAt && (
            <span className="mt-2 flex items-center gap-2 text-base">
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

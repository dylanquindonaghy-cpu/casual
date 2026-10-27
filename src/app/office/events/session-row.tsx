import { StatusChip } from "@/app/ui/status-chip";
import type { BookedCasual, SessionRow } from "@/lib/office/events";
import {
  filledText,
  isFull,
  requirementChip,
  sessionDetails,
  sessionName,
  sessionShowingText,
  sessionSwitchLabel,
  sessionTime,
} from "@/lib/office/events-copy";
import { PLACE_STATUS_WORDS, SHIFT_STATUS_WORDS } from "@/lib/office/shifts-copy";
import { roleLabel } from "@/lib/portal/format";
import { AttendanceButtons, MarkRestWorked } from "../shifts/[id]/attendance-forms";
import { PLACE_TONE } from "../shifts/shift-tones";
import { SessionMenu } from "./session-menu";
import { ShowingSwitch } from "./showing-switch";

// One session (docs/office-v2.md 3.3, "What a session is"): the role, its times, "Urgent" on an
// urgent gap, a chip per requirement, "N/M filled", then its pay per hour, post, meeting point and
// uniform, and its "…" menu. On the event's page (`full`) also its own switch, who is booked and,
// once it has started, "Mark who worked". A white row with its hairline (Phase 23), red-edged on
// an urgent gap (its "Urgent" chip says so in words).
export function SessionItem({
  session: s,
  timeZone,
  withDay,
  eventShowing,
  full,
  uniqueName,
  booked = [],
}: {
  session: SessionRow;
  timeZone: string;
  withDay: boolean;
  eventShowing: boolean;
  full?: boolean;
  // The session's name, unique among those shown with it (uniqueSessionNames): its switch's, its
  // menu's and its urgent button's.
  uniqueName?: string;
  booked?: BookedCasual[];
}) {
  const name = uniqueName ?? sessionName(s, timeZone, withDay);
  const showingId = `showing-${s.shiftId}`;
  const details = sessionDetails(s);
  const short = s.booked < s.headcount;
  const unmarked = booked.filter((b) => b.status === "confirmed").length;
  return (
    <li
      className={`glass-tile relative flex flex-col gap-2 rounded-row border p-3 ${
        s.urgentGap ? "border-urgent" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
          {full ? (
            <h3 className="font-semibold">{roleLabel(s.role)}</h3>
          ) : (
            <span className="font-semibold">{roleLabel(s.role)}</span>
          )}
          <span className="inline-flex h-6 items-center rounded-full glass-button px-2 text-sm tabular-nums">
            {sessionTime(s, timeZone, withDay)}
          </span>
          {s.urgentGap && <StatusChip tone="urgent">Urgent</StatusChip>}
          {s.status === "cancelled" || s.status === "draft" ? (
            <StatusChip tone="quiet">{SHIFT_STATUS_WORDS[s.status]}</StatusChip>
          ) : null}
          {s.requirements.map((r) => (
            <span
              key={r.code}
              className="inline-flex h-6 items-center rounded-full bg-quiet-soft px-2 text-sm font-semibold text-quiet-ink"
            >
              {requirementChip(r)}
            </span>
          ))}
        </div>
        <div className="flex items-start gap-2">
          <span
            className={`flex min-h-11 items-center whitespace-nowrap text-sm font-semibold tabular-nums ${short && !s.ended ? "text-urgent" : "text-ink"}`}
          >
            {filledText(s)}
          </span>
          <SessionMenu session={s} name={name} eventShowing={eventShowing} />
        </div>
      </div>
      {details.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-muted tabular-nums">
          {details.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </p>
      )}
      {full && (
        <>
          {s.status !== "cancelled" && (
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span id={showingId} className="text-sm text-ink-muted">
                {sessionShowingText(s, eventShowing)}
              </span>
              <ShowingSwitch
                target="session"
                id={s.shiftId}
                showing={s.showing}
                label={sessionSwitchLabel(name)}
                describedBy={showingId}
                small
              />
            </div>
          )}
          {booked.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-line pt-2">
              <p className="text-sm font-semibold">
                Booked{s.started ? ". Mark who worked it and who didn't attend." : ""}
              </p>
              <ul role="list" className="flex flex-col gap-2">
                {booked.map((b) => (
                  <li key={b.workerId} className="flex flex-col gap-2">
                    <p className="leading-8">
                      <span className="font-semibold">{b.name}:</span>{" "}
                      <StatusChip tone={PLACE_TONE[b.status] ?? "quiet"}>
                        {PLACE_STATUS_WORDS[b.status] ?? b.status}
                      </StatusChip>
                    </p>
                    {s.started && (
                      <AttendanceButtons
                        shiftId={s.shiftId}
                        workerId={b.workerId}
                        name={b.name}
                        status={b.status}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {s.ended && <MarkRestWorked shiftId={s.shiftId} count={unmarked} />}
            </div>
          ) : (
            s.status !== "cancelled" && (
              <p className="text-sm text-ink-muted">{isFull(s) ? "Full." : "Nobody booked yet."}</p>
            )
          )}
        </>
      )}
    </li>
  );
}

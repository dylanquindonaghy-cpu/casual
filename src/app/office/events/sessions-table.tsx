import Link from "next/link";
import type { ReactNode } from "react";
import { btn, textLink } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { Seats } from "@/app/ui/sign";
import type { EventCardData } from "@/lib/office/events";
import { sessionWhen } from "@/lib/office/events-board";
import { spansDays, uniqueSessionNames } from "@/lib/office/events-copy";
import { roleLabel } from "@/lib/portal/format";
import { pounds } from "@/lib/portal/pay-format";
import { localDateOf } from "@/lib/time/zoned";
import { SessionMenu } from "./session-menu";
import { UrgentSwitch } from "./urgent-switch";

// An event's open row on the rota board (Phases 18 and 20; docs/screens.md `/office/events`), set
// into the board a step darker: where, how many sessions it has to come, then its "show to
// casuals" switch (Phase 20: here, not on the board's row), "Add a session" (firms without a
// planner) and the event's page; then a table of its sessions in the two weeks on the board (the
// pills above it), each on two lines: role (→ the session), when, places as seats and "3/4", pay
// an hour (on the right), the urgent switch and the "…" menu (offer, assign, change or cancel;
// pinned to the right edge when the table is wider than the page); under it, its post, meeting
// point and uniform. Its other sessions to come are counted, and are on the event's own page.
// Each session's buttons are named apart ("More for Steward 08:00–16:00 (2)"), over all its
// sessions.
// "Meet at staff entrance on Arena Way": the meeting point mid-sentence (an acronym stays).
const inSentence = (w: string) =>
  /^[A-Z][a-z]/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w;

export function SessionsTable({
  event: e,
  timeZone,
  hasPlanner,
  window,
  showingSwitch,
}: {
  event: EventCardData;
  timeZone: string;
  hasPlanner: boolean;
  window: { first: string; last: string }; // the board's days, yyyy-mm-dd
  showingSwitch?: ReactNode; // the event's "show to casuals" switch
}) {
  const names = uniqueSessionNames(e.sessions, timeZone, spansDays(e, timeZone));
  const shown = e.sessions.filter((s) => {
    const day = localDateOf(s.startsAt, timeZone);
    return day >= window.first && day <= window.last;
  });
  const outside = e.sessions.length - shown.length;
  const th = "px-2 pt-1 pb-2 font-normal";
  const td = "px-2 pt-3 pb-1 align-top";
  // The "…" menu stays in reach at the table's right edge when the table is wider than the page.
  const pinned = "sticky right-0 bg-canvas";
  return (
    <div className="rounded-[18px] bg-canvas px-4 pt-3.5 pb-2.5 inset-shadow-sunk">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1.5">
        {e.place && <span className="font-semibold">{e.place}</span>}
        <span className="text-sm text-ink-muted">
          {e.sessionCount === 1 ? "1 session" : `${e.sessionCount} sessions`} to come
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {showingSwitch && (
            <span className="flex items-center gap-1 text-sm font-medium">
              {showingSwitch}
              <span aria-hidden="true">Show to casuals</span>
            </span>
          )}
          {!hasPlanner && (
            <Link href="/office/shifts/new" className={btn.text}>
              <Icon name="plus" size={16} />
              Add a session
            </Link>
          )}
          <Link
            href={`/office/events/${e.eventId}`}
            className={`inline-flex min-h-11 items-center px-1 text-sm font-medium ${textLink}`}
            aria-label={`Open the event's page: ${e.name}`}
          >
            Open the event&apos;s page
          </Link>
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="py-3 text-ink-muted">No sessions in these two weeks.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="text-sm text-ink-muted">
                <th scope="col" className={`${th} pl-0`}>
                  Session
                </th>
                <th scope="col" className={th}>
                  When
                </th>
                <th scope="col" className={th}>
                  Places
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Pay an hour
                </th>
                <th scope="col" className={th}>
                  Urgent
                </th>
                <th scope="col" className={`${th} ${pinned} pr-0`}>
                  <span className="sr-only">More</span>
                </th>
              </tr>
            </thead>
            {shown.map((s) => {
              const name = names.get(s.shiftId) ?? roleLabel(s.role);
              const filled = s.status === "filled" ? s.headcount : Math.min(s.booked, s.headcount);
              const free = s.headcount - filled;
              const second = [
                s.post,
                s.meetingPoint && `Meet at ${inSentence(s.meetingPoint)}`,
                s.uniform,
              ].filter(Boolean);
              return (
                // Each session a body of its own: its line, then its details under it.
                <tbody key={s.shiftId} data-session={s.shiftId} className="border-t border-line">
                  <tr>
                    <td className={`${td} pl-0 font-semibold whitespace-nowrap`}>
                      <Link href={`/office/shifts/${s.shiftId}`} className={textLink}>
                        {roleLabel(s.role)}
                      </Link>
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>
                      {sessionWhen(s, timeZone)}
                    </td>
                    <td className={`${td} min-w-32 whitespace-nowrap`}>
                      <span className="flex items-center gap-2">
                        <Seats
                          taken={filled}
                          total={s.headcount}
                          urgent={s.urgentGap && free > 0}
                          className="max-w-24"
                        />
                        <span className="font-sign text-sm">
                          {filled}/{s.headcount}
                        </span>
                      </span>
                    </td>
                    <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
                      {s.payRatePence != null ? pounds(s.payRatePence) : "–"}
                    </td>
                    <td className={td}>
                      <UrgentSwitch
                        shiftId={s.shiftId}
                        isUrgent={s.isUrgent}
                        name={name}
                        disabled={s.status === "cancelled" || (s.started && !s.isUrgent)}
                      />
                    </td>
                    <td className={`${td} ${pinned} pr-0`} rowSpan={2}>
                      <SessionMenu session={s} name={name} eventShowing={e.showing} />
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="pt-0 pb-3 pl-0 text-sm text-ink-muted">
                      {second.length > 0 ? second.join(" · ") : "No post, meeting point or uniform"}
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      {outside > 0 && (
        <p className="border-t border-line py-2.5 text-ink-muted">
          {outside === 1 ? "1 more session" : `${outside} more sessions`} to come, outside these two
          weeks.
        </p>
      )}
    </div>
  );
}

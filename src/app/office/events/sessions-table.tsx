import Link from "next/link";
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

// An event's open row on the rota board (Phase 18; docs/screens.md `/office/events`): where, how
// many sessions it has to come and whether casuals see it; then a table of its sessions in the two
// weeks on the board (the pills above it): role (→ the session), when, places as seats and
// "3/4", pay an hour, post, meeting point, uniform, the urgent switch and the "…" menu (offer,
// assign, change or cancel; pinned to the right edge when the table is wider than the page). Its other sessions to come are counted, and are on the event's own
// page. Then "Add a session" (firms without a planner) and the event's page. Each session's
// buttons are named apart ("More for Steward 08:00–16:00 (2)"), over all its sessions.
export function SessionsTable({
  event: e,
  timeZone,
  hasPlanner,
  window,
}: {
  event: EventCardData;
  timeZone: string;
  hasPlanner: boolean;
  window: { first: string; last: string }; // the board's days, yyyy-mm-dd
}) {
  const names = uniqueSessionNames(e.sessions, timeZone, spansDays(e, timeZone));
  const shown = e.sessions.filter((s) => {
    const day = localDateOf(s.startsAt, timeZone);
    return day >= window.first && day <= window.last;
  });
  const outside = e.sessions.length - shown.length;
  const th = "px-1.5 py-2 font-semibold";
  const td = "px-1.5 py-2.5 align-top";
  // The "…" menu stays in reach at the table's right edge when the table is wider than the page.
  const pinned = "sticky right-0 border-l border-line bg-card";
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3.5 py-2.5">
        {e.place && <span className="font-semibold">{e.place}</span>}
        <span className="text-ink-muted">
          {e.sessionCount === 1 ? "1 session" : `${e.sessionCount} sessions`} to come
        </span>
        <span
          className={`flex items-center gap-1.5 text-sm font-semibold ${e.showing ? "text-done" : "text-ink-muted"}`}
        >
          <Icon name="eye" size={16} />
          {e.showing ? "Showing to casuals" : "Hidden from casuals"}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="px-3.5 py-3 text-ink-muted">No sessions in these two weeks.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="text-sm text-ink-muted">
                <th scope="col" className={`${th} pl-3.5`}>
                  Role
                </th>
                <th scope="col" className={th}>
                  When
                </th>
                <th scope="col" className={th}>
                  Places
                </th>
                <th scope="col" className={th}>
                  Pay an hour
                </th>
                <th scope="col" className={th}>
                  Post
                </th>
                <th scope="col" className={th}>
                  Meeting point
                </th>
                <th scope="col" className={th}>
                  Uniform
                </th>
                <th scope="col" className={th}>
                  Urgent
                </th>
                <th scope="col" className={`${th} ${pinned} pr-3.5`}>
                  <span className="sr-only">More</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const name = names.get(s.shiftId) ?? roleLabel(s.role);
                const filled =
                  s.status === "filled" ? s.headcount : Math.min(s.booked, s.headcount);
                const free = s.headcount - filled;
                return (
                  <tr key={s.shiftId} data-session={s.shiftId} className="border-t border-line">
                    <td className={`${td} pl-3.5 font-semibold whitespace-nowrap`}>
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
                        <span className="font-sign text-base">
                          {filled}/{s.headcount}
                        </span>
                      </span>
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>
                      {s.payRatePence != null ? pounds(s.payRatePence) : "–"}
                    </td>
                    <td className={td}>{s.post ?? "–"}</td>
                    <td className={`${td} text-ink-muted`}>{s.meetingPoint ?? "–"}</td>
                    <td className={`${td} max-w-48 text-ink-muted`}>{s.uniform ?? "–"}</td>
                    <td className={td}>
                      <UrgentSwitch
                        shiftId={s.shiftId}
                        isUrgent={s.isUrgent}
                        name={name}
                        disabled={s.status === "cancelled" || (s.started && !s.isUrgent)}
                      />
                    </td>
                    <td className={`${td} ${pinned} pr-3.5`}>
                      <SessionMenu session={s} name={name} eventShowing={e.showing} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {outside > 0 && (
        <p className="border-t border-line px-3.5 py-2.5 text-ink-muted">
          {outside === 1 ? "1 more session" : `${outside} more sessions`} to come, outside these two
          weeks.
        </p>
      )}
      <div className="flex flex-wrap gap-1 border-t border-line px-2 py-1.5">
        {!hasPlanner && (
          <Link href="/office/shifts/new" className={btn.text}>
            <Icon name="plus" size={16} />
            Add a session
          </Link>
        )}
        <Link
          href={`/office/events/${e.eventId}`}
          className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-ink-muted hover:bg-quiet-soft"
          aria-label={`Open the event's page: ${e.name}`}
        >
          Open the event&apos;s page
        </Link>
      </div>
    </div>
  );
}

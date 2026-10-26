import Link from "next/link";
import { btn } from "@/app/ui/classes";
import type { SessionRow } from "@/lib/office/events";
import { PLANNER_SESSION_WORDS, SHEET_SESSION_WORDS } from "@/lib/office/events-copy";
import { summaryButton } from "../shifts/[id]/chevron";
import { UrgentToggle } from "./urgent-toggle";

// A session's "…" menu (docs/office-v2.md 3.3, "Card buttons"): the forms that already exist,
// reached from here. Offer a place (the offer page) while it's open with a place free and
// shown to casuals; Assign
// and Change or cancel on the shift's page (a Google Sheet's session can't be changed or
// cancelled as a whole here, only its details; one from the firm's planner, not even those);
// Mark urgent / Not urgent in place. A <details>,
// so it opens without waiting for the page. The panel lies over the row (the row is its frame):
// the row's full width on a phone, under the button from 640px, so it never widens the page. It
// floats, so it alone has the office's overlay (Phase 23: 22px round, as a card in a page).
export function SessionMenu({
  session,
  name,
  eventShowing,
}: {
  session: SessionRow;
  name: string; // unique on the page
  eventShowing: boolean;
}) {
  const page = `/office/shifts/${session.shiftId}`;
  const live = session.status !== "cancelled" && !session.started;
  const placeFree = session.status === "open" && session.booked < session.headcount;
  const shown = session.showing && eventShowing;
  return (
    <details className="group">
      <summary className={`${btn.secondary} ${summaryButton} px-3`} aria-label={`More for ${name}`}>
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="currentColor"
        >
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </summary>
      <div className="absolute inset-x-2 z-10 mt-2 flex origin-top-right animate-pop flex-col gap-2 rounded-inner glass-float p-3 sm:left-auto sm:w-64">
        {live && placeFree && shown && (
          <Link
            href={`/office/offer/${session.shiftId}`}
            className={`${btn.secondary} justify-start`}
          >
            Offer a place
          </Link>
        )}
        {live && (
          <Link href={`${page}#assign`} className={`${btn.secondary} justify-start`}>
            Assign someone
          </Link>
        )}
        {(live || session.isUrgent) && (
          <UrgentToggle shiftId={session.shiftId} isUrgent={session.isUrgent} name={name} />
        )}
        {session.fromSheet || session.fromPlanner ? (
          <>
            <p className="text-sm text-ink-muted">
              {session.fromSheet ? SHEET_SESSION_WORDS : PLANNER_SESSION_WORDS}
            </p>
            <Link href={page} className={`${btn.secondary} justify-start`}>
              Open this session
            </Link>
          </>
        ) : (
          <Link href={page} className={`${btn.secondary} justify-start`}>
            Change or cancel
          </Link>
        )}
      </div>
    </details>
  );
}

import Link from "next/link";
import { btn } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
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
// so it opens without waiting for the page. Phase 24 (round 7): a round clear-glass button, as the
// dashboard's detail card's; its panel floats under it, its right edge with the button's, at most
// 80% of the window wide, so it never widens the page.
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
    <details className="group relative shrink-0">
      <summary
        aria-label={`More for ${name}`}
        className={`${summaryButton} press-glass glass-button inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-button-hover hover:text-ink active:bg-button-press group-open:bg-button-press group-open:text-ink`}
      >
        <Icon name="dots" />
      </summary>
      <div className="absolute top-full right-0 z-10 mt-2 flex w-64 max-w-[80vw] origin-top-right animate-pop flex-col gap-2 rounded-inner glass-float p-3">
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

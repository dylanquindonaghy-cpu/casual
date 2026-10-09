import Link from "next/link";
import { btn } from "@/app/ui/classes";
import type { SessionRow } from "@/lib/office/events";
import { SHEET_SESSION_WORDS } from "@/lib/office/events-copy";
import { summaryButton } from "../shifts/[id]/chevron";
import { UrgentToggle } from "./urgent-toggle";

// A session's "…" menu (docs/office-v2.md 3.3, "Card buttons"): the forms that already exist,
// reached from here. Offer a place (Today's offer page) while it's open with a place free; Assign
// and Change or cancel on the shift's page (a Google Sheet's session can't be changed or
// cancelled as a whole here, only its details); Mark urgent / Not urgent in place. A <details>,
// so it opens without waiting for the page.
export function SessionMenu({ session, name }: { session: SessionRow; name: string }) {
  const page = `/office/shifts/${session.shiftId}`;
  const live = session.status !== "cancelled" && !session.started;
  const placeFree = session.status === "open" && session.booked < session.headcount;
  return (
    <details className="group relative">
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
      <div className="mt-2 flex w-64 max-w-[calc(100vw-3rem)] flex-col gap-2 rounded-lg border border-line bg-card p-3 shadow-md">
        {live && placeFree && (
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
        {session.fromSheet ? (
          <>
            <p className="text-sm text-ink-muted">{SHEET_SESSION_WORDS}</p>
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

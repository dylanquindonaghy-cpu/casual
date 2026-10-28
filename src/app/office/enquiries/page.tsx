import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  card,
  meta,
  notice,
  nums,
  page,
  tab,
  tabCount,
  tabCurrent,
  tabs,
  textLink,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { appEnv } from "@/lib/env";
import {
  ENQUIRY_VIEWS,
  LIST_MAX,
  officeEnquiries,
  officeEnquiry,
  type EnquiryView,
} from "@/lib/office/enquiries";
import {
  AI_BANNER,
  appTodayText,
  countsLine,
  enquiriesEmptyText,
  showLastDaysText,
  VIEW_LABELS,
} from "@/lib/office/enquiries-copy";
import { officeRequestQueue } from "@/lib/office/request-queue";
import { CasualPageLink, EnquiryBody, EnquiryFacts, enquiryTitle } from "./enquiry-detail";
import { EnquiryItem } from "./enquiry-row";
import { RequestQueueView } from "./request-queue-view";

export const metadata: Metadata = { title: "Enquiries" };

// Enquiries (docs/office-v2.md 3.6; docs/screens.md `/office/enquiries`; 12D.1): what casuals and
// strangers sent the shifts line in the firm's message retention (90 days by default) and what came of it, the ones that need a
// person, the requests made in the app (the old Requests page) and pay. Views are links. Phase 24
// (24.4, round 7 of the canvas): from 1024px the list sits at the left in glass and the chosen
// message at the right (`?message=`, the list's first by default: ./enquiry-detail.tsx, as its own
// page shows it); on a phone each row opens the message's own page. Admins and resourcers.

// Only today's (since midnight, the firm's time): "Show only today's" under the views (Phase 24,
// 24.3: the dashboard's "Enquiries today" card linked here until then).
const EMPTY_TODAY = "Nothing to the shifts line today.";

const isView = (v: unknown): v is EnquiryView =>
  typeof v === "string" && (ENQUIRY_VIEWS as readonly string[]).includes(v);
// This list with a message chosen beside it (from 1024px).
const paneHref = (view: EnquiryView, day: "today" | undefined, messageId: string) => {
  const q = new URLSearchParams();
  if (view !== "all") q.set("view", view);
  if (day) q.set("day", day);
  q.set("message", messageId);
  return `/office/enquiries?${q.toString()}`;
};
const hrefOf = (view: EnquiryView, day?: "today") => {
  const q = [
    ...(view === "all" ? [] : [`view=${view}`]),
    ...(day && view !== "app" ? [`day=${day}`] : []),
  ];
  return q.length === 0 ? "/office/enquiries" : `/office/enquiries?${q.join("&")}`;
};

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; day?: string; message?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("enquiries");
  const { view: viewParam, day: dayParam, message: messageParam } = await searchParams;
  const view: EnquiryView = isView(viewParam) ? viewParam : "all";
  // "Requests from the app" is the request queue: every one waiting, whatever the day.
  const day = dayParam === "today" && view !== "app" ? ("today" as const) : undefined;
  const ctx = { firm, officeUserId: officeUser.id };
  const list = await officeEnquiries(ctx, view, day ? { day } : {});
  if (!list) notFound();
  const queue =
    view === "app"
      ? await officeRequestQueue({ firm }, (await readSessionToken("office")) ?? "")
      : null;
  if (view === "app" && !queue) notFound();
  // The message beside the list (from 1024px): the one asked for (`?message=`, any of the firm's,
  // even one this view doesn't list), else the list's first.
  const asked = typeof messageParam === "string" ? messageParam : null;
  let chosen = view !== "app" && asked ? await officeEnquiry(ctx, asked) : null;
  const first = list.rows[0];
  if (!chosen && view !== "app" && first) chosen = await officeEnquiry(ctx, first.messageId);
  const now = new Date();
  return (
    <main className={page.office}>
      <PageHeader title="Enquiries">
        <p className={nums}>{countsLine(list.today, list.needPerson, now)}</p>
      </PageHeader>
      {appEnv().AI_TRANSPORT === "none" && <p className={`${notice} mb-6`}>{AI_BANNER}</p>}

      <nav aria-label="Show" className={tabs}>
        {ENQUIRY_VIEWS.map((v) => (
          <Link
            key={v}
            href={hrefOf(v, day)}
            aria-current={v === view ? "page" : undefined}
            className={v === view ? tabCurrent : tab}
          >
            {VIEW_LABELS[v]}
            {v === "person" && (
              <>
                {" "}
                <span className={tabCount(v === view)}>{list.needPerson.count}</span>
              </>
            )}
          </Link>
        ))}
      </nav>
      {day ? (
        <p className={`${meta} mt-3`}>
          Only today&apos;s.{" "}
          <Link href={hrefOf(view)} className={textLink}>
            {showLastDaysText(list.days)}
          </Link>
        </p>
      ) : (
        view !== "app" && (
          <p className={`${meta} mt-3`}>
            <Link href={hrefOf(view, "today")} className={textLink}>
              Show only today&apos;s
            </Link>
          </p>
        )
      )}
      {day && view === "all" && list.appToday > 0 && (
        // Today's requests from the app, listed under their own view.
        <p className={`${meta} mt-1`}>
          {appTodayText(list.appToday)}{" "}
          <Link href={hrefOf("app")} className={textLink}>
            See requests from the app
          </Link>
        </p>
      )}

      {view === "app" && queue ? (
        // The chosen tab's name for screen readers (the tab says it on the page), then the queue's
        // own parts (Phase 24, as the list's).
        <section aria-labelledby="view-heading" className="mt-6">
          <h2 id="view-heading" className="sr-only">
            {VIEW_LABELS[view]}
          </h2>
          <RequestQueueView queue={queue} />
        </section>
      ) : (
        <div
          className={`mt-6 ${chosen ? "lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6" : ""}`}
        >
          <section aria-labelledby="view-heading">
            <h2 id="view-heading" className="sr-only">
              {VIEW_LABELS[view]}
            </h2>
            {list.rows.length === 0 ? (
              <p className={`${card} text-ink-muted`}>
                {day
                  ? EMPTY_TODAY
                  : enquiriesEmptyText(view as Exclude<EnquiryView, "app">, list.days)}
              </p>
            ) : (
              <>
                <ul role="list" className="glass flex flex-col gap-1 rounded-inner p-2">
                  {list.rows.map((r) => (
                    <EnquiryItem
                      key={r.messageId}
                      r={r}
                      timeZone={list.timeZone}
                      paneHref={paneHref(view, day, r.messageId)}
                      chosen={r.messageId === chosen?.messageId}
                    />
                  ))}
                </ul>
                {list.more && (
                  <p className={`${meta} mt-3`}>
                    Showing the {view === "person" ? "oldest" : "latest"} {LIST_MAX}.
                  </p>
                )}
              </>
            )}
          </section>
          {chosen && (
            // From 1024px only: a phone opens a message on its own page.
            <section
              aria-labelledby="chosen-title"
              data-chosen-message={chosen.messageId}
              className="glass hidden rounded-inner p-6 lg:block"
            >
              <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <h2
                    id="chosen-title"
                    className="text-2xl font-semibold tracking-heading text-balance text-ink"
                  >
                    {enquiryTitle(chosen)}
                  </h2>
                  <EnquiryFacts e={chosen} />
                </div>
                <CasualPageLink e={chosen} />
              </header>
              <EnquiryBody e={chosen} level={3} stayOn={paneHref(view, day, chosen.messageId)} />
            </section>
          )}
        </div>
      )}
    </main>
  );
}

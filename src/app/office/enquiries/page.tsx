import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  card,
  h2,
  headingGap,
  meta,
  notice,
  nums,
  page,
  rows,
  sectionGap,
  tab,
  tabCurrent,
  tabs,
  textLink,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { appEnv } from "@/lib/env";
import { ENQUIRY_VIEWS, LIST_MAX, officeEnquiries, type EnquiryView } from "@/lib/office/enquiries";
import {
  AI_BANNER,
  appTodayText,
  countsLine,
  enquiriesEmptyText,
  showLastDaysText,
  VIEW_LABELS,
} from "@/lib/office/enquiries-copy";
import { officeRequestQueue } from "@/lib/office/request-queue";
import { EnquiryItem } from "./enquiry-row";
import { RequestQueueView } from "./request-queue-view";

export const metadata: Metadata = { title: "Enquiries" };

// Enquiries (docs/office-v2.md 3.6; docs/screens.md `/office/enquiries`; 12D.1): what casuals and
// strangers sent the shifts line in the firm's message retention (90 days by default) and what came of it, the ones that need a
// person, the requests made in the app (the old Requests page) and pay. Views are links. Each row
// opens the message's own page. Admins and resourcers.

// Only today's (since midnight, the firm's time): the dashboard's "Enquiries today" link.
const EMPTY_TODAY = "Nothing to the shifts line today.";

const isView = (v: unknown): v is EnquiryView =>
  typeof v === "string" && (ENQUIRY_VIEWS as readonly string[]).includes(v);
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
  searchParams: Promise<{ view?: string; day?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("enquiries");
  const { view: viewParam, day: dayParam } = await searchParams;
  const view: EnquiryView = isView(viewParam) ? viewParam : "all";
  // "Requests from the app" is the request queue: every one waiting, whatever the day.
  const day = dayParam === "today" && view !== "app" ? ("today" as const) : undefined;
  const list = await officeEnquiries(
    { firm, officeUserId: officeUser.id },
    view,
    day ? { day } : {},
  );
  if (!list) notFound();
  const queue =
    view === "app"
      ? await officeRequestQueue({ firm }, (await readSessionToken("office")) ?? "")
      : null;
  if (view === "app" && !queue) notFound();
  const now = new Date();
  return (
    <main className={page.office}>
      <PageHeader title="Enquiries" />
      <p className={`${nums} -mt-2`}>{countsLine(list.today, list.needPerson, now)}</p>
      {appEnv().AI_TRANSPORT === "none" && <p className={`${notice} mt-4`}>{AI_BANNER}</p>}

      <nav aria-label="Show" className={`${tabs} mt-6`}>
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
                <span className={nums}>({list.needPerson.count})</span>
              </>
            )}
          </Link>
        ))}
      </nav>
      {day && (
        <p className={`${meta} mt-3`}>
          Only today&apos;s.{" "}
          <Link href={hrefOf(view)} className={textLink}>
            {showLastDaysText(list.days)}
          </Link>
        </p>
      )}
      {day && view === "all" && list.appToday > 0 && (
        // The dashboard's "Enquiries today" counts these too (docs/office-v2.md 3.2).
        <p className={`${meta} mt-1`}>
          {appTodayText(list.appToday)}{" "}
          <Link href={hrefOf("app")} className={textLink}>
            See requests from the app
          </Link>
        </p>
      )}

      <section aria-labelledby="view-heading" className={sectionGap.office}>
        <h2 id="view-heading" className={h2}>
          {VIEW_LABELS[view]}
        </h2>
        {view === "app" && queue ? (
          <div className={headingGap}>
            <RequestQueueView queue={queue} />
          </div>
        ) : list.rows.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>
            {day ? EMPTY_TODAY : enquiriesEmptyText(view as Exclude<EnquiryView, "app">, list.days)}
          </p>
        ) : (
          <>
            <ul role="list" className={`${rows} ${headingGap}`}>
              {list.rows.map((r) => (
                <EnquiryItem key={r.messageId} r={r} timeZone={list.timeZone} />
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
    </main>
  );
}

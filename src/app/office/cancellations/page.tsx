import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, h2, meta, nums, page, row, rows, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { CANCELLATIONS_PAGE_ROWS, officeCancellations } from "@/lib/office/cancellations";
import {
  CANCELLATION_VIEWS,
  howText,
  strikeText,
  VIEW_EMPTY,
  VIEW_WORDS,
  weekCountsText,
  type CancellationView,
} from "@/lib/office/cancellations-copy";
import { noticeText } from "@/lib/portal/cancel-reasons";
import { roleLabel, timeOnDay } from "@/lib/portal/format";

export const metadata: Metadata = { title: "Cancellations" };

const isView = (v: unknown): v is CancellationView =>
  typeof v === "string" && (CANCELLATION_VIEWS as readonly string[]).includes(v);

const hrefOf = (view: CancellationView, day?: "today") => {
  const q = [...(view === "all" ? [] : [`view=${view}`]), ...(day ? [`day=${day}`] : [])];
  return q.length === 0 ? "/office/cancellations" : `/office/cancellations?${q.join("&")}`;
};

// Cancellations (docs/office-v2.md 3.4; docs/screens.md `/office/cancellations`): this week's
// counts, then every cancelled booking, newest first, in the chosen view (links: All · Under 48
// hours · By the office), each opening its record. Nothing to approve: a cancellation is final
// when it's made. A CSV of the view. Admins and resourcers.
export default async function CancellationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; day?: string }>;
}) {
  const { firm } = await requireOfficeArea("cancellations");
  const { view: viewParam, day: dayParam } = await searchParams;
  const view: CancellationView = isView(viewParam) ? viewParam : "all";
  // Only today's (since midnight, the firm's time): the dashboard's "Cancellations today" link.
  const day = dayParam === "today" ? ("today" as const) : undefined;
  const list = await officeCancellations({ firm }, (await readSessionToken("office")) ?? "", view, {
    limit: CANCELLATIONS_PAGE_ROWS,
    ...(day ? { day } : {}),
  });
  if (!list) notFound();
  const tz = list.timeZone;
  const week = weekCountsText(list.week);
  return (
    <main className={page.office}>
      <PageHeader
        title="Cancellations"
        actions={
          <a
            href={`/office/cancellations/export?view=${view}${day ? `&day=${day}` : ""}`}
            className={btn.secondary}
          >
            Download CSV
          </a>
        }
      >
        <p>
          Every cancellation, by casuals and by the office. A cancellation is final the moment
          it&apos;s made: nothing here needs approving.
        </p>
      </PageHeader>

      <section aria-labelledby="week" className="grid gap-3 sm:grid-cols-2">
        <h2 id="week" className="sr-only">
          This week
        </h2>
        <div className={card}>
          <p className={meta}>Cancellations this week</p>
          <p className={`text-lg font-semibold ${nums}`}>{week.cancellations}</p>
        </div>
        <div className={card}>
          <p className={meta}>Under {list.threshold} hours&apos; notice this week</p>
          <p className={`text-lg font-semibold ${nums}`}>{week.strikes}</p>
        </div>
      </section>

      <nav aria-label="Show" className="mt-8 flex flex-wrap gap-2">
        {CANCELLATION_VIEWS.map((v) => (
          <Link
            key={v}
            href={hrefOf(v, day)}
            aria-current={v === view ? "page" : undefined}
            className={v === view ? `${btn.primary} rounded-full` : `${btn.secondary} rounded-full`}
          >
            {VIEW_WORDS[v](list.threshold)}
          </Link>
        ))}
      </nav>

      {day && (
        <p className={`${meta} mt-3`}>
          Only today&apos;s.{" "}
          <Link href={hrefOf(view)} className={textLink}>
            Show every day
          </Link>
        </p>
      )}

      <h2 className={`${h2} mt-6`}>{VIEW_WORDS[view](list.threshold)}</h2>
      {list.rows.length === 0 ? (
        <p className={`${card} mt-3 text-ink-muted`}>
          {day ? "No cancellations today." : VIEW_EMPTY[view]}
        </p>
      ) : (
        <ul role="list" className={`${rows} mt-3`}>
          {list.rows.map((r) => (
            <li key={r.assignmentId} className={row}>
              <Link
                href={`/office/cancellations/${r.ref}`}
                className="press flex flex-col gap-1 rounded-row focus-visible:outline-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <span className="min-w-0">
                  <span className="block font-semibold underline decoration-line-strong underline-offset-4">
                    {r.casual}
                  </span>
                  <span className="block text-ink-muted">
                    {roleLabel(r.role)}
                    {r.siteName ? ` at ${r.siteName}` : ""} · {timeOnDay(r.startsAt, tz)}
                  </span>
                </span>
                <span className={`flex flex-col text-sm sm:items-end ${nums}`}>
                  <span>
                    Cancelled {timeOnDay(r.cancelledAt, tz)} · {howText(r)}
                  </span>
                  <span className="text-ink-muted">
                    {noticeText(r.noticeHours)} · Strike: {strikeText(r, tz)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.total > list.rows.length && (
        <p className="mt-4 text-ink-muted">
          Showing the latest {CANCELLATIONS_PAGE_ROWS} of {list.total}. Download the CSV for all of
          them.
        </p>
      )}
    </main>
  );
}

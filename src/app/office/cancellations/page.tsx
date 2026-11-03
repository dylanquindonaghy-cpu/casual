import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, nums, page, tab, tabCount, tabCurrent, tabs } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { CANCELLATIONS_PAGE_ROWS, officeCancellations } from "@/lib/office/cancellations";
import {
  CANCELLATION_VIEWS,
  cancelledLine,
  countTiles,
  noticeShort,
  RED_ROWS,
  sessionLine,
  strikeBadge,
  VIEW_EMPTY,
  VIEW_WORDS,
  type CancellationRow,
  type CancellationView,
} from "@/lib/office/cancellations-copy";
import { REVIEW_WORDS } from "@/lib/office/strikes-copy";

export const metadata: Metadata = { title: "Cancellations" };

const isView = (v: unknown): v is CancellationView =>
  typeof v === "string" && (CANCELLATION_VIEWS as readonly string[]).includes(v);

const hrefOf = (view: CancellationView, day?: "today") => {
  const q = [...(view === "all" ? [] : [`view=${view}`]), ...(day ? [`day=${day}`] : [])];
  return q.length === 0 ? "/office/cancellations" : `/office/cancellations?${q.join("&")}`;
};

const th = "px-4 pt-4 pb-3 text-xs font-medium whitespace-nowrap text-ink-muted";
const td = "px-4 py-3 align-middle";
// A row with under the threshold's notice (can-1): tinted red with a red edge, in every tab. On a
// phone its card is the tint instead of glass (glass keeps one fill everywhere: office.look).
const hotRow = "bg-urgent-soft";
const hotEdge = "border-l-4 border-l-urgent";

// Cancellations, round 8 (Phase 26.8; docs/screens.md "Cancellations, round 8"; the older
// `/office/cancellations` row for the rest): four counts (can-3), the tabs with their counts (All ·
// Under 48 hours · Strikes · By the office, can-4) and Every day · Today (aud-15), then every
// cancelled booking, newest first, as a table from 768px and cards on a phone, with its notice
// and strike in their own columns (can-2) and the short-notice rows in red (can-1); each opens its
// record. Nothing to approve: a cancellation is final when it's made. A CSV of the view. Admins
// and resourcers.
export default async function CancellationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; day?: string }>;
}) {
  const { firm } = await requireOfficeArea("cancellations");
  const { view: viewParam, day: dayParam } = await searchParams;
  const view: CancellationView = isView(viewParam) ? viewParam : "all";
  // Only today's (since midnight, the firm's time): the "Today" tab.
  const day = dayParam === "today" ? ("today" as const) : undefined;
  const list = await officeCancellations({ firm }, (await readSessionToken("office")) ?? "", view, {
    limit: CANCELLATIONS_PAGE_ROWS,
    ...(day ? { day } : {}),
  });
  if (!list) notFound();
  const tz = list.timeZone;
  const tiles = countTiles(list, list.threshold);
  const viewName = VIEW_WORDS[view](list.threshold);
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

      <ul
        role="list"
        aria-label="Counts"
        className="glass mb-4 grid grid-cols-2 overflow-hidden rounded-inner md:grid-cols-4"
      >
        {tiles.map((t) => (
          <li
            key={t.label}
            className="flex flex-col gap-1 border-line p-4 not-last:border-r max-md:even:border-r-0 max-md:[&:nth-child(-n+2)]:border-b"
          >
            <span className="text-sm text-ink-muted">{t.label}</span>
            <span
              className={`text-3xl font-semibold tabular-nums ${t.urgent ? "text-urgent-ink" : "text-ink"}`}
            >
              {t.value}
            </span>
            <span className="text-sm text-ink-muted">{t.line}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <nav aria-label="Show" className={tabs}>
          {CANCELLATION_VIEWS.map((v) => (
            <Link
              key={v}
              href={hrefOf(v, day)}
              aria-current={v === view ? "page" : undefined}
              className={v === view ? tabCurrent : tab}
            >
              {VIEW_WORDS[v](list.threshold)}{" "}
              <span className={tabCount(v === view)}>{list.tabs[v]}</span>
            </Link>
          ))}
        </nav>
        {/* aud-15: two tabs, not a small text link. */}
        <nav aria-label="Which days" className={`${tabs} sm:ml-auto`}>
          <Link
            href={hrefOf(view)}
            aria-current={day ? undefined : "page"}
            className={day ? tab : tabCurrent}
          >
            Every day
          </Link>
          <Link
            href={hrefOf(view, "today")}
            aria-current={day ? "page" : undefined}
            className={day ? tabCurrent : tab}
          >
            Today
          </Link>
        </nav>
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
        <span aria-hidden="true" className={`inline-block h-4 w-3 ${hotRow} ${hotEdge}`} />
        {RED_ROWS(list.threshold)}
      </p>

      <section className="mt-4" aria-labelledby="list">
        {/* The chosen tab's name, for screen readers: the tab says it on the page (Phase 24). */}
        <h2 id="list" className="sr-only">
          {day ? `${viewName}, today` : viewName}
        </h2>
        {list.rows.length === 0 ? (
          <p className={`${card} text-ink-muted`}>
            {day ? "No cancellations today." : VIEW_EMPTY[view]}
          </p>
        ) : (
          <>
            {/* A table from 768px; stacked cards on a phone. */}
            <div
              role="region"
              tabIndex={0}
              aria-label={`${viewName}: cancellations`}
              className="glass hidden overflow-x-auto rounded-inner px-2 pb-2 md:block"
            >
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className={th}>Casual and session</th>
                    <th className={th}>Cancelled</th>
                    <th className={th}>Notice</th>
                    <th className={th}>Strike</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => {
                    const hot = r.noticeHours < list.threshold;
                    return (
                      <tr
                        key={r.assignmentId}
                        data-record={r.ref}
                        className={`border-t border-line ${hot ? hotRow : ""}`}
                      >
                        <td className={`${td} min-w-64 ${hot ? hotEdge : ""}`}>
                          <Link
                            href={`/office/cancellations/${r.ref}`}
                            className="press font-semibold text-ink underline-offset-4 hover:underline"
                          >
                            {r.casual}
                          </Link>
                          <span className="block text-sm text-ink-muted">{sessionLine(r, tz)}</span>
                        </td>
                        <td className={`${td} text-sm text-ink-muted ${nums}`}>
                          {cancelledLine(r, tz)}
                        </td>
                        <td className={td}>
                          <Notice hours={r.noticeHours} hot={hot} />
                        </td>
                        <td className={td}>
                          <Strike row={r} tz={tz} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul
              role="list"
              aria-label={`${viewName}: cancellations`}
              className="flex flex-col gap-3 md:hidden"
            >
              {list.rows.map((r) => {
                const hot = r.noticeHours < list.threshold;
                return (
                  <li
                    key={r.assignmentId}
                    data-record={r.ref}
                    className={`rounded-inner p-4 ${hot ? `${hotRow} ${hotEdge}` : "glass"}`}
                  >
                    <Link
                      href={`/office/cancellations/${r.ref}`}
                      className="press font-semibold text-ink underline decoration-line-strong underline-offset-4"
                    >
                      {r.casual}
                    </Link>
                    <span className="block text-sm text-ink-muted">{sessionLine(r, tz)}</span>
                    <span className={`mt-1 block text-sm text-ink-muted ${nums}`}>
                      Cancelled {cancelledLine(r, tz)}
                    </span>
                    <span className="mt-3 flex flex-wrap items-center gap-2">
                      <Notice hours={r.noticeHours} hot={hot} />
                      <Strike row={r} tz={tz} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {list.total > list.rows.length && (
        <p className="mt-4 text-ink-muted">
          Showing the latest {CANCELLATIONS_PAGE_ROWS} of {list.total}. Download the CSV for all of
          them.
        </p>
      )}
    </main>
  );
}

const pill = "inline-flex min-h-7 items-center gap-1 rounded-full px-3 py-1 text-sm font-medium";

// The notice given (can-2): red under the threshold, grey otherwise. The column says "Notice".
function Notice({ hours, hot }: { hours: number; hot: boolean }) {
  return (
    <span
      className={`${pill} whitespace-nowrap ${nums} ${hot ? "bg-urgent-soft text-urgent-ink" : "bg-quiet-soft text-ink-muted"}`}
    >
      <span className="sr-only md:hidden">Notice: </span>
      <span>{noticeShort(hours)}</span>
    </span>
  );
}

// The strike (can-2): "Strike 2 issued" in red with when it stops counting, "They gave a reason: check it" in
// amber, a withdrawn one struck through, or grey "No strike · why".
function Strike({ row, tz }: { row: CancellationRow; tz: string }) {
  const b = strikeBadge(row, tz);
  if (b.kind === "issued") {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`${pill} bg-urgent-fill font-semibold text-on-urgent`}>
          <Icon name="strike" size={14} />
          {b.text}
        </span>
        {b.review && (
          <span className={`${pill} bg-attention-soft text-attention-ink`}>{REVIEW_WORDS}</span>
        )}
        <span className="basis-full text-sm text-ink-muted">{b.line}</span>
      </span>
    );
  }
  if (b.kind === "withdrawn") {
    return <span className={`${pill} bg-quiet-soft text-ink-muted line-through`}>{b.text}</span>;
  }
  return <span className={`${pill} bg-quiet-soft text-ink-muted`}>{b.text}</span>;
}

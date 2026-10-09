import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, h2, meta, nums, page, row, rows, textLink, card } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { evidenceText } from "@/lib/office/cancellations-copy";
import {
  officeStrikes,
  STRIKE_VIEWS,
  type CasualStrike,
  type StrikeView,
} from "@/lib/office/strikes";
import {
  liveCountText,
  STRIKE_VIEW_EMPTY,
  STRIKE_VIEW_WORDS,
  strikeLine,
  strikesIntro,
  strikeStatusText,
} from "@/lib/office/strikes-copy";

export const metadata: Metadata = { title: "Strikes" };

const isView = (v: unknown): v is StrikeView =>
  typeof v === "string" && (STRIKE_VIEWS as readonly string[]).includes(v);
const hrefOf = (view: StrikeView) =>
  view === "live" ? "/office/strikes" : `/office/strikes?view=${view}`;

// A strike's evidence email, in the record's words.
const evidenceOf = (s: CasualStrike, tz: string) =>
  evidenceText(
    {
      strike: {
        status: s.status,
        expiresAt: s.expiresAt,
        reviewNeeded: s.reviewNeeded,
        evidence: { ...s.evidence, to: null },
      },
    },
    tz,
  );

// Strikes (docs/office-v2.md 3.5; docs/screens.md `/office/strikes`): one row per casual with a
// strike, by how many still count, in the chosen view (links: Live · Needs review · All). Each
// strike links to its cancellation record, where it's withdrawn or kept. No badge, no CSV (the
// cancellations CSV has the strike). Admins and resourcers.
export default async function StrikesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { firm } = await requireOfficeArea("strikes");
  const { view: viewParam } = await searchParams;
  const view: StrikeView = isView(viewParam) ? viewParam : "live";
  const list = await officeStrikes({ firm }, (await readSessionToken("office")) ?? "", view);
  if (!list) notFound();
  const tz = list.timeZone;
  return (
    <main className={page.office}>
      <PageHeader eyebrow={`${firm.name} office`} title="Strikes">
        <p>{strikesIntro(list.noticeHours, list.liveDays)}</p>
      </PageHeader>

      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {STRIKE_VIEWS.map((v) => (
          <Link
            key={v}
            href={hrefOf(v)}
            aria-current={v === view ? "page" : undefined}
            className={v === view ? `${btn.primary} rounded-full` : `${btn.secondary} rounded-full`}
          >
            {STRIKE_VIEW_WORDS[v]}
          </Link>
        ))}
      </nav>

      <h2 className={`${h2} mt-6`}>{STRIKE_VIEW_WORDS[view]}</h2>
      {list.rows.length === 0 ? (
        <p className={`${card} mt-3 text-ink-muted`}>{STRIKE_VIEW_EMPTY[view]}</p>
      ) : (
        <ul role="list" className={`${rows} mt-3`}>
          {list.rows.map((r) => {
            const [latest, ...earlier] = r.strikes;
            return (
              <li key={r.workerId} className={`${row} flex flex-col gap-2`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto font-semibold">{r.casual}</h3>
                  <StatusChip tone={r.live > 0 ? "urgent" : "quiet"}>
                    {liveCountText(r.live)}
                  </StatusChip>
                  {r.review && <StatusChip tone="attention">Needs review</StatusChip>}
                </div>
                {latest && (
                  <div className="flex flex-col gap-1">
                    <p>
                      <span className="text-ink-muted">Latest: </span>
                      <Link
                        href={`/office/cancellations/${latest.assignmentId}`}
                        className={`${textLink} ${nums}`}
                      >
                        {strikeLine(latest, tz)}
                      </Link>
                    </p>
                    <p className={`${meta} ${nums}`}>
                      {strikeStatusText(latest, tz)} · Evidence: {evidenceOf(latest, tz)}
                    </p>
                  </div>
                )}
                {earlier.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold">
                      Their other strikes ({earlier.length}
                      {r.more ? "+" : ""})
                    </summary>
                    <ul role="list" className="mt-2 flex flex-col gap-2">
                      {earlier.map((s) => (
                        <li key={s.assignmentId} className={`${meta} ${nums}`}>
                          <Link
                            href={`/office/cancellations/${s.assignmentId}`}
                            className={textLink}
                          >
                            {strikeLine(s, tz)}
                          </Link>{" "}
                          · {strikeStatusText(s, tz)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.total > list.rows.length && (
        <p className="mt-4 text-ink-muted">
          Showing {list.rows.length} of {list.total} casuals, those with the most live strikes
          first.
        </p>
      )}
    </main>
  );
}

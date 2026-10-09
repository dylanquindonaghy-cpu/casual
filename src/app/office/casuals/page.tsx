import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  h2,
  headingGap,
  meta,
  nums,
  page,
  sectionGap,
  table,
  textLink,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import {
  CASUAL_VIEWS,
  CASUALS_PAGE_MAX,
  casualsList,
  type CasualRow,
  type CasualView,
} from "@/lib/office/casuals";
import { STATUS_WORDS as ACCESS_WORDS } from "@/lib/office/worker-copy";
import { roleLabel } from "@/lib/portal/format";
import {
  needsSummary,
  qualificationTitle,
  STATUS_TONES,
  STATUS_WORDS,
} from "@/lib/portal/qualification-copy";
import { officeTravelText } from "@/lib/travel/copy";
import { FindWorkerForm } from "../find-worker-form";
import { findWorkersAction } from "./actions";

export const metadata: Metadata = { title: "Casuals" };

const VIEW_WORDS: Record<CasualView, string> = { all: "All", needs: "Need updating" };
const EMPTY: Record<CasualView, string> = {
  all: "No casuals yet. Add them from a staff file or your rota sheet.",
  needs: "Nobody needs to update anything.",
};
const isView = (v: unknown): v is CasualView =>
  typeof v === "string" && (CASUAL_VIEWS as readonly string[]).includes(v);
const hrefOf = (view: CasualView) =>
  view === "all" ? "/office/casuals" : "/office/casuals?view=needs";

// Each qualification as a tag, the worst first.
function Tags({ row }: { row: CasualRow }) {
  if (row.qualifications.length === 0) {
    return (
      <span className={meta}>
        {row.rolesWithoutRule.length > 0
          ? `No rule for ${row.rolesWithoutRule.map(roleLabel).join(", ")}`
          : "None needed"}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {row.qualifications.map((q) => (
        <StatusChip key={q.type} tone={STATUS_TONES[q.status]}>
          {`${qualificationTitle(q.name)}: ${STATUS_WORDS[q.status]}`}
        </StatusChip>
      ))}
    </span>
  );
}

const who = (row: CasualRow) =>
  `${row.roles.map(roleLabel).join(", ") || "No roles"}${
    row.status === "active" ? "" : ` · ${ACCESS_WORDS[row.status]}`
  }`;
const strikesText = (n: number) => (n === 0 ? "None" : String(n));

// Casuals (docs/office-v2.md 3.7; docs/screens.md `/office/casuals`; 12F.1): All and Need updating
// as links with their counts, "Find a casual" (the find-a-worker form, as built), then everyone in
// the view: a table on a wide screen, stacked cards on a phone. Admins and resourcers.
export default async function OfficeCasualsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("casuals");
  const { view: viewParam } = await searchParams;
  const view: CasualView = isView(viewParam) ? viewParam : "all";
  const list = await casualsList({ firm, officeUserId: officeUser.id }, view);
  if (!list) notFound();
  return (
    <main className={page.office}>
      <PageHeader eyebrow={<>{firm.name} office</>} title="Casuals">
        <p>
          Their qualifications, travel areas and strikes. Open someone to see more, or to change
          their access when they leave, come back or lose their phone.
        </p>
      </PageHeader>

      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {CASUAL_VIEWS.map((v) => (
          <Link
            key={v}
            href={hrefOf(v)}
            aria-current={v === view ? "page" : undefined}
            className={v === view ? `${btn.primary} rounded-full` : `${btn.secondary} rounded-full`}
          >
            {VIEW_WORDS[v]} <span className={nums}>({list.counts[v]})</span>
          </Link>
        ))}
      </nav>

      <section className={`${card} mt-6 max-w-2xl`} aria-labelledby="find">
        <h2 id="find" className={h2}>
          Find a casual
        </h2>
        <div className={headingGap}>
          <FindWorkerForm
            find={findWorkersAction}
            hrefBase="/office/casuals"
            notAllowed="You can't see casuals."
          />
        </div>
      </section>

      <section className={sectionGap.office} aria-labelledby="list">
        <h2 id="list" className={h2}>
          {VIEW_WORDS[view]}
        </h2>
        {list.rows.length === 0 ? (
          <p className={`${headingGap} text-ink-muted`}>{EMPTY[view]}</p>
        ) : (
          <>
            {/* A table from 768px; stacked cards on a phone. */}
            <div
              role="region"
              tabIndex={0}
              aria-label={`${VIEW_WORDS[view]}: casuals`}
              className={`${table.wrap} ${headingGap} hidden md:block`}
            >
              <table className={table.table}>
                <thead>
                  <tr>
                    <th className={table.th}>Casual</th>
                    <th className={table.th}>Qualifications</th>
                    <th className={table.th}>Travel area</th>
                    <th className={`${table.th} ${table.num}`}>Live strikes</th>
                    <th className={table.th}>Needs updating</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id}>
                      <td className={`${table.td} min-w-48`}>
                        <Link
                          href={`/office/casuals/${r.id}`}
                          className={`font-semibold ${textLink}`}
                        >
                          {r.name}
                        </Link>
                        <span className={`block ${meta}`}>{who(r)}</span>
                      </td>
                      <td className={`${table.td} min-w-56`}>
                        <Tags row={r} />
                      </td>
                      <td className={`${table.td} ${nums}`}>{officeTravelText(r.travel)}</td>
                      <td className={`${table.td} ${table.num}`}>{strikesText(r.liveStrikes)}</td>
                      <td className={table.td}>{needsSummary(r.needs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul role="list" className={`${headingGap} flex flex-col gap-3 md:hidden`}>
              {list.rows.map((r) => (
                <li key={r.id} className={card}>
                  <Link href={`/office/casuals/${r.id}`} className={`font-semibold ${textLink}`}>
                    {r.name}
                  </Link>
                  <p className={meta}>{who(r)}</p>
                  <div className="mt-2">
                    <Tags row={r} />
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="font-semibold">Travel area</dt>
                    <dd className={nums}>{officeTravelText(r.travel)}</dd>
                    <dt className="font-semibold">Live strikes</dt>
                    <dd className={nums}>{strikesText(r.liveStrikes)}</dd>
                    <dt className="font-semibold">Needs updating</dt>
                    <dd>{needsSummary(r.needs)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
            {list.more && (
              <p className={`${meta} mt-2`}>
                Showing the first {CASUALS_PAGE_MAX}. Use Find a casual to find anyone else.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

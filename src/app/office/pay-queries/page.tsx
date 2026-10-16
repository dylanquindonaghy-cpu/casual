import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, h2, meta, page, sectionGap } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { digestLines } from "@/lib/office/pay-digest-copy";
import { officePayDigestView } from "@/lib/office/pay-digest-view";
import { officePayQueryGroups } from "@/lib/office/pay-query-groups";
import { timeOnDay } from "@/lib/portal/format";
import { ISSUE_LABELS } from "@/lib/portal/pay-query-kinds";
import { dayLabel } from "@/lib/rules/reasons";
import { SendDigestButton } from "./send-digest-button";
import { SortGroupForm } from "./sort-group-form";

export const metadata: Metadata = { title: "Pay queries" };

// A group's card: on a desk, the queries on the left and "Tell them what payroll did" beside them.
const group = `${card} mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-8`;

// Payroll's pay queries (docs/screens.md `/office/pay-queries`): open ones grouped by likely cause,
// biggest first, with a one-line summary and each worker's query; the digest's schedule, the last
// one sent and "Send the digest now"; and each group's "Mark as sorted and tell them" (the workers
// are told payroll has answered, and see the note on their pay page: 13.4). Payroll and admins.
// Layout (docs/ui-design.md "Action card"): the digest in its own card, then one card per group,
// named by its one heading (aria-labelledby), the queries as divided rows ("In a digest" as a
// chip at the end of its line), and the group's one main action.
export default async function PayQueriesPage() {
  const { firm } = await requireOfficeArea("pay");
  const token = (await readSessionToken("office")) ?? "";
  const data = await officePayQueryGroups({ firm }, token);
  const digest = await officePayDigestView({ firm }, token);
  if (!data || !digest) notFound();
  const tz = data.timeZone;
  const total = data.groups.reduce((n, g) => n + g.queries.length, 0);
  return (
    <main className={page.office}>
      <PageHeader
        eyebrow={`${firm.name} office`}
        title="Pay queries"
        actions={
          <Link href="/office/pay/import" className={btn.secondary}>
            Import pay records
          </Link>
        }
      >
        <p>
          {total === 0
            ? "No pay queries waiting."
            : `${total === 1 ? "1 query" : `${total} queries`} waiting, grouped by likely cause. Biggest first.`}
        </p>
      </PageHeader>
      <section
        className={`${card} flex flex-wrap items-end justify-between gap-x-8 gap-y-4`}
        aria-labelledby="digest-heading"
      >
        <div className="flex max-w-prose flex-col gap-1">
          <h2 id="digest-heading" className={h2}>
            Payroll digest
          </h2>
          {digestLines(digest.schedule, digest.status, digest.timeZone).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <SendDigestButton />
      </section>
      {data.groups.map((g, i) => (
        <section key={g.key} className={group} aria-labelledby={`pay-group-${i}`}>
          <div className="min-w-0">
            <h2 id={`pay-group-${i}`} className={`${h2} text-balance`}>
              {g.heading}
            </h2>
            {g.aiLine && (
              <p className="mt-2">
                AI summary: {g.aiLine} <span className="text-ink-muted">(written by AI)</span>
              </p>
            )}
            <ul role="list" className="mt-4 divide-y divide-line border-t border-line">
              {g.queries.map((q) => (
                <li key={q.id} className="py-3">
                  <p className="font-semibold">
                    {q.worker}: {q.shift ?? dayLabel(q.day)} · {ISSUE_LABELS[g.facts.issue]}
                  </p>
                  {q.details && <p className="mt-1">&ldquo;{q.details}&rdquo;</p>}
                  <p className={`mt-1 ${meta} tabular-nums`}>
                    Sent {timeOnDay(q.createdAt, tz)} · Reference {q.ref}
                    {q.status === "in_digest" ? (
                      <>
                        {" · "}
                        <StatusChip tone="quiet">In a digest</StatusChip>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <SortGroupForm ids={g.queries.map((q) => q.id)} />
        </section>
      ))}
      {data.more && <p className={`mt-4 ${meta}`}>Showing the newest 2,000.</p>}
      <p className={`${sectionGap.office} flex flex-wrap gap-x-6`}>
        <Link href="/office" className={btn.link}>
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}

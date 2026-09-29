import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officePayQueryGroups } from "@/lib/office/pay-query-groups";
import { timeOnDay } from "@/lib/portal/format";
import { ISSUE_LABELS } from "@/lib/portal/pay-query-kinds";
import { dayLabel } from "@/lib/rules/reasons";

const card = "mt-3 rounded-xl border border-slate-300 p-4";

// Payroll's pay queries (docs/screens.md `/office/pay-queries`): open ones grouped by likely cause,
// biggest first, with a one-line summary and each worker's query. Payroll and admins. Read only for
// now: resolving a group, the digest and telling workers come next.
export default async function PayQueriesPage() {
  const { firm } = await requireOfficeArea("pay");
  const data = await officePayQueryGroups({ firm }, (await readSessionToken("office")) ?? "");
  if (!data) notFound();
  const tz = data.timeZone;
  const total = data.groups.reduce((n, g) => n + g.queries.length, 0);
  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Pay queries</h1>
      <p className="mt-2">
        {total === 0
          ? "No pay queries waiting."
          : `${total === 1 ? "1 query" : `${total} queries`} waiting, grouped by likely cause. Biggest first.`}
      </p>
      {data.groups.map((g) => (
        <section key={g.key} className={card} aria-label={g.heading}>
          <h2 className="text-xl font-bold">{g.heading}</h2>
          {g.aiLine && (
            <p className="mt-1">
              AI summary: {g.aiLine} <span className="text-slate-600">(written by AI)</span>
            </p>
          )}
          <ul className="mt-2 divide-y">
            {g.queries.map((q) => (
              <li key={q.id} className="py-2">
                <p className="font-semibold">
                  {q.worker}: {q.shift ?? dayLabel(q.day)} · {ISSUE_LABELS[g.facts.issue]}
                </p>
                {q.details && <p>&ldquo;{q.details}&rdquo;</p>}
                <p className="text-base text-slate-600">
                  Sent {timeOnDay(q.createdAt, tz)} · Reference {q.ref}
                  {q.status === "in_digest" ? " · In a digest" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data.more && <p className="mt-4">Showing the newest 2,000.</p>}
      <p className="mt-8">
        <Link href="/office" className="underline">
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}

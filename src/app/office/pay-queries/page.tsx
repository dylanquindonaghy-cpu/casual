import Link from "next/link";
import { notFound } from "next/navigation";
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

const card = "mt-3 rounded-xl border border-slate-300 p-4";

// Payroll's pay queries (docs/screens.md `/office/pay-queries`): open ones grouped by likely cause,
// biggest first, with a one-line summary and each worker's query; the digest's schedule, the last
// one sent and "Send the digest now"; and each group's "Mark as sorted and tell them" (the workers
// get payroll's note). Payroll and admins.
export default async function PayQueriesPage() {
  const { firm } = await requireOfficeArea("pay");
  const token = (await readSessionToken("office")) ?? "";
  const data = await officePayQueryGroups({ firm }, token);
  const digest = await officePayDigestView({ firm }, token);
  if (!data || !digest) notFound();
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
      <section className={card} aria-labelledby="digest-heading">
        <h2 id="digest-heading" className="text-xl font-bold">
          Payroll digest
        </h2>
        {digestLines(digest.schedule, digest.status, digest.timeZone).map((line) => (
          <p key={line} className="mt-1">
            {line}
          </p>
        ))}
        <SendDigestButton />
      </section>
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
          <SortGroupForm ids={g.queries.map((q) => q.id)} />
        </section>
      ))}
      {data.more && <p className="mt-4">Showing the newest 2,000.</p>}
      <p className="mt-8 flex flex-wrap gap-4">
        <Link href="/office/pay/import" className="underline">
          Import pay records
        </Link>
        <Link href="/office" className="underline">
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}

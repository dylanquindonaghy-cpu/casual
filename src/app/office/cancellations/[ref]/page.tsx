import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, nums, page, row, rows, textLink } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeCancellationRecord, type SharedReference } from "@/lib/office/cancellations";
import { AS_IT_IS_NOW, howText, recordFields } from "@/lib/office/cancellations-copy";
import { roleLabel, timeOnDay } from "@/lib/portal/format";
import { ResendEvidence } from "./resend-evidence";

export const metadata: Metadata = { title: "Cancellation record" };

// One cancellation's record (docs/office-v2.md 3.4's table; docs/screens.md
// `/office/cancellations/[ref]`): every field, the reason as given (admins and resourcers only:
// the PDF and the CSV never carry a casual's), and "Download PDF" (by the booking's full id, so it
// is always this one). Opened by its reference or the booking's full id; a reference two
// cancellations share lists both to choose from. "Resend evidence" when the evidence email to the
// strikes team failed (12C.4). Nothing to approve.
export default async function CancellationRecordPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { firm } = await requireOfficeArea("cancellations");
  const { ref } = await params;
  const found = await officeCancellationRecord(
    { firm },
    (await readSessionToken("office")) ?? "",
    ref,
  );
  if (!found) notFound();
  if (found.status === "several") return <ChooseOne shared={found.shared} />;
  const { record } = found;
  const fields = recordFields(record.row, {
    tz: record.timeZone,
    threshold: record.threshold,
    liveStrikes: record.liveStrikes,
    forExport: false,
  });
  return (
    <main className={page.office}>
      <PageHeader
        eyebrow={
          <Link href="/office/cancellations" className={textLink}>
            Cancellations
          </Link>
        }
        title={`Cancellation ${record.row.ref}`}
        actions={
          <a
            href={`/office/cancellations/${record.row.assignmentId}/pdf`}
            className={btn.secondary}
          >
            Download PDF
          </a>
        }
      >
        <p>
          {record.row.casual}: final the moment it was made. The PDF shows a casual&apos;s reason as
          &ldquo;Casual&apos;s own reason (see ShiftDesk)&rdquo;.
        </p>
        <p>{AS_IT_IS_NOW}</p>
      </PageHeader>
      {record.row.strike?.evidence.status === "failed" && (
        <section aria-labelledby="evidence" className="mb-6 flex max-w-3xl flex-col gap-2">
          <h2 id="evidence" className="font-semibold text-ink">
            The evidence email failed
          </h2>
          <p className="text-ink-muted">
            It may have arrived anyway: check with the strikes team before sending it again.
          </p>
          <ResendEvidence assignmentId={record.row.assignmentId} />
        </section>
      )}
      <dl className="grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
        {fields.map((f) => (
          <div key={f.label} className="contents">
            <dt className="font-semibold text-ink">{f.label}</dt>
            <dd className="mb-2 text-ink sm:mb-0">{f.value}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}

function ChooseOne({ shared }: { shared: SharedReference }) {
  const tz = shared.timeZone;
  return (
    <main className={page.office}>
      <PageHeader
        eyebrow={
          <Link href="/office/cancellations" className={textLink}>
            Cancellations
          </Link>
        }
        title={`Cancellation ${shared.ref}`}
      >
        <p>{shared.choices.length} cancellations have this reference. Choose the one you want.</p>
      </PageHeader>
      <ul role="list" className={rows}>
        {shared.choices.map((r) => (
          <li key={r.assignmentId} className={row}>
            <Link
              href={`/office/cancellations/${r.assignmentId}`}
              className="flex flex-col gap-1 rounded-md focus-visible:outline-2"
            >
              <span className="font-semibold underline decoration-line-strong underline-offset-4">
                {r.casual}
              </span>
              <span className="text-ink-muted">
                {roleLabel(r.role)}
                {r.siteName ? ` at ${r.siteName}` : ""} · {timeOnDay(r.startsAt, tz)}
              </span>
              <span className={`text-sm ${nums}`}>
                Cancelled {timeOnDay(r.cancelledAt, tz)} · {howText(r)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

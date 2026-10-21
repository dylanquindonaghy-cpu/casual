import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, nums, page, row, rows } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeCancellationRecord, type SharedReference } from "@/lib/office/cancellations";
import {
  AS_IT_IS_NOW,
  howText,
  recordFields,
  resendNote,
  strikeSectionLines,
  strikeText,
} from "@/lib/office/cancellations-copy";
import { strikeButtons, withdrawText } from "@/lib/office/strike-actions-copy";
import { roleLabel, timeOnDay } from "@/lib/portal/format";
import { ResendEvidence } from "./resend-evidence";
import { StrikeActions } from "./strike-actions";

export const metadata: Metadata = { title: "Cancellation record" };

// One cancellation's record (docs/office-v2.md 3.4's table; docs/screens.md
// `/office/cancellations/[ref]`): every field, the reason as given (admins and resourcers only:
// the PDF and the CSV never carry a casual's), and "Download PDF" (by the booking's full id, so it
// is always this one). Opened by its reference or the booking's full id; a reference two
// cancellations share lists both to choose from. "Resend evidence" when the evidence email to the
// strikes team failed or is held up (12C.4). Its strike: "Withdraw strike…" and, until someone has
// reviewed it, "Keep strike" (for whoever may change strikes); once withdrawn, who, when and why
// (12C.5). Nothing to approve.
export default async function CancellationRecordPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { firm, officeUser } = await requireOfficeArea("cancellations");
  const { ref } = await params;
  const found = await officeCancellationRecord(
    { firm },
    (await readSessionToken("office")) ?? "",
    ref,
  );
  if (!found) notFound();
  if (found.status === "several") return <ChooseOne shared={found.shared} />;
  const { record } = found;
  // "Resend evidence" when a live strike's email failed or is held up (12C.4).
  const strike = record.row.strike;
  const resend = strike?.status === "live" ? resendNote(strike.evidence) : null;
  const fields = recordFields(record.row, {
    tz: record.timeZone,
    threshold: record.threshold,
    liveStrikes: record.liveStrikes,
    forExport: false,
  });
  return (
    <main className={page.office}>
      <PageHeader
        back={{ href: "/office/cancellations", label: "Cancellations" }}
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
      {strike && (
        <section aria-labelledby="strike" className="mb-6 flex max-w-3xl flex-col gap-2">
          <h2 id="strike" className="font-semibold text-ink">
            Strike: {strikeText(record.row, record.timeZone)}
          </h2>
          {strikeSectionLines(strike, record.timeZone).map((line) => (
            <p key={line} className="text-ink-muted">
              {line}
            </p>
          ))}
          {strike.status === "live" && record.row.erased && (
            <p className="text-ink-muted">{withdrawText({ status: "erased" })}</p>
          )}
          {/* Always here for whoever may change strikes (it shows nothing without a button or an
              answer), so an answer outlives the refresh that takes its button away (19.1). */}
          {canAccess(officeUser.role, "strikes") && (
            <StrikeActions
              assignmentId={record.row.assignmentId}
              {...strikeButtons(strike, record.row.erased ?? false)}
            />
          )}
        </section>
      )}
      {/* Always here (it shows nothing without a note), so a resend's answer outlives the refresh. */}
      <ResendEvidence assignmentId={record.row.assignmentId} note={resend} />
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
        back={{ href: "/office/cancellations", label: "Cancellations" }}
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

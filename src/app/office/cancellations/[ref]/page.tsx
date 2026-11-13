import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { btn, card, nums, page, row, rows } from "@/app/ui/classes";
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
import { cancellationTabTitle } from "@/lib/office/tab-titles";
import { roleLabel, timeOnDay } from "@/lib/portal/format";
import { ResendEvidence } from "./resend-evidence";
import { StrikeActions } from "./strike-actions";
import { Ref } from "@/app/ui/ref";

// The record, read once per request for the page and its tab title (Phase 37.6, w1-09:
// "Cancellation 8CE76FA4 · Ben Carter"; "Cancellation 8CE76FA4" when two share the ref), after the
// page's own access check: a role without "cancellations" gets the not-found page. Reads only.
// The PDF and the evidence keep "Cancellation record {ref}".
const load = cache(async (ref: string) => {
  const session = await requireOfficeArea("cancellations");
  const found = await officeCancellationRecord(
    { firm: session.firm },
    (await readSessionToken("office")) ?? "",
    ref,
  );
  return { session, found };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { found } = await load((await params).ref);
  if (!found) notFound();
  return {
    title:
      found.status === "several"
        ? cancellationTabTitle(found.shared.ref)
        : cancellationTabTitle(found.record.row.ref, found.record.row.casual),
  };
}

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
  const { ref } = await params;
  const {
    session: { officeUser },
    found,
  } = await load(ref);
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
  // can-5: notice, strike and reason first; then every other field in §3.4's order (the PDF keeps
  // that order throughout).
  const firstLabels = ["Notice", `Under ${record.threshold} hours`, "Strike", "Reason"];
  const first = firstLabels.flatMap((label) => fields.filter((f) => f.label === label));
  const rest = fields.filter((f) => !firstLabels.includes(f.label));
  const hot = record.row.noticeHours < record.threshold;
  return (
    <main className={page.office}>
      <PageHeader
        back={{ href: "/office/cancellations", label: "Cancellations" }}
        title={
          <>
            Cancellation <Ref>{record.row.ref}</Ref>
          </>
        }
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
      {/* Notice, strike and reason first (round 8's can-5). Under the threshold, its status is a red
          edge and the notice in red, never a tint over the whole section (Phase 24.5's rule, which
          tests/e2e/office.look.spec.ts checks on every office page). */}
      <section
        aria-labelledby="first"
        className={`mb-6 max-w-3xl ${card} ${hot ? "border-l-4 border-l-urgent" : ""}`}
      >
        <h2 id="first" className="sr-only">
          Notice, strike and reason
        </h2>
        <Fields fields={first} hot={hot} />
      </section>
      {strike && (
        <section aria-labelledby="strike" className="mb-6 flex max-w-3xl flex-col gap-2">
          <h2 id="strike" className="font-bold text-ink">
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
      {/* The rest of the record's facts as label and value rows in one card (Phase 21). */}
      <div className={`${card} max-w-3xl`}>
        <Fields fields={rest} hot={false} />
      </div>
    </main>
  );
}

// Label and value rows. `hot`: the notice was under the threshold, so it reads in red.
function Fields({ fields, hot }: { fields: { label: string; value: string }[]; hot: boolean }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
      {fields.map((f) => (
        <div key={f.label} className="contents">
          <dt className="font-semibold text-ink">{f.label}</dt>
          <dd
            className={`mb-2 sm:mb-0 ${hot && f.label === "Notice" ? "font-semibold text-urgent-ink" : "text-ink"}`}
          >
            {f.label === "Reference" ? <Ref>{f.value}</Ref> : f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ChooseOne({ shared }: { shared: SharedReference }) {
  const tz = shared.timeZone;
  return (
    <main className={page.office}>
      <PageHeader
        back={{ href: "/office/cancellations", label: "Cancellations" }}
        title={
          <>
            Cancellation <Ref>{shared.ref}</Ref>
          </>
        }
      >
        <p>{shared.choices.length} cancellations have this reference. Choose the one you want.</p>
      </PageHeader>
      <ul role="list" className={rows}>
        {shared.choices.map((r) => (
          <li key={r.assignmentId} className={row}>
            <Link
              href={`/office/cancellations/${r.assignmentId}`}
              className="press flex flex-col gap-1 rounded-row focus-visible:outline-2"
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

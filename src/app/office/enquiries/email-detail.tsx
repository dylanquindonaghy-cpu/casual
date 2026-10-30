import Link from "next/link";
import { btn, h2, meta, nums } from "@/app/ui/classes";
import { StatusChip } from "@/app/ui/status-chip";
import type { EmailEnquiryDetail } from "@/lib/office/enquiries";
import {
  attachmentsLine,
  emailReceivedStep,
  emailReplyByLine,
  emailReplyStep,
  emailSentStep,
  emailSortedStep,
  emailTitle,
  notCasualText,
  OUTCOME_TONES,
  OUTCOME_WORDS,
  PAY_LOCK,
  subjectLine,
  thenStep,
} from "@/lib/office/enquiries-copy";
import { roleLabel, timeOnDay } from "@/lib/portal/format";
import { dayLabel } from "@/lib/rules/reasons";
import { localDateOf } from "@/lib/time/zoned";
import { EmailForms } from "./[id]/email-forms";

// One email to the staffing inbox (P7.4, P7.5; Phase 25.5; docs/screens.md "The staffing inbox in
// Enquiries"), as its own page shows it and as Enquiries shows the chosen one beside the list from
// 1024px, in a message's parts (./enquiry-detail.tsx): who it's from, its outcome and reference;
// "The email" (its subject and words, and each reply as it went), "How it was answered" step by
// step from logged facts, and, while it needs a person, "Answer it" (./[id]/email-forms.tsx). One
// not from a casual shows who it came from and that it's in the firm's own inbox: its words were
// never kept.

export { emailTitle };

export function EmailFacts({ e }: { e: EmailEnquiryDetail }) {
  return (
    <p className="flex flex-wrap items-center gap-2">
      <StatusChip tone={OUTCOME_TONES[e.outcome]}>{OUTCOME_WORDS[e.outcome]}</StatusChip>
      {e.pay && <StatusChip tone="quiet">{PAY_LOCK}</StatusChip>}
      <span className={`${meta} ${nums}`}>Reference {e.ref}</span>
    </p>
  );
}

export function EmailCasualLink({ e }: { e: EmailEnquiryDetail }) {
  return e.who.kind === "casual" ? (
    <Link href={`/office/casuals/${e.who.workerId}`} className={btn.secondary}>
      {e.who.name}&apos;s page
    </Link>
  ) : null;
}

export function EmailBody({
  e,
  level,
  stayOn,
}: {
  e: EmailEnquiryDetail;
  level: 2 | 3;
  stayOn?: string;
}) {
  const H = level === 2 ? "h2" : "h3";
  const at = (d: Date) => timeOnDay(d, e.timeZone);
  const t = e.timeline;
  const shiftWords = (s: { role: string; site: string | null; startsAt: Date }) =>
    `${roleLabel(s.role)}${s.site ? ` at ${s.site}` : ""}, ${dayLabel(localDateOf(s.startsAt, e.timeZone))}`;
  const then = t.then.map((fact) =>
    thenStep(fact, at, {
      firstName: e.who.kind === "casual" ? e.who.firstName : null,
      shiftWords,
    }),
  );
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="the-email" className="flex flex-col gap-3">
        <H id="the-email" className={h2}>
          The email
        </H>
        <div className="glass-tile flex flex-col gap-3 rounded-inner p-4">
          {e.who.kind === "casual" ? (
            <>
              <p className="font-semibold break-words">{subjectLine(e.subject)}</p>
              <p className="break-words whitespace-pre-wrap">{e.text ?? "(No text.)"}</p>
              {e.attachments > 0 && <p className={meta}>{attachmentsLine(e.attachments)}</p>}
              <p className={`${meta} ${nums}`}>Email · {at(e.at)}</p>
            </>
          ) : (
            <p className="break-words">{notCasualText(e.fromAddress)}</p>
          )}
          {e.replies.map((r) => (
            <div
              key={r.id}
              className="ml-auto max-w-[85%] rounded-inner bg-ink px-4 py-3 text-on-ink"
            >
              <p className="sr-only">Reply:</p>
              <p className="break-words whitespace-pre-wrap">{r.body}</p>
              <p className="mt-1 text-sm tabular-nums opacity-80">
                {emailReplyByLine(r)} · {at(r.at)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-3">
        <H id="how" className={h2}>
          How it was answered
        </H>
        <ol className="flex list-decimal flex-col gap-2 pl-6 marker:text-ink-muted">
          <li>
            <span className="font-semibold">Received:</span> {emailReceivedStep(t.received, at)}
          </li>
          <li>
            <span className="font-semibold">Sorted:</span> {emailSortedStep(t.sorted)}
          </li>
          <li>
            <span className="font-semibold">Reply built:</span> {emailReplyStep(t.reply)}
          </li>
          <li>
            <span className="font-semibold">Sent:</span> {emailSentStep(t.sent, at)}
          </li>
          <li>
            <span className="font-semibold">Then:</span>{" "}
            {then.length === 0 ? (
              e.waiting ? (
                "Waiting for a person."
              ) : (
                "Nothing more."
              )
            ) : then.length === 1 ? (
              then[0]
            ) : (
              <ul role="list" className="mt-1 flex list-disc flex-col gap-1 pl-6">
                {then.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </li>
        </ol>
      </section>

      <EmailForms
        key={e.messageId}
        waiting={e.waiting}
        emailId={e.messageId}
        draft={e.draft}
        pay={e.pay}
        firstName={e.firstName}
        signOff={e.firm.signOff}
        level={level}
        stayOn={stayOn}
      />
    </div>
  );
}

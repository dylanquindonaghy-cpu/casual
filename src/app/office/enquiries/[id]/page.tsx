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
  textLink,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { officeEnquiry, type ConversationItem } from "@/lib/office/enquiries";
import {
  CHANNEL_WORDS,
  NO_CHECKS,
  OUTCOME_TONES,
  OUTCOME_WORDS,
  PAY_LOCK,
  planLine,
  receivedStep,
  replyStep,
  sentStep,
  sortedStep,
  thenStep,
  whoName,
} from "@/lib/office/enquiries-copy";
import { roleLabel, timeOnDay } from "@/lib/portal/format";
import { dayLabel } from "@/lib/rules/reasons";
import { localDateOf } from "@/lib/time/zoned";
import { EnquiryForms } from "./enquiry-forms";

export const metadata: Metadata = { title: "Enquiry" };

// One message on the shifts line (docs/office-v2.md 3.6; docs/screens.md
// `/office/enquiries/[id]`; 12D.1): the conversation as the casual saw it, then "How it was
// answered" step by step from logged facts, "Considered but not offered", and, while it needs a
// person, the reply box and "Close without a reply". Admins and resourcers.

// A voicemail's caller can be faked (a WhatsApp's number can't, easily): the office should know.
const VOICEMAIL_WARNING =
  "From a voicemail on the shifts line. A caller's number can be faked: check anything unusual with them.";

function Bubble({ item, timeZone }: { item: ConversationItem; timeZone: string }) {
  const theirs = item.direction === "in";
  const state = item.officeReply?.state;
  return (
    <li className={`flex ${theirs ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 ${
          theirs ? "border border-line bg-card" : "bg-done-soft"
        }`}
      >
        <p className="sr-only">{theirs ? "They wrote:" : "Reply:"}</p>
        <p className="break-words whitespace-pre-wrap">
          {item.text ??
            (item.channel === "voice"
              ? "(A voicemail we couldn't turn into text.)"
              : "(A photo or file, with no text.)")}
        </p>
        <p className={`${meta} ${nums} mt-1`}>
          {CHANNEL_WORDS[item.channel]} · {timeOnDay(item.at, timeZone)}
          {item.officeReply && (
            <>
              {" · "}
              {item.officeReply.by ?? "The office"}
              {state === "sending" ? " · Sending" : state === "failed" ? " · Not sent" : ""}
            </>
          )}
        </p>
      </div>
    </li>
  );
}

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { firm, officeUser } = await requireOfficeArea("enquiries");
  const { id } = await params;
  const e = await officeEnquiry({ firm, officeUserId: officeUser.id }, id);
  if (!e) notFound();
  const at = (d: Date) => timeOnDay(d, e.timeZone);
  const name = whoName(e.who);
  const t = e.timeline;
  // "Door supervisor at Acme Demo Arena, Sat 10 Oct"
  const shiftWords = (s: { role: string; site: string | null; startsAt: Date }) =>
    `${roleLabel(s.role)}${s.site ? ` at ${s.site}` : ""}, ${dayLabel(localDateOf(s.startsAt, e.timeZone))}`;
  const then = t.then.map((fact) =>
    thenStep(fact, at, {
      firstName: e.who.kind === "casual" ? e.who.firstName : null,
      shiftWords,
    }),
  );
  return (
    <main className={page.office}>
      <PageHeader
        eyebrow={
          <Link href="/office/enquiries" className={textLink}>
            Enquiries
          </Link>
        }
        title={
          e.who.kind === "casual"
            ? `Message from ${name}`
            : `Message from ${name.toLowerCase() === "withheld" ? "a withheld number" : "an unknown number"}`
        }
      />
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <StatusChip tone={OUTCOME_TONES[e.outcome]}>{OUTCOME_WORDS[e.outcome]}</StatusChip>
        {e.pay && <StatusChip tone="quiet">{PAY_LOCK}</StatusChip>}
        <span className={`${meta} ${nums}`}>Reference {e.ref}</span>
      </div>
      {e.who.kind === "casual" && (
        <p className="mt-2">
          <Link href={`/office/casuals/${e.who.workerId}`} className={textLink}>
            {e.who.name}&apos;s page
          </Link>
        </p>
      )}
      {e.voicemail && (
        <p className="mt-3 rounded-md border-l-4 border-attention bg-attention-soft px-3 py-2 text-attention-ink">
          {VOICEMAIL_WARNING}
        </p>
      )}

      <section aria-labelledby="conversation" className={sectionGap.office}>
        <h2 id="conversation" className={h2}>
          The conversation
        </h2>
        <ul role="list" className={`${card} ${headingGap} flex flex-col gap-3`}>
          {e.conversation.map((item) => (
            <Bubble key={item.id} item={item} timeZone={e.timeZone} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" className={sectionGap.office}>
        <h2 id="how" className={h2}>
          How it was answered
        </h2>
        <ol className={`${card} ${headingGap} flex list-decimal flex-col gap-2 pl-10`}>
          <li>
            <span className="font-semibold">Received:</span> {receivedStep(t.received, at)}
          </li>
          <li>
            <span className="font-semibold">Sorted:</span> {sortedStep(t.sorted)}
          </li>
          <li>
            <span className="font-semibold">Checks made by code:</span> {NO_CHECKS}
          </li>
          <li>
            <span className="font-semibold">Reply built:</span> {replyStep(t.reply)}
          </li>
          <li>
            <span className="font-semibold">Sent:</span> {sentStep(t.sent, at)}
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
              <ul role="list" className="mt-1 flex list-disc flex-col gap-1 pl-5">
                {then.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </li>
        </ol>
      </section>

      <section aria-labelledby="not-offered" className={sectionGap.office}>
        <h2 id="not-offered" className={h2}>
          Considered but not offered
        </h2>
        <p className={`${card} ${headingGap} text-ink-muted`}>{NO_CHECKS}</p>
      </section>

      {e.waiting && (
        <section aria-labelledby="answer" className={sectionGap.office}>
          <h2 id="answer" className={h2}>
            Answer it
          </h2>
          <div className={`${card} ${headingGap}`}>
            <EnquiryForms
              messageId={e.messageId}
              canReply={e.plan.ok}
              planLine={planLine(e.plan)}
            />
          </div>
        </section>
      )}

      <p className={sectionGap.office}>
        <Link href="/office/enquiries" className={btn.link}>
          Back to Enquiries
        </Link>
      </p>
    </main>
  );
}

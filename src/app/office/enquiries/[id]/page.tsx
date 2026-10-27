import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  h2,
  headingGap,
  meta,
  notice,
  nums,
  page,
  sectionGap,
  textLink,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { officeEnquiry, type ConversationItem, type SessionName } from "@/lib/office/enquiries";
import {
  CHANNEL_WORDS,
  builtWords,
  checkWords,
  NO_CHECKS,
  reasonWords,
  travelCheckWords,
  notCheckedWords,
  CANCEL_CHECKS,
  CANCEL_NOT_OFFERED,
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
import { dayLabel, shortDate } from "@/lib/rules/reasons";
import { localDateOf, wallTimeOf } from "@/lib/time/zoned";
import { EnquiryForms } from "./enquiry-forms";

export const metadata: Metadata = { title: "Enquiry" };

// One message on the shifts line (docs/office-v2.md 3.6; docs/screens.md
// `/office/enquiries/[id]`; 12D.1): the conversation as the casual saw it, then "How it was
// answered" step by step from logged facts, "Considered but not offered", and, while it needs a
// person, the reply box and "Close without a reply". Admins and resourcers.

// A voicemail's caller can be faked (a WhatsApp's number can't, easily): the office should know.
const VOICEMAIL_WARNING =
  "From a voicemail on the shifts line. A caller's number can be faked: check anything unusual with them.";

// One message as a chat bubble (Phase 23: flat): theirs on the left, white with its hairline;
// ours on the right in the done tint with its line.
function Bubble({ item, timeZone }: { item: ConversationItem; timeZone: string }) {
  const theirs = item.direction === "in";
  const state = item.officeReply?.state;
  return (
    <li className={`flex ${theirs ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-inner px-4 py-2 ${
          theirs ? "glass-tile" : "border border-done-line bg-done-soft"
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
              {state === "sending"
                ? " · Sending"
                : state === "failed"
                  ? " · Not sent"
                  : state === "unconfirmed"
                    ? " · Not confirmed"
                    : ""}
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
  const b = e.built;
  const cancel = b?.template === "cancel_booking" || b?.template === "cancel_none";
  const hhmm = (iso: string) => {
    const w = wallTimeOf(new Date(iso), e.timeZone);
    return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  };
  const times = (from: string, to: string) => `${hhmm(from)}–${hhmm(to)}`;
  const wordsCtx = {
    names: b?.names ?? {},
    // "9 Jun 2028" (the year left out when it's this year's)
    date: (iso: string) => shortDate(iso, Number(localDateOf(new Date(), e.timeZone).slice(0, 4))),
    times,
    role: (r: string) => roleLabel(r).toLowerCase(),
  };
  const reasonCtx = {
    names: b?.names ?? {},
    times,
    at: (iso: string) => timeOnDay(new Date(iso), e.timeZone),
  };
  // "Northern Lights Live, Acme Demo Arena, Sat 10 Oct 08:00–16:00"
  const placeWhen = (s: SessionName) =>
    [
      s.eventName,
      s.siteName,
      `${dayLabel(localDateOf(s.startsAt, e.timeZone))} ${times(s.startsAt.toISOString(), s.endsAt.toISOString())}`,
    ]
      .filter((x): x is string => !!x)
      .join(", ");
  const sessionWords = (s: SessionName | null) =>
    s ? `${roleLabel(s.role)} · ${placeWhen(s)}` : "A session since removed";
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
        back={{ href: "/office/enquiries", label: "Enquiries" }}
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
      {e.voicemail && <p className={`${notice} mt-3`}>{VOICEMAIL_WARNING}</p>}

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
        <ol className={`${card} ${headingGap} flex list-decimal flex-col gap-2 pl-12`}>
          <li>
            <span className="font-semibold">Received:</span> {receivedStep(t.received, at)}
          </li>
          <li>
            <span className="font-semibold">Sorted:</span> {sortedStep(t.sorted)}
          </li>
          <li>
            <span className="font-semibold">Checks made by code:</span>{" "}
            {!b ? (
              NO_CHECKS
            ) : cancel ? (
              CANCEL_CHECKS
            ) : b.offered.length === 0 ? (
              "No session passed them (see below)."
            ) : (
              <ul role="list" className="mt-1 flex flex-col gap-3">
                {b.offered.map((o) => (
                  <li key={o.shiftId}>
                    <p className="font-semibold">{sessionWords(o.session)}</p>
                    <ul role="list" className="mt-1 flex list-disc flex-col gap-1 pl-6">
                      {o.checks.map((c, i) => (
                        <li key={i}>{checkWords(c, wordsCtx)}</li>
                      ))}
                      <li>Showing to casuals ✓</li>
                      <li>{travelCheckWords(b.area, o, b.travelOff)}</li>
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </li>
          <li>
            <span className="font-semibold">Reply built:</span>{" "}
            {b ? (
              <>
                {builtWords(b.template, b.offered.length, b.more)}
                {b.named.length > 0 && (
                  <ul role="list" className="mt-1 flex list-disc flex-col gap-1 pl-6">
                    {b.named.map((n, i) => (
                      <li key={i}>
                        {n ? (
                          <Link href={`/office/shifts/${n.shiftId}`} className={textLink}>
                            {sessionWords(n)}
                          </Link>
                        ) : (
                          sessionWords(null)
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {b.offered.length > 0 && (
                  <ul role="list" className="mt-1 flex list-disc flex-col gap-1 pl-6">
                    {b.offered.map((o) => (
                      <li key={o.shiftId}>
                        <Link href={`/office/shifts/${o.shiftId}`} className={textLink}>
                          {sessionWords(o.session)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              replyStep(t.reply)
            )}
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
              <ul role="list" className="mt-1 flex list-disc flex-col gap-1 pl-6">
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
        {!b ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>{NO_CHECKS}</p>
        ) : cancel ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>{CANCEL_NOT_OFFERED}</p>
        ) : b.notOffered.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>
            {b.notChecked > 0 ? notCheckedWords(b.notChecked) : "Nothing left out."}
          </p>
        ) : (
          <ul role="list" className={`${card} ${headingGap} flex list-disc flex-col gap-1 pl-8`}>
            {b.notOffered.map((n) => (
              <li key={n.shiftId}>
                {n.session ? roleLabel(n.session.role) : "A session"}:{" "}
                {n.reasons.map((r) => reasonWords(r, reasonCtx)).join("; ")}
                {n.session && <span className={meta}> · {placeWhen(n.session)}</span>}
              </li>
            ))}
            {b.notOfferedMore > 0 && (
              <li className={meta}>And {b.notOfferedMore} more not listed.</li>
            )}
            {b.notChecked > 0 && <li className={meta}>{notCheckedWords(b.notChecked)}</li>}
          </ul>
        )}
      </section>

      <EnquiryForms
        waiting={e.waiting}
        messageId={e.messageId}
        canReply={e.plan.ok}
        planLine={planLine(e.plan)}
      />

      <p className={sectionGap.office}>
        <Link href="/office/enquiries" className={btn.link}>
          Back to Enquiries
        </Link>
      </p>
    </main>
  );
}

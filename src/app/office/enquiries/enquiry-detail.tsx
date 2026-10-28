import Link from "next/link";
import { btn, h2, meta, notice, nums, textLink } from "@/app/ui/classes";
import { StatusChip } from "@/app/ui/status-chip";
import type { ConversationItem, EnquiryDetail, SessionName } from "@/lib/office/enquiries";
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
import { EnquiryForms } from "./[id]/enquiry-forms";

// One message on the shifts line (docs/office-v2.md 3.6; docs/screens.md `/office/enquiries/[id]`;
// 12D.1), as its own page shows it and as Enquiries shows the chosen one beside the list from
// 1024px (Phase 24, 24.4: round 7 of the canvas): who it's from, its outcome and reference, their
// page; then the conversation as the casual saw it, "How it was answered" step by step from logged
// facts, "Considered but not offered", and, while it needs a person, the reply box with "Send
// reply" and "Close, no reply needed". The page's headings are one level under its title: h2 on
// the message's page (its title the h1), h3 beside the list (its title an h2 under "Enquiries").

// A voicemail's caller can be faked (a WhatsApp's number can't, easily): the office should know.
const VOICEMAIL_WARNING =
  "From a voicemail on the shifts line. A caller's number can be faked: check anything unusual with them.";

// "Message from Kieran Doyle", or from "an unknown number" / "a withheld number".
export function enquiryTitle(e: EnquiryDetail): string {
  const name = whoName(e.who);
  return e.who.kind === "casual"
    ? `Message from ${name}`
    : `Message from ${name.toLowerCase() === "withheld" ? "a withheld number" : "an unknown number"}`;
}

// Its outcome, "Pay: never answered by AI" on a pay message, and its reference.
export function EnquiryFacts({ e }: { e: EnquiryDetail }) {
  return (
    <p className="flex flex-wrap items-center gap-2">
      <StatusChip tone={OUTCOME_TONES[e.outcome]}>{OUTCOME_WORDS[e.outcome]}</StatusChip>
      {e.pay && <StatusChip tone="quiet">{PAY_LOCK}</StatusChip>}
      <span className={`${meta} ${nums}`}>Reference {e.ref}</span>
    </p>
  );
}

// "Kieran Doyle's page" (a casual's message only).
export function CasualPageLink({ e }: { e: EnquiryDetail }) {
  return e.who.kind === "casual" ? (
    <Link href={`/office/casuals/${e.who.workerId}`} className={btn.secondary}>
      {e.who.name}&apos;s page
    </Link>
  ) : null;
}

// One message as a chat bubble (round 7): theirs on the left in clear glass; ours on the right in
// ink, its words in the ink's own colour (so in dark, a light bubble with dark words).
function Bubble({ item, timeZone }: { item: ConversationItem; timeZone: string }) {
  const theirs = item.direction === "in";
  const state = item.officeReply?.state;
  return (
    <li className={`flex ${theirs ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-inner px-4 py-3 ${
          theirs ? "glass-button text-ink" : "bg-ink text-on-ink"
        }`}
      >
        <p className="sr-only">{theirs ? "They wrote:" : "Reply:"}</p>
        <p className="break-words whitespace-pre-wrap">
          {item.text ??
            (item.channel === "voice"
              ? "(A voicemail we couldn't turn into text.)"
              : "(A photo or file, with no text.)")}
        </p>
        <p className={`mt-1 text-sm tabular-nums ${theirs ? "text-ink-muted" : "opacity-80"}`}>
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

export function EnquiryBody({
  e,
  level,
  stayOn,
}: {
  e: EnquiryDetail;
  level: 2 | 3;
  stayOn?: string; // beside Enquiries' list: the list with this message chosen (EnquiryForms)
}) {
  const H = level === 2 ? "h2" : "h3";
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
    <div className="flex flex-col gap-8">
      {e.voicemail && <p className={notice}>{VOICEMAIL_WARNING}</p>}

      <section aria-labelledby="conversation" className="flex flex-col gap-3">
        <H id="conversation" className={h2}>
          The conversation
        </H>
        <ul role="list" className="glass-tile flex flex-col gap-3 rounded-inner p-4">
          {e.conversation.map((item) => (
            <Bubble key={item.id} item={item} timeZone={e.timeZone} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-3">
        <H id="how" className={h2}>
          How it was answered
        </H>
        <ol className="flex list-decimal flex-col gap-2 pl-6 marker:text-ink-muted">
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

      <section aria-labelledby="not-offered" className="flex flex-col gap-3">
        <H id="not-offered" className={h2}>
          Considered but not offered
        </H>
        {!b ? (
          <p className="text-ink-muted">{NO_CHECKS}</p>
        ) : cancel ? (
          <p className="text-ink-muted">{CANCEL_NOT_OFFERED}</p>
        ) : b.notOffered.length === 0 ? (
          <p className="text-ink-muted">
            {b.notChecked > 0 ? notCheckedWords(b.notChecked) : "Nothing left out."}
          </p>
        ) : (
          <ul role="list" className="flex list-disc flex-col gap-1 pl-6">
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
        key={e.messageId}
        waiting={e.waiting}
        messageId={e.messageId}
        canReply={e.plan.ok}
        planLine={planLine(e.plan)}
        level={level}
        stayOn={stayOn}
      />
    </div>
  );
}

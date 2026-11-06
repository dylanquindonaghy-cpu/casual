import Link from "next/link";
import {
  btn,
  card,
  count,
  h2,
  headingGap,
  meta,
  muted,
  notice,
  row,
  rows,
  sectionGap,
  textLink,
} from "@/app/ui/classes";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import type { QueueRequest, RequestQueue } from "@/lib/office/request-queue";
import {
  answeredBy,
  approveHint,
  askedLines,
  kindName,
  markAgainHref,
  markedNowText,
  outcomeWord,
  toldText,
} from "@/lib/office/requests-copy";
import { shiftWhen, roleLabel, timeOnDay } from "@/lib/portal/format";
import { AnswerForm } from "../requests/answer-form";
import { Ref } from "@/app/ui/ref";

// askedLines() ends with the voicemail warning when the request came from a voicemail: it stands
// out, as something to check before answering (its words say why): the office's notice.
const voicemailWarning = `${notice} mt-1`;

function ShiftLine({
  r,
  timeZone,
  className,
}: {
  r: QueueRequest;
  timeZone: string;
  className?: string;
}) {
  if (!r.shift) return null;
  return (
    <p className={className}>
      <Link href={`/office/shifts/${r.shift.shiftId}`} className={textLink}>
        {roleLabel(r.shift.role)}
        {r.shift.site ? ` at ${r.shift.site}` : ""}
      </Link>
      , {shiftWhen(r.shift.startsAt, r.shift.endsAt, timeZone)}
    </p>
  );
}

// A section's heading with its count beside it (outside the <h3>, so the section's name stays the
// heading's words). An <h3>: the view's own heading is the page's <h2>.
function SectionHeading({ id, title, n }: { id: string; title: string; n: number }) {
  return (
    <div className="flex items-center">
      <h3 id={id} className={h2}>
        {title}
      </h3>
      {n > 0 && <span className={count}>{n}</span>}
    </div>
  );
}

// The answer's word as a status chip, the rest of the sentence after it: "[Declined] by Sam Rota",
// "[Taken back] by Ann" (Phase 28.9). The words are answeredBy()'s, which start with outcomeWord();
// only that word is coloured. Any "Answered" is done (green), whatever's stored.
const OUTCOME_TONES: Record<string, StatusTone> = {
  approved: "done",
  auto_resolved: "done",
  declined: "quiet",
  withdrawn: "quiet",
};

function Outcome({ r }: { r: QueueRequest }) {
  const said = answeredBy(r);
  const word = outcomeWord(r);
  const tone = word === "Answered" ? "done" : OUTCOME_TONES[r.status];
  if (!tone || !said.startsWith(word)) return <>{said}</>;
  return (
    <>
      <StatusChip tone={tone}>{word}</StatusChip>
      {said.slice(word.length)}
    </>
  );
}

// Enquiries' "Requests from the app" (docs/screens.md `/office/enquiries`; the old Requests page,
// 12D.1): what casuals asked in the app, waiting ones to approve or decline with a note (the casual
// is told), and those answered in the last 7 days. Waiting ones are cards: what was asked on the
// left, the answer on the right (below on a phone). Answered ones are compact rows with the
// answer's word in a chip. Each waiting one has its own anchor (`#request-{id}`): the dashboard's
// Coming up opens a casual's time change or swap there (Phase 27.9).
export function RequestQueueView({ queue }: { queue: RequestQueue }) {
  const tz = queue.timeZone;
  return (
    <>
      <section aria-labelledby="waiting">
        <SectionHeading id="waiting" title="Waiting for an answer" n={queue.waiting.length} />
        {queue.waiting.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>No requests waiting.</p>
        ) : (
          <ul role="list" className={`${headingGap} flex flex-col gap-4`}>
            {queue.waiting.map((r) => (
              <li
                key={r.requestId}
                id={`request-${r.requestId}`}
                className={`${card} lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  {/* The kind in a chip, then the name: the words read "Swap: Sam Jones". */}
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-semibold">
                    <StatusChip tone="quiet">{kindName(r.type)}</StatusChip>
                    <span className="sr-only">: </span>
                    <span>{r.worker.name}</span>
                  </p>
                  <ShiftLine r={r} timeZone={tz} />
                  {askedLines(r).map((line, i, all) => (
                    <p
                      key={i}
                      className={
                        r.asked.voicemail && i === all.length - 1 ? voicemailWarning : undefined
                      }
                    >
                      {line}
                    </p>
                  ))}
                  {markedNowText(r) && <p className={meta}>{markedNowText(r)}</p>}
                  <p className={`${meta} mt-1 tabular-nums`}>
                    Sent {timeOnDay(r.createdAt, tz)} · Reference <Ref>{r.ref}</Ref>
                    {r.status === "escalated" && (
                      <>
                        {" · "}
                        <StatusChip tone="attention">Escalated</StatusChip>
                      </>
                    )}
                  </p>
                </div>
                <div className="mt-4 flex min-w-0 flex-col gap-3 border-t border-line pt-4 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                  {approveHint(r.type, r.asked.cancellation) && (
                    <p className={muted}>{approveHint(r.type, r.asked.cancellation)}</p>
                  )}
                  {/* An attendance question (Phase 28.9): the session's who-worked, to mark it
                      again there (logged as marking always is); answering never changes it. */}
                  {markAgainHref(r) && (
                    <Link href={markAgainHref(r) ?? ""} className={`${btn.secondary} self-start`}>
                      Mark again
                    </Link>
                  )}
                  <AnswerForm
                    requestId={r.requestId}
                    firstName={r.worker.firstName}
                    type={r.type}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {queue.waitingMore && <p className={`${meta} mt-3`}>Showing the oldest 100.</p>}
      </section>

      <section aria-labelledby="answered" className={sectionGap.office}>
        <SectionHeading
          id="answered"
          title="Answered in the last 7 days"
          n={queue.answered.length}
        />
        {queue.answered.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>
            Nothing answered in the last 7 days.
          </p>
        ) : (
          <ul role="list" className={`${rows} ${headingGap}`}>
            {queue.answered.map((r) => (
              <li
                key={r.requestId}
                className={`${row} grid gap-x-8 gap-y-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`}
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {kindName(r.type)}: {r.worker.name}
                  </p>
                  <ShiftLine r={r} timeZone={tz} className={meta} />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <p>
                    <Outcome r={r} />
                    {r.answer?.at ? ` at ${timeOnDay(r.answer.at, tz)}` : ""}. Reference{" "}
                    <Ref>{r.ref}</Ref>.
                  </p>
                  {r.answer?.note && <p>Note: {r.answer.note}</p>}
                  {markedNowText(r) && <p className={meta}>{markedNowText(r)}</p>}
                  {toldText(r) && (
                    <p
                      className={
                        r.answer?.told === "failed" ? "font-semibold text-urgent-ink" : meta
                      }
                    >
                      {toldText(r)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

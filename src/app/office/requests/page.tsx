import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  count,
  h2,
  headingGap,
  meta,
  muted,
  page,
  row,
  rows,
  sectionGap,
  textLink,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeRequestQueue, type QueueRequest } from "@/lib/office/request-queue";
import {
  answeredBy,
  approveHint,
  askedLines,
  kindName,
  toldText,
} from "@/lib/office/requests-copy";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { AnswerForm } from "./answer-form";

// askedLines() ends with the voicemail warning when the request came from a voicemail: it stands
// out, as something to check before answering (its words say why).
const voicemailWarning =
  "mt-1 rounded-md border-l-4 border-attention bg-attention-soft px-3 py-2 text-attention-ink";

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

// A section's heading with its count beside it (outside the <h2>, so the section's name stays the
// heading's words).
function SectionHeading({ id, title, n }: { id: string; title: string; n: number }) {
  return (
    <div className="flex items-center">
      <h2 id={id} className={h2}>
        {title}
      </h2>
      {n > 0 && <span className={count}>{n}</span>}
    </div>
  );
}

// The answer's first word as a status chip, the rest of the sentence after it: "[Declined] by Sam
// Rota". The words are answeredBy()'s; only the first one is coloured.
const OUTCOME_TONES: Record<string, StatusTone> = {
  approved: "done",
  auto_resolved: "done",
  declined: "quiet",
};

function Outcome({ r }: { r: QueueRequest }) {
  const said = answeredBy(r);
  const tone = OUTCOME_TONES[r.status];
  if (!tone) return <>{said}</>;
  const space = said.indexOf(" ");
  const word = space < 0 ? said : said.slice(0, space);
  return (
    <>
      <StatusChip tone={tone}>{word}</StatusChip>
      {said.slice(word.length)}
    </>
  );
}

export const metadata: Metadata = { title: "Requests" };

// Workers' requests for the office (docs/screens.md `/office/requests`): waiting ones to approve
// or decline with a note (the worker is told), and those answered in the last 7 days. Waiting ones
// are cards: what was asked on the left, the answer on the right (below on a phone). Answered ones
// are compact rows with the answer's word in a chip.
export default async function OfficeRequestsPage() {
  const { firm } = await requireOfficeArea("requests");
  const queue = await officeRequestQueue({ firm }, (await readSessionToken("office")) ?? "");
  if (!queue) notFound();
  const tz = queue.timeZone;
  return (
    <main className={page.office}>
      <PageHeader eyebrow={<>{firm.name} office</>} title="Requests" />

      <section aria-labelledby="waiting">
        <SectionHeading id="waiting" title="Waiting for an answer" n={queue.waiting.length} />
        {queue.waiting.length === 0 ? (
          <p className={`${card} ${headingGap} text-ink-muted`}>No requests waiting.</p>
        ) : (
          <ul role="list" className={`${headingGap} flex flex-col gap-4`}>
            {queue.waiting.map((r) => (
              <li
                key={r.requestId}
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
                  <p className={`${meta} mt-1 tabular-nums`}>
                    Sent {timeOnDay(r.createdAt, tz)} · Reference {r.ref}
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
                  <AnswerForm requestId={r.requestId} firstName={r.worker.firstName} />
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
                    {r.answer?.at ? ` at ${timeOnDay(r.answer.at, tz)}` : ""}. Reference {r.ref}.
                  </p>
                  {r.answer?.note && <p>Note: {r.answer.note}</p>}
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

      <p className={sectionGap.office}>
        <Link href="/office" className={btn.link}>
          Back to Today
        </Link>
      </p>
    </main>
  );
}

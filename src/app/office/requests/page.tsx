import Link from "next/link";
import { notFound } from "next/navigation";
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

const section = "mt-8";
const heading = "text-2xl font-bold";
const card = "mt-3 rounded-xl border border-slate-300 p-4";

function ShiftLine({ r, timeZone }: { r: QueueRequest; timeZone: string }) {
  if (!r.shift) return null;
  return (
    <p>
      <Link href={`/office/shifts/${r.shift.shiftId}`} className="underline">
        {roleLabel(r.shift.role)}
        {r.shift.site ? ` at ${r.shift.site}` : ""}
      </Link>
      , {shiftWhen(r.shift.startsAt, r.shift.endsAt, timeZone)}
    </p>
  );
}

// Workers' requests for the office (docs/screens.md `/office/requests`): waiting ones to approve
// or decline with a note (the worker is told), and those answered in the last 7 days.
export default async function OfficeRequestsPage() {
  const { firm } = await requireOfficeArea("requests");
  const queue = await officeRequestQueue({ firm }, (await readSessionToken("office")) ?? "");
  if (!queue) notFound();
  const tz = queue.timeZone;
  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Requests</h1>

      <section className={section} aria-labelledby="waiting">
        <h2 id="waiting" className={heading}>
          Waiting for an answer
        </h2>
        {queue.waiting.length === 0 ? (
          <p className="mt-2">No requests waiting.</p>
        ) : (
          <ul>
            {queue.waiting.map((r) => (
              <li key={r.requestId} className={card}>
                <p className="text-lg font-semibold">
                  {kindName(r.type)}: {r.worker.name}
                </p>
                <ShiftLine r={r} timeZone={tz} />
                {askedLines(r).map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
                <p className="text-base text-slate-600">
                  Sent {timeOnDay(r.createdAt, tz)} · Reference {r.ref}
                  {r.status === "escalated" ? " · Escalated" : ""}
                </p>
                {approveHint(r.type) && <p className="mt-2">{approveHint(r.type)}</p>}
                <AnswerForm requestId={r.requestId} firstName={r.worker.firstName} />
              </li>
            ))}
          </ul>
        )}
        {queue.waitingMore && <p className="mt-2">Showing the oldest 100.</p>}
      </section>

      <section className={section} aria-labelledby="answered">
        <h2 id="answered" className={heading}>
          Answered in the last 7 days
        </h2>
        {queue.answered.length === 0 ? (
          <p className="mt-2">Nothing answered in the last 7 days.</p>
        ) : (
          <ul>
            {queue.answered.map((r) => (
              <li key={r.requestId} className={card}>
                <p className="font-semibold">
                  {kindName(r.type)}: {r.worker.name}
                </p>
                <ShiftLine r={r} timeZone={tz} />
                <p>
                  {answeredBy(r)}
                  {r.answer?.at ? ` at ${timeOnDay(r.answer.at, tz)}` : ""}. Reference {r.ref}.
                </p>
                {r.answer?.note && <p>Note: {r.answer.note}</p>}
                {toldText(r) && <p>{toldText(r)}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/office" className="mt-8 inline-block underline">
        Back to Today
      </Link>
    </main>
  );
}

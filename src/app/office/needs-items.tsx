import Link from "next/link";
import type { ReactNode } from "react";
import type { NeedsAttention } from "@/lib/office/dashboard";
import { evidenceItems, needsCount } from "@/lib/office/dashboard";
import {
  expiredText,
  NEEDS_HEADINGS,
  plannerRefusedText,
  SECTIONS,
  uploadsText,
  webhookFailingText,
  type NeedsKey,
} from "@/lib/office/dashboard-copy";
import { sheetChangeText, sheetNameText, toCheckText, toMarkText } from "@/lib/office/today-copy";
import { roleLabel, shiftWhen, timeOnDay } from "@/lib/portal/format";
import { card, headingGap, meta, nums, row, rows, textLink } from "../ui/classes";
import { StatusChip } from "../ui/status-chip";
import { BookingToCheckActions } from "./keep-booking";

// Needs attention's items, in parts (docs/office-v2.md 3.2; Phase 18: on their own page,
// `/office/needs-attention`, which the bell opens; the dashboard's "After that" counts them). Each
// part is a region the browser tests find it by, with its heading and count, then its items and
// what to do about each. Pure: the page loads the data.

function Empty({ children }: { children: ReactNode }) {
  return <p className={`${card} ${headingGap} text-ink-muted`}>{children}</p>;
}

// One part of Needs attention: its heading (a region the browser tests find it by) and items.
export function Need({
  id,
  n,
  more,
  children,
}: {
  id: NeedsKey;
  n: number;
  more?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-6">
      <h3 id={id} className="flex items-center gap-2 text-lg font-bold">
        {NEEDS_HEADINGS[id]}
        <span className={`rounded-full bg-attention-soft px-2 text-sm text-attention-ink ${nums}`}>
          {more ? `${n}+` : n}
        </span>
      </h3>
      {children}
      {more && <p className={`${meta} mt-2`}>Showing the first 50.</p>}
    </section>
  );
}

// "Steward at Acme Demo Arena": a shift's title, a link to its page.
function ShiftTitle({ shift }: { shift: { shiftId: string; role: string; site: string | null } }) {
  return (
    <Link href={`/office/shifts/${shift.shiftId}`} className={textLink}>
      {roleLabel(shift.role)}
      {shift.site ? ` at ${shift.site}` : ""}
    </Link>
  );
}

export function evidenceAddressText(waiting: number): string {
  const base =
    "The strikes team's email isn't set and confirmed, so strike records can't be emailed to them.";
  if (waiting === 0) return base;
  return `${base} ${waiting} ${waiting === 1 ? "record waits" : "records wait"} for it.`;
}

export function NeedsItems({
  n,
  timeZone: tz,
  today,
  isAdmin,
}: {
  n: NeedsAttention;
  timeZone: string;
  today: string;
  isAdmin: boolean;
}) {
  if (needsCount(n).count === 0) return <Empty>{SECTIONS.needs.empty}</Empty>;
  const evidence = evidenceItems(n.evidence);
  return (
    <>
      {n.toCheck.length > 0 && (
        <Need id="to-check" n={n.toCheck.length} more={n.toCheckMore}>
          <p className={`${headingGap} max-w-prose text-ink-muted`}>
            These people are booked, but can&apos;t work these shifts as things stand. Cancel the
            booking (they&apos;re told), or keep it.
          </p>
          <ul role="list" className={`${headingGap} flex flex-col gap-3`}>
            {n.toCheck.map((b) => (
              <li key={`${b.shiftId}-${b.workerId}`} className={card}>
                <p className="font-semibold">{toCheckText(b)}</p>
                <p className="mt-1">
                  <ShiftTitle shift={b} />
                  <span className={nums}>, {shiftWhen(b.startsAt, b.endsAt, tz)}</span>
                </p>
                <p className="mt-1">
                  <Link href={`/office/casuals/${b.workerId}`} className={textLink}>
                    {b.worker}&apos;s page
                  </Link>
                </p>
                <BookingToCheckActions shiftId={b.shiftId} workerId={b.workerId} name={b.worker} />
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.fromSheet.length > 0 && (
        <Need id="from-sheet" n={n.fromSheet.length} more={n.fromSheetMore}>
          <p className={`${headingGap} max-w-prose text-ink-muted`}>
            Your rota sheet asks for these, but the app couldn&apos;t do them.
          </p>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {n.fromSheet.map((i) => (
              <li key={i.shiftId} className={row}>
                <p className="font-semibold">
                  <ShiftTitle shift={i} />
                </p>
                <p className={`${meta} ${nums}`}>{shiftWhen(i.startsAt, i.endsAt, tz)}</p>
                <div className="mt-2 flex max-w-prose flex-col gap-2">
                  {i.change && <p>{sheetChangeText(i.change)}</p>}
                  {i.names.map((x, k) => (
                    <p key={`${x.name}-${k}`}>{sheetNameText(x)}</p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.toMark.length > 0 && (
        <Need id="to-mark" n={n.toMark.length} more={n.toMarkMore}>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {n.toMark.map((t) => (
              <li key={t.shiftId} className={`${row} flex flex-wrap items-center gap-x-4 gap-y-1`}>
                <p className="font-semibold">
                  <ShiftTitle shift={t} />
                </p>
                <p className={`${meta} ${nums}`}>{shiftWhen(t.startsAt, t.endsAt, tz)}</p>
                <StatusChip tone="attention">{toMarkText(t.unmarked)}</StatusChip>
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.expired.length > 0 && (
        <Need id="expired" n={n.expired.length} more={n.expiredMore}>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {n.expired.map((e) => (
              <li key={`${e.assignmentId}-${e.type}`} className={`${row} flex flex-col gap-1`}>
                <p className="max-w-prose">{expiredText(e, today, tz)}</p>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link href={`/office/casuals/${e.workerId}`} className={textLink}>
                    {e.worker}&apos;s page
                  </Link>
                  <Link href={`/office/shifts/${e.shiftId}`} className={textLink}>
                    The {roleLabel(e.role).toLowerCase()} shift
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.uploads > 0 && (
        <Need id="uploads" n={n.uploads}>
          <p className={`${headingGap} flex flex-wrap items-center gap-x-4 gap-y-1`}>
            <span>{uploadsText(n.uploads)}</span>
            <Link href="/office/casuals?view=uploads" className={textLink}>
              Check uploads
            </Link>
          </p>
        </Need>
      )}

      {evidence > 0 && (
        <Need id="evidence" n={evidence} more={n.evidence.failedMore}>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {!n.evidence.addressConfirmed && (
              <li className={`${row} flex max-w-prose flex-col gap-2`}>
                <p>{evidenceAddressText(n.evidence.waiting)}</p>
                {isAdmin ? (
                  <Link href="/office/settings" className={`${textLink} self-start`}>
                    Set it in Settings
                  </Link>
                ) : (
                  <p className={meta}>An admin can set it in Settings.</p>
                )}
              </li>
            )}
            {n.evidence.failed.map((f) => (
              <li key={f.assignmentId} className={`${row} flex max-w-prose flex-col gap-2`}>
                <p>
                  {f.casual}&apos;s strike record{" "}
                  {f.stuck ? "hasn't been emailed to" : "couldn't be emailed to"} the strikes team
                  (cancelled <span className={nums}>{timeOnDay(f.cancelledAt, tz)}</span>).{" "}
                  {f.stuck
                    ? "It's held up."
                    : f.nothingSent
                      ? "Nothing was sent."
                      : "It may have arrived anyway."}
                </p>
                <Link
                  href={`/office/cancellations/${f.assignmentId}`}
                  className={`${textLink} self-start`}
                >
                  Open the record to resend it
                </Link>
              </li>
            ))}
          </ul>
        </Need>
      )}

      {n.webhookFailing && (
        <Need id="webhook" n={1} more={false}>
          <div className={`${headingGap} ${row} flex max-w-prose flex-col gap-2`}>
            <p className={nums}>{webhookFailingText(n.webhookFailing.since, tz)}</p>
            {isAdmin ? (
              <Link href="/office/settings/integrations" className={`${textLink} self-start`}>
                Open Integrations
              </Link>
            ) : (
              <p className={meta}>An admin can check it in Integrations.</p>
            )}
          </div>
        </Need>
      )}

      {n.plannerRefused.length > 0 && (
        <Need id="planner-refused" n={n.plannerRefused.length} more={n.plannerRefusedMore}>
          <ul role="list" className={`${headingGap} ${rows}`}>
            {n.plannerRefused.map((r) => (
              <li key={r.shiftId} className={`${row} flex max-w-prose flex-col gap-1`}>
                <p>{plannerRefusedText(r, tz)}</p>
                <p>
                  <ShiftTitle shift={r} />
                  <span className={nums}>, {shiftWhen(r.startsAt, r.endsAt, tz)}</span>
                </p>
                <p className={`${meta} ${nums}`}>Refused {timeOnDay(r.refusedAt, tz)}</p>
              </li>
            ))}
          </ul>
        </Need>
      )}
    </>
  );
}

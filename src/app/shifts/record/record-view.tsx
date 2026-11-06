import Link from "next/link";
import type { MyRecord, MyRecordRow } from "@/lib/portal/my-record";
import {
  NO_LONGER_LISTED,
  RECORD_EMPTY,
  RECORD_FOOT_LEAD,
  RECORD_FOOT_LINK,
  RECORD_INTRO,
  RECORD_REF_LEAD,
  RECORD_TITLE,
  recordAskedText,
  recordDayHeading,
  recordDays,
  recordMoreText,
  recordMoveLines,
  recordNoticeText,
  recordOwnReasonText,
  recordShiftName,
  recordShiftStart,
  recordTime,
  recordTitle,
  SITE_CHANGED_TOO,
  STRIKE_WORDS,
} from "@/lib/portal/record-copy";
import {
  btn,
  disc,
  emptyBox,
  headingGap,
  meta,
  muted,
  nums,
  staffH2,
  staffRow,
  staffRows,
  textLinkInGroup,
} from "../../ui/classes";
import { Icon, type IconName } from "../../ui/icons";
import { PageHeader } from "../../ui/page-header";
import { Ref } from "../../ui/ref";
import { StatusChip, type StatusTone } from "../../ui/status-chip";

// Your shift record (docs/screens.md "The casual app, Phase 28", 28.4): her own offers, bookings,
// office changes and cancellations for the last 90 days, newest first, one glass card of rows per
// day. Each row: a round disc (decoration: its title says what happened), the title and its time,
// the shift (a link only while she can open it), then its facts: the times before and after, the
// fixed reason, who asked, her reference and reason, the notice as logged, and the strike as it
// stands now. Read only, so server-rendered and hook-free (page.tsx reads the record); never kept
// for no signal (only Home and Booked are: public/sw.js).

const LEAD: Record<MyRecordRow["kind"] | "own_cancel", { tone: StatusTone; icon: IconName }> = {
  offered: { tone: "wait", icon: "send" },
  booked: { tone: "done", icon: "check" },
  moved: { tone: "attention", icon: "clock" },
  shortened: { tone: "attention", icon: "minus" },
  cancelled: { tone: "urgent", icon: "cancel" },
  own_cancel: { tone: "quiet", icon: "cancel" },
};

const STRIKE_TONE: Record<NonNullable<MyRecordRow["strike"]>, StatusTone> = {
  strike: "urgent",
  withdrawn: "done",
  none: "quiet",
};

export function RecordView({ record, now }: { record: MyRecord; now: Date }) {
  const tz = record.timeZone;
  const days = recordDays(record.rows, tz);
  return (
    <>
      <PageHeader title={RECORD_TITLE} updated={`Updated ${recordTime(now, tz)}`}>
        <p className={muted}>{RECORD_INTRO}</p>
      </PageHeader>
      {days.length === 0 ? (
        <p className={emptyBox}>{RECORD_EMPTY}</p>
      ) : (
        days.map((d, i) => (
          <section
            key={d.day}
            aria-labelledby={`record-${d.day}`}
            className={i === 0 ? undefined : "mt-6"}
          >
            <h2 id={`record-${d.day}`} className={staffH2}>
              {recordDayHeading(d.day, now, tz)}
            </h2>
            <ol role="list" className={`${staffRows} ${headingGap}`}>
              {d.rows.map((row, j) => (
                <RecordItem key={`${row.at.toISOString()}:${j}`} row={row} tz={tz} />
              ))}
            </ol>
          </section>
        ))
      )}
      {record.more && <p className={`mt-4 ${muted}`}>{recordMoreText(record.rows.length)}</p>}
      <p className={`mt-6 ${muted}`}>
        {RECORD_FOOT_LEAD}{" "}
        <Link href="/messages" className={`${btn.link} text-base font-semibold`}>
          {RECORD_FOOT_LINK}
        </Link>
        .
      </p>
    </>
  );
}

function RecordItem({ row, tz }: { row: MyRecordRow; tz: string }) {
  const lead = LEAD[row.kind === "cancelled" && row.by === "you" ? "own_cancel" : row.kind];
  const asked = recordAskedText(row.askedBy);
  return (
    <li className={`${staffRow} flex gap-3`} data-record-row={row.kind}>
      <span aria-hidden="true" className={`${disc.base} ${disc[lead.tone]} mt-0.5`}>
        <Icon name={lead.icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-semibold text-ink">{recordTitle(row)}</p>
          <time dateTime={row.at.toISOString()} className={`shrink-0 ${meta} ${nums}`}>
            {recordTime(row.at, tz)}
          </time>
        </div>
        <ShiftLine shift={row.shift} tz={tz} />
        <div className={`mt-1 flex flex-col gap-0.5 text-base text-ink ${nums}`}>
          {row.moved && recordMoveLines(row.moved, tz).map((line) => <p key={line}>{line}</p>)}
          {row.moved?.siteChanged && <p>{SITE_CHANGED_TOO}</p>}
          {row.ref && (
            <p>
              {RECORD_REF_LEAD} <Ref>{row.ref}</Ref>
            </p>
          )}
          {row.reason &&
            (row.by === "you" ? <p>{recordOwnReasonText(row.reason)}</p> : <p>{row.reason}</p>)}
          {asked && <p>{asked}</p>}
          <p className={row.noticeHours === null ? "text-ink-muted" : undefined}>
            {recordNoticeText(row)}
          </p>
        </div>
        {row.strike && (
          <p className="mt-2">
            <StatusChip tone={STRIKE_TONE[row.strike]}>{STRIKE_WORDS[row.strike]}</StatusChip>
          </p>
        )}
      </div>
    </li>
  );
}

// The shift: its role and site, its start under it. A link (44px tall) only while she can open it.
function ShiftLine({ shift, tz }: { shift: MyRecordRow["shift"]; tz: string }) {
  if (!shift) return <p className={muted}>{NO_LONGER_LISTED}</p>;
  const box = "flex min-h-11 flex-col justify-center text-base text-ink";
  const start = <span className={`block ${meta} ${nums}`}>{recordShiftStart(shift, tz)}</span>;
  return shift.canOpen ? (
    <Link href={`/shifts/${shift.id}`} className={`group ${box}`}>
      <span className={`block ${textLinkInGroup}`}>{recordShiftName(shift)}</span>
      {start}
    </Link>
  ) : (
    <div className={box}>
      <span className="block">{recordShiftName(shift)}</span>
      {start}
    </div>
  );
}

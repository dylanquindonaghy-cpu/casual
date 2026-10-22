import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  btn,
  card,
  field,
  h2,
  headingGap,
  labelStack,
  meta,
  page,
  rows,
  sectionGap,
  textLinkInGroup,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip } from "@/app/ui/status-chip";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeShiftList, SHIFT_LIST_DAYS } from "@/lib/office/shift-pages";
import { SHIFT_STATUS_WORDS } from "@/lib/office/shifts-copy";
import { roleLabel } from "@/lib/portal/format";
import { dayLabel } from "@/lib/rules/reasons";
import { parseSheetDate } from "@/lib/roster/sheets/parse";
import { systemClock } from "@/lib/auth/clock";
import { addDays, localDateOf, wallTimeOf, zonedToUtc } from "@/lib/time/zoned";
import { SHIFT_TONE } from "./shift-tones";

export const metadata: Metadata = { title: "Shifts" };

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

// A small arrow beside "Earlier" and "Later" (decorative: the word says it).
function Arrow({ back }: { back?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={back ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6"} />
    </svg>
  );
}

// The office's shifts (docs/screens.md `/office/shifts`): 4 weeks from a chosen day. Each day is
// one card of compact rows: the time and "{Role} at {site}" (the link), then how many are booked
// and the status words as coloured chips, lined up on the right on a desktop so open and urgent
// shifts stand out in a long day.
export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { firm } = await requireOfficeArea("shifts");
  const { from: fromParam } = await searchParams;
  const tz = firm.timezone;
  const today = localDateOf(systemClock.now(), tz);
  const fromDate =
    typeof fromParam === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(fromParam) &&
    parseSheetDate(fromParam)
      ? fromParam
      : today;
  const [y = 2000, m = 1, d = 1] = fromDate.split("-").map(Number);
  const from = zonedToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, tz);
  const list = await officeShiftList({ firm }, (await readSessionToken("office")) ?? "", from);
  if (!list) notFound();
  const days = new Map<string, typeof list.shifts>();
  for (const s of list.shifts) {
    const key = localDateOf(s.startsAt, tz);
    days.set(key, [...(days.get(key) ?? []), s]);
  }
  return (
    <main className={page.office}>
      <PageHeader
        title="Shifts"
        actions={
          <>
            <Link href="/office/shifts/new" className={btn.primary}>
              New shift
            </Link>
            <Link href="/office/shifts/event" className={btn.secondary}>
              Shifts for an event
            </Link>
            <Link href="/office/shifts/import" className={btn.secondary}>
              Import from a file
            </Link>
          </>
        }
      />

      <div className={`${card} flex flex-wrap items-end justify-between gap-x-6 gap-y-3`}>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className={labelStack}>
            Show 4 weeks from
            <input type="date" name="from" defaultValue={fromDate} className={field} />
          </label>
          <button type="submit" className={btn.secondary}>
            Show
          </button>
        </form>
        <p className="flex items-center gap-3">
          <Link
            href={`/office/shifts?from=${addDays(fromDate, -SHIFT_LIST_DAYS)}`}
            className={btn.link}
          >
            <Arrow back />
            Earlier
          </Link>{" "}
          <span className="text-ink-muted">·</span>{" "}
          <Link
            href={`/office/shifts?from=${addDays(fromDate, SHIFT_LIST_DAYS)}`}
            className={btn.link}
          >
            Later
            <Arrow />
          </Link>
        </p>
      </div>

      {list.shifts.length === 0 ? (
        <p className={`${card} ${sectionGap.office} text-ink-muted`}>No shifts in these 4 weeks.</p>
      ) : (
        [...days.entries()].map(([day, dayShifts]) => (
          <section key={day} className={sectionGap.office} aria-label={dayLabel(day)}>
            <h2 className={h2}>{dayLabel(day)}</h2>
            <ul role="list" className={`${rows} ${headingGap}`}>
              {dayShifts.map((s) => (
                <li
                  key={s.shiftId}
                  className="flex flex-col gap-1 px-4 py-2 md:grid md:grid-cols-[minmax(0,1fr)_19rem] md:items-center md:gap-6"
                >
                  <Link
                    href={`/office/shifts/${s.shiftId}`}
                    className="press group flex min-h-11 min-w-0 items-center font-semibold text-ink"
                  >
                    <span>
                      <span className="tabular-nums">
                        {hhmm(s.startsAt, tz)} to {hhmm(s.endsAt, tz)}
                      </span>{" "}
                      ·{" "}
                      <span className={textLinkInGroup}>
                        {roleLabel(s.role)}
                        {s.site ? ` at ${s.site}` : ""}
                      </span>
                    </span>
                  </Link>
                  <p className="pb-1 text-sm leading-7 text-ink-muted md:pb-0">
                    <span className="tabular-nums">
                      {s.booked} of {s.headcount} booked
                    </span>{" "}
                    ·{" "}
                    <StatusChip tone={SHIFT_TONE[s.status]}>
                      {SHIFT_STATUS_WORDS[s.status]}
                    </StatusChip>
                    {s.isUrgent && (
                      <>
                        {" "}
                        · <StatusChip tone="urgent">Urgent</StatusChip>
                      </>
                    )}
                    {s.fromSheet && (
                      <>
                        {" "}
                        · <StatusChip tone="quiet">From your Google Sheet</StatusChip>
                      </>
                    )}
                    {s.fromPlanner && (
                      <>
                        {" "}
                        · <StatusChip tone="quiet">From your planner</StatusChip>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {list.more && <p className={`${meta} mt-4`}>Showing the first 200.</p>}
      <p className={sectionGap.office}>
        <Link href="/office" className={btn.link}>
          Back to the dashboard
        </Link>
      </p>
    </main>
  );
}

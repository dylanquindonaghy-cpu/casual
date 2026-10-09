import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btn, card, field, hint, label, page, row, rows } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import {
  dayWithYear,
  officeActionLog,
  parseLogQuery,
  type LogFilters,
} from "@/lib/office/action-log";
import { LOG_TYPE_KEYS, LOG_TYPES } from "@/lib/office/log-types";
import { timeOnDay } from "@/lib/portal/format";

const select = `${field} w-full`;

export const metadata: Metadata = { title: "Action log" };

// The link to the next page: the same filters, continuing after the last line shown.
function olderHref(filters: LogFilters, before: string): string {
  const q = new URLSearchParams();
  if (filters.worker) q.set("worker", filters.worker);
  if (filters.shift) q.set("shift", filters.shift);
  if (filters.type) q.set("type", filters.type);
  if (filters.from) q.set("from", filters.from);
  if (filters.to) q.set("to", filters.to);
  q.set("before", before);
  return `/office/log?${q.toString()}`;
}

// The office's action log (docs/screens.md `/office/log`): every event, newest first, filtered by
// worker, shift, type and dates. Admins and resourcers. The filters sit in one card (a row of five
// on a wide screen); the lines are compact rows, the time and type on the left, the words and the
// shift on the right (stacked on a phone).
//
// Each line's first <p> is "{time} · {type}", and its second <p> is the words, with one link (the
// shift) at most: tests/e2e/office.log.spec.ts reads them that way.
export default async function ActionLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { firm } = await requireOfficeArea("log");
  const query = parseLogQuery(await searchParams);
  const log = await officeActionLog({ firm }, (await readSessionToken("office")) ?? "", query);
  if (!log) notFound();
  const f = log.filters;
  return (
    <main className={page.office}>
      <PageHeader eyebrow={<>{firm.name} office</>} title="Action log">
        <p>Everything that happened, newest first.</p>
      </PageHeader>

      <div className={card}>
        <form method="get">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto_auto]">
            <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-3 xl:col-span-1">
              <label htmlFor="log-worker" className={label}>
                Worker
              </label>
              <select
                id="log-worker"
                name="worker"
                defaultValue={f.worker ?? ""}
                className={select}
              >
                <option value="">Everyone</option>
                {log.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-3 xl:col-span-1">
              <label htmlFor="log-shift" className={label}>
                Shift
              </label>
              <select id="log-shift" name="shift" defaultValue={f.shift ?? ""} className={select}>
                <option value="">All shifts</option>
                {log.shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex min-w-0 flex-col gap-1 xl:col-span-1">
              <label htmlFor="log-type" className={label}>
                Type
              </label>
              <select id="log-type" name="type" defaultValue={f.type ?? ""} className={select}>
                <option value="">All types</option>
                {LOG_TYPE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {LOG_TYPES[key].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1 md:col-span-2 xl:col-span-1">
              <label htmlFor="log-from" className={label}>
                From
              </label>
              <input
                id="log-from"
                type="date"
                name="from"
                defaultValue={f.from ?? ""}
                className={select}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1 md:col-span-2 xl:col-span-1">
              <label htmlFor="log-to" className={label}>
                To
              </label>
              <input
                id="log-to"
                type="date"
                name="to"
                defaultValue={f.to ?? ""}
                className={select}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <button type="submit" className={btn.primary}>
              Show
            </button>
            <Link href="/office/log" className={btn.link}>
              Clear
            </Link>
          </div>
        </form>
        <p className={`${hint} mt-3`}>
          A shift shows only the chosen dates here. For all of one shift, open it and choose
          &quot;See this shift in the action log&quot;.
        </p>
      </div>

      <p className="mt-8 font-semibold">
        {f.from && f.to
          ? `${dayWithYear(f.from, log.thisYear)} to ${dayWithYear(f.to, log.thisYear)}.`
          : "Everything logged for this shift."}
        {log.clamped ? " At most 92 days at a time." : ""}
      </p>

      {log.entries.length === 0 ? (
        <p className={`${card} mt-3 text-ink-muted`}>Nothing logged for these choices.</p>
      ) : (
        <ul role="list" className={`${rows} mt-3`}>
          {/* Keyed by position, not the event's number: event numbers are shared by every firm and
              a key reaches the page's source (audit L44). */}
          {log.entries.map((e, i) => (
            <li
              key={i}
              className={`${row} grid gap-x-6 gap-y-0.5 sm:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)]`}
            >
              <p
                className={`text-sm text-ink-muted tabular-nums sm:pt-0.5${e.shift ? " sm:row-span-2" : ""}`}
              >
                {timeOnDay(e.at, log.timeZone)} · <span className="font-semibold">{e.type}</span>
              </p>
              <p className="min-w-0 text-ink">{e.words}</p>
              {e.shift && (
                <p className="min-w-0 text-sm sm:col-start-2">
                  <Link
                    href={`/office/shifts/${e.shift.id}`}
                    className="inline-block py-0.5 underline underline-offset-4 hover:text-ink-muted"
                  >
                    {e.shift.label}
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {log.older !== null && (
        <Link href={olderHref(f, log.older)} className={`${btn.secondary} mt-4`}>
          Older
        </Link>
      )}
      <p className="mt-10">
        <Link href="/office" className={btn.link}>
          Back to Today
        </Link>
      </p>
    </main>
  );
}

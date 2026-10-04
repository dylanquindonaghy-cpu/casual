import Link from "next/link";
import { notFound } from "next/navigation";
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

const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";
const field = "rounded border border-slate-400 px-2 py-1";

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
// worker, shift, type and dates. Admins and resourcers.
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
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Action log</h1>
      <p className="mt-2">Everything that happened, newest first.</p>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor="log-worker" className="font-semibold">
            Worker
          </label>
          <select id="log-worker" name="worker" defaultValue={f.worker ?? ""} className={field}>
            <option value="">Everyone</option>
            {log.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="log-shift" className="font-semibold">
            Shift
          </label>
          <select id="log-shift" name="shift" defaultValue={f.shift ?? ""} className={field}>
            <option value="">All shifts</option>
            {log.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="log-type" className="font-semibold">
            Type
          </label>
          <select id="log-type" name="type" defaultValue={f.type ?? ""} className={field}>
            <option value="">All types</option>
            {LOG_TYPE_KEYS.map((key) => (
              <option key={key} value={key}>
                {LOG_TYPES[key].label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="log-from" className="font-semibold">
            From
          </label>
          <input
            id="log-from"
            type="date"
            name="from"
            defaultValue={f.from ?? ""}
            className={field}
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor="log-to" className="font-semibold">
            To
          </label>
          <input id="log-to" type="date" name="to" defaultValue={f.to ?? ""} className={field} />
        </div>
        <button type="submit" className={button}>
          Show
        </button>
        <Link href="/office/log" className="self-center underline">
          Clear
        </Link>
      </form>
      <p className="mt-2 text-base text-slate-600">
        A shift shows only the chosen dates here. For all of one shift, open it and choose &quot;See
        this shift in the action log&quot;.
      </p>

      <p className="mt-4">
        {f.from && f.to
          ? `${dayWithYear(f.from, log.thisYear)} to ${dayWithYear(f.to, log.thisYear)}.`
          : "Everything logged for this shift."}
        {log.clamped ? " At most 92 days at a time." : ""}
      </p>

      {log.entries.length === 0 ? (
        <p className="mt-4">Nothing logged for these choices.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {/* Keyed by position, not the event's number: event numbers are shared by every firm and
              a key reaches the page's source (audit L44). */}
          {log.entries.map((e, i) => (
            <li key={i} className="py-3">
              <p className="text-base text-slate-600">
                {timeOnDay(e.at, log.timeZone)} · {e.type}
              </p>
              <p>{e.words}</p>
              {e.shift && (
                <p className="text-base">
                  <Link href={`/office/shifts/${e.shift.id}`} className="underline">
                    {e.shift.label}
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {log.older !== null && (
        <Link href={olderHref(f, log.older)} className={`${button} mt-4 inline-block`}>
          Older
        </Link>
      )}
      <p className="mt-8">
        <Link href="/office" className="underline">
          Back to Today
        </Link>
      </p>
    </main>
  );
}

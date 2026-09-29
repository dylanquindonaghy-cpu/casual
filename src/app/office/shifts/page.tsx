import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficeArea } from "@/lib/auth/current-office";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { officeShiftList, SHIFT_LIST_DAYS } from "@/lib/office/shift-pages";
import { SHIFT_STATUS_WORDS } from "@/lib/office/shifts-copy";
import { roleLabel } from "@/lib/portal/format";
import { dayLabel } from "@/lib/rules/reasons";
import { parseSheetDate } from "@/lib/roster/sheets/parse";
import { systemClock } from "@/lib/auth/clock";
import { addDays, localDateOf, wallTimeOf, zonedToUtc } from "@/lib/time/zoned";

const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const w = wallTimeOf(d, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

// The office's shifts (docs/screens.md `/office/shifts`): 4 weeks from a chosen day.
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
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-base text-slate-600">{firm.name} office</p>
      <h1 className="text-3xl font-bold">Shifts</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/office/shifts/new" className={button}>
          New shift
        </Link>
        <Link href="/office/shifts/event" className={button}>
          Shifts for an event
        </Link>
        <Link href="/office/shifts/import" className={button}>
          Import from a file
        </Link>
      </div>
      <form className="mt-6 flex flex-wrap items-end gap-2" method="get">
        <label className="flex flex-col">
          <span className="font-semibold">Show 4 weeks from</span>
          <input
            type="date"
            name="from"
            defaultValue={fromDate}
            className="rounded border px-2 py-1"
          />
        </label>
        <button type="submit" className={button}>
          Show
        </button>
      </form>
      <p className="mt-2">
        <Link
          href={`/office/shifts?from=${addDays(fromDate, -SHIFT_LIST_DAYS)}`}
          className="underline"
        >
          Earlier
        </Link>{" "}
        ·{" "}
        <Link
          href={`/office/shifts?from=${addDays(fromDate, SHIFT_LIST_DAYS)}`}
          className="underline"
        >
          Later
        </Link>
      </p>
      {list.shifts.length === 0 ? (
        <p className="mt-6">No shifts in these 4 weeks.</p>
      ) : (
        [...days.entries()].map(([day, dayShifts]) => (
          <section key={day} className="mt-6" aria-label={dayLabel(day)}>
            <h2 className="text-xl font-bold">{dayLabel(day)}</h2>
            <ul>
              {dayShifts.map((s) => (
                <li key={s.shiftId} className="mt-2 rounded-xl border border-slate-300 p-3">
                  <Link href={`/office/shifts/${s.shiftId}`} className="font-semibold underline">
                    {hhmm(s.startsAt, tz)} to {hhmm(s.endsAt, tz)} · {roleLabel(s.role)}
                    {s.site ? ` at ${s.site}` : ""}
                  </Link>
                  <p>
                    {s.booked} of {s.headcount} booked · {SHIFT_STATUS_WORDS[s.status]}
                    {s.isUrgent ? " · Urgent" : ""}
                    {s.fromSheet ? " · From your Google Sheet" : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {list.more && <p className="mt-4">Showing the first 200.</p>}
      <Link href="/office" className="mt-8 inline-block underline">
        Back to Today
      </Link>
    </main>
  );
}

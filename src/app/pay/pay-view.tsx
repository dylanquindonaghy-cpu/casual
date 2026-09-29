import { hoursText, pounds, type PayLine } from "@/lib/portal/pay-format";
import { dayLabel } from "@/lib/rules/reasons";

// The pay page once the code has been checked (docs/screens.md, `/pay`): the last 8 weeks of pay
// lines as payroll sent them. Only what the payroll file had: a gross that wasn't in it isn't
// worked out here.
export function PayView({ lines, firmName }: { lines: PayLine[]; firmName: string }) {
  if (lines.length === 0) {
    return <p className="mt-6">No pay data yet for this period.</p>;
  }
  return (
    <>
      <p className="mt-4 text-base text-slate-600">
        The last 8 weeks, from {firmName}&apos;s payroll.
      </p>
      <ul className="mt-4 space-y-4">
        {lines.map((line) => (
          <li
            key={`${line.periodStart}:${line.periodEnd}:${line.ratePence}`}
            className="rounded-2xl border-2 border-slate-300 p-4"
          >
            <p className="font-semibold">
              {dayLabel(line.periodStart)} to {dayLabel(line.periodEnd)}
            </p>
            <p className="mt-1 text-xl">
              {hoursText(line.hours)} at {pounds(line.ratePence)} an hour
            </p>
            {line.grossPence !== null && (
              <p className="mt-1">Gross pay: {pounds(line.grossPence)}</p>
            )}
            {line.payDate && <p className="mt-1">Pay date: {dayLabel(line.payDate)}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-base">If something looks wrong, contact the office.</p>
    </>
  );
}

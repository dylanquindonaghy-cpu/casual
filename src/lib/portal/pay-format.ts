// The pay page's figures in words: browser-safe (no database imports), so any component may use
// them (tests/unit/client-boundary.test.ts).

export interface PayLine {
  periodStart: string; // yyyy-mm-dd
  periodEnd: string;
  hours: number;
  ratePence: number;
  grossPence: number | null;
  payDate: string | null;
}

// "£12.50", "£1,234.00".
export function pounds(pence: number): string {
  const whole = Math.floor(pence / 100).toLocaleString("en-GB");
  return `£${whole}.${String(pence % 100).padStart(2, "0")}`;
}

// "37.5 hours", "1 hour", "7.25 hours".
export function hoursText(hours: number): string {
  const n = Number(hours.toFixed(2));
  return `${n} ${n === 1 ? "hour" : "hours"}`;
}

// One pay period as payroll sent it (Phase 24, the mock-up's Pay: "each week"): its lines (a line per
// rate, lowest rate first), its total only when payroll gave a gross for every line (Dylan, 26 Oct
// 2026: "Total only if payroll gave all"; the sum of payroll's own grosses, never worked out from
// the hours and rates), and the days it's paid (each once, soonest first). Weeks keep the lines'
// order (newest first: src/lib/portal/pay.ts).
export interface PayWeek {
  periodStart: string;
  periodEnd: string;
  lines: PayLine[];
  totalPence: number | null;
  payDates: string[];
}

export function payWeeks(lines: PayLine[]): PayWeek[] {
  const weeks: PayWeek[] = [];
  for (const line of lines) {
    let week = weeks.find(
      (w) => w.periodStart === line.periodStart && w.periodEnd === line.periodEnd,
    );
    if (!week) {
      week = {
        periodStart: line.periodStart,
        periodEnd: line.periodEnd,
        lines: [],
        totalPence: null,
        payDates: [],
      };
      weeks.push(week);
    }
    week.lines.push(line);
  }
  for (const week of weeks) {
    week.lines.sort((a, b) => a.ratePence - b.ratePence);
    const grosses = week.lines.map((l) => l.grossPence);
    week.totalPence = grosses.every((g): g is number => g !== null)
      ? grosses.reduce((sum, g) => sum + g, 0)
      : null;
    week.payDates = [
      ...new Set(week.lines.map((l) => l.payDate).filter((d): d is string => d !== null)),
    ].sort();
  }
  return weeks;
}

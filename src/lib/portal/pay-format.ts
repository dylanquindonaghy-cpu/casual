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

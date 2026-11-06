import { z } from "zod";
import { MESSAGE_OFFICE } from "./pay-copy";

// The browser-safe half of pay queries (docs/screens.md `/pay`, `/pay/query`): the issues, the
// status words, the form's check and the outcome shape. No database code may be imported here: the
// form (a client component) uses it (tests/unit/client-boundary.test.ts).

export const PAY_ISSUES = ["missing_hours", "wrong_rate", "late_pay", "other"] as const;
export type PayIssue = (typeof PAY_ISSUES)[number];

export const ISSUE_LABELS: Record<PayIssue, string> = {
  missing_hours: "Hours missing",
  wrong_rate: "Wrong rate",
  late_pay: "Paid late or not paid",
  other: "Something else",
};

// To the worker, a query in the digest is still with payroll.
export const PAY_QUERY_STATUS_WORDS: Record<string, string> = {
  open: "With payroll",
  in_digest: "With payroll",
  resolved: "Answered by payroll",
};

export const MAX_PAY_QUERY_DETAILS = 1000;
export const PAY_QUERY_DAYS_BACK = 90; // a day typed in: at most this many days ago
// The shifts offered (and the only ones ?shift= can choose or the server takes): those that started
// in the last 90 days, the same window as Booked's Past (PAST_DAYS = RELIABILITY_DAYS, Phase 28.13),
// so "Ask about the pay for this shift" on any past row opens with that shift chosen.
export const PAY_QUERY_SHIFT_DAYS = PAY_QUERY_DAYS_BACK;
// Before 28.13's fix the list was 8 weeks; kept for anything still importing it. Not used.
export const PAY_QUERY_SHIFT_WEEKS = 8;
export const OTHER_DAY = "day"; // the "A day not in the list" choice

export type PayQueryProblem =
  | "no_shift_or_day" // neither chosen
  | "bad_day" // not a date
  | "future_day"
  | "too_old" // more than 90 days ago
  | "no_issue"
  | "no_details" // "Something else" needs a word or two
  | "too_long"; // details over 1,000 characters

export interface PayQueryInput {
  shiftId: string | null;
  day: string | null; // yyyy-mm-dd, when no shift was chosen
  issue: PayIssue;
  details: string | null;
}

const uuid = z.uuid();

// The form's fields as typed, checked for shape (the server checks the shift is theirs and the day
// is in range). Problems, or the input.
export function payQueryInput(fields: {
  shift?: string;
  day?: string;
  issue?: string;
  details?: string;
}): { ok: true; input: PayQueryInput } | { ok: false; problems: PayQueryProblem[] } {
  const problems: PayQueryProblem[] = [];
  const shift = (fields.shift ?? "").trim();
  const dayText = (fields.day ?? "").trim();
  let shiftId: string | null = null;
  let day: string | null = null;
  if (shift && shift !== OTHER_DAY) {
    if (uuid.safeParse(shift).success) shiftId = shift.toLowerCase();
    else problems.push("no_shift_or_day");
  } else if (shift === OTHER_DAY && dayText) {
    const valid =
      /^(20\d\d|2100)-\d{2}-\d{2}$/.test(dayText) &&
      new Date(`${dayText}T00:00:00Z`).toISOString().slice(0, 10) === dayText;
    if (valid) day = dayText;
    else problems.push("bad_day");
  } else {
    problems.push("no_shift_or_day");
  }
  const issue = (PAY_ISSUES as readonly string[]).includes(fields.issue ?? "")
    ? (fields.issue as PayIssue)
    : null;
  if (!issue) problems.push("no_issue");
  const details = (fields.details ?? "").trim();
  if (details.length > MAX_PAY_QUERY_DETAILS) problems.push("too_long");
  if (issue === "other" && !details) problems.push("no_details");
  if (problems.length > 0 || !issue) return { ok: false, problems };
  return { ok: true, input: { shiftId, day, issue, details: details || null } };
}

export const PROBLEM_WORDS: Record<PayQueryProblem, string> = {
  no_shift_or_day: "Choose a shift, or a day.",
  bad_day: "Enter the day, like 26/10/2026.",
  future_day: "That day hasn't happened yet.",
  too_old: "Pay queries can go back 90 days. For anything older, message the office.",
  no_issue: "Choose what's wrong.",
  no_details: "Tell payroll what's wrong.",
  too_long: "That's too long (1,000 characters at most).",
};

// The words of a problem that are a link (Phase 28.10): "message the office" in too_old goes to
// Messages, so an old question never ends at "contact the office" with nothing to tap.
export const PROBLEM_LINKS: Partial<Record<PayQueryProblem, { text: string; href: string }>> = {
  too_old: { text: "message the office", href: MESSAGE_OFFICE.href },
};

// ?shift= on /pay/query (Phase 28.10): a shift's id (a uuid, in lower case), or nothing. Anything
// else, a list of them included, is ignored.
export function shiftParam(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parsed = uuid.safeParse(raw.trim());
  return parsed.success ? parsed.data.toLowerCase() : null;
}

// Where the pay query's code step goes once the code is right: always the pay query itself, with
// ?shift= kept only when it's a shift's id. Nothing else in the address is read (a next= or any
// other return address is ignored), so the step can't send her anywhere else.
export const PAY_QUERY_PATH = "/pay/query";
export function payQueryPath(rawShift: unknown): string {
  const shift = shiftParam(rawShift);
  return shift ? `${PAY_QUERY_PATH}?shift=${shift}` : PAY_QUERY_PATH;
}

// Whether a path is one payQueryPath gives (the code card checks again before it goes there).
export const isPayQueryPath = (path: string): boolean =>
  /^\/pay\/query(\?shift=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(
    path,
  );

// The shift the form starts on: ?shift= when it is one of the shifts in her list (payQueryShifts:
// her own, inside her firm, from the last 90 days), else none, and "Choose a shift" shows.
export function preselectedShift(
  shifts: readonly { shiftId: string }[],
  rawShift: unknown,
): string | null {
  const shift = shiftParam(rawShift);
  return shift !== null && shifts.some((s) => s.shiftId === shift) ? shift : null;
}

export type RaisePayQueryOutcome =
  | {
      status: "created";
      ref: string; // the first 8 characters of its id, upper case
      issue: PayIssue;
      when: string; // the shift ("Sat 7 Nov, 08:00 to 16:00") or the day ("Mon 26 Oct")
      sentAt: string; // "09:14 on Mon 2 Nov"
      signOff: string;
    }
  | { status: "already_open"; ref: string } // the same question is already with payroll
  | { status: "invalid"; problems: PayQueryProblem[] }
  | { status: "not_yours" } // not a shift of theirs from the last 90 days
  | { status: "needs_code" } // the pay code's 30 minutes ran out
  | { status: "logged_out" }
  | { status: "error" };

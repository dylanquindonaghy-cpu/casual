import { z } from "zod";
import { ISSUE_LABELS, type PayIssue } from "../portal/pay-query-kinds";
import { pounds } from "../portal/pay-format";
import { dayLabel } from "../rules/reasons";
import { AI_TIMEOUT_MS, askAi } from "./ask";
import type { AiClient } from "./client";

// One line per pay query group, for payroll (docs/architecture.md "Haiku writes a one-line summary
// per group"). The model sees only the group's facts (how many, the issue, the week, the site, the
// rate): no names, no worker's own words. Its line is used only if it passes the check below (one
// line, 5 to 160 characters, no number that isn't in the facts, no advice, blame or verdict words,
// and nothing but the facts' own words and a few plain ones);
// otherwise, or when the AI isn't there, the line is written by code. Payroll always sees the
// code's line (the facts) as the heading, and an AI line only beneath it, labelled.

export interface PayGroupFacts {
  count: number;
  issue: PayIssue;
  week: string; // the pay period's first day (a Monday), yyyy-mm-dd
  // What the firm calls its pay period (P3.1; Phase 25.2): "the week of …" or "the cycle of …".
  label?: "week" | "cycle";
  site: string | null; // the site's name, for hours missing
  ratesPence: number[] | null; // the pay line's rate(s), for a wrong rate; [] if none imported
}

export interface PayGroupSummary {
  text: string;
  byAi: boolean;
}

// "12 queries: wrong rate, the week of Mon 7 Sep, paid at £12.50."
export function codeSummary(f: PayGroupFacts): string {
  return `${f.count} ${f.count === 1 ? "query" : "queries"}: ${factsPhrase(f)}.`;
}

// What a group's queries share, without the count: "wrong rate, the week of Mon 7 Sep, paid at
// £12.50" (the payroll digest's headline uses it too).
export function factsPhrase(f: PayGroupFacts): string {
  const parts = [
    ISSUE_LABELS[f.issue].toLowerCase(),
    `the ${f.label ?? "week"} of ${dayLabel(f.week)}`,
  ];
  if (f.issue === "missing_hours") parts.push(f.site ? `at ${f.site}` : "no site named");
  if (f.issue === "wrong_rate" && f.ratesPence) {
    parts.push(
      f.ratesPence.length > 0
        ? `paid at ${f.ratesPence.map(pounds).join(" and ")}`
        : "no pay line imported for the day",
    );
  }
  return parts.join(", ");
}

const SYSTEM =
  "You write one short line for a payroll officer summing up a group of staff pay queries that " +
  "share a likely cause. Use only the facts given. Do not add numbers, names, blame or advice. " +
  "Plain British English, under 160 characters, no line breaks.";

function promptFor(f: PayGroupFacts): string {
  return JSON.stringify({
    queries: f.count,
    issue: ISSUE_LABELS[f.issue],
    // The firm's word for its pay period (Phase 25.2), so a line never calls a fortnight a week.
    [f.label === "cycle" ? "payCycleStarting" : "weekStarting"]: dayLabel(f.week),
    site: f.site,
    paidAt: f.ratesPence?.map(pounds) ?? null,
  });
}

// The numbers the line may mention: those in the facts (the count, the week's date, the rates).
function allowedNumbers(f: PayGroupFacts): Set<string> {
  const text = `${f.count} ${dayLabel(f.week)} ${(f.ratesPence ?? []).map(pounds).join(" ")}`;
  return new Set(text.match(/\d+(?:\.\d+)?/g) ?? []);
}

const ADVICE_OR_VERDICT = new RegExp(
  "\\b(" +
    [
      // advice and blame
      "should",
      "must",
      "needs? to",
      "ought",
      "recommend\\w*",
      "blame\\w*",
      "fault\\w*",
      "mistakes?",
      "error by",
      "sue",
      "legal\\w*",
      // a verdict on the pay
      "correct\\w*",
      "incorrect\\w*",
      "right",
      "accurate\\w*",
      "inaccurate\\w*",
      "valid",
      "invalid",
      "genuine",
      "justified",
      "unjustified",
      "entitled",
      "under-?paid",
      "over-?paid",
      "owe[sd]?",
      "owing",
      "due",
      "refund\\w*",
      "back ?pay",
      "back-?dated",
      "reimburs\\w*",
      "compensat\\w*",
      "deduct\\w*",
      "difference",
      "top[- ]?up",
      "nothing",
      "no (?:issue|problem)s?",
      "fine",
      "resolved",
      "sorted",
      "fixed",
      "approv\\w*",
      "reject\\w*",
      "den(?:y|ied)",
      // a promise
      "will",
      "going to",
      "won't",
    ].join("|") +
    ")\\b",
  "i",
);

// The words a line may use (the reviews of Phase 10 task 19: a block list can't catch every way to
// state a verdict, "paid too little", "short-paid", "the claims are true"). The facts' own phrases
// (the issue as the code names it, the site, the week's day, and each part of the code's own line:
// "paid at £12.50", "no pay line imported for the day") are taken out first; every word left must
// be one of these plain ones, so the line can only restate the facts, never judge them (golden
// rule 9). None of them can carry a verdict on its own: "paid", "no", "all", "still", "been" and
// the like are allowed only inside the facts' phrases ("No hours missing", "They have been paid"
// and "the rate still used" are refused). A line that needs any other word falls back to the code's.
const NEUTRAL_WORDS = new Set([
  // joining words
  ...["a", "an", "the", "and", "or", "of", "at", "on", "in", "for", "from", "with", "to", "by"],
  ...["about", "each", "same", "this", "these", "that", "those", "their", "they", "them", "who"],
  ...["which", "is", "are", "was", "were", "it", "its"],
  // what the group is
  ...["staff", "worker", "workers", "people", "person", "query", "queries", "queried", "group"],
  ...["grouped", "say", "says", "said", "report", "reports", "reported", "raise", "raised"],
  ...["ask", "asks", "asked"],
  // what the facts are about
  ...["starting", "beginning", "day", "days", "shift", "shifts", "site", "sites"],
  ...["rate", "rates", "hour", "hours", "pay", "line", "lines", "show", "shows", "shown", "listed"],
]);

// The firm's word for its pay period, and only that (Phase 25.2): a line never calls a fortnight's
// cycle a week, or a week a cycle.
const PERIOD_WORDS: Record<"week" | "cycle", readonly string[]> = {
  week: ["week", "weeks"],
  cycle: ["cycle", "cycles"],
};

function onlyFactsWords(line: string, f: PayGroupFacts): boolean {
  let rest = ` ${line.toLowerCase()} `;
  const phrases = [ISSUE_LABELS[f.issue], f.site, dayLabel(f.week), ...factsPhrase(f).split(", ")]
    .filter((p): p is string => Boolean(p))
    // The longest first, so a phrase inside another doesn't break it up.
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) rest = rest.split(phrase.toLowerCase()).join(" ");
  const words = rest.match(/\p{L}+/gu) ?? [];
  const period = PERIOD_WORDS[f.label ?? "week"];
  return words.every((w) => NEUTRAL_WORDS.has(w) || period.includes(w));
}

export function checkedLine(raw: string, f: PayGroupFacts): string | null {
  const line = z
    .string()
    .trim()
    .min(5)
    .max(160)
    .regex(/^[^\n\r]+$/)
    .safeParse(raw);
  if (!line.success) return null;
  // A summary, not advice, blame or a conclusion about the pay (golden rule 9: a pay dispute never
  // gets an AI answer, and payroll mustn't be nudged towards one; audit L47): those words send it
  // back to the code's line. Erring wide is safe: the code's line is always right.
  if (ADVICE_OR_VERDICT.test(line.data)) return null;
  if (!onlyFactsWords(line.data, f)) return null;
  const allowed = allowedNumbers(f);
  const numbers = line.data.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.every((n) => allowed.has(n)) ? line.data : null;
}

// How long a summary may take before the code's line is used (src/lib/ai/ask.ts).
export const AI_SUMMARY_TIMEOUT_MS = AI_TIMEOUT_MS;

export async function summarisePayGroup(
  f: PayGroupFacts,
  ai: AiClient,
  opts: { timeoutMs?: number } = {},
): Promise<PayGroupSummary> {
  const raw = await askAi(
    ai,
    { purpose: "pay_group_summary", system: SYSTEM, prompt: promptFor(f), maxTokens: 80 },
    opts.timeoutMs ?? AI_SUMMARY_TIMEOUT_MS,
  );
  const line = typeof raw === "string" ? checkedLine(raw, f) : null;
  return line ? { text: line, byAi: true } : { text: codeSummary(f), byAi: false };
}

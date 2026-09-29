import { z } from "zod";
import { ISSUE_LABELS, type PayIssue } from "../portal/pay-query-kinds";
import { pounds } from "../portal/pay-format";
import { dayLabel } from "../rules/reasons";
import type { AiClient } from "./client";

// One line per pay query group, for payroll (docs/architecture.md "Haiku writes a one-line summary
// per group"). The model sees only the group's facts (how many, the issue, the week, the site, the
// rate): no names, no worker's own words. Its line is used only if it passes the check below (one
// line, 5 to 160 characters, no number that isn't in the facts, no advice or blame words);
// otherwise, or when the AI isn't there, the line is written by code. Payroll always sees the
// code's line (the facts) as the heading, and an AI line only beneath it, labelled.

export interface PayGroupFacts {
  count: number;
  issue: PayIssue;
  week: string; // the week's Monday, yyyy-mm-dd
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
  const parts = [ISSUE_LABELS[f.issue].toLowerCase(), `the week of ${dayLabel(f.week)}`];
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
    weekStarting: dayLabel(f.week),
    site: f.site,
    paidAt: f.ratesPence?.map(pounds) ?? null,
  });
}

// The numbers the line may mention: those in the facts (the count, the week's date, the rates).
function allowedNumbers(f: PayGroupFacts): Set<string> {
  const text = `${f.count} ${dayLabel(f.week)} ${(f.ratesPence ?? []).map(pounds).join(" ")}`;
  return new Set(text.match(/\d+(?:\.\d+)?/g) ?? []);
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
  // A summary, not advice or blame: those words send it back to the code's line.
  if (/\b(should|must|need to|blame|fault|mistake|error by|sue|legal)\b/i.test(line.data)) {
    return null;
  }
  const allowed = allowedNumbers(f);
  const numbers = line.data.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.every((n) => allowed.has(n)) ? line.data : null;
}

export async function summarisePayGroup(f: PayGroupFacts, ai: AiClient): Promise<PayGroupSummary> {
  try {
    const raw = await ai.complete({
      purpose: "pay_group_summary",
      system: SYSTEM,
      prompt: promptFor(f),
      maxTokens: 80,
    });
    const line = checkedLine(raw, f);
    if (line) return { text: line, byAi: true };
  } catch {
    // Not connected, timed out or refused: the code line below.
  }
  return { text: codeSummary(f), byAi: false };
}

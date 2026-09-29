import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { payQueries, payRecords, shifts } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import type { PayIssue } from "../portal/pay-query-kinds";
import { mondayOf } from "../time/zoned";

// Pay query grouping keys (Phase 6; docs/data-model.md `pay_queries.group_key`; docs/architecture.md
// "Code assigns grouping keys"). Code, never a model, decides which queries share a likely cause
// (golden rules 1 and 9). A key uses only the parts that point at one cause for its issue:
// - wrong rate: the week and the rate the worker's imported pay line for that day was paid at (a
//   rate change not applied to a week's shifts);
// - hours missing: the week and the site (one site's timesheet);
// - paid late or not paid: the week (one pay run);
// - something else: the week.
// The week is the Monday of the day worked (firm time). Keys are versioned ("pay1:") so a later
// change of rule never mixes old and new keys in one group.

export const GROUP_KEY_VERSION = "pay1";
const KEY_PATTERN = new RegExp(
  `^${GROUP_KEY_VERSION}:(wrong_rate|missing_hours|late_pay|other):(\\d{4}-\\d{2}-\\d{2})(?::(rate|site):([0-9a-f+-]+|none))?$`,
);

export interface GroupFacts {
  issue: PayIssue;
  workDate: string; // yyyy-mm-dd
  siteId: string | null; // the shift's site, if the query names a shift with one
  ratesPence: number[]; // the rates on the worker's pay lines covering the day (may be none)
}

export function payGroupKey(f: GroupFacts): string {
  const week = mondayOf(f.workDate);
  switch (f.issue) {
    case "wrong_rate": {
      const rates = [...new Set(f.ratesPence)].sort((a, b) => a - b);
      return `${GROUP_KEY_VERSION}:wrong_rate:${week}:rate:${rates.length > 0 ? rates.join("+") : "none"}`;
    }
    case "missing_hours":
      return `${GROUP_KEY_VERSION}:missing_hours:${week}:site:${f.siteId ?? "none"}`;
    case "late_pay":
      return `${GROUP_KEY_VERSION}:late_pay:${week}`;
    case "other":
      return `${GROUP_KEY_VERSION}:other:${week}`;
  }
}

export interface ParsedGroupKey {
  issue: PayIssue;
  week: string;
  siteId: string | null;
  ratesPence: number[] | null; // null: not part of this key; [] : no pay line for the day
}

// A key back into its parts (for showing a group), or null for one this code didn't write.
export function parsePayGroupKey(key: string): ParsedGroupKey | null {
  const m = KEY_PATTERN.exec(key);
  if (!m) return null;
  const [, issue, week, part, value] = m;
  const parsed: ParsedGroupKey = {
    issue: issue as PayIssue,
    week: week ?? "",
    siteId: null,
    ratesPence: null,
  };
  if (part === "rate") {
    parsed.ratesPence = value === "none" ? [] : (value ?? "").split("+").map(Number);
  }
  if (part === "site" && value !== "none") parsed.siteId = value ?? null;
  return parsed;
}

// The facts a query's key needs, from the firm's rows (RLS scopes them).
export async function groupFactsFor(
  tx: FirmTx,
  q: { workerId: string; shiftId: string | null; workDate: string; issue: PayIssue },
): Promise<GroupFacts> {
  let siteId: string | null = null;
  if (q.shiftId) {
    const [shift] = await tx
      .select({ siteId: shifts.siteId })
      .from(shifts)
      .where(eq(shifts.id, q.shiftId));
    siteId = shift?.siteId ?? null;
  }
  const lines =
    q.issue === "wrong_rate"
      ? await tx
          .select({ ratePence: payRecords.ratePence })
          .from(payRecords)
          .where(
            and(
              eq(payRecords.workerId, q.workerId),
              lte(payRecords.periodStart, q.workDate),
              gte(payRecords.periodEnd, q.workDate),
            ),
          )
      : [];
  return {
    issue: q.issue,
    workDate: q.workDate,
    siteId,
    ratesPence: lines.map((l) => l.ratePence),
  };
}

// Recomputes the keys of open and in-digest queries (a pay line imported after the query was
// raised changes a wrong-rate key). Returns how many changed. The key is worked out from the rows,
// so this can run as often as needed.
export async function regroupPayQueries(tx: FirmTx): Promise<{ changed: number }> {
  const open = await tx
    .select({
      id: payQueries.id,
      workerId: payQueries.workerId,
      shiftId: payQueries.shiftId,
      workDate: payQueries.workDate,
      issue: payQueries.issueType,
      groupKey: payQueries.groupKey,
    })
    .from(payQueries)
    .where(inArray(payQueries.status, ["open", "in_digest"]))
    .orderBy(asc(payQueries.id)) // one lock order, so two regroups can't deadlock
    .for("no key update");
  let changed = 0;
  for (const q of open) {
    const key = payGroupKey(await groupFactsFor(tx, q));
    if (key !== q.groupKey) {
      await tx
        .update(payQueries)
        .set({ groupKey: key })
        .where(and(eq(payQueries.id, q.id), sql`${payQueries.groupKey} is distinct from ${key}`));
      changed += 1;
    }
  }
  return { changed };
}

import { and, eq, inArray, sql } from "drizzle-orm";
import { authParts, type AuthContext } from "../auth/link-login";
import { currentOfficeUser } from "../auth/office-login";
import { canAccess } from "../auth/roles";
import { noAi, type AiClient } from "../ai/client";
import {
  codeSummary,
  summarisePayGroup,
  type PayGroupFacts,
  type PayGroupSummary,
} from "../ai/pay-summary";
import { firms, sites } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { parsePayGroupKey } from "../pay/grouping";
import { shiftWhen } from "../portal/format";
import type { PayIssue } from "../portal/pay-query-kinds";
import { mondayOf } from "../time/zoned";

// Payroll's pay queries, grouped by likely cause (docs/screens.md `/office/pay-queries`). Payroll and
// admins: the session and role are checked here as well as on the page. Reads only, inside the firm.
// Open and in-digest queries by their grouping key (worked out by code: src/lib/pay/grouping.ts),
// biggest group first, each with its facts, a one-line summary and its queries (the worker, the
// day, the shift, their details: payroll's to answer; never logged). The heading is the code's line
// from the facts; summariseGroups() adds an AI line beneath it, outside any transaction (the digest
// job, once Bedrock is connected). At most 2,000 queries (the newest), and it says when there are more.

export interface PayQueryItem {
  id: string;
  ref: string;
  worker: string;
  day: string; // yyyy-mm-dd
  shift: string | null; // "Sat 31 Oct, 08:00 to 16:00"
  details: string | null;
  status: string;
  createdAt: Date;
}

export interface PayQueryGroup {
  key: string;
  facts: PayGroupFacts;
  heading: string; // the code's line, from the facts
  aiLine: string | null; // an AI line that passed the check (summariseGroups), shown beneath
  queries: PayQueryItem[];
}

type Row = {
  id: string;
  group_key: string | null;
  issue_type: PayIssue;
  work_date: string;
  details: string | null;
  status: string;
  created_at: string | Date;
  first_name: string;
  last_name: string;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
};

export const PAY_QUERY_ROWS = 2000;

export async function loadPayQueryGroups(
  tx: FirmTx,
): Promise<{ timeZone: string; groups: PayQueryGroup[]; more: boolean }> {
  const [firm] = await tx
    .select({ timezone: firms.timezone })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  const timeZone = firm?.timezone ?? "Europe/London";
  const { rows } = await tx.execute<Row>(sql`
    select q.id, q.group_key, q.issue_type, q.work_date::text as work_date, q.details, q.status,
           q.created_at, w.first_name, w.last_name, s.starts_at, s.ends_at
      from pay_queries q
      join workers w on w.firm_id = q.firm_id and w.id = q.worker_id
      left join shifts s on s.firm_id = q.firm_id and s.id = q.shift_id
     where q.status in ('open', 'in_digest')
     order by q.created_at desc, q.id
     limit ${PAY_QUERY_ROWS + 1}`);
  const more = rows.length > PAY_QUERY_ROWS;
  rows.splice(PAY_QUERY_ROWS);
  rows.reverse(); // oldest first within each group

  // A query with no key (none are written without one) groups on its own.
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.group_key ?? `ungrouped:${r.id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const siteIds = [...byKey.keys()]
    .map((k) => parsePayGroupKey(k)?.siteId)
    .filter((id): id is string => !!id);
  const siteNames = new Map(
    siteIds.length === 0
      ? []
      : (
          await tx
            .select({ id: sites.id, name: sites.name })
            .from(sites)
            .where(inArray(sites.id, siteIds))
        ).map((s) => [s.id, s.name]),
  );

  const groups: PayQueryGroup[] = [];
  for (const [key, members] of byKey) {
    const first = members[0];
    if (!first) continue;
    const parsed = parsePayGroupKey(key);
    const facts: PayGroupFacts = {
      count: members.length,
      issue: parsed?.issue ?? first.issue_type,
      week: parsed?.week ?? mondayOf(first.work_date),
      site: parsed?.siteId ? (siteNames.get(parsed.siteId) ?? null) : null,
      ratesPence: parsed?.ratesPence ?? null,
    };
    groups.push({
      key,
      facts,
      heading: codeSummary(facts),
      aiLine: null,
      queries: members.map((m) => ({
        id: m.id,
        ref: m.id.slice(0, 8).toUpperCase(),
        worker: `${m.first_name} ${m.last_name}`,
        day: m.work_date,
        shift:
          m.starts_at && m.ends_at
            ? shiftWhen(new Date(m.starts_at), new Date(m.ends_at), timeZone)
            : null,
        details: m.details,
        status: m.status,
        createdAt: new Date(m.created_at),
      })),
    });
  }
  groups.sort((a, b) => b.queries.length - a.queries.length || a.key.localeCompare(b.key));
  return { timeZone, groups, more };
}

// The AI's line for each group (the digest, once Bedrock is connected), after the groups are
// loaded: never inside a database transaction (an AI call can take seconds). A line that fails the
// check, or no AI, leaves `aiLine` empty.
export async function summariseGroups(
  groups: PayQueryGroup[],
  ai: AiClient,
): Promise<PayQueryGroup[]> {
  const out: PayQueryGroup[] = [];
  for (const g of groups) {
    const s = await summarisePayGroup(g.facts, ai);
    out.push({ ...g, aiLine: s.byAi ? s.text : null });
  }
  return out;
}

// The page's data for the logged-in office user, or null (logged out, or a role without it).
export async function officePayQueryGroups(
  ctx: AuthContext,
  token: string,
): Promise<{ timeZone: string; groups: PayQueryGroup[]; more: boolean } | null> {
  const me = await currentOfficeUser(ctx, token);
  if (!me || !canAccess(me.officeUser.role, "pay")) return null;
  const { run } = authParts(ctx);
  return run(ctx.firm.id, (tx) => loadPayQueryGroups(tx));
}

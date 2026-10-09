"use server";

import { z } from "zod";
import { sortPayQueries } from "@/lib/office/pay-sort";
import { MAX_SORT_IDS, type ResolvePayQueriesResult } from "@/lib/pay/resolve";
import { asPayroll, type Common } from "./as-payroll";

// Payroll's "Mark as sorted and tell them" (docs/screens.md `/office/pay-queries`): the queries
// shown in a group and payroll's note, checked with zod first. The note is the person's own words:
// nothing on this path can reach AI code (tests/unit/ai.boundary.test.ts). Shown in place.

const sortInput = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_SORT_IDS),
  note: z.string().max(5000),
});

export async function sortPayQueriesAction(
  ids: unknown,
  note: unknown,
): Promise<ResolvePayQueriesResult | Common> {
  const input = sortInput.safeParse({ ids, note });
  if (!input.success) return { status: "error" };
  return asPayroll("sort pay queries", (ctx) =>
    sortPayQueries(ctx, input.data.ids, input.data.note),
  );
}

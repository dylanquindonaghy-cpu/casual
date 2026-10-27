"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { officeSearchHits } from "@/lib/office/search";
import type { SearchHits } from "@/lib/office/search-copy";
import { requestLog } from "@/lib/request";

// The top bar's search (Phase 24; src/lib/office/search.ts): a server action, so what's typed (a
// name, a mobile number) never goes in the address or a log. The firm comes from the request's
// host and the office user from their session; the loader checks the role again inside the firm's
// transaction, for each kind it finds.

export type SearchResult =
  | { status: "found"; hits: SearchHits }
  | { status: "logged_out" }
  | { status: "not_allowed" }
  | { status: "error" };

export async function searchOfficeAction(raw: unknown): Promise<SearchResult> {
  const parsed = z.string().max(1_000).safeParse(raw);
  if (!parsed.success) return { status: "found", hits: { groups: [], count: 0 } };
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  const role = session.officeUser.role;
  if (!canAccess(role, "casuals") && !canAccess(role, "shifts")) return { status: "not_allowed" };
  try {
    const hits = await officeSearchHits(
      { firm: session.firm, officeUserId: session.officeUser.id },
      parsed.data,
      session.firm.timezone,
    );
    return hits ? { status: "found", hits } : { status: "not_allowed" };
  } catch (error) {
    (await requestLog()).error("office search failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

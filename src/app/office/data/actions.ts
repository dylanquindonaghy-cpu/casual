"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import type { FindWorkersResult } from "@/app/office/find-worker-form";
import { findWorkers } from "@/lib/gdpr/worker-export";
import { requestLog } from "@/lib/request";

// Finding the worker a GDPR request is about (docs/screens.md `/office/data`). A server action, not
// a search in the address: a mobile number or name typed here must never end up in the address bar,
// the browser's history or a request log. The firm comes from the host, the office user from their
// session (an admin: checked here and again inside the search).

const input = z.string().max(1_000);

export async function findWorkersAction(raw: unknown): Promise<FindWorkersResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { status: "found", matches: [] };
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "data")) return { status: "not_allowed" };
  try {
    const matches = await findWorkers(
      { firm: session.firm, officeUserId: session.officeUser.id },
      parsed.data,
    );
    return matches ? { status: "found", matches } : { status: "not_allowed" };
  } catch (error) {
    (await requestLog()).error("find workers failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

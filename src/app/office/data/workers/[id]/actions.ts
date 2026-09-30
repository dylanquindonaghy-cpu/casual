"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { eraseWorker } from "@/lib/gdpr/worker-erase";
import type { EraseActionResult } from "@/lib/office/data-copy";
import { requestLog } from "@/lib/request";

// Deleting a worker's personal details (docs/screens.md `/office/data/workers/[id]`). The firm
// comes from the request's host and the office user from their session (an admin: checked here,
// and again inside the deletion). The box must be ticked.

const input = z.strictObject({ workerId: z.uuid(), understood: z.literal(true) });

export async function eraseWorkerAction(raw: unknown): Promise<EraseActionResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    return (raw as { understood?: unknown } | null)?.understood === true
      ? { status: "not_found" }
      : { status: "unconfirmed" };
  }
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "data")) return { status: "not_allowed" };
  try {
    return await eraseWorker(
      { firm: session.firm, officeUserId: session.officeUser.id },
      parsed.data.workerId,
    );
  } catch (error) {
    (await requestLog()).error("erase worker failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

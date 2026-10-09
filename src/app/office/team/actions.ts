"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { OFFICE_ROLES } from "@/lib/db/schema";
import { changeAccessFromOffice, type OfficeAccessChange } from "@/lib/office/team";
import type { TeamActionResult } from "@/lib/office/team-copy";
import { requestLog } from "@/lib/request";

// Turning someone's office access off or back on, changing their role, or logging them out on
// every device (docs/screens.md `/office/team`). The firm comes from the request's host and the
// admin from their session (checked here, and again inside the change). Input is checked with zod
// first. The result is shown in place.

const input = z.discriminatedUnion("change", [
  z.strictObject({ officeUserId: z.uuid(), change: z.literal("disable") }),
  z.strictObject({ officeUserId: z.uuid(), change: z.literal("enable") }),
  z.strictObject({ officeUserId: z.uuid(), change: z.literal("sign_out") }),
  z.strictObject({ officeUserId: z.uuid(), change: z.literal("role"), role: z.enum(OFFICE_ROLES) }),
]);

export async function changeOfficeAccessAction(raw: unknown): Promise<TeamActionResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { status: "error" };
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  if (!canAccess(session.officeUser.role, "team")) return { status: "not_allowed" };
  const change: OfficeAccessChange =
    parsed.data.change === "role"
      ? { kind: "role", role: parsed.data.role }
      : { kind: parsed.data.change };
  try {
    return await changeAccessFromOffice(
      { firm: session.firm, officeUserId: session.officeUser.id },
      parsed.data.officeUserId,
      change,
    );
  } catch (error) {
    (await requestLog()).error("office access change failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

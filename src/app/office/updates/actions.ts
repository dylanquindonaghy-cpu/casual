"use server";

import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import { markUpdatesSeen } from "@/lib/office/updates";
import { requestLog } from "@/lib/request";

// "Mark all as seen" on Updates (Phase 26.4): what the page showed has been seen, so the bell counts
// from there.
// shownAt: when the page was drawn (its own clock, sent with it).
const ShownAt = z.iso.datetime();

export async function markUpdatesSeenAction(shownAt: string): Promise<{
  status: "seen" | "not_allowed" | "error";
}> {
  const session = await getOfficeSession();
  if (!session) return { status: "not_allowed" };
  const at = ShownAt.safeParse(shownAt);
  if (!at.success) return { status: "error" };
  try {
    const ok = await markUpdatesSeen(
      { firm: session.firm, officeUserId: session.officeUser.id },
      new Date(at.data),
    );
    return { status: ok ? "seen" : "not_allowed" };
  } catch (error) {
    (await requestLog()).error("mark updates seen failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

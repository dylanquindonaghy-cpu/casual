"use server";

import { getOfficeSession } from "@/lib/auth/current-office";
import { saveMyDashboard } from "@/lib/office/contracts";
import type { CustomiseState } from "@/lib/office/customise-copy";
import { requestLog } from "@/lib/request";

// Customise's "Save my dashboard" (Phase 26.3; docs/screens.md "Customise"): the contracts the
// person looks after and the cards they see, from the form (ticked "contract" and "card" boxes),
// saved to them. The firm comes from the request's host and the person from their session; the
// role is checked again inside the change (src/lib/office/contracts.ts), and every value too.
export async function saveDashboardAction(
  _previous: CustomiseState,
  form: FormData,
): Promise<CustomiseState> {
  const session = await getOfficeSession();
  if (!session) return { status: "logged_out" };
  try {
    return await saveMyDashboard(
      { firm: session.firm, officeUserId: session.officeUser.id },
      { clientIds: form.getAll("contract"), cards: form.getAll("card") },
    );
  } catch (error) {
    (await requestLog()).error("save dashboard failed", { firmId: session.firm.id, error });
    return { status: "error" };
  }
}

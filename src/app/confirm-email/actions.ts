"use server";

import { confirmStrikesEmail, type ConfirmStrikesEmailResult } from "@/lib/office/strikes-email";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// "Confirm this address" on the strikes team's link (12B.7). No login: the strikes team needn't be
// office users. The firm comes from the request's host; the link's signature (firm, address,
// expiry) is checked against that firm's address as it is now.
export async function confirmStrikesEmailAction(
  token: unknown,
): Promise<ConfirmStrikesEmailResult | { status: "error" }> {
  if (typeof token !== "string") return { status: "invalid" };
  const firm = await getCurrentFirm();
  try {
    return await confirmStrikesEmail({ firm }, token);
  } catch (error) {
    (await requestLog()).error("confirm strikes email failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

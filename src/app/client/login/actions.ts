"use server";

import { z } from "zod";
import { requestClientLoginLink } from "@/lib/client/login";
import { clientIp, requestLog } from "@/lib/request";
import { currentFirmAddress, getCurrentFirm } from "@/lib/tenancy/current-firm";

export type ClientLoginState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "invalid_email" }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "error" };

// "Send me a link" for a client contact (Phase 36.3). The same answer whether or not the address
// is known (or switched on).
export async function requestClientLinkAction(
  _prev: ClientLoginState,
  formData: FormData,
): Promise<ClientLoginState> {
  const firm = await getCurrentFirm(); // outside try: an unknown firm is a 404, not an error
  const email = z.string().max(254).safeParse(formData.get("email"));
  if (!email.success) return { status: "invalid_email" };
  try {
    const address = await currentFirmAddress(); // the link goes back to the same address
    return await requestClientLoginLink({ firm, address, clientIp: await clientIp() }, email.data);
  } catch (error) {
    (await requestLog()).error("client link request failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

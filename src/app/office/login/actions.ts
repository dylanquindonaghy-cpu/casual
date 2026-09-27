"use server";

import { z } from "zod";
import { requestOfficeLoginLink } from "@/lib/auth/office-login";
import { clientIp, requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

export type OfficeLoginState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "invalid_email" }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "error" };

// "Send me a link" for office users. The same answer whether or not the address is known.
export async function requestOfficeLinkAction(
  _prev: OfficeLoginState,
  formData: FormData,
): Promise<OfficeLoginState> {
  const firm = await getCurrentFirm(); // outside try: an unknown firm is a 404, not an error
  const email = z.string().max(254).safeParse(formData.get("email"));
  if (!email.success) return { status: "invalid_email" };
  try {
    return await requestOfficeLoginLink({ firm, clientIp: await clientIp() }, email.data);
  } catch (error) {
    (await requestLog()).error("office link request failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

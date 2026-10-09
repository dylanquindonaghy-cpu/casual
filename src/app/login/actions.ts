"use server";

import { z } from "zod";
import { requestWorkerLoginLink } from "@/lib/auth/worker-login";
import { clientIp, requestLog } from "@/lib/request";
import { currentFirmAddress, getCurrentFirm } from "@/lib/tenancy/current-firm";

export type LoginFormState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "invalid_number" }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "error" };

// "Send me a link". The answer is the same whether or not the number belongs to a worker here.
export async function requestLoginLinkAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const firm = await getCurrentFirm(); // outside try: an unknown firm is a 404, not an error
  const mobile = z.string().max(40).safeParse(formData.get("mobile"));
  if (!mobile.success) return { status: "invalid_number" };
  try {
    const address = await currentFirmAddress(); // the link goes back to the same address
    return await requestWorkerLoginLink({ firm, address, clientIp: await clientIp() }, mobile.data);
  } catch (error) {
    (await requestLog()).error("login link request failed", { firmId: firm.id, error });
    return { status: "error" };
  }
}

"use server";

import { sendPayDigestNow } from "@/lib/office/quick-actions";
import type { SendDigestNowResult } from "@/lib/pay/digest";
import { asPayroll, type Common } from "./as-payroll";

// Payroll's "Send the digest now" (docs/screens.md `/office/pay-queries`). The digest itself goes
// from the job worker. The result is shown in place.

export async function sendDigestNowAction(): Promise<SendDigestNowResult | Common> {
  return asPayroll("send pay digest now", (ctx) => sendPayDigestNow(ctx));
}

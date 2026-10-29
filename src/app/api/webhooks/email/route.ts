import { resolveFirmByInbox } from "@/lib/db/directory";
import { receiveEmail } from "@/lib/email/receive";
import { handleEmailWebhook } from "@/lib/email/webhook";
import { appEnv } from "@/lib/env";

// The staffing inbox's emails in (P7.2; docs/api-and-jobs.md): the firm's email provider sends each
// email its inbox receives. Signature checked first, then one row stored, 200 at once. On the
// platform address: the address it was sent to names the firm. The work is in
// src/lib/email/webhook.ts.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleEmailWebhook(request, {
    secret: appEnv().EMAIL_INBOUND_SECRET,
    resolveFirmByInbox,
    receive: (firmId, email) => receiveEmail(firmId, email),
    now: () => new Date(),
  });
}

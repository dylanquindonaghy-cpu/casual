import { resolveConnectorSource } from "@/lib/db/directory";
import { receiveConnectorEvent } from "@/lib/connector/job";
import { handleConnectorWebhook } from "@/lib/connector/webhook";
import { appEnv } from "@/lib/env";

// A connector's webhooks (P5.3; docs/api-and-jobs.md): the firm's own system says a session or a
// staff record changed. Signature checked first, then one row stored and one job queued, 200 at
// once; the job reads the record from the system itself. On the platform address: the source's id
// in the path names it. The work is in src/lib/connector/webhook.ts.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sourceId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return handleConnectorWebhook(request, (await params).sourceId, {
    secret: appEnv().INTEGRATIONS_SECRET,
    resolveSource: resolveConnectorSource,
    receive: (firmId, event) => receiveConnectorEvent(firmId, event),
    now: () => new Date(),
  });
}

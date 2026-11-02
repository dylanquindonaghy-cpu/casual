import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import {
  pushSubscriptionSchema,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/push/subscriptions";
import { checkedPushBody as checked } from "@/lib/push/route-body";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// POST: save this phone's web push subscription for the logged-in worker; DELETE: remove it, also
// when it was already gone (so it can be repeated) (docs/api-and-jobs.md). A route, not a server action, so the service worker could post a
// renewed subscription too. The firm comes from the host and the worker from the session; the
// request must come from the portal's own page (its Origin is this host), the body is checked
// with zod and kept small. A save that writes counts against the worker's limit (10 every 15
// minutes, the auth throttle: 429 with Retry-After past it), since each writes to the action log;
// removing is never limited (turning notifications off, or logging out, must always work). Answers
// are plain JSON statuses; nothing about the subscription is logged.

export async function POST(request: Request): Promise<Response> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return Response.json({ status: "logged_out" }, { status: 401 });
  const input = await checked(request);
  if (input instanceof Response) return input;
  const subscription = pushSubscriptionSchema.safeParse(input.body);
  if (!subscription.success) return Response.json({ status: "invalid" }, { status: 400 });
  try {
    // A save that would write counts against the worker's limit first (after the same-origin and
    // size checks, so only the portal's own page uses it up).
    const result = await savePushSubscription({ firm }, session.worker.id, subscription.data, {
      limit: true,
    });
    if (result.status === "rate_limited") {
      return Response.json(
        { status: "rate_limited" },
        { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
      );
    }
    return Response.json(result, { status: result.status === "saved" ? 200 : 404 });
  } catch (error) {
    (await requestLog()).error("save push subscription failed", { firmId: firm.id, error });
    return Response.json({ status: "error" }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return Response.json({ status: "logged_out" }, { status: 401 });
  const input = await checked(request);
  if (input instanceof Response) return input;
  const endpoint = z.object({ endpoint: z.url().max(2048) }).safeParse(input.body);
  if (!endpoint.success) return Response.json({ status: "invalid" }, { status: 400 });
  try {
    const result = await removePushSubscription(
      { firm },
      session.worker.id,
      endpoint.data.endpoint,
    );
    return Response.json(result);
  } catch (error) {
    (await requestLog()).error("remove push subscription failed", { firmId: firm.id, error });
    return Response.json({ status: "error" }, { status: 500 });
  }
}

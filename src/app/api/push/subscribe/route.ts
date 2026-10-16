import { z } from "zod";
import { getWorkerSession } from "@/lib/auth/current-worker";
import {
  pushSubscriptionSchema,
  removePushSubscription,
  savePushSubscription,
  throttlePushChanges,
} from "@/lib/push/subscriptions";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";

// POST: save this phone's web push subscription for the logged-in worker; DELETE: remove it, also
// when it was already gone (so it can be repeated) (docs/api-and-jobs.md). A route, not a server action, so the service worker could post a
// renewed subscription too. The firm comes from the host and the worker from the session; the
// request must come from the portal's own page (its Origin is this host), the body is checked
// with zod and kept small. Each save or removal counts against the worker's limit first (10 every
// 15 minutes, the auth throttle: 429 with Retry-After past it), since each writes to the action
// log. Answers are plain JSON statuses; nothing about the subscription is logged.

const MAX_BODY = 4096;

async function limited(firm: { id: string }, workerId: string): Promise<Response | null> {
  const hit = await throttlePushChanges({ firm }, workerId);
  if (!hit) return null;
  return Response.json(
    { status: "rate_limited" },
    { status: 429, headers: { "retry-after": String(hit.retryAfterSeconds) } },
  );
}

async function checked(request: Request): Promise<Response | { body: unknown }> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && !!host && new URL(origin).host === host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return Response.json({ status: "forbidden" }, { status: 403 });
  // Refuse a large body before reading it where the size is declared, and count bytes after.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return Response.json({ status: "too_large" }, { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY) {
    return Response.json({ status: "too_large" }, { status: 413 });
  }
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return Response.json({ status: "invalid" }, { status: 400 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const firm = await getCurrentFirm();
  const session = await getWorkerSession();
  if (!session) return Response.json({ status: "logged_out" }, { status: 401 });
  const input = await checked(request);
  if (input instanceof Response) return input;
  // After the same-origin and size checks: only the portal's own page uses up the limit.
  const refused = await limited(firm, session.worker.id);
  if (refused) return refused;
  const subscription = pushSubscriptionSchema.safeParse(input.body);
  if (!subscription.success) return Response.json({ status: "invalid" }, { status: 400 });
  try {
    const result = await savePushSubscription({ firm }, session.worker.id, subscription.data);
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
  // After the same-origin and size checks: only the portal's own page uses up the limit.
  const refused = await limited(firm, session.worker.id);
  if (refused) return refused;
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

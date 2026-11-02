import { z } from "zod";
import { getOfficeSession } from "@/lib/auth/current-office";
import {
  removeOfficePushSubscription,
  renewOfficePushSubscription,
  saveOfficePushSubscription,
} from "@/lib/push/office-subscriptions";
import { checkedPushBody } from "@/lib/push/route-body";
import { pushSubscriptionSchema } from "@/lib/push/subscriptions";
import { requestLog } from "@/lib/request";

// POST: save this browser's web push subscription for the logged-in admin or resourcer (Phase 26.4,
// Updates' "Tell me about": "Turn on notifications here" only); PUT: renew one already theirs, from
// its old address to the new (the service worker on a renewal, and the page checking the one the
// browser has: anything not already theirs is left alone, 404); DELETE: remove it, also when it was
// already gone (docs/api-and-jobs.md). As the casuals' /api/push/subscribe: a route, so the service worker can post a renewed
// subscription; the firm from the host and the person from the office session; the site's own page
// only; the body checked with zod and kept small; a save that writes counts against the person's
// limit (429 with Retry-After past it); removing is never limited. Nothing about the subscription is
// logged here.

export async function POST(request: Request): Promise<Response> {
  const session = await getOfficeSession();
  if (!session) return Response.json({ status: "logged_out" }, { status: 401 });
  const input = await checkedPushBody(request);
  if (input instanceof Response) return input;
  const subscription = pushSubscriptionSchema.safeParse(input.body);
  if (!subscription.success) return Response.json({ status: "invalid" }, { status: 400 });
  try {
    const result = await saveOfficePushSubscription(
      { firm: session.firm, officeUserId: session.officeUser.id },
      subscription.data,
      { limit: true },
    );
    if (result.status === "rate_limited") {
      return Response.json(
        { status: "rate_limited" },
        { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
      );
    }
    return Response.json(result, { status: result.status === "saved" ? 200 : 403 });
  } catch (error) {
    (await requestLog()).error("save office push subscription failed", {
      firmId: session.firm.id,
      error,
    });
    return Response.json({ status: "error" }, { status: 500 });
  }
}

const Renewal = z.object({ old: z.url().max(2048), subscription: pushSubscriptionSchema });

export async function PUT(request: Request): Promise<Response> {
  const session = await getOfficeSession();
  if (!session) return Response.json({ status: "logged_out" }, { status: 401 });
  const input = await checkedPushBody(request);
  if (input instanceof Response) return input;
  const renewal = Renewal.safeParse(input.body);
  if (!renewal.success) return Response.json({ status: "invalid" }, { status: 400 });
  try {
    const result = await renewOfficePushSubscription(
      { firm: session.firm, officeUserId: session.officeUser.id },
      renewal.data.old,
      renewal.data.subscription,
      { limit: true },
    );
    if (result.status === "rate_limited") {
      return Response.json(
        { status: "rate_limited" },
        { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
      );
    }
    const code = { saved: 200, not_found: 404, not_allowed: 403 }[result.status];
    return Response.json(result, { status: code });
  } catch (error) {
    (await requestLog()).error("renew office push subscription failed", {
      firmId: session.firm.id,
      error,
    });
    return Response.json({ status: "error" }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const session = await getOfficeSession();
  if (!session) return Response.json({ status: "logged_out" }, { status: 401 });
  const input = await checkedPushBody(request);
  if (input instanceof Response) return input;
  const endpoint = z.object({ endpoint: z.url().max(2048) }).safeParse(input.body);
  if (!endpoint.success) return Response.json({ status: "invalid" }, { status: 400 });
  try {
    const result = await removeOfficePushSubscription(
      { firm: session.firm, officeUserId: session.officeUser.id },
      endpoint.data.endpoint,
    );
    return Response.json(result);
  } catch (error) {
    (await requestLog()).error("remove office push subscription failed", {
      firmId: session.firm.id,
      error,
    });
    return Response.json({ status: "error" }, { status: 500 });
  }
}

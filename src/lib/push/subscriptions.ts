import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { pushSubscriptions, workers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { withFirm } from "../db/scoped";
import { recordEvent } from "../events/record";
import { appEnv } from "../env";
import { LIMITS, throttle, type Throttled } from "../auth/throttle";
import type { PortalContext } from "../portal/my-shifts";

// A worker's web push subscriptions (docs/api-and-jobs.md, `POST /api/push/subscribe`): the
// address a browser gives for this phone. Saved and removed by the logged-in worker only; read
// by the senders (offer waves). The endpoint and keys address one person's phone, so they never
// go into the action log or the logs (the events say only that one was added or removed).

// The browser makers' push services: a subscription must point at one of them (never at a host of
// the sender's choosing, which the real sender would then post to).
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];
export const MAX_PHONES_PER_WORKER = 10;

export function isPushServiceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

// What the browser's PushSubscription.toJSON() gives, checked.
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine(isPushServiceUrl, "must be a browser push service address"),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{16,200}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{8,100}={0,2}$/),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function savePushSubscription(
  ctx: PortalContext,
  workerId: string,
  input: PushSubscriptionInput,
): Promise<{ status: "saved" } | { status: "not_found" }> {
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [me] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(and(eq(workers.id, workerId), eq(workers.status, "active")));
    if (!me) return { status: "not_found" };
    // Saved again unchanged (the profile re-checks on load): nothing to do or log.
    const [same] = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, input.endpoint),
          eq(pushSubscriptions.workerId, workerId),
          eq(pushSubscriptions.p256dh, input.keys.p256dh),
          eq(pushSubscriptions.auth, input.keys.auth),
        ),
      );
    if (same) return { status: "saved" };
    // One row per endpoint: a new login on the same phone takes it over.
    const [row] = await tx
      .insert(pushSubscriptions)
      .values({
        firmId: ctx.firm.id,
        workerId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.firmId, pushSubscriptions.endpoint],
        set: {
          workerId: sql`excluded.worker_id`,
          p256dh: sql`excluded.p256dh`,
          auth: sql`excluded.auth`,
        },
      })
      .returning({ id: pushSubscriptions.id });
    // At most MAX_PHONES_PER_WORKER: the oldest go (each offer is pushed to every one).
    await tx.execute(sql`
      delete from push_subscriptions where id in (
        select id from push_subscriptions where worker_id = ${workerId}
         order by created_at desc, id desc offset ${MAX_PHONES_PER_WORKER})
    `);
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "push.subscribed",
      entityType: "push_subscription",
      entityId: row?.id ?? null,
      data: {},
    });
    return { status: "saved" };
  });
}

export async function removePushSubscription(
  ctx: PortalContext,
  workerId: string,
  endpoint: string,
): Promise<{ status: "removed" } | { status: "not_found" }> {
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const removed = await tx
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.workerId, workerId), eq(pushSubscriptions.endpoint, endpoint)),
      )
      .returning({ id: pushSubscriptions.id });
    if (removed.length === 0) return { status: "not_found" };
    await recordEvent(tx, {
      actorType: "worker",
      actorId: workerId,
      action: "push.unsubscribed",
      entityType: "push_subscription",
      entityId: removed[0]?.id ?? null,
      data: {},
    });
    return { status: "removed" };
  });
}

// Where to push to for a worker (inside the sender's transaction).
export async function pushTargets(tx: FirmTx, workerId: string): Promise<PushTarget[]> {
  return tx
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.workerId, workerId));
}

// The push service said this subscription no longer exists: forget it.
export async function forgetPushTarget(tx: FirmTx, id: string): Promise<void> {
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
}

// Counts one save or removal by this worker (the auth throttle, LIMITS.pushPerWorker), in its own
// short transaction before the work, so a refused or failed request still counts. Null: within
// the limit.
export async function throttlePushChanges(
  ctx: PortalContext & { secret?: string },
  workerId: string,
): Promise<Throttled | null> {
  return throttle(
    ctx.run ?? withFirm,
    ctx.firm.id,
    [{ limit: LIMITS.pushPerWorker, value: workerId }],
    {
      now: ctx.clock?.now() ?? new Date(),
      secret: ctx.secret ?? appEnv().SESSION_SECRET,
      entityType: "worker",
      entityId: workerId,
    },
  );
}

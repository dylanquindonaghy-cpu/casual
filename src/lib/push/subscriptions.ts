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
// the sender's choosing, which the real sender would then post to). Chrome and Android: Google's;
// Safari and iPhones: Apple's web push host; Firefox: Mozilla's; Edge on Windows: Microsoft's.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^web\.push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]{1,63}\.notify\.windows\.com$/,
];
export const MAX_PHONES_PER_WORKER = 10;

// Only the exact form a browser gives (13.3 guardrails review): https, a plain lower-case host
// (letters, digits, dots and hyphens: no %-escape, no user name, no port), then a path, and nothing
// a URL parser would rewrite. Two parsers must read the same host: this one (WHATWG) and the older
// one web-push connects with, which ends a host at a "%" where this one decodes it: with
// "https://attacker.example%2Epush.apple.com/x" the check saw Apple and web-push would have
// connected to attacker.example. The host also keeps to DNS's lengths (withinDnsLengths): the
// older parser blanks a longer one, and Node would then connect to localhost (13.3 guardrails round
// 2; the push services' own hosts are all short, so this guards the list if it ever grows). Checked
// when a subscription is saved and again before each push.
export function isPushServiceUrl(raw: string): boolean {
  if (!/^https:\/\/[a-z0-9.-]+\//.test(raw)) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname;
    return url.href === raw && withinDnsLengths(host) && PUSH_HOSTS.some((h) => h.test(host));
  } catch {
    return false;
  }
}

// A host name DNS allows: 253 characters at most, each dot-separated part 1 to 63.
export function withinDnsLengths(host: string): boolean {
  return (
    host.length <= 253 && host.split(".").every((part) => part.length >= 1 && part.length <= 63)
  );
}

// A phone's keys as web push needs them: the public key a 65-byte uncompressed P-256 point, the
// auth secret 16 bytes. Anything else could never be pushed to.
const keyBytes = (raw: string, length: number, first?: number) => {
  const bytes = Buffer.from(raw, "base64url");
  return bytes.length === length && (first === undefined || bytes[0] === first);
};

// What the browser's PushSubscription.toJSON() gives, checked.
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048).refine(isPushServiceUrl, "must be a browser push service address"),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z
      .string()
      .regex(/^[A-Za-z0-9_-]{87}=?$/)
      .refine((k) => keyBytes(k, 65, 0x04), "must be the phone's P-256 public key"),
    auth: z
      .string()
      .regex(/^[A-Za-z0-9_-]{22}(==)?$/)
      .refine((k) => keyBytes(k, 16), "must be the phone's 16-byte auth secret"),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SaveResult =
  | { status: "saved" }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterSeconds: number };

// Saved again unchanged (the profile re-checks on load): nothing to do or log.
async function unchanged(tx: FirmTx, workerId: string, input: PushSubscriptionInput) {
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
  return same !== undefined;
}

// `limit` (the route, 13.3): a save that would write counts against the worker's limit first
// (throttlePushChanges); one that changes nothing doesn't count.
export async function savePushSubscription(
  ctx: PortalContext & { secret?: string },
  workerId: string,
  input: PushSubscriptionInput,
  opts: { limit?: boolean } = {},
): Promise<SaveResult> {
  const run = ctx.run ?? withFirm;
  if (opts.limit) {
    const before = await run(ctx.firm.id, async (tx) => {
      const [me] = await tx
        .select({ id: workers.id })
        .from(workers)
        .where(and(eq(workers.id, workerId), eq(workers.status, "active")));
      if (!me) return "not_found" as const;
      return (await unchanged(tx, workerId, input)) ? ("same" as const) : ("write" as const);
    });
    if (before === "not_found") return { status: "not_found" };
    if (before === "same") return { status: "saved" };
    const limited = await throttlePushChanges(ctx, workerId);
    if (limited) return { status: "rate_limited", retryAfterSeconds: limited.retryAfterSeconds };
  }
  return run(ctx.firm.id, async (tx) => {
    const [me] = await tx
      .select({ id: workers.id })
      .from(workers)
      .where(and(eq(workers.id, workerId), eq(workers.status, "active")));
    if (!me) return { status: "not_found" };
    if (await unchanged(tx, workerId, input)) return { status: "saved" };
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

// Where to push to for a worker (read in its own short transaction: src/lib/notify/send.ts).
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

// The push service said this subscription no longer exists: forget it, if it's still the one that
// was pushed to. The push went with no transaction open (14.1), so meanwhile a new login on that
// phone may have taken the row over with new keys: then it's kept. True if it was forgotten.
export async function forgetPushTarget(tx: FirmTx, target: PushTarget): Promise<boolean> {
  const gone = await tx
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.id, target.id),
        eq(pushSubscriptions.endpoint, target.endpoint),
        eq(pushSubscriptions.p256dh, target.p256dh),
        eq(pushSubscriptions.auth, target.auth),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return gone.length > 0;
}

// Counts one save that writes, by this worker (the auth throttle, LIMITS.pushPerWorker), in its own
// short transaction before the work, so a refused or failed save still counts. Removing a phone is
// never limited: turning notifications off, or logging out, must always work. Null: within the
// limit.
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

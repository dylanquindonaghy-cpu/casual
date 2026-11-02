import { and, eq, sql } from "drizzle-orm";
import { LIMITS, throttle, type Throttled } from "../auth/throttle";
import { officePushSubscriptions } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent } from "../events/record";
import { appEnv } from "../env";
import { officeUserMay, parts, type OfficeContext } from "../office/office-context";
import type { PushSubscriptionInput, PushTarget } from "./subscriptions";

// An office user's browsers with notifications on (Phase 26.4; Updates' "Tell me about", upd-4):
// the address a browser gives, saved and removed by the logged-in admin or resourcer only, read by
// the office alert senders (src/lib/office/alerts.ts). As a casual's (src/lib/push/subscriptions.ts):
// one row per browser (a new login on a shared computer takes it over), a few per person, each
// save that writes logged and counted against the person's limit, removing never limited.

export const MAX_BROWSERS_PER_OFFICE_USER = 5;

export type OfficeSaveResult =
  | { status: "saved" }
  | { status: "not_allowed" }
  | { status: "rate_limited"; retryAfterSeconds: number };

async function unchanged(tx: FirmTx, officeUserId: string, input: PushSubscriptionInput) {
  const [same] = await tx
    .select({ id: officePushSubscriptions.id })
    .from(officePushSubscriptions)
    .where(
      and(
        eq(officePushSubscriptions.endpoint, input.endpoint),
        eq(officePushSubscriptions.officeUserId, officeUserId),
        eq(officePushSubscriptions.p256dh, input.keys.p256dh),
        eq(officePushSubscriptions.auth, input.keys.auth),
      ),
    );
  return same !== undefined;
}

// Counts one save that writes (its own short transaction first, so a refused save still counts).
async function throttleOfficePush(
  ctx: OfficeContext & { secret?: string },
): Promise<Throttled | null> {
  return throttle(
    parts(ctx).run,
    ctx.firm.id,
    [{ limit: LIMITS.pushPerOfficeUser, value: ctx.officeUserId }],
    {
      now: ctx.clock?.now() ?? new Date(),
      secret: ctx.secret ?? appEnv().SESSION_SECRET,
      entityType: "office_user",
      entityId: ctx.officeUserId,
    },
  );
}

export async function saveOfficePushSubscription(
  ctx: OfficeContext & { secret?: string },
  input: PushSubscriptionInput,
  opts: { limit?: boolean } = {},
): Promise<OfficeSaveResult> {
  const run = parts(ctx).run;
  if (opts.limit) {
    const before = await run(ctx.firm.id, async (tx) => {
      if (!(await officeUserMay(tx, ctx.officeUserId, "today"))) return "not_allowed" as const;
      return (await unchanged(tx, ctx.officeUserId, input))
        ? ("same" as const)
        : ("write" as const);
    });
    if (before === "not_allowed") return { status: "not_allowed" };
    if (before === "same") return { status: "saved" };
    const limited = await throttleOfficePush(ctx);
    if (limited) return { status: "rate_limited", retryAfterSeconds: limited.retryAfterSeconds };
  }
  return run(ctx.firm.id, async (tx) => {
    if (!(await officeUserMay(tx, ctx.officeUserId, "today"))) return { status: "not_allowed" };
    if (await unchanged(tx, ctx.officeUserId, input)) return { status: "saved" };
    const [row] = await tx
      .insert(officePushSubscriptions)
      .values({
        firmId: ctx.firm.id,
        officeUserId: ctx.officeUserId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      })
      .onConflictDoUpdate({
        target: [officePushSubscriptions.firmId, officePushSubscriptions.endpoint],
        set: {
          officeUserId: sql`excluded.office_user_id`,
          p256dh: sql`excluded.p256dh`,
          auth: sql`excluded.auth`,
        },
      })
      .returning({ id: officePushSubscriptions.id });
    // At most MAX_BROWSERS_PER_OFFICE_USER: the oldest go.
    await tx.execute(sql`
      delete from office_push_subscriptions where id in (
        select id from office_push_subscriptions where office_user_id = ${ctx.officeUserId}
         order by created_at desc, id desc offset ${MAX_BROWSERS_PER_OFFICE_USER})
    `);
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "office_push.subscribed",
      entityType: "office_push_subscription",
      entityId: row?.id ?? null,
      data: {},
    });
    return { status: "saved" };
  });
}

// "Turn off here", or logging out: this browser stops getting the person's notifications. Works for
// any office role (someone whose access changed can still clear their browser), never limited.
export async function removeOfficePushSubscription(
  ctx: OfficeContext,
  endpoint: string,
): Promise<{ status: "removed" } | { status: "not_found" }> {
  return parts(ctx).run(ctx.firm.id, async (tx) => {
    const removed = await tx
      .delete(officePushSubscriptions)
      .where(
        and(
          eq(officePushSubscriptions.officeUserId, ctx.officeUserId),
          eq(officePushSubscriptions.endpoint, endpoint),
        ),
      )
      .returning({ id: officePushSubscriptions.id });
    if (removed.length === 0) return { status: "not_found" };
    await recordEvent(tx, {
      actorType: "office",
      actorId: ctx.officeUserId,
      action: "office_push.unsubscribed",
      entityType: "office_push_subscription",
      entityId: removed[0]?.id ?? null,
      data: {},
    });
    return { status: "removed" };
  });
}

// Where to push to for an office user (read in its own short transaction: src/lib/notify/send.ts).
export async function officePushTargets(tx: FirmTx, officeUserId: string): Promise<PushTarget[]> {
  return tx
    .select({
      id: officePushSubscriptions.id,
      endpoint: officePushSubscriptions.endpoint,
      p256dh: officePushSubscriptions.p256dh,
      auth: officePushSubscriptions.auth,
    })
    .from(officePushSubscriptions)
    .where(eq(officePushSubscriptions.officeUserId, officeUserId));
}

// The push service said it's gone: forget it, if it's still the one that was pushed to.
export async function forgetOfficePushTarget(tx: FirmTx, target: PushTarget): Promise<boolean> {
  const gone = await tx
    .delete(officePushSubscriptions)
    .where(
      and(
        eq(officePushSubscriptions.id, target.id),
        eq(officePushSubscriptions.endpoint, target.endpoint),
        eq(officePushSubscriptions.p256dh, target.p256dh),
        eq(officePushSubscriptions.auth, target.auth),
      ),
    )
    .returning({ id: officePushSubscriptions.id });
  return gone.length > 0;
}

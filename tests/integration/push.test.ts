import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { pushToWorker } from "@/lib/notify/send";
import {
  pushSubscriptionSchema,
  pushTargets,
  removePushSubscription,
  savePushSubscription,
  throttlePushChanges,
} from "@/lib/push/subscriptions";
import type { PushSendResult, PushTransport } from "@/lib/push/transport";
import { bookingFirm, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// Web push subscriptions on the real database, as the app role: saved and removed by the worker,
// moved to a new login on the same phone, never another firm's, never logged by address.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const ctxFor = (f: BookingFirm) => ({ firm: { id: f.firmId }, run: withFirm });
const subscription = (endpoint = "https://fcm.googleapis.com/fcm/send/phone-1") =>
  pushSubscriptionSchema.parse({
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  });
const rowsFor = async (firmId: string) =>
  (
    await su.query(
      "select worker_id::text, endpoint from push_subscriptions where firm_id = $1 order by endpoint",
      [firmId],
    )
  ).rows;

describe("push subscriptions", () => {
  it("a worker saves this phone's subscription, and removes it", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    expect(await savePushSubscription(ctxFor(f), sam, subscription())).toEqual({ status: "saved" });
    expect(await rowsFor(f.firmId)).toEqual([
      { worker_id: sam, endpoint: "https://fcm.googleapis.com/fcm/send/phone-1" },
    ]);
    const targets = await withFirm(f.firmId, (tx) => pushTargets(tx, sam));
    expect(targets.map((t) => t.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/phone-1"]);
    expect(
      await removePushSubscription(ctxFor(f), sam, "https://fcm.googleapis.com/fcm/send/phone-1"),
    ).toEqual({ status: "removed" });
    expect(await rowsFor(f.firmId)).toEqual([]);
    // Logged, but never by address.
    const { rows } = await su.query(
      "select action, data from events where firm_id = $1 and action like 'push.%' order by id",
      [f.firmId],
    );
    expect(rows).toEqual([
      { action: "push.subscribed", data: {} },
      { action: "push.unsubscribed", data: {} },
    ]);
  });

  it("a new login on the same phone takes the subscription over", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const jo = await f.worker({ first: "Jo" });
    await savePushSubscription(ctxFor(f), sam, subscription());
    await savePushSubscription(ctxFor(f), jo, subscription());
    expect(await rowsFor(f.firmId)).toEqual([
      { worker_id: jo, endpoint: "https://fcm.googleapis.com/fcm/send/phone-1" },
    ]);
    // Sam can't remove Jo's.
    expect(
      await removePushSubscription(ctxFor(f), sam, "https://fcm.googleapis.com/fcm/send/phone-1"),
    ).toEqual({ status: "not_found" });
  });

  it("saving the same subscription again changes and logs nothing; at most 10 phones each", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    await savePushSubscription(ctxFor(f), sam, subscription());
    await savePushSubscription(ctxFor(f), sam, subscription());
    const { rows: logged } = await su.query(
      "select count(*)::int as n from events where firm_id = $1 and action = 'push.subscribed'",
      [f.firmId],
    );
    expect(logged).toEqual([{ n: 1 }]);
    for (let i = 0; i < 11; i++) {
      await savePushSubscription(
        ctxFor(f),
        sam,
        subscription(`https://fcm.googleapis.com/fcm/send/p${i}`),
      );
    }
    const kept = await rowsFor(f.firmId);
    expect(kept).toHaveLength(10);
    // The oldest went.
    expect(kept.map((r) => r.endpoint)).not.toContain(
      "https://fcm.googleapis.com/fcm/send/phone-1",
    );
  });

  it("not for an inactive worker, or another firm's", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    const gone = await f.worker({ first: "Ina", status: "inactive" });
    const kit = await other.worker({ first: "Kit" });
    expect(await savePushSubscription(ctxFor(f), gone, subscription())).toEqual({
      status: "not_found",
    });
    expect(await savePushSubscription(ctxFor(f), kit, subscription())).toEqual({
      status: "not_found",
    });
    expect(await rowsFor(f.firmId)).toEqual([]);
    expect(await rowsFor(other.firmId)).toEqual([]);
  });

  it("only takes https push addresses with proper keys", () => {
    const bad = (o: Record<string, unknown>) =>
      pushSubscriptionSchema.safeParse({
        endpoint: "https://fcm.googleapis.com/fcm/send/x",
        keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7K" },
        ...o,
      }).success;
    expect(bad({})).toBe(true);
    expect(bad({ endpoint: "http://fcm.googleapis.com/fcm/send/x" })).toBe(false);
    // Only the browser makers' push services: never a host of someone's choosing.
    expect(bad({ endpoint: "https://localhost/x" })).toBe(false);
    expect(bad({ endpoint: "https://10.0.0.5/x" })).toBe(false);
    expect(bad({ endpoint: "https://fcm.googleapis.com.evil.example/x" })).toBe(false);
    expect(bad({ endpoint: "https://fcm.googleapis.com:8443/x" })).toBe(false);
    expect(bad({ endpoint: "https://web.push.apple.com/abc" })).toBe(true);
    expect(bad({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc" })).toBe(true);
    expect(bad({ endpoint: "https://wns2-db5p.notify.windows.com/w/?token=abc" })).toBe(true);
    expect(bad({ endpoint: "not a url" })).toBe(false);
    expect(bad({ keys: { p256dh: "short", auth: "tBHItJI5svbpez7K" } })).toBe(false);
    expect(bad({ keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "a b" } })).toBe(
      false,
    );
  });

  it("the database refuses a push address that isn't https", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    await expect(
      su.query(
        "insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth) values ($1, $2, 'http://x', 'k', 'a')",
        [f.firmId, sam],
      ),
    ).rejects.toThrow(/push_subscriptions_endpoint_https/);
  });
});

describe("saving and removing phones is rate-limited (13.3)", () => {
  it("10 saves or removals per worker every 15 minutes; the 11th is refused, logged once", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const ann = await f.worker({ first: "Ann" });
    const at = (iso: string) => ({ ...ctxFor(f), clock: { now: () => new Date(iso) } });
    for (let n = 1; n <= 10; n++)
      expect(await throttlePushChanges(at("2026-10-16T10:01:00Z"), sam), `try ${n}`).toBeNull();
    const refused = await throttlePushChanges(at("2026-10-16T10:05:00Z"), sam);
    expect(refused).toMatchObject({ limit: "push:worker", retryAfterSeconds: 600 });
    expect(await throttlePushChanges(at("2026-10-16T10:06:00Z"), sam)).not.toBeNull();
    // Another worker has their own count; the next window starts afresh.
    expect(await throttlePushChanges(at("2026-10-16T10:06:00Z"), ann)).toBeNull();
    expect(await throttlePushChanges(at("2026-10-16T10:15:00Z"), sam)).toBeNull();
    // Reaching it is logged once, with the worker's id (never a number or an address).
    const { rows } = await su.query(
      `select entity_type, entity_id::text, data from events
        where firm_id = $1 and action = 'auth.rate_limited' order by id`,
      [f.firmId],
    );
    expect(rows).toEqual([
      { entity_type: "worker", entity_id: sam, data: { limit: "push:worker" } },
    ]);
  });
});

describe("a push that fails this time (13.3)", () => {
  it("keeps the phone and isn't counted; a phone that's gone is forgotten", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    for (const phone of ["phone-ok", "phone-down", "phone-gone"])
      await savePushSubscription(
        ctxFor(f),
        sam,
        subscription(`https://fcm.googleapis.com/fcm/send/${phone}`),
      );
    const answers: Record<string, PushSendResult> = {
      "phone-ok": { status: "sent" },
      "phone-down": { status: "failed", code: "http_500" },
      "phone-gone": { status: "gone" },
    };
    const push: PushTransport = {
      name: "fake",
      async send(target) {
        return answers[target.endpoint.split("/").pop() ?? ""] ?? { status: "skipped" };
      },
    };
    const pushes = await withFirm(f.firmId, (tx) =>
      pushToWorker(tx, { push }, sam, { title: "t", body: "b", url: "/" }),
    );
    expect(pushes).toBe(1);
    expect((await rowsFor(f.firmId)).map((r: { endpoint: string }) => r.endpoint)).toEqual([
      "https://fcm.googleapis.com/fcm/send/phone-down",
      "https://fcm.googleapis.com/fcm/send/phone-ok",
    ]);
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'push.forgotten'",
      [f.firmId],
    );
    expect(rows).toEqual([{ data: { reason: "gone" } }]);
  });
});

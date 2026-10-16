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
import webpush from "web-push";
import { createWebPushTransport, type WebPushSend } from "@/lib/push/transport";
import { bookingFirm, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";
import { keptLog } from "../helpers/planner-api";

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
// A phone's keys as a browser gives them (a P-256 public key, a 16-byte auth secret): made up here.
const PHONE_KEY =
  "BMjKn90ImxFVU1zSHNEtruyhx0HMcUneBp1ALg-PY6_yI87c_6dAPQLNPXaYzumNeXGAWfJ_VLuP-VKZbmUba3Q";
const PHONE_AUTH = "6rFtYx17VYjqn0un5estNA";
const subscription = (endpoint = "https://fcm.googleapis.com/fcm/send/phone-1") =>
  pushSubscriptionSchema.parse({
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: PHONE_KEY,
      auth: PHONE_AUTH,
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
        keys: { p256dh: PHONE_KEY, auth: PHONE_AUTH },
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
    // Only the exact form a browser gives (13.3 guardrails review): a %-escape in the host read one
    // way by this check and another by web-push, which would have connected to attacker.example.
    for (const endpoint of [
      "https://attacker.example%2Epush.apple.com/x",
      "https://attacker.example%2Ewns2-db5p.notify.windows.com/x",
      "https://FCM.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com:443/fcm/send/x",
      "https://fcm.googleapis.com/fcm/../send/x",
      "https://user@fcm.googleapis.com/fcm/send/x",
      "https://api.push.apple.com/x", // Apple's web push host is web.push.apple.com
    ])
      expect(bad({ endpoint }), endpoint).toBe(false);
    // Keys web push can use: a 65-byte P-256 point and a 16-byte secret.
    expect(bad({ keys: { p256dh: "short", auth: PHONE_AUTH } })).toBe(false);
    expect(bad({ keys: { p256dh: PHONE_KEY.slice(0, 64), auth: PHONE_AUTH } })).toBe(false);
    expect(bad({ keys: { p256dh: `A${PHONE_KEY.slice(1)}`, auth: PHONE_AUTH } })).toBe(false);
    expect(bad({ keys: { p256dh: PHONE_KEY, auth: "a b" } })).toBe(false);
    expect(bad({ keys: { p256dh: PHONE_KEY, auth: PHONE_AUTH.slice(0, 20) } })).toBe(false);
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

describe("saving phones is rate-limited (13.3)", () => {
  it("10 saves that write per worker every 15 minutes; the 11th is refused, logged once; re-saving and removing never are", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const ann = await f.worker({ first: "Ann" });
    const at = (iso: string) => ({ ...ctxFor(f), clock: { now: () => new Date(iso) } });
    const phone = (n: number) => subscription(`https://fcm.googleapis.com/fcm/send/sam-${n}`);
    const save = (iso: string, who: string, n: number) =>
      savePushSubscription(at(iso), who, phone(n), { limit: true });
    for (let n = 1; n <= 10; n++)
      expect(await save("2026-10-16T10:01:00Z", sam, n), `save ${n}`).toEqual({ status: "saved" });
    expect(await save("2026-10-16T10:05:00Z", sam, 11)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 600,
    });
    expect((await rowsFor(f.firmId)).length).toBe(10);
    // The profile re-saving a phone it already has writes nothing, so it's never refused.
    expect(await save("2026-10-16T10:06:00Z", sam, 3)).toEqual({ status: "saved" });
    // Nor is turning notifications off.
    expect(
      await removePushSubscription(at("2026-10-16T10:06:00Z"), sam, phone(4).endpoint),
    ).toEqual({ status: "removed" });
    // Another worker has their own count; the next window starts afresh.
    expect(await save("2026-10-16T10:06:00Z", ann, 20)).toEqual({ status: "saved" });
    expect(await save("2026-10-16T10:15:00Z", sam, 11)).toEqual({ status: "saved" });
    // Reaching it is logged once, with the worker's id (never a number or an address).
    const { rows } = await su.query(
      `select entity_type, entity_id::text, data from events
        where firm_id = $1 and action = 'auth.rate_limited' order by id`,
      [f.firmId],
    );
    expect(rows).toEqual([
      { entity_type: "worker", entity_id: sam, data: { limit: "push:worker" } },
    ]);
    // The limit itself, counted directly.
    const fresh = await f.worker({ first: "Cal" });
    for (let n = 1; n <= 10; n++)
      expect(await throttlePushChanges(at("2026-10-16T11:01:00Z"), fresh)).toBeNull();
    expect(await throttlePushChanges(at("2026-10-16T11:01:00Z"), fresh)).toMatchObject({
      limit: "push:worker",
    });
  });
});

describe("pushing to a worker's phones (13.3)", () => {
  it("all at once; a failed push keeps the phone, logged by host and code; gone or not a push service: forgotten", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    for (const phone of ["phone-ok", "phone-down", "phone-gone", "phone-slow"])
      await savePushSubscription(
        ctxFor(f),
        sam,
        subscription(`https://fcm.googleapis.com/fcm/send/${phone}`),
      );
    // Saved before the address check existed: a host that reads one way here and another to
    // web-push. The database only asks for https.
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://attacker.example%2Epush.apple.com/x', $3, $4)`,
      [f.firmId, sam, PHONE_KEY, PHONE_AUTH],
    );
    // The real sender, with a stand-in for the push services (nothing leaves the test).
    const called: string[] = [];
    const send: WebPushSend = async (subscription) => {
      const phone = subscription.endpoint.split("/").pop() ?? "";
      called.push(phone);
      await new Promise((r) => setTimeout(r, 200));
      if (phone === "phone-down")
        throw new webpush.WebPushError("refused", 500, {}, "", subscription.endpoint);
      if (phone === "phone-gone")
        throw new webpush.WebPushError("gone", 410, {}, "", subscription.endpoint);
      return { statusCode: 201 };
    };
    const vapid = webpush.generateVAPIDKeys();
    const push = createWebPushTransport(
      {
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
        subject: "mailto:ops@example.com",
      },
      { send },
    );
    const kept = keptLog();
    const started = Date.now();
    const pushes = await withFirm(f.firmId, (tx) =>
      pushToWorker(tx, { push, logger: kept.logger }, sam, { title: "t", body: "b", url: "/" }),
    );
    // Four phones at 200 ms each, at once.
    expect(Date.now() - started).toBeLessThan(700);
    expect(pushes).toBe(2);
    // The made-up host was never contacted.
    expect(called.sort()).toEqual(["phone-down", "phone-gone", "phone-ok", "phone-slow"]);
    expect((await rowsFor(f.firmId)).map((r: { endpoint: string }) => r.endpoint)).toEqual([
      "https://fcm.googleapis.com/fcm/send/phone-down",
      "https://fcm.googleapis.com/fcm/send/phone-ok",
      "https://fcm.googleapis.com/fcm/send/phone-slow",
    ]);
    const { rows } = await su.query(
      "select data from events where firm_id = $1 and action = 'push.forgotten' order by data ->> 'reason'",
      [f.firmId],
    );
    expect(rows).toEqual([
      { data: { reason: "gone" } },
      { data: { reason: "not_a_push_service" } },
    ]);
    // The failed one: the firm, the push service's host and a code; never the phone's address.
    expect(kept.lines).toEqual([
      {
        level: "warn",
        msg: "push not delivered",
        fields: { firmId: f.firmId, host: "fcm.googleapis.com", code: "http_500" },
      },
    ]);
    expect(JSON.stringify(kept.lines)).not.toContain("phone-down");
  });
});

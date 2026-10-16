import { createECDH, randomBytes } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { createRequire } from "node:module";
import webpush from "web-push";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorkerEnv } from "@/lib/env";
import {
  createWebPushTransport,
  getPushTransport,
  PUSH_TIMEOUT_MS,
  PUSH_TTL_SECONDS,
  type WebPushSend,
} from "@/lib/push/transport";

// The real web push sender (13.3), with no push service: a stand-in takes what web-push would send,
// so nothing leaves the test. web-push itself builds the encrypted, signed request from it, and the
// test then decrypts it with the phone's own keys, as the phone would: the service worker
// (public/sw.js) gets the title, the words and the link. A push service that never answers is a
// local socket that accepts and stays silent.

const vapid = webpush.generateVAPIDKeys();
const keys = {
  publicKey: vapid.publicKey,
  privateKey: vapid.privateKey,
  subject: "mailto:ops@example.com",
};

// A phone's subscription, with a real key pair (the phone keeps the private half).
function phone() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    target: {
      id: "sub-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/test-phone",
      p256dh: ecdh.getPublicKey("base64url"),
      auth: auth.toString("base64url"),
    },
  };
}

const payload = {
  title: "Urgent shift",
  body: "Steward needed at Riverside Arena Sat 08:00.",
  url: "/offers/abc",
};

// http_ece is web-push's own encryption library: the phone's side of it decrypts.
const ece = createRequire(import.meta.url)("http_ece") as {
  decrypt(
    body: Buffer,
    params: { version: "aes128gcm"; privateKey: ReturnType<typeof createECDH>; authSecret: Buffer },
  ): Buffer;
};

// server.close() waits for its connections to end, and the silent server's side of one never hears
// the sender give up: its sockets are destroyed here.
let servers: Server[] = [];
let sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
  sockets = [];
});

describe("the web push sender (PUSH_TRANSPORT=webpush)", () => {
  it("sends the push to the phone's push service, signed with our keys, and the phone can read it", async () => {
    const p = phone();
    const sent: { endpoint: string; body: Buffer; headers: Record<string, string> }[] = [];
    // What web-push would post: built by web-push itself, then kept here instead of sent.
    const standIn: WebPushSend = async (subscription, body, options) => {
      const request = webpush.generateRequestDetails(subscription, body, options);
      sent.push({
        endpoint: request.endpoint,
        body: request.body as Buffer,
        headers: request.headers as Record<string, string>,
      });
      return { statusCode: 201 };
    };
    const push = createWebPushTransport(keys, standIn);
    expect(push.name).toBe("webpush");
    expect(await push.send(p.target, payload)).toEqual({ status: "sent" });

    expect(sent).toHaveLength(1);
    const request = sent[0];
    expect(request?.endpoint).toBe(p.target.endpoint);
    // Signed with our VAPID key (the push service checks it against the key the phone subscribed
    // with), kept 12 hours at most, at normal urgency, encrypted for this phone only.
    expect(request?.headers.Authorization).toMatch(new RegExp(`^vapid t=.+, k=${keys.publicKey}$`));
    expect(request?.headers.TTL).toBe(PUSH_TTL_SECONDS);
    expect(request?.headers.Urgency).toBe("normal");
    expect(request?.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(request?.body.toString("utf8")).not.toContain("Riverside");
    // The phone decrypts it: the JSON the service worker's push handler reads.
    const read = JSON.parse(
      ece
        .decrypt(request?.body ?? Buffer.alloc(0), {
          version: "aes128gcm",
          privateKey: p.ecdh,
          authSecret: p.auth,
        })
        .toString("utf8"),
    ) as unknown;
    expect(read).toEqual(payload);
  });

  it("404 and 410: the phone is gone; any other refusal or a network error: failed this time, never thrown", async () => {
    const p = phone();
    const failing =
      (error: unknown): WebPushSend =>
      async () => {
        throw error;
      };
    const send = (error: unknown) =>
      createWebPushTransport(keys, failing(error)).send(p.target, payload);
    const refused = (statusCode: number) =>
      new webpush.WebPushError(
        "Received unexpected response code",
        statusCode,
        {},
        "",
        p.target.endpoint,
      );
    expect(await send(refused(410))).toEqual({ status: "gone" });
    expect(await send(refused(404))).toEqual({ status: "gone" });
    // Our keys (403), the push service's own trouble (500), too many (429): kept, a code only.
    expect(await send(refused(403))).toEqual({ status: "failed", code: "http_403" });
    expect(await send(refused(500))).toEqual({ status: "failed", code: "http_500" });
    expect(await send(refused(429))).toEqual({ status: "failed", code: "http_429" });
    expect(await send(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toEqual(
      {
        status: "failed",
        code: "ECONNRESET",
      },
    );
    expect(await send(new TypeError("odd"))).toEqual({ status: "failed", code: "TypeError" });
    // Nothing of the address or the message in a code.
    const odd = new Error("x");
    odd.name = "https://fcm.googleapis.com/fcm/send/test-phone";
    expect(await send(odd)).toEqual({ status: "failed", code: "unknown" });
  });

  it("a push service that never answers is given up on, as a failed push", async () => {
    // web-push's own sender against a socket on this machine that accepts and says nothing.
    const silent = createServer((socket) => void sockets.push(socket));
    servers.push(silent);
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", () => r()));
    const address = silent.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const p = phone();
    const push = createWebPushTransport(keys, webpush.sendNotification, 300);
    const started = Date.now();
    expect(
      await push.send(
        { ...p.target, endpoint: `https://127.0.0.1:${port}/push/test-phone` },
        payload,
      ),
    ).toEqual({ status: "failed", code: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
    // The real wait is a few seconds: a slow push service never holds a message's record up long.
    expect(PUSH_TIMEOUT_MS).toBe(5_000);
  });

  it("the settings: webpush needs the three VAPID keys, and is refused in tests", () => {
    const worker = {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://shiftdesk_app:x@localhost:5432/shiftdesk",
      DATABASE_JOBS_URL: "postgres://shiftdesk_jobs:x@localhost:5432/shiftdesk",
      SESSION_SECRET: "a-real-looking-secret-of-32-characters-or-more",
      APP_BASE_DOMAIN: "localhost:3000",
      PUSH_TRANSPORT: "webpush",
    };
    const all = {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: keys.subject,
    };
    expect(() => parseWorkerEnv(worker)).toThrow(
      /VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT/,
    );
    expect(() => parseWorkerEnv({ ...worker, ...all, VAPID_SUBJECT: "" })).toThrow(
      /VAPID_PRIVATE_KEY/,
    );
    expect(() => parseWorkerEnv({ ...worker, ...all, VAPID_PRIVATE_KEY: "not-a-key" })).toThrow(
      /base64url VAPID private key/,
    );
    expect(() => parseWorkerEnv({ ...worker, ...all, VAPID_SUBJECT: "ops@example.com" })).toThrow(
      /mailto: or https:/,
    );
    const env = parseWorkerEnv({ ...worker, ...all });
    expect(env.PUSH_TRANSPORT).toBe("webpush");
    expect(getPushTransport(env).name).toBe("webpush");
    // Tests never reach a push service, whatever the keys.
    expect(() => parseWorkerEnv({ ...worker, ...all, NODE_ENV: "test" })).toThrow(
      /tests never reach a push service/,
    );
    // The test setup itself keeps it off (tests/setup/env.ts).
    expect(process.env.PUSH_TRANSPORT).toBe("console");
    expect(process.env.VAPID_PRIVATE_KEY).toBe("");
  });
});

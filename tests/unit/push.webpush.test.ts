import { execFileSync } from "node:child_process";
import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Agent, createServer, type RequestOptions, type Server } from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { connect } from "node:tls";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWorkerEnv } from "@/lib/env";
import {
  createWebPushTransport,
  getPushTransport,
  PUSH_TIMEOUT_MS,
  PUSH_TTL_SECONDS,
  type WebPushSend,
} from "@/lib/push/transport";

// The real web push sender (13.3) against a fake push service: web-push's own sender posts over
// real HTTPS to a server on this machine. The connection is pointed there by the agent the test
// gives the sender, so the address stays a real push service's (the sender refuses anything else)
// and nothing ever leaves the test. The fake service checks what a real one checks (the VAPID
// signature against our public key, its audience), decrypts the push with the phone's own keys as
// the phone would, and answers by the address's last part: ok 201, gone 410, notfound 404,
// forbidden 403, drip (a 201 that never finishes). The certificate is made for the test (openssl,
// as the browser tests need too).

const vapid = webpush.generateVAPIDKeys();
const keys = {
  publicKey: vapid.publicKey,
  privateKey: vapid.privateKey,
  subject: "mailto:ops@example.com",
};
const payload = {
  title: "Urgent shift",
  body: "Steward needed at Riverside Arena Sat 08:00.",
  url: "/offers/abc",
};

// A phone: a real key pair (it keeps the private half) and auth secret.
function phone(last: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    target: {
      id: `sub-${last}`,
      endpoint: `https://fcm.googleapis.com/fcm/send/${last}`,
      p256dh: ecdh.getPublicKey("base64url"),
      auth: auth.toString("base64url"),
    },
  };
}

// http_ece is web-push's own encryption library: the phone's side of it decrypts.
const ece = createRequire(import.meta.url)("http_ece") as {
  decrypt(
    body: Buffer,
    params: { version: "aes128gcm"; privateKey: ReturnType<typeof createECDH>; authSecret: Buffer },
  ): Buffer;
};
const readBy = (p: ReturnType<typeof phone>, body: Buffer | undefined): unknown =>
  JSON.parse(
    ece
      .decrypt(body ?? Buffer.alloc(0), {
        version: "aes128gcm",
        privateKey: p.ecdh,
        authSecret: p.auth,
      })
      .toString("utf8"),
  );

// What the fake push service received.
interface Received {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
let dir = "";
let cert = "";
let server: Server;
let port = 0;
const received: Received[] = [];
const drips: NodeJS.Timeout[] = [];
// When each trickling answer's connection closed (the sender's deadline should close it).
const dripsClosedAt: number[] = [];
// The host and TLS name each connection was made for, as web-push worked them out.
const aimedAt: { host: string | undefined; servername: string | undefined }[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fake-push-"));
  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"],
      ...["-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1"],
      ...["-subj", "/CN=fcm.googleapis.com", "-addext", "subjectAltName=DNS:fcm.googleapis.com"],
    ],
    { stdio: "ignore" },
  );
  cert = readFileSync(join(dir, "cert.pem"), "utf8");
  server = createServer({ key: readFileSync(join(dir, "key.pem")), cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = req.url ?? "";
      received.push({ path, headers: req.headers, body: Buffer.concat(chunks) });
      const last = path.split("/").pop() ?? "";
      if (last === "drip") {
        res.writeHead(201);
        const drip = setInterval(() => res.write(" "), 100);
        drips.push(drip);
        res.on("close", () => {
          clearInterval(drip);
          dripsClosedAt.push(Date.now());
        });
        return;
      }
      const statuses: Record<string, number> = {
        ok: 201,
        gone: 410,
        notfound: 404,
        forbidden: 403,
      };
      res.writeHead(statuses[last] ?? 500).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
});
afterAll(async () => {
  for (const drip of drips) clearInterval(drip);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

// Every connection the sender makes goes to the fake service, checked against its certificate,
// and the host web-push meant to reach is kept (it must be the push service's own).
class ToFakePushService extends Agent {
  override createConnection(
    options: RequestOptions & { servername?: string },
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex {
    aimedAt.push({ host: options.host ?? undefined, servername: options.servername });
    const socket = connect({ host: "127.0.0.1", port, ca: cert, servername: "fcm.googleapis.com" });
    if (callback) socket.once("secureConnect", () => callback(null, socket));
    return socket;
  }
}
const sender = (o: { timeoutMs?: number; send?: WebPushSend } = {}) =>
  createWebPushTransport(keys, {
    agentFor: () => new ToFakePushService({ keepAlive: false }),
    ...o,
  });

// The VAPID signature as a push service checks it: an ES256 JWT, verified with the key it names.
function vapidOf(r: Received | undefined, publicKey = keys.publicKey) {
  const m = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(String(r?.headers.authorization ?? ""));
  const [head = "", claims = "", signature = ""] = (m?.[1] ?? "").split(".");
  const point = Buffer.from(publicKey, "base64url");
  const key = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
  return {
    k: m?.[2],
    signed: verify(
      "sha256",
      Buffer.from(`${head}.${claims}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    claims: JSON.parse(Buffer.from(claims, "base64url").toString("utf8") || "{}") as Record<
      string,
      unknown
    >,
  };
}
const lastTo = (path: string) => received.filter((r) => r.path === path).at(-1);

describe("the web push sender (PUSH_TRANSPORT=webpush) against a fake push service", () => {
  it("posts the push to the phone's push service, signed with our keys, readable by that phone only", async () => {
    const p = phone("ok");
    const before = aimedAt.length;
    expect(await sender().send(p.target, payload)).toEqual({ status: "sent" });
    const r = lastTo("/fcm/send/ok");
    expect(r).toBeDefined();
    // web-push aimed at the push service named in the address, nowhere else.
    expect(aimedAt.slice(before)).toEqual([
      { host: "fcm.googleapis.com", servername: "fcm.googleapis.com" },
    ]);
    // Signed with our VAPID key, for this push service, for a day at most (what the service checks).
    const v = vapidOf(r);
    expect(v.k).toBe(keys.publicKey);
    expect(v.signed).toBe(true);
    expect(vapidOf(r, webpush.generateVAPIDKeys().publicKey).signed).toBe(false);
    expect(v.claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: keys.subject });
    expect(Number(v.claims.exp) * 1000 - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    // Kept 12 hours at most, normal urgency, encrypted.
    expect(r?.headers.ttl).toBe(String(PUSH_TTL_SECONDS));
    expect(r?.headers.urgency).toBe("normal");
    expect(r?.headers["content-encoding"]).toBe("aes128gcm");
    expect(r?.body.toString("utf8")).not.toContain("Riverside");
    // The phone decrypts it: exactly what the service worker's push handler reads.
    expect(readBy(p, r?.body)).toEqual(payload);
  });

  it("an urgent one goes at high urgency; one with `until` isn't kept past it (never shown to the phone)", async () => {
    const p = phone("ok");
    const until = new Date(Date.now() + 10 * 60 * 1000);
    await sender().send(p.target, { ...payload, urgent: true, until });
    const r = lastTo("/fcm/send/ok");
    expect(r?.headers.urgency).toBe("high");
    expect(Number(r?.headers.ttl)).toBeGreaterThan(590);
    expect(Number(r?.headers.ttl)).toBeLessThanOrEqual(600);
    expect(readBy(p, r?.body)).toEqual(payload);
    // A shift that has already started: not kept at all.
    await sender().send(p.target, { ...payload, until: new Date(Date.now() - 1000) });
    expect(lastTo("/fcm/send/ok")?.headers.ttl).toBe("0");
  });

  it("410 and 404: the phone is gone; 403 (our keys): failed this time, kept", async () => {
    expect(await sender().send(phone("gone").target, payload)).toEqual({ status: "gone" });
    expect(await sender().send(phone("notfound").target, payload)).toEqual({ status: "gone" });
    expect(await sender().send(phone("forbidden").target, payload)).toEqual({
      status: "failed",
      code: "http_403",
    });
  });

  it("a push service that never finishes is cut off at the deadline, connection closed, even while it trickles", async () => {
    const started = Date.now();
    const closedBefore = dripsClosedAt.length;
    expect(await sender({ timeoutMs: 500 }).send(phone("drip").target, payload)).toEqual({
      status: "failed",
      code: "timeout",
    });
    const gaveUp = Date.now();
    expect(gaveUp - started).toBeLessThan(2_000);
    expect(lastTo("/fcm/send/drip")).toBeDefined();
    // The sender closed its connection: the fake service sees it go within a moment.
    for (let n = 0; n < 20 && dripsClosedAt.length === closedBefore; n++)
      await new Promise((r) => setTimeout(r, 50));
    expect(dripsClosedAt.length).toBe(closedBefore + 1);
    expect((dripsClosedAt.at(-1) ?? Infinity) - gaveUp).toBeLessThan(1_000);
    expect(PUSH_TIMEOUT_MS).toBe(5_000);
  });

  it("an address that isn't a push service's, in the form a browser gives, is never contacted", async () => {
    const before = received.length;
    const calls: string[] = [];
    const standIn: WebPushSend = async (subscription) => {
      calls.push(subscription.endpoint);
      return {};
    };
    for (const endpoint of [
      // Read as Apple by the address check, as attacker.example by web-push (13.3 guardrails).
      "https://attacker.example%2Epush.apple.com/x",
      "https://evil.example/x",
      "https://FCM.googleapis.com/fcm/send/ok",
      // A host over DNS's length: the older parser blanks it, and Node would go to localhost.
      `https://${"a".repeat(237)}.notify.windows.com/x`,
    ]) {
      const target = { ...phone("ok").target, endpoint };
      expect(await sender().send(target, payload), endpoint).toEqual({ status: "refused" });
      expect(await sender({ send: standIn }).send(target, payload), endpoint).toEqual({
        status: "refused",
      });
    }
    expect(calls).toEqual([]);
    expect(received.length).toBe(before);
  });

  it("network errors and odd failures: failed with a code, never thrown, never the address", async () => {
    const target = phone("ok").target;
    const failing =
      (error: unknown): WebPushSend =>
      async () => {
        throw error;
      };
    const send = (error: unknown) => sender({ send: failing(error) }).send(target, payload);
    expect(await send(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toEqual(
      {
        status: "failed",
        code: "ECONNRESET",
      },
    );
    expect(await send(new TypeError("odd"))).toEqual({ status: "failed", code: "TypeError" });
    expect(await send(null)).toEqual({ status: "failed", code: "unknown" });
    expect(await send(undefined)).toEqual({ status: "failed", code: "unknown" });
    const odd = new Error("x");
    odd.name = target.endpoint;
    expect(await send(odd)).toEqual({ status: "failed", code: "unknown" });
  });
});

describe("the settings for web push", () => {
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

  it("webpush needs the three keys, as a pair, and is refused in tests", () => {
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
    // Keys from two different pairs: every push would fail, so the worker doesn't start.
    expect(() =>
      parseWorkerEnv({
        ...worker,
        ...all,
        VAPID_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey,
      }),
    ).toThrow(/isn't the private half of VAPID_PUBLIC_KEY/);
    const env = parseWorkerEnv({ ...worker, ...all });
    expect(env.PUSH_TRANSPORT).toBe("webpush");
    expect(getPushTransport(env).name).toBe("webpush");
    // Tests never reach a push service, whatever the keys.
    expect(() => parseWorkerEnv({ ...worker, ...all, NODE_ENV: "test" })).toThrow(
      /tests never reach a push service/,
    );
    // Nor production yet: the push must first go outside the record's transaction.
    const production = () =>
      parseWorkerEnv({ ...worker, ...all, NODE_ENV: "production", PUSH_TRANSPORT: "webpush" });
    expect(production).toThrow(/webpush waits on one more build step/);
    // The test setup itself keeps it off (tests/setup/env.ts).
    expect(process.env.PUSH_TRANSPORT).toBe("console");
    expect(process.env.VAPID_PRIVATE_KEY).toBe("");
  });
});

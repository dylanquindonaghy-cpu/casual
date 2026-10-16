import type { Agent } from "node:https";
import webpush from "web-push";
import { isPushServiceUrl, type PushTarget } from "./subscriptions";

// Sending a web push (docs/architecture.md, "Notifications"). The real sender (webpush, 13.3)
// signs with the deployment's VAPID keys and posts to the browser maker's push service (Google,
// Apple, Mozilla, Microsoft: subscriptions are only ever saved for those, src/lib/push/
// subscriptions.ts). The console transport prints what would be sent, never the endpoint itself (it
// addresses one person's phone): only the push service's host.

export interface PushPayload {
  title: string;
  body: string;
  url: string; // opened when the notification is tapped (our own site only: public/sw.js)
  // For the push service only, never shown: an urgent one goes at high urgency, and one with
  // `until` (a shift's start) isn't delivered after it.
  urgent?: boolean;
  until?: Date;
}

// gone: the push service says the subscription no longer exists (forget it); refused: its address
// isn't a browser maker's push service in the form a browser gives (forget it; nothing was sent);
// skipped: nothing was pushed (push switched off); failed: it didn't go this time (a code only:
// never the address). A push never throws: it's free and best effort, and goes after the message
// it follows.
export type PushSendResult =
  | { status: "sent" }
  | { status: "gone" }
  | { status: "refused" }
  | { status: "skipped" }
  | { status: "failed"; code: string };

export interface PushTransport {
  readonly name: string;
  send(target: PushTarget, payload: PushPayload): Promise<PushSendResult>;
}

export function createConsolePushTransport(
  write: (line: string) => void = console.log,
): PushTransport {
  return {
    name: "console",
    async send(target, payload) {
      let host = "unknown";
      try {
        host = new URL(target.endpoint).host;
      } catch {
        // Not a URL: still nothing to print.
      }
      write(`[push] via ${host}: ${payload.title} | ${payload.body} | ${payload.url}`);
      return { status: "sent" };
    },
  };
}

// Push switched off (PUSH_TRANSPORT=none): nothing is pushed or counted.
export const noPushTransport: PushTransport = {
  name: "none",
  async send() {
    return { status: "skipped" };
  },
};

// The real sender. A push the phone hasn't picked up is kept by the push service for PUSH_TTL
// (an offer or a reminder is stale after that), or until the payload's `until` (a shift's start)
// when that's sooner; an urgent one goes at high urgency (Android delivers it even when the phone
// is saving power). Before anything is sent the address is checked again (isPushServiceUrl: a
// browser maker's push service, in the exact form a browser gives), so a row saved before that
// check existed can never make the worker post anywhere else ("refused": forget it). A push service
// that hasn't finished within PUSH_TIMEOUT_MS is given up on, whatever it's doing (web-push's own
// time-out only counts silence). 404 and 410 mean the subscription is gone; anything else (a
// refusal, a time-out) is a failed push, never a reason to forget the phone (a 403, say, is our
// keys, not theirs).
export const PUSH_TTL_SECONDS = 12 * 60 * 60;
export const PUSH_TIMEOUT_MS = 5_000;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string; // mailto: or https:
}

// web-push's own sender, or a stand-in.
export type WebPushSend = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

export interface WebPushOptions {
  send?: WebPushSend;
  timeoutMs?: number;
  // Where the connection goes: the default; a test points it at a fake push service on this
  // machine, so nothing ever leaves a test (tests/unit/push.webpush.test.ts).
  agent?: Agent;
}

export function createWebPushTransport(keys: VapidKeys, opts: WebPushOptions = {}): PushTransport {
  const send = opts.send ?? webpush.sendNotification;
  const timeoutMs = opts.timeoutMs ?? PUSH_TIMEOUT_MS;
  return {
    name: "webpush",
    async send(target, payload) {
      if (!isPushServiceUrl(target.endpoint)) return { status: "refused" };
      // Only the words and the link reach the phone.
      const { title, body, url } = payload;
      const ttl =
        payload.until === undefined
          ? PUSH_TTL_SECONDS
          : Math.max(
              0,
              Math.min(PUSH_TTL_SECONDS, Math.floor((payload.until.getTime() - Date.now()) / 1000)),
            );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          send(
            { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
            JSON.stringify({ title, body, url }),
            {
              vapidDetails: keys,
              TTL: ttl,
              urgency: payload.urgent ? "high" : "normal",
              timeout: timeoutMs,
              ...(opts.agent ? { agent: opts.agent } : {}),
            },
          ),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Socket timeout")), timeoutMs);
          }),
        ]);
        return { status: "sent" };
      } catch (error) {
        const status =
          error !== null && typeof error === "object"
            ? (error as { statusCode?: unknown }).statusCode
            : undefined;
        if (status === 404 || status === 410) return { status: "gone" };
        return { status: "failed", code: pushFailureCode(error, status) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// The push service's HTTP status, or "timeout", or the network error's code (ECONNRESET), or the
// error's class.
function pushFailureCode(error: unknown, status: unknown): string {
  if (typeof status === "number") return `http_${status}`;
  if (error instanceof Error && error.message === "Socket timeout") return "timeout";
  const code =
    error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(name) ? name : "unknown";
}

export function getPushTransport(config: {
  PUSH_TRANSPORT: "console" | "none" | "webpush";
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}): PushTransport {
  switch (config.PUSH_TRANSPORT) {
    case "console":
      return createConsolePushTransport();
    case "none":
      return noPushTransport;
    case "webpush": {
      // The settings check refuses webpush without all three (src/lib/env.ts).
      const {
        VAPID_PUBLIC_KEY: publicKey,
        VAPID_PRIVATE_KEY: privateKey,
        VAPID_SUBJECT: subject,
      } = config;
      if (!publicKey || !privateKey || !subject) throw new Error("webpush needs the VAPID keys");
      return createWebPushTransport({ publicKey, privateKey, subject });
    }
  }
}

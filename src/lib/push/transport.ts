import type { PushTarget } from "./subscriptions";

// Sending a web push (docs/architecture.md, "Notifications"). The real sender signs with the
// firm's VAPID keys and posts to the browser maker's push service (Google, Apple, Mozilla): an
// outside service, not connected yet (PLAN.md Parking lot, "connect the real web push"). The
// console transport prints what would be sent, never the endpoint itself (it addresses one
// person's phone): only the push service's host.

export interface PushPayload {
  title: string;
  body: string;
  url: string; // opened when the notification is tapped (our own site only: public/sw.js)
}

// gone: the push service says the subscription no longer exists (forget it); skipped: nothing was
// pushed (push switched off).
export type PushSendResult = { status: "sent" } | { status: "gone" } | { status: "skipped" };

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

export function getPushTransport(config: { PUSH_TRANSPORT: "console" | "none" }): PushTransport {
  switch (config.PUSH_TRANSPORT) {
    case "console":
      return createConsolePushTransport();
    case "none":
      return noPushTransport;
  }
}

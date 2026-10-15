import { addressHost, sendWebhook, type Resolve, type RequestFn } from "./send";

// How the worker sends a webhook (docs/office-v2.md 5.3.3 "Transports"; 12J.2), like messaging:
// WEBHOOK_TRANSPORT, a worker setting. "console" (the development default) prints the signed
// request with the address cut to its host; "https" sends it through the safe sender (send.ts) and
// is required in production. Tests inject a fake. The web app never sends a webhook: "Send test
// event" queues a job.

export interface WebhookRequest {
  url: string; // a secret: never printed or logged whole
  headers: Record<string, string>;
  body: string;
}

export interface WebhookTransport {
  name: string;
  // Resolves on a 2xx answer; otherwise throws a WebhookSendError (a code, never the address).
  send(request: WebhookRequest): Promise<void>;
}

export const CONSOLE_WEBHOOK_START = "[webhook:console] ";

export function createConsoleWebhookTransport(
  print: (line: string) => void = console.log,
): WebhookTransport {
  return {
    name: "console",
    async send(r) {
      const headers = Object.entries(r.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      print(
        `${CONSOLE_WEBHOOK_START}POST https://${addressHost(r.url)}/… (not sent: console transport)\n${headers}\n\n${r.body}`,
      );
    },
  };
}

export function createHttpsWebhookTransport(
  deps: { resolve?: Resolve; request?: RequestFn } = {},
): WebhookTransport {
  return {
    name: "https",
    async send(r) {
      await sendWebhook(r, deps);
    },
  };
}

export function webhookTransport(kind: "console" | "https"): WebhookTransport {
  return kind === "https" ? createHttpsWebhookTransport() : createConsoleWebhookTransport();
}

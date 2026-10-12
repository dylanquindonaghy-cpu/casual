import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { isCustomDomain, normaliseHost } from "../tenancy/host";

// Sending a webhook safely (docs/office-v2.md 5.3.3 "Safe sending"; 12J.2). The worker shares a
// network with the database, so an address the firm gives must never reach inside it.
//
// - When an address is saved (checkWebhookAddress): https://, port 443, a DNS name (no IP address),
//   no user:password, at most 500 characters, and not ShiftDesk's own base domain or anything under
//   it. The office also refuses a firm's own domain (src/lib/office/webhook-settings.ts).
// - On each try (sendWebhook): the name is resolved and every address must be public
//   (isPublicAddress: an explicit BlockList, then IPv6 only in 2000::/3). A name with any refused
//   address is refused, even with a public one beside it.
// - The checked address is the one used: https.request's `lookup` returns only it, so DNS can't
//   change in between, while the name still drives SNI and the certificate check.
// - One POST: no redirects, 5 seconds to connect and 10 in all (one AbortSignal), and at most 1 KB
//   of the answer read and none kept.
// - The address is a secret (catch-hook addresses carry their key in the path), so every error
//   from here is a WebhookSendError carrying a code only, never the address or a raw error (whose
//   message may quote it); log lines name the host only.

export const CONNECT_TIMEOUT_MS = 5_000;
export const TOTAL_TIMEOUT_MS = 10_000;
export const MAX_ANSWER_BYTES = 1024;
export const MAX_ADDRESS_LENGTH = 500;

export type WebhookFailureCode =
  "timeout" | "dns" | "tls" | "refused_address" | "redirect" | "connection" | `http_${number}`;

export class WebhookSendError extends Error {
  constructor(readonly code: WebhookFailureCode) {
    super(`the webhook wasn't delivered: ${code}`);
    this.name = "WebhookSendError";
  }
}

// ---- When an address is saved ----

export type AddressProblem =
  "not_an_address" | "not_https" | "port" | "credentials" | "ip_address" | "too_long" | "ours";

export type CheckedAddress =
  { ok: true; url: string; host: string } | { ok: false; problem: AddressProblem };

export function checkWebhookAddress(raw: string, baseDomain: string): CheckedAddress {
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_ADDRESS_LENGTH || /\s/.test(text)) {
    return { ok: false, problem: text.length > MAX_ADDRESS_LENGTH ? "too_long" : "not_an_address" };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, problem: "not_an_address" };
  }
  if (url.protocol !== "https:") return { ok: false, problem: "not_https" };
  if (url.username !== "" || url.password !== "") return { ok: false, problem: "credentials" };
  // An explicit :443 is dropped by URL: any other port is refused.
  if (url.port !== "") return { ok: false, problem: "port" };
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || isIP(host) !== 0 || /^[0-9.]+$/.test(host)) {
    return { ok: false, problem: "ip_address" };
  }
  const [baseName = ""] = normaliseHost(baseDomain).split(":");
  if (host === baseName || host.endsWith(`.${baseName}`)) return { ok: false, problem: "ours" };
  if (!isCustomDomain(host, baseDomain)) return { ok: false, problem: "not_an_address" };
  // A fragment is never sent: dropped, so the stored address is only what's used.
  url.hash = "";
  const href = url.href;
  if (href.length > MAX_ADDRESS_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, url: href, host };
}

// "https://hooks.example/…k3F9": what the page shows (the host and the last 4 characters).
export function addressHint(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "…";
  }
  return `https://${host}/…${url.slice(-4)}`;
}

export function addressHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ---- On each try: only public addresses ----

// Two lists, each address checked against its own family's only: a BlockList checks an IPv4
// address against IPv6 rules too, through its IPv4-mapped form, so ::ffff:0:0/96 in one list
// would refuse every IPv4 address (tests/unit/integrations.webhooks.test.ts).
const blockedV4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, the cloud metadata address (169.254.169.254) included
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
] as const) {
  blockedV4.addSubnet(net, prefix, "ipv4");
}
const blockedV6 = new BlockList();
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96], // IPv4-compatible
  ["::ffff:0:0", 96], // IPv4-mapped
  ["64:ff9b::", 96], // NAT64
  ["2002::", 16], // 6to4
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(net, prefix, "ipv6");
}
const globalUnicast = new BlockList();
globalUnicast.addSubnet("2000::", 3, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) {
    return !blockedV6.check(address, "ipv6") && globalUnicast.check(address, "ipv6");
  }
  return false;
}

export type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;

const resolveAll: Resolve = (host) => dnsLookup(host, { all: true, verbatim: true });

// Every address the name resolves to, all public, or a WebhookSendError.
export async function publicAddressOf(
  host: string,
  resolve: Resolve = resolveAll,
): Promise<{ address: string; family: 4 | 6 }> {
  let found: { address: string; family: number }[];
  try {
    found = await resolve(host);
  } catch {
    throw new WebhookSendError("dns");
  }
  if (found.length === 0) throw new WebhookSendError("dns");
  if (!found.every((a) => isPublicAddress(a.address))) {
    throw new WebhookSendError("refused_address");
  }
  const first = found[0];
  if (!first) throw new WebhookSendError("dns");
  return { address: first.address, family: isIP(first.address) === 6 ? 6 : 4 };
}

// ---- One POST to the checked address ----

export type RequestFn = (url: URL, options: RequestOptions) => ClientRequest;

export interface Transmission {
  url: URL;
  address: string; // already checked
  family: 4 | 6;
  headers: Record<string, string>;
  body: string;
  request?: RequestFn; // https.request (tests pass http.request with a local server)
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
}

const TLS_CODES =
  /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_OSSL_|HOSTNAME_MISMATCH)/;

function failureCode(err: unknown): WebhookFailureCode {
  if (err instanceof WebhookSendError) return err.code;
  const e = err as { name?: unknown; code?: unknown } | null;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return "timeout";
  const code = typeof e?.code === "string" ? e.code : "";
  if (code === "ABORT_ERR" || code === "ETIMEDOUT") return "timeout";
  if (TLS_CODES.test(code)) return "tls";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  return "connection";
}

// Resolves with the answer's status when it's 2xx; anything else is a WebhookSendError.
export function transmit(t: Transmission): Promise<{ status: number }> {
  const send = t.request ?? (httpsRequest as RequestFn);
  const connectMs = t.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(t.totalTimeoutMs ?? TOTAL_TIMEOUT_MS);
  // Only the address already checked, whatever the name resolves to now.
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address: t.address, family: t.family },
      ]);
    } else {
      callback(null, t.address, t.family);
    }
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(new WebhookSendError(failureCode(err)));
    };
    let req: ClientRequest;
    try {
      req = send(t.url, {
        method: "POST",
        headers: { ...t.headers, "content-length": String(Buffer.byteLength(t.body)) },
        lookup,
        signal,
        agent: false, // a fresh connection each time: nothing reused, and no redirects followed
      });
    } catch (err) {
      fail(err);
      return;
    }
    req.on("socket", (socket) => {
      if (!socket.connecting) return;
      const timer = setTimeout(() => req.destroy(new WebhookSendError("timeout")), connectMs);
      socket.once("connect", () => clearTimeout(timer));
      socket.once("close", () => clearTimeout(timer));
    });
    req.on("error", fail);
    req.on("response", (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      let read = 0;
      const finish = () => {
        res.destroy();
        if (settled) return;
        if (status >= 200 && status < 300) {
          settled = true;
          resolve({ status });
        } else if (status >= 300 && status < 400) {
          fail(new WebhookSendError("redirect"));
        } else {
          fail(new WebhookSendError(`http_${status}`));
        }
      };
      res.on("data", (chunk: Buffer) => {
        read += chunk.length;
        if (read >= MAX_ANSWER_BYTES) finish();
      });
      res.on("end", finish);
      res.on("error", () => finish());
    });
    req.end(t.body);
  });
}

// Resolve, check, send: the https transport's one try.
export async function sendWebhook(
  o: { url: string; headers: Record<string, string>; body: string },
  deps: { resolve?: Resolve; request?: RequestFn } = {},
): Promise<{ status: number }> {
  let url: URL;
  try {
    url = new URL(o.url);
  } catch {
    throw new WebhookSendError("refused_address");
  }
  // Checked again on each try: a stored address is never trusted blindly.
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) {
    throw new WebhookSendError("refused_address");
  }
  if (url.hostname.startsWith("[") || isIP(url.hostname) !== 0) {
    throw new WebhookSendError("refused_address");
  }
  const { address, family } = await publicAddressOf(url.hostname, deps.resolve);
  return transmit({
    url,
    address,
    family,
    headers: o.headers,
    body: o.body,
    ...(deps.request ? { request: deps.request } : {}),
  });
}

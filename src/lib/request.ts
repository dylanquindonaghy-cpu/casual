import { isIP } from "node:net";
import { headers } from "next/headers";
import { log, type Logger } from "./log";

// The request ID src/proxy.ts set on this request, for log lines from pages and server actions.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function requestIdFrom(h: Headers): string {
  const id = h.get("x-request-id") ?? "";
  return UUID.test(id) ? id : "unknown";
}

export async function requestId(): Promise<string> {
  return requestIdFrom(await headers());
}

export async function requestLog(): Promise<Logger> {
  return log.child({ requestId: await requestId() });
}

// The client's IP, for rate limits. Only X-Real-IP, which Caddy sets from the connection and
// overwrites if a client sends it (the web port is never published). Without it every request
// shares one "unknown" bucket: the limits still apply, just not per person.
// IPv6 is grouped by /64: one home or mobile connection usually gets a whole /64, so counting
// single addresses would let one client use a new address for every request.
let warned = false;

export function clientIpFrom(h: Headers): string {
  const key = ipLimitKey(h.get("x-real-ip") ?? "");
  if (key === "unknown" && process.env.NODE_ENV === "production" && !warned) {
    warned = true;
    log.warn("no X-Real-IP header: rate limits are shared by all clients (check Caddy)");
  }
  return key;
}

export function ipLimitKey(raw: string): string {
  const ip = raw.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped?.[1]) return mapped[1];
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind !== 6) return "unknown";
  const [head = "", tail] = ip.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? front
      : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}

export async function clientIp(): Promise<string> {
  return clientIpFrom(await headers());
}

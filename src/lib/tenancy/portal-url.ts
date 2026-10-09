import { normaliseHost } from "./host";

// A firm's portal address, built only from the firm's own record and our configuration, never
// from a request (a forged Host header must not be able to point a real login link elsewhere).
// http only for local development (localhost); everything else is https.
export function portalUrl(slug: string, baseDomain: string): string {
  const base = normaliseHost(baseDomain);
  const hostname = base.replace(/:\d+$/, "");
  const local = hostname === "localhost" || hostname.endsWith(".localhost");
  return `${local ? "http" : "https"}://${slug}.${base}`;
}

// Which of a firm's two addresses a login request came in on: its portal (<slug>.<base>) or its own
// verified domain (Phase 8, shifts.firmname.co.uk). The login link goes back to the same one, so
// the session (a host-only cookie) is on the address the person uses (audit M7).
export type FirmAddress = "portal" | "own_domain";

// A firm's own domain as an address, from the firm's own record (never a request's Host). Always
// https: Caddy serves it with its own certificate (the browser tests put an https front on their
// made-up domain, tests/e2e/tls-front.ts); a browser keeps no session cookie over plain http there.
export function ownDomainUrl(domain: string): string {
  return `https://${domain}`;
}

// An address on the platform itself (no firm): where Twilio sends its webhooks. Built only from
// our configuration, never from a request, so a webhook's signature is checked against the address
// Twilio was given.
export function platformUrl(baseDomain: string, path: string): string {
  const base = normaliseHost(baseDomain);
  const hostname = base.replace(/:\d+$/, "");
  const local = hostname === "localhost" || hostname.endsWith(".localhost");
  return `${local ? "http" : "https"}://${base}${path}`;
}

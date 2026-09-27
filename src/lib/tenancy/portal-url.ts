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

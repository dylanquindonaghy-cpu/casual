import { isValidSlug } from "./slug";

// Host -> firm, the pure part (no database). Used by src/proxy.ts to turn away hosts we don't
// serve before any work happens, and by getCurrentFirm() to find the firm's slug.
//
//   <base>             the ShiftDesk home page (no firm)
//   <slug>.<base>      a firm's portal
//   anything else      not served (custom domains arrive in Phase 8)
//
// The base domain includes the port in dev (localhost:3000) and none in production.

export type HostMatch = { kind: "apex" } | { kind: "firm"; slug: string };

// Lowercase, trimmed, one trailing dot removed from the hostname ("acme.localhost.:3000").
// Anything that isn't a plain ASCII host name with an optional port comes back unchanged
// (lowercased), so it can never equal the base domain or end with it by accident.
const HOST_SHAPE = /^([a-z0-9.-]+?)\.?(:\d{1,5})?$/;

export function normaliseHost(raw: string): string {
  const host = raw.trim().toLowerCase();
  const m = HOST_SHAPE.exec(host);
  return m ? `${m[1]}${m[2] ?? ""}` : host;
}

// Only printable ASCII: lowercasing some Unicode letters gives ASCII ones (the Kelvin sign
// becomes "k"), so non-ASCII is refused before normalising.
const ASCII = /^[\x21-\x7e]+$/;

export function parseHost(
  rawHost: string | null | undefined,
  baseDomain: string,
): HostMatch | null {
  if (!rawHost || !ASCII.test(rawHost.trim())) return null;
  const host = normaliseHost(rawHost);
  const base = normaliseHost(baseDomain);
  if (host === base) return { kind: "apex" };
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length);
  // One label only: x.acme.<base> is not Acme.
  return isValidSlug(slug) ? { kind: "firm", slug } : null;
}

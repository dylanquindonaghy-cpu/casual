import { isValidSlug } from "./slug";

// Host -> firm, the pure part (no database). Used by src/proxy.ts to turn away hosts we don't
// serve before any work happens, and by getCurrentFirm() to find the firm.
//
//   <base>             the ShiftDesk home page (no firm)
//   <slug>.<base>      a firm's portal
//   a public name      maybe a firm's own domain (Phase 8: shifts.firmname.co.uk, pointed at us
//                      with a CNAME); getCurrentFirm() serves it only if it's a firm's verified one
//   anything else      not served
//
// The base domain includes the port in dev (localhost:3000) and none in production. A custom
// domain has no port in production; locally it may carry the base domain's own port (a made-up
// domain mapped to this machine over plain http; the browser tests now reach theirs over https,
// with no port, through tests/e2e/tls-front.ts).

export type HostMatch =
  { kind: "apex" } | { kind: "firm"; slug: string } | { kind: "custom"; domain: string };

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

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LABEL = /^[a-z]{2,63}$/; // letters only: never an IP address

const splitPort = (host: string): [string, string] => {
  const m = /^(.*?)(:\d{1,5})?$/.exec(host);
  return [m?.[1] ?? host, m?.[2] ?? ""];
};

// A name a firm could point at us (lowercase, no port): at least two dot-separated labels of
// letters, digits and hyphens (not starting or ending with one), a letter-only last label, at most
// 253 characters, and not our own base domain or anything under it (those are ours, by slug).
export function isCustomDomain(name: string, baseDomain: string): boolean {
  const [baseName] = splitPort(normaliseHost(baseDomain));
  if (name.length > 253 || name === baseName || name.endsWith(`.${baseName}`)) return false;
  const labels = name.split(".");
  return (
    labels.length >= 2 &&
    labels.every((label) => LABEL.test(label)) &&
    TOP_LABEL.test(labels.at(-1) ?? "")
  );
}

export function parseHost(
  rawHost: string | null | undefined,
  baseDomain: string,
): HostMatch | null {
  if (!rawHost || !ASCII.test(rawHost.trim())) return null;
  const host = normaliseHost(rawHost);
  const base = normaliseHost(baseDomain);
  if (host === base) return { kind: "apex" };
  const suffix = `.${base}`;
  if (host.endsWith(suffix)) {
    const slug = host.slice(0, -suffix.length);
    // One label only: x.acme.<base> is not Acme.
    return isValidSlug(slug) ? { kind: "firm", slug } : null;
  }
  // Maybe a firm's own domain: with no port, or the base domain's own port (local tests).
  const [name, port] = splitPort(host);
  const [, basePort] = splitPort(base);
  if (port !== "" && port !== basePort) return null;
  return isCustomDomain(name, base) ? { kind: "custom", domain: name } : null;
}

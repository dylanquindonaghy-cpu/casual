import type { ResolveFirmByDomain, ResolveFirmBySlug } from "../db/directory";
import { normaliseHost, parseHost } from "./host";

// Caddy's on-demand TLS check (docs/architecture.md "Custom domains and branding"; Phase 8):
// before getting a certificate for a host it hasn't seen, Caddy asks
// `GET /api/caddy/ask?domain=<host>` and only goes ahead on a 200. We say yes only to hosts in the
// firms table: a firm's subdomain (<slug>.<base>, for a firm that exists) or a firm's own domain
// once verified (its CNAME points at us). Anything else, including our own base domain (Caddy gets
// that certificate normally) and anything malformed, is no, so nobody can make us fetch
// certificates for names that aren't our customers'.
export async function approveCertificate(
  domain: string | null,
  deps: {
    baseDomain: string;
    resolveFirmBySlug: ResolveFirmBySlug;
    resolveFirmByDomain: ResolveFirmByDomain;
  },
): Promise<boolean> {
  if (!domain || domain.length > 253) return false;
  // Certificates are for names, never ports: the base domain's port (local only) doesn't count.
  const base = normaliseHost(deps.baseDomain).replace(/:\d{1,5}$/, "");
  if (/:/.test(domain)) return false;
  const match = parseHost(domain, base);
  if (match?.kind === "firm") return (await deps.resolveFirmBySlug(match.slug)) !== null;
  if (match?.kind === "custom") return (await deps.resolveFirmByDomain(match.domain)) !== null;
  return false;
}

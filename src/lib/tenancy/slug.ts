// Firm slugs: the subdomain a firm's staff use (acme.<base domain>). Mirrors the firms table's
// check constraints (src/lib/db/schema/tenancy.ts); tenancy.host tests keep the two in step.

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,18}[a-z0-9]$/;

// Kept for ourselves: custom domains CNAME to portal.<base>, and the rest are obvious targets.
export const RESERVED_SLUGS = ["www", "portal", "api", "app", "admin"] as const;

export function isValidSlug(slug: string): boolean {
  return (
    SLUG_PATTERN.test(slug) &&
    !(RESERVED_SLUGS as readonly string[]).includes(slug) &&
    // Punycode renders as another script and could pose as another firm in the address bar.
    !slug.startsWith("xn--")
  );
}

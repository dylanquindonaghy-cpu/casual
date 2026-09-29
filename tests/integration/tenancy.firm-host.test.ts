import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firmForHost } from "@/lib/tenancy/firm";
import { RESERVED_SLUGS, isValidSlug } from "@/lib/tenancy/slug";
import { superuserPool, uniqueSlug } from "../helpers/db";
import { pgError } from "../helpers/rls-probe";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Host -> firm against the real database (through app_resolve_firm as shiftdesk_app).

const BASE = "localhost:3000";
let su: Pool;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  su = superuserPool();
  A = await createTenant(su);
  B = await createTenant(su);
});
afterAll(async () => {
  await su.end();
});

describe("firmForHost", () => {
  it("resolves each firm's subdomain to that firm and no other", async () => {
    expect((await firmForHost(`${A.slug}.${BASE}`, BASE))?.id).toBe(A.firmId);
    expect((await firmForHost(`${B.slug}.${BASE}`, BASE))?.id).toBe(B.firmId);
  });

  it("ignores case and a trailing dot", async () => {
    expect((await firmForHost(`${A.slug.toUpperCase()}.localhost.:3000`, BASE))?.id).toBe(A.firmId);
  });

  it("returns null for an unknown slug, the home page, and hosts we don't serve", async () => {
    for (const host of [
      `nobody-here.${BASE}`,
      BASE,
      "evil.example:3000",
      `x.${A.slug}.${BASE}`,
      null,
    ]) {
      expect(await firmForHost(host, BASE)).toBeNull();
    }
  });

  it("resolves a firm's own domain only once it's verified (Phase 8), and to that firm alone", async () => {
    const domain = `${uniqueSlug("d")}.example.com`;
    await su.query("update firms set custom_domain = $1, domain_verified = false where id = $2", [
      domain,
      A.firmId,
    ]);
    try {
      expect(await firmForHost(`${domain}:3000`, BASE)).toBeNull();
      await su.query("update firms set domain_verified = true where id = $1", [A.firmId]);
      expect((await firmForHost(`${domain}:3000`, BASE))?.id).toBe(A.firmId);
      expect((await firmForHost(`${domain.toUpperCase()}.:3000`, BASE))?.id).toBe(A.firmId);
      // Another name, a lookalike, or the right name on another port: nobody.
      expect(await firmForHost(`x.${domain}:3000`, BASE)).toBeNull();
      expect(await firmForHost(`${domain}:4000`, BASE)).toBeNull();
    } finally {
      // Firm A is shared by the file's other tests.
      await su.query(
        "update firms set custom_domain = null, domain_verified = false where id = $1",
        [A.firmId],
      );
    }
  });
});

describe("slug rules: the code and the database agree", () => {
  it.each([...RESERVED_SLUGS, "xn--abc", "-bad", "bad-", "a", "UPPER", "a".repeat(21)])(
    "%s is rejected by both",
    async (slug) => {
      expect(isValidSlug(slug)).toBe(false);
      const err = await pgError(
        su.query("insert into firms (name, slug, sector) values ('X', $1, 'security')", [slug]),
      );
      expect(err.code).toBe("23514"); // a check constraint
    },
  );

  it("a valid slug is accepted by both", async () => {
    const slug = uniqueSlug("ok");
    expect(isValidSlug(slug)).toBe(true);
    const result = await su.query(
      "insert into firms (name, slug, sector) values ('X', $1, 'security') returning id",
      [slug],
    );
    expect(result.rowCount).toBe(1);
  });
});

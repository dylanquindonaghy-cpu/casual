import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveFirmBySlug } from "@/lib/db/directory";
import { appRolePool, superuserPool, uniqueSlug } from "../helpers/db";
import { inFirm, pgError } from "../helpers/rls-probe";
import { createTenant, type Tenant } from "../helpers/tenant-rows";

// Host -> firm lookup before any firm is known, through app_resolve_firm() only.

let su: Pool;
let app: Pool;
let A: Tenant;

beforeAll(async () => {
  su = superuserPool();
  app = appRolePool(1);
  A = await createTenant(su);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

describe("resolveFirmBySlug", () => {
  it("returns only the firm's directory fields, signed '[Firm name] Shift Team' by default", async () => {
    expect(await resolveFirmBySlug(A.slug)).toEqual({
      id: A.firmId,
      slug: A.slug,
      name: `Test Firm ${A.slug}`,
      timezone: "Europe/London",
      signOff: `Test Firm ${A.slug} Shift Team`,
    });
  });

  it("uses the firm's own sign-off when settings has one", async () => {
    const slug = uniqueSlug("s");
    await su.query(
      `insert into firms (name, slug, sector, settings)
       values ('Acme Events', $1, 'security', '{"sign_off": "Acme Events Shift Team"}')`,
      [slug],
    );
    expect((await resolveFirmBySlug(slug))?.signOff).toBe("Acme Events Shift Team");
  });

  it("falls back to '[Firm name] Shift Team' when the sign-off setting is blank", async () => {
    const slug = uniqueSlug("b");
    await su.query(
      `insert into firms (name, slug, sector, settings)
       values ('Blank Co', $1, 'security', '{"sign_off": "  "}')`,
      [slug],
    );
    expect((await resolveFirmBySlug(slug))?.signOff).toBe("Blank Co Shift Team");
  });

  it("returns null for an unknown slug", async () => {
    expect(await resolveFirmBySlug("no-such-firm")).toBeNull();
  });

  it("is the only way in: the app role can't read the firm directly without a firm set", async () => {
    const direct = await inFirm(app, null, (c) =>
      c.query("select id from firms where slug = $1", [A.slug]).then((r) => r.rowCount),
    );
    expect(direct).toBe(0);
    const viaFunction = await inFirm(app, null, (c) =>
      c.query("select id from app_resolve_firm($1)", [A.slug]).then((r) => r.rowCount),
    );
    expect(viaFunction).toBe(1);
  });
});

describe("app_resolve_firm hardening", () => {
  it("returns only id, slug, name, timezone and sign_off", async () => {
    const { rows } = await su.query(
      "select pg_get_function_result('app_resolve_firm(text)'::regprocedure) as result",
    );
    expect(rows[0]?.result).toBe(
      "TABLE(id uuid, slug text, name text, timezone text, sign_off text)",
    );
  });

  it("runs as its owner with a pinned search_path, and only the app role may call it", async () => {
    const { rows } = await su.query<{
      definer: boolean;
      config: string[];
      acl: string[];
    }>(
      `select prosecdef as definer, proconfig as config, proacl::text[] as acl
         from pg_proc where oid = 'app_resolve_firm(text)'::regprocedure`,
    );
    const fn = rows[0];
    expect(fn?.definer).toBe(true);
    expect(fn?.config).toEqual(["search_path=pg_catalog, pg_temp"]);
    // No "=X/..." entry: PUBLIC can't execute it.
    expect(fn?.acl.filter((entry) => entry.startsWith("="))).toEqual([]);
    expect(fn?.acl.some((entry) => entry.startsWith("shiftdesk_app=X/"))).toBe(true);
  });

  it("the app role can't create a temp table to shadow firms", async () => {
    const err = await pgError(
      inFirm(app, null, (c) => c.query("create temp table firms (id uuid, slug text)")),
    );
    expect(err).toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied/),
    });
  });
});

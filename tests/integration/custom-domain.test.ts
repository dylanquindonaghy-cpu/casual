import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDirectory, createDomainDirectory } from "@/lib/db/directory";
import { createWithFirm } from "@/lib/db/scoped";
import { approveCertificate } from "@/lib/tenancy/caddy-ask";
import { firmForHost } from "@/lib/tenancy/firm";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, uniqueSlug, urls } from "../helpers/db";
import { setCustomDomain, toDomain, type ResolveCname } from "../../scripts/firm-domain-owner";

// A firm's own domain (Phase 8): the lookup that serves it (app_resolve_firm_by_domain, only once
// verified), Caddy's certificate check (/api/caddy/ask) and the owner's `npm run firm:domain`, on
// the real database; the lookups as the app role. DNS is a fake: the tests say what each name's
// CNAME is. Names use the reserved .example and .test names.

let su: Pool;
let app: Pool;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const BASE = "shiftdesk.test"; // as in production: no port
// What a firm's CNAME must point to: its own subdomain.
const targetOf = (slug: string) => `${slug}.${BASE}`;

async function firm() {
  const f = await bookingFirm(su, createWithFirm(app));
  const { rows } = await su.query<{ slug: string }>("select slug from firms where id = $1", [
    f.firmId,
  ]);
  return { firmId: f.firmId, slug: rows[0]?.slug ?? "" };
}

const domainOf = async (firmId: string) =>
  (
    await su.query<{ domain: string | null; verified: boolean }>(
      "select custom_domain as domain, domain_verified as verified from firms where id = $1",
      [firmId],
    )
  ).rows[0];
const eventsOf = async (firmId: string) =>
  (
    await su.query<{ data: Record<string, unknown> }>(
      "select data from events where firm_id = $1 and action = 'firm.domain_changed' order by id",
      [firmId],
    )
  ).rows.map((r) => r.data);

// A fake DNS: each name's CNAME, as a test sets it.
function fakeDns(records: Record<string, string[]>): ResolveCname {
  return async (name) => {
    const found = records[name];
    if (!found) throw Object.assign(new Error("queryCname ENODATA"), { code: "ENODATA" });
    return found;
  };
}

const uniqueDomain = () => `${uniqueSlug("s")}.acme-events.example`;

describe("the lookup: a verified domain is the firm's, nothing else is anyone's", () => {
  it("unverified: nobody; verified: that firm, with directory fields only", async () => {
    const t = await firm();
    const domain = uniqueDomain();
    const byDomain = createDomainDirectory(app);
    await su.query("update firms set custom_domain = $2 where id = $1", [t.firmId, domain]);
    expect(await byDomain(domain)).toBeNull();
    await su.query("update firms set domain_verified = true where id = $1", [t.firmId]);
    expect(await byDomain(domain)).toMatchObject({ id: t.firmId, slug: t.slug });
    expect(Object.keys((await byDomain(domain)) ?? {}).sort()).toEqual(
      ["id", "name", "signOff", "slug", "timezone"].sort(),
    );
    // Exact names only: no case games (the caller lowercases), no neighbours.
    expect(await byDomain(domain.toUpperCase())).toBeNull();
    expect(await byDomain(`x.${domain}`)).toBeNull();
    expect(await byDomain("")).toBeNull();
  });

  it("app_resolve_firm_by_domain(): runs as its owner, pinned search_path, only the app role may call it", async () => {
    const { rows } = await su.query<{
      definer: boolean;
      config: string[];
      acl: string[];
      result: string;
    }>(
      `select prosecdef as definer, proconfig as config, proacl::text[] as acl,
              pg_get_function_result(oid) as result
         from pg_proc where oid = 'app_resolve_firm_by_domain(text)'::regprocedure`,
    );
    expect(rows[0]?.definer).toBe(true);
    // Directory fields only: widening this is a decision, not an accident.
    expect(rows[0]?.result).toBe(
      "TABLE(id uuid, slug text, name text, timezone text, sign_off text)",
    );
    expect(rows[0]?.config).toEqual(["search_path=pg_catalog, pg_temp"]);
    expect(rows[0]?.acl.filter((entry) => entry.startsWith("="))).toEqual([]);
    expect(rows[0]?.acl.some((entry) => entry.startsWith("shiftdesk_app=X/"))).toBe(true);
    expect(rows[0]?.acl.some((entry) => entry.startsWith("shiftdesk_jobs="))).toBe(false);
  });

  it("the database only takes a lowercase host name, and each one belongs to one firm", async () => {
    const t = await firm();
    for (const bad of [
      "Shifts.Acme.example",
      "https://shifts.acme.example",
      "shifts.acme.example:443",
      "shifts..acme.example",
      "shifts.acme.example/",
      "-",
    ]) {
      await expect(
        su.query("update firms set custom_domain = $2 where id = $1", [t.firmId, bad]),
        bad,
      ).rejects.toMatchObject({ code: "23514" });
    }
    const domain = uniqueDomain();
    await su.query("update firms set custom_domain = $2 where id = $1", [t.firmId, domain]);
    const other = await firm();
    await expect(
      su.query("update firms set custom_domain = $2 where id = $1", [other.firmId, domain]),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("Caddy's certificate check (/api/caddy/ask)", () => {
  const deps = () => ({
    baseDomain: BASE,
    resolveFirmBySlug: createDirectory(app),
    resolveFirmByDomain: createDomainDirectory(app),
  });

  it("yes to a firm's subdomain and a firm's verified domain; no to everything else", async () => {
    const t = await firm();
    const domain = uniqueDomain();
    await su.query("update firms set custom_domain = $2 where id = $1", [t.firmId, domain]);
    expect(await approveCertificate(`${t.slug}.${BASE}`, deps())).toBe(true);
    expect(await approveCertificate(domain, deps())).toBe(false); // not verified yet
    await su.query("update firms set domain_verified = true where id = $1", [t.firmId]);
    expect(await approveCertificate(domain, deps())).toBe(true);
    for (const no of [
      null,
      "",
      BASE, // ours: its certificate comes the ordinary way
      `portal.${BASE}`,
      `nobody-here-zz.${BASE}`,
      `x.${t.slug}.${BASE}`,
      `${domain}:443`,
      "10.0.0.1",
      "unknown.acme-events.example",
      `${"a".repeat(260)}.example`,
    ]) {
      expect(await approveCertificate(no, deps()), String(no)).toBe(false);
    }
  });

  it("locally the base domain's port doesn't matter (certificates are for names)", async () => {
    const t = await firm();
    expect(
      await approveCertificate(`${t.slug}.localhost`, { ...deps(), baseDomain: "localhost:3100" }),
    ).toBe(true);
  });
});

describe("setting a firm's own domain (npm run firm:domain)", () => {
  it("saved before the CNAME is there (not served), verified once it is, served from then on", async () => {
    const t = await firm();
    const domain = uniqueDomain();
    const records: Record<string, string[]> = {};
    const deps = { baseDomain: BASE, resolveCname: fakeDns(records) };
    expect(
      await setCustomDomain(urls.admin, t.slug, { set: `https://${domain.toUpperCase()}/` }, deps),
    ).toEqual({
      status: "saved",
      domain,
      verified: false,
      found: [],
      target: targetOf(t.slug),
    });
    expect(await firmForHost(domain, BASE)).toBeNull();
    // Pointed at us, but at another firm's subdomain (or our old portal name): not verified.
    records[domain] = [`portal.${BASE}`, `someone-else.${BASE}`];
    expect(await setCustomDomain(urls.admin, t.slug, { check: true }, deps)).toMatchObject({
      verified: false,
      changed: false,
    });
    // The firm adds the CNAME to its own subdomain (DNS names may end with a dot).
    records[domain] = [`${targetOf(t.slug)}.`];
    expect(await setCustomDomain(urls.admin, t.slug, { check: true }, deps)).toEqual({
      status: "checked",
      domain,
      verified: true,
      changed: true,
      found: [targetOf(t.slug)],
      target: targetOf(t.slug),
    });
    expect((await firmForHost(domain, BASE))?.id).toBe(t.firmId);
    expect(await setCustomDomain(urls.admin, t.slug, { check: true }, deps)).toMatchObject({
      status: "checked",
      verified: true,
      changed: false,
    });
    // The CNAME is taken away, or pointed elsewhere: not served any more.
    records[domain] = ["somewhere-else.example"];
    expect(await setCustomDomain(urls.admin, t.slug, { check: true }, deps)).toMatchObject({
      verified: false,
      changed: true,
      found: ["somewhere-else.example"],
    });
    expect(await firmForHost(domain, BASE)).toBeNull();
    expect(await eventsOf(t.firmId)).toEqual([
      { change: "set", verified: false, domain },
      { change: "verified", verified: true, domain },
      { change: "unverified", verified: false, domain },
    ]);
  });

  it("a domain can only be verified for the firm its CNAME points to (a mistyped --firm can't take it)", async () => {
    const acme = await firm();
    const north = await firm();
    const domain = uniqueDomain();
    const deps = { baseDomain: BASE, resolveCname: fakeDns({ [domain]: [targetOf(acme.slug)] }) };
    expect(await setCustomDomain(urls.admin, north.slug, { set: domain }, deps)).toMatchObject({
      status: "saved",
      verified: false,
    });
    expect(await firmForHost(domain, BASE)).toBeNull();
    await setCustomDomain(urls.admin, north.slug, { clear: true }, deps);
    expect(await setCustomDomain(urls.admin, acme.slug, { set: domain }, deps)).toMatchObject({
      status: "saved",
      verified: true,
    });
    expect((await firmForHost(domain, BASE))?.id).toBe(acme.firmId);
  });

  it("a different domain needs --replace; one another firm has is refused; clearing", async () => {
    const t = await firm();
    const first = uniqueDomain();
    const second = uniqueDomain();
    const deps = {
      baseDomain: BASE,
      resolveCname: fakeDns({ [first]: [targetOf(t.slug)], [second]: [targetOf(t.slug)] }),
    };
    expect(await setCustomDomain(urls.admin, t.slug, { set: first }, deps)).toMatchObject({
      status: "saved",
      verified: true,
    });
    expect(await setCustomDomain(urls.admin, t.slug, { set: second }, deps)).toEqual({
      status: "has_other",
      before: first,
    });
    expect(
      await setCustomDomain(urls.admin, t.slug, { set: second, replace: true }, deps),
    ).toMatchObject({
      status: "saved",
      domain: second,
      verified: true,
    });
    const other = await firm();
    expect(await setCustomDomain(urls.admin, other.slug, { set: second }, deps)).toEqual({
      status: "taken",
    });
    expect(await domainOf(other.firmId)).toEqual({ domain: null, verified: false });
    expect(await setCustomDomain(urls.admin, t.slug, { clear: true }, deps)).toEqual({
      status: "cleared",
      before: second,
    });
    expect(await domainOf(t.firmId)).toEqual({ domain: null, verified: false });
    // The log says which address was set, replaced and removed.
    expect(await eventsOf(t.firmId)).toEqual([
      { change: "set", verified: true, domain: first },
      { change: "set", verified: true, domain: second, before: first },
      { change: "cleared", verified: false, domain: second },
    ]);
    expect(await setCustomDomain(urls.admin, t.slug, { clear: true }, deps)).toEqual({
      status: "unchanged",
    });
    expect(await setCustomDomain(urls.admin, t.slug, { check: true }, deps)).toEqual({
      status: "no_domain",
    });
    expect(await setCustomDomain(urls.admin, "no-such-firm-zz", { set: first }, deps)).toEqual({
      status: "no_firm",
    });
  });

  it("refuses names that can't be a firm's own domain, changing nothing", async () => {
    const t = await firm();
    const deps = { baseDomain: BASE, resolveCname: fakeDns({}) };
    for (const bad of [
      BASE,
      `portal.${BASE}`,
      `acme.${BASE}`,
      "shifts.acme.example:443",
      "shifts.acme.example/login",
      "user@shifts.acme.example",
      "10.0.0.1",
      "localhost",
      "shifts",
      "",
    ]) {
      expect(await setCustomDomain(urls.admin, t.slug, { set: bad }, deps), bad).toEqual({
        status: "bad_domain",
      });
    }
    expect(await domainOf(t.firmId)).toEqual({ domain: null, verified: false });
    expect(await eventsOf(t.firmId)).toEqual([]);
  });

  it("DNS not answering is simply not verified yet", async () => {
    const t = await firm();
    const domain = uniqueDomain();
    const broken: ResolveCname = async () => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
    };
    expect(
      await setCustomDomain(
        urls.admin,
        t.slug,
        { set: domain },
        { baseDomain: BASE, resolveCname: broken },
      ),
    ).toEqual({ status: "saved", domain, verified: false, found: [], target: targetOf(t.slug) });
  });

  it("reads what people type", () => {
    expect(toDomain(" Shifts.Acme.example. ")).toBe("shifts.acme.example");
    expect(toDomain("https://shifts.acme.example/")).toBe("shifts.acme.example");
    expect(toDomain("http://shifts.acme.example")).toBe("shifts.acme.example");
    for (const bad of ["shifts.acme.example/x", "shifts acme.example", "shifts.acme.example:80"]) {
      expect(toDomain(bad), bad).toBeNull();
    }
  });
});

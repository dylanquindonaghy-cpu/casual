import { Client } from "pg";
import { isCustomDomain, normaliseHost } from "../src/lib/tenancy/host";

// A firm's own domain (Phase 8, `npm run firm:domain`, scripts/firm-domain.ts): the firm adds a
// CNAME from, say, shifts.acme.co.uk to its own subdomain, acme.<our domain>; we save the name here
// and it's served (and Caddy may get its certificate) only once verified: its CNAME points to that
// firm's subdomain, so a domain can only ever be verified for the firm it points to (a mistyped
// --firm can't take another firm's domain). As the owner, like the shifts line and the brand: the
// app role can only read firms. RLS is forced for the owner too, so each change runs with the firm
// set for its transaction only; kept out of src/ on purpose (scripts/invariants.sh, invariant 5).
// DNS is looked up before anything is locked (a slow answer mustn't hold up the firm's writes).
// Logged `firm.domain_changed` {change, verified, domain, before}.

export type ResolveCname = (name: string) => Promise<string[]>;

export type DomainAction =
  | { set: string; replace?: boolean } // save (and check) this domain
  | { check: true } // look up the saved domain's CNAME again
  | { clear: true };

export type SetDomainResult =
  | { status: "saved"; domain: string; verified: boolean; found: string[]; target: string }
  | {
      status: "checked";
      domain: string;
      verified: boolean;
      changed: boolean;
      found: string[];
      target: string;
    }
  | { status: "cleared"; before: string }
  | { status: "unchanged" } // nothing to clear
  | { status: "no_firm" }
  | { status: "no_domain" } // nothing saved to check
  | { status: "bad_domain" }
  | { status: "taken" } // another firm has it
  | { status: "has_other"; before: string } // a different domain is saved: pass `replace`
  | { status: "busy" }; // it changed while we were checking: run it again

// The event (the office's action log: src/lib/office/log-types.ts and event-words.ts).
const DOMAIN_CHANGED = "firm.domain_changed";

// What the firm typed: "shifts.acme.co.uk", "Shifts.Acme.co.uk." or "https://shifts.acme.co.uk/"
// all mean the same name; anything with a path, port, user or query isn't a domain.
export function toDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9.-]+$/.test(s)) return null;
  return normaliseHost(s);
}

// What the firm's CNAME must point to: its own subdomain (no port).
export const cnameTarget = (slug: string, baseDomain: string) =>
  `${slug}.${normaliseHost(baseDomain).replace(/:\d{1,5}$/, "")}`;

// Verified: its CNAME is exactly the target. A name with no CNAME, or DNS not answering, is simply
// not verified yet. (A direct CNAME only: a flattened or proxied record never verifies.)
async function lookUp(
  domain: string,
  target: string,
  resolveCname: ResolveCname,
): Promise<{ verified: boolean; found: string[] }> {
  let found: string[] = [];
  try {
    found = (await resolveCname(domain)).map((name) => normaliseHost(name));
  } catch {
    found = [];
  }
  return { verified: found.includes(target), found };
}

export async function setCustomDomain(
  adminUrl: string,
  slug: string,
  action: DomainAction,
  deps: { baseDomain: string; resolveCname: ResolveCname },
): Promise<SetDomainResult> {
  const domain = "set" in action ? toDomain(action.set) : null;
  if ("set" in action && (domain === null || !isCustomDomain(domain, deps.baseDomain))) {
    return { status: "bad_domain" };
  }
  const target = cnameTarget(slug, deps.baseDomain);
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    // A first look, unlocked: which firm, and what it has now.
    const { rows: seen } = await owner.query<{ id: string; domain: string | null }>(
      "select id::text as id, custom_domain as domain from firms where slug = $1",
      [slug],
    );
    const firmId = seen[0]?.id;
    if (!firmId) return { status: "no_firm" };
    const before = seen[0]?.domain ?? null;
    if ("clear" in action && before === null) return { status: "unchanged" };
    const name = domain ?? before;
    if (!("clear" in action) && name === null) return { status: "no_domain" };
    const replacing = domain !== null && before !== null && before !== domain;
    if (replacing && !("set" in action && action.replace)) {
      return { status: "has_other", before: before ?? "" };
    }
    // DNS now, before any lock.
    const dns =
      name !== null && !("clear" in action) ? await lookUp(name, target, deps.resolveCname) : null;

    await owner.query("begin");
    try {
      await owner.query("select set_config('app.current_firm_id', $1, true)", [firmId]);
      // Held against another run at the same time, without blocking the firm's other writes
      // (NO KEY UPDATE doesn't stop rows that refer to the firm being inserted).
      const { rows } = await owner.query<{ domain: string | null; verified: boolean }>(
        "select custom_domain as domain, domain_verified as verified from firms where id = $1 for no key update",
        [firmId],
      );
      const firm = rows[0];
      if (!firm) throw new Error("the firm's row wasn't there inside its own transaction");
      if (firm.domain !== before) {
        await owner.query("rollback");
        return { status: "busy" };
      }
      const save = async (
        next: string | null,
        verified: boolean,
        change: "set" | "verified" | "unverified" | "cleared",
      ) => {
        await owner.query(
          "update firms set custom_domain = $2, domain_verified = $3 where id = $1",
          [firmId, next, verified],
        );
        await owner.query(
          `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
           values ($1, 'system', $2, 'firm', $1, $3)`,
          [
            firmId,
            DOMAIN_CHANGED,
            JSON.stringify({
              change,
              verified,
              domain: next ?? firm.domain,
              ...(change === "set" && firm.domain !== null ? { before: firm.domain } : {}),
            }),
          ],
        );
      };

      if ("clear" in action) {
        await save(null, false, "cleared");
        await owner.query("commit");
        return { status: "cleared", before: before ?? "" };
      }
      const { verified, found } = dns ?? { verified: false, found: [] };
      if (domain !== null && domain !== firm.domain) {
        await save(domain, verified, "set");
        await owner.query("commit");
        return { status: "saved", domain, verified, found, target };
      }
      const changed = verified !== firm.verified;
      if (changed) await save(name, verified, verified ? "verified" : "unverified");
      await owner.query(changed ? "commit" : "rollback");
      return { status: "checked", domain: name ?? "", verified, changed, found, target };
    } catch (err) {
      await owner.query("rollback").catch(() => undefined);
      if ((err as { code?: string }).code === "23505") return { status: "taken" };
      throw err;
    }
  } finally {
    await owner.end();
  }
}

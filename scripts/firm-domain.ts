import { resolveCname } from "node:dns/promises";
import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { setCustomDomain, type DomainAction } from "./firm-domain-owner";

// Sets, checks or clears a firm's own domain (Phase 8). The firm first adds a CNAME record at their
// DNS provider: from the name they want (shifts.acme.co.uk) to their own subdomain,
// acme.<our domain>. Then:
//
//   npm run firm:domain -- --firm acme --domain shifts.acme.co.uk
//   npm run firm:domain -- --firm acme --check        (after they add the CNAME, or to re-check)
//   npm run firm:domain -- --firm acme --domain shifts.acme-events.co.uk --replace
//   npm run firm:domain -- --firm acme --clear
//
// It's served, and Caddy gets its certificate, only once verified. Uses the owner connection
// (DATABASE_ADMIN_URL) and APP_BASE_DOMAIN (our domain).

const USAGE =
  "Usage: npm run firm:domain -- --firm <slug> (--domain shifts.firm.co.uk [--replace] | --check | --clear)";

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        domain: { type: "string" },
        replace: { type: "boolean", default: false },
        check: { type: "boolean", default: false },
        clear: { type: "boolean", default: false },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const chosen = [values.domain !== undefined, values.check, values.clear].filter(Boolean).length;
const baseDomain = process.env.APP_BASE_DOMAIN;
if (!values.firm || chosen !== 1 || (values.replace && values.domain === undefined)) {
  console.error(USAGE);
  process.exit(2);
}
if (!baseDomain) {
  console.error("APP_BASE_DOMAIN must be set (our own domain, e.g. shiftdesk.co.uk).");
  process.exit(2);
}

const action: DomainAction =
  values.domain !== undefined
    ? { set: values.domain, replace: values.replace }
    : values.check
      ? { check: true }
      : { clear: true };
const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
const cnameWords = (found: string[]) =>
  found.length === 0 ? "it has no CNAME yet" : `its CNAME points to ${found.join(", ")}`;

try {
  const result = await setCustomDomain(adminUrl, values.firm, action, { baseDomain, resolveCname });
  switch (result.status) {
    case "saved":
    case "checked":
      console.log(
        result.verified
          ? `${result.domain} is verified for ${values.firm} (its CNAME points to ${result.target}), in ${where}. It's served now; the first visit gets its certificate.`
          : `${result.domain} is saved for ${values.firm} but not verified: ${cnameWords(result.found)}. Ask the firm to add a CNAME (DNS only, not proxied) from ${result.domain} to ${result.target}, then run this again with --check.`,
      );
      break;
    case "cleared":
      console.log(
        `${values.firm} has no custom domain now (it was ${result.before}), in ${where}.`,
      );
      break;
    case "unchanged":
      console.log("Nothing to clear: that firm has no custom domain.");
      break;
    case "no_firm":
      console.log(`There's no firm with the slug "${values.firm}" in ${where}.`);
      break;
    case "no_domain":
      console.log("That firm has no custom domain to check. Set one with --domain.");
      break;
    case "bad_domain":
      console.log(
        "That isn't a domain we can use. Use a name like shifts.acme.co.uk (not our own domain or anything under it).",
      );
      break;
    case "taken":
      console.log("Another firm already has that domain. Each domain belongs to one firm.");
      break;
    case "busy":
      console.log(
        "The domain changed while it was being checked. Nothing was changed: run it again.",
      );
      break;
    case "has_other":
      console.log(
        `${values.firm} already has ${result.before}. To change it, run the same command with --replace.`,
      );
      break;
  }
  process.exit(["saved", "checked", "cleared", "unchanged"].includes(result.status) ? 0 : 1);
} catch (err) {
  console.error(`Setting the domain failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

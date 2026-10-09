import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { withFirm } from "../src/lib/db/scoped";
import { SECTORS } from "../src/lib/db/schema";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { createFirm } from "./firm-create-owner";

// Creates a pilot firm: its row, its sector's credential rules and its first admin (Phase 9;
// docs/runbooks.md "Onboarding a pilot firm"). Uses the owner connection (DATABASE_ADMIN_URL) for
// the firm's row and the app connection (DATABASE_URL) for the rest.
//
//   npm run -s firm:create -- --slug acme --name "Acme Events" --sector security \
//     --admin-email jo@acme-events.example --admin-name "Jo Bloggs"

const USAGE = `Usage: npm run firm:create -- --slug <slug> --name "…" --sector ${SECTORS.join("|")} --admin-email <email> --admin-name "…"`;

function readArgs() {
  try {
    return parseArgs({
      options: {
        slug: { type: "string" },
        name: { type: "string" },
        sector: { type: "string" },
        "admin-email": { type: "string" },
        "admin-name": { type: "string" },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const slug = values.slug?.trim().toLowerCase();
const name = values.name;
const sector = values.sector;
const adminEmail = values["admin-email"];
const adminName = values["admin-name"];
if (!slug || !name || !sector || !adminEmail || !adminName) {
  console.error(USAGE);
  process.exit(2);
}

const WHY = {
  slug: "The slug must be 2 to 20 lowercase letters, numbers or hyphens, not starting or ending with a hyphen (and not www, portal, api, app or admin): it becomes <slug>.<our domain>.",
  name: "The name must be 2 to 80 characters.",
  sector: `The sector must be one of: ${SECTORS.join(", ")}.`,
  adminEmail: "The admin's email doesn't look like an email address.",
  adminName: "The admin's name must be 2 to 80 characters.",
} as const;

const env = adminEnv();
const adminUrl = env.DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
// The firm's row is made with one login and the rest with the other: both must be the same database.
const place = (url: string) => `${new URL(url).hostname}/${databaseName(url)}`;
if (place(adminUrl) !== place(env.DATABASE_URL)) {
  console.error(
    "DATABASE_ADMIN_URL and DATABASE_URL point at different databases. Nothing was changed.",
  );
  process.exit(1);
}
try {
  const result = await createFirm(adminUrl, withFirm, {
    slug,
    name,
    sector,
    adminEmail,
    adminName,
  });
  switch (result.status) {
    case "created":
      console.log(
        `${result.resumed ? `Finished setting up (it was created ${result.createdAt.toISOString()})` : "Created"} ${name} (${slug}) in ${where}: ${result.typesAdded} credential types and ${result.rulesAdded} rules from the ${sector} pack, and its admin.`,
      );
      console.log(`Next: npm run -s firm:check -- --firm ${slug}`);
      break;
    case "taken":
      console.log(`The slug "${slug}" is already taken in ${where}. Nothing was changed.`);
      break;
    case "bad":
      console.log(`${WHY[result.field]} Nothing was changed.`);
      break;
  }
  process.exit(result.status === "created" ? 0 : 1);
} catch (err) {
  console.error(
    `Creating the firm failed (${errorCode(err)}). Run the same command again to finish it.`,
  );
  process.exit(1);
}

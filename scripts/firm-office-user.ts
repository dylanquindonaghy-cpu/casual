import { parseArgs } from "node:util";
import { resolveFirmBySlug } from "../src/lib/db/directory";
import { withFirm } from "../src/lib/db/scoped";
import { errorCode } from "../src/lib/jobs/firm-job";
import { addOfficeUser, OFFICE_ROLES_TO_ADD } from "./firm-create-owner";

// Gives someone office access at a firm: a resourcer, payroll, or another admin (Phase 9;
// docs/runbooks.md "Onboarding a pilot firm"). As the app role inside the firm (DATABASE_URL).
// They log in at <slug>.<our domain>/office with a link sent to that email.
//
//   npm run -s firm:office-user -- --firm acme --role resourcer --email sam@acme-events.example --name "Sam Rota"

const USAGE = `Usage: npm run firm:office-user -- --firm <slug> --role ${OFFICE_ROLES_TO_ADD.join("|")} --email <email> --name "…"`;

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        role: { type: "string" },
        email: { type: "string" },
        name: { type: "string" },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
if (!values.firm || !values.role || !values.email || !values.name) {
  console.error(USAGE);
  process.exit(2);
}
const WHY = {
  email: "That doesn't look like an email address.",
  name: "The name must be 2 to 80 characters.",
  role: `The role must be one of: ${OFFICE_ROLES_TO_ADD.join(", ")}.`,
} as const;
try {
  const slug = values.firm.trim().toLowerCase();
  const firm = await resolveFirmBySlug(slug);
  const result = await addOfficeUser(withFirm, firm?.id ?? null, {
    email: values.email,
    name: values.name,
    role: values.role,
  });
  switch (result.status) {
    case "added":
      console.log(`Added: they can now log in to ${slug}'s office as ${values.role}.`);
      break;
    case "already":
      console.log(
        `That email already has a ${slug} office login (${result.role}, ${result.active ? "active" : "disabled"}). Nothing was changed.`,
      );
      break;
    case "no_firm":
      console.log(`There's no firm with the slug "${slug}".`);
      break;
    case "bad":
      console.log(`${WHY[result.field]} Nothing was changed.`);
      break;
  }
  process.exit(result.status === "added" ? 0 : 1);
} catch (err) {
  console.error(`Adding the office user failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

import { parseArgs } from "node:util";
import { resolveFirmBySlug } from "../src/lib/db/directory";
import { withFirm } from "../src/lib/db/scoped";
import { errorCode } from "../src/lib/jobs/firm-job";
import { changeOfficeAccess, type OfficeAccessChange } from "../src/lib/office/team";
import { teamResultText } from "../src/lib/office/team-copy";
import { addOfficeUser, OFFICE_ROLES_TO_ADD } from "./firm-create-owner";

// Gives someone office access at a firm: a resourcer, payroll, or another admin (Phase 9;
// docs/runbooks.md "Onboarding a pilot firm"). As the app role inside the firm (DATABASE_URL).
// They log in at <slug>.<our domain>/office with a link sent to that email.
//
//   npm run -s firm:office-user -- --firm acme --role resourcer --email sam@acme-events.example --name "Sam Rota"
//
// And changes someone's access, as the firm's admins can on the office team page (Phase 10;
// docs/runbooks.md "Someone leaves the office, or loses a laptop"), logged as the system:
//
//   npm run -s firm:office-user -- --firm acme --email sam@acme-events.example --disable
//   ... --enable | --set-role payroll | --sign-out

const USAGE = [
  `Usage: npm run firm:office-user -- --firm <slug> --role ${OFFICE_ROLES_TO_ADD.join("|")} --email <email> --name "…"`,
  "   or: npm run firm:office-user -- --firm <slug> --email <email> --disable | --enable | --sign-out",
  `   or: npm run firm:office-user -- --firm <slug> --email <email> --set-role ${OFFICE_ROLES_TO_ADD.join("|")}`,
].join("\n");

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        role: { type: "string" },
        email: { type: "string" },
        name: { type: "string" },
        disable: { type: "boolean" },
        enable: { type: "boolean" },
        "sign-out": { type: "boolean" },
        "set-role": { type: "string" },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const changes = [
  values.disable ? ({ kind: "disable" } as const) : null,
  values.enable ? ({ kind: "enable" } as const) : null,
  values["sign-out"] ? ({ kind: "sign_out" } as const) : null,
  values["set-role"] !== undefined ? ("role" as const) : null,
].filter((c) => c !== null);

if (changes.length > 0) {
  // A change: exactly one, to someone already there (no --role or --name, which are for adding).
  if (changes.length > 1 || !values.firm || !values.email || values.role || values.name) {
    console.error(USAGE);
    process.exit(2);
  }
  const [only] = changes;
  const setRole = values["set-role"] ?? "";
  if (only === "role" && !(OFFICE_ROLES_TO_ADD as readonly string[]).includes(setRole)) {
    console.log(`The role must be one of: ${OFFICE_ROLES_TO_ADD.join(", ")}. Nothing was changed.`);
    process.exit(1);
  }
  if (only === undefined) throw new Error("no change chosen");
  const change: OfficeAccessChange =
    only === "role"
      ? { kind: "role", role: setRole as (typeof OFFICE_ROLES_TO_ADD)[number] }
      : only;
  try {
    const slug = values.firm.trim().toLowerCase();
    const firm = await resolveFirmBySlug(slug);
    if (!firm) {
      console.log(`There's no firm with the slug "${slug}".`);
      process.exit(1);
    }
    const result = await changeOfficeAccess(withFirm, firm.id, {
      person: { email: values.email },
      change,
      by: { type: "system" },
    });
    console.log(
      result.status === "not_found"
        ? `That email has no ${slug} office login. Nothing was changed.`
        : teamResultText(result),
    );
    process.exit(result.status === "done" || result.status === "unchanged" ? 0 : 1);
  } catch (err) {
    console.error(`Changing their access failed (${errorCode(err)}). Nothing was changed.`);
    process.exit(1);
  }
}

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

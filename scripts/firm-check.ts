import { parseArgs } from "node:util";
import { resolveFirmBySlug } from "../src/lib/db/directory";
import { withFirm } from "../src/lib/db/scoped";
import { errorCode } from "../src/lib/jobs/firm-job";
import { firmReadiness, readinessText } from "../src/lib/onboarding/readiness";

// The pilot onboarding checklist for one firm, from its data (Phase 9; docs/runbooks.md
// "Onboarding a pilot firm"): what's done, what's left, and what to confirm yourself. Read-only,
// as the app role inside the firm (DATABASE_URL). Prints counts, role names and settings only.
//
//   npm run -s firm:check -- --firm acme

const USAGE = "Usage: npm run firm:check -- --firm <slug>";

function readArgs() {
  try {
    return parseArgs({ options: { firm: { type: "string" } } }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
if (!values.firm) {
  console.error(USAGE);
  process.exit(2);
}
try {
  const firm = await resolveFirmBySlug(values.firm.trim().toLowerCase());
  if (!firm) {
    console.log(`There's no firm with the slug "${values.firm}".`);
    process.exit(1);
  }
  const items = await withFirm(firm.id, (tx) => firmReadiness(tx));
  console.log(readinessText(firm.name, items));
  process.exit(0);
} catch (err) {
  console.error(`The check failed (${errorCode(err)}).`);
  process.exit(1);
}

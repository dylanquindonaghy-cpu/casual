import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { localDateOf } from "../src/lib/time/zoned";
import { firmAgreement, signingDay } from "./firm-agreement-owner";

// Records the day a firm's agreement and DPA were signed (Gate B; docs/runbooks.md "Onboarding a
// pilot firm"), or shows it. Uses the owner connection (DATABASE_ADMIN_URL). Until it's recorded,
// the live server takes no real staff data for the firm: imports save nothing and no rota sheet
// is connected.
//
//   npm run -s firm:agreement -- --firm acme                     (shows it)
//   npm run -s firm:agreement -- --firm acme --signed 04/10/2026 (the day both were signed)
//   npm run -s firm:agreement -- --firm acme --clear             (recorded on the wrong firm)

const USAGE = "Usage: npm run firm:agreement -- --firm <slug> [--signed <dd/mm/yyyy> | --clear]";

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        signed: { type: "string" },
        clear: { type: "boolean", default: false },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
if (!values.firm || (values.clear && values.signed !== undefined)) {
  console.error(USAGE);
  process.exit(2);
}
const slug = values.firm.trim().toLowerCase();
// Today in London, where the paperwork is signed (UTC's date is a day behind before 01:00 BST).
const today = localDateOf(new Date(), "Europe/London");
let signedOn: string | null | "clear" = values.clear ? "clear" : null;
if (values.signed !== undefined) {
  signedOn = signingDay(values.signed, today);
  if (!signedOn) {
    console.error(
      "--signed must be the day both were signed, like 04/10/2026: a real date, not in the future.",
    );
    process.exit(2);
  }
}

const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
try {
  const result = await firmAgreement(adminUrl, slug, signedOn);
  switch (result.status) {
    case "no_firm":
      console.log(`There's no firm with the slug "${slug}" in ${where}.`);
      process.exit(1);
    case "shown":
      console.log(
        result.signedOn
          ? `${slug}'s agreement and DPA are recorded as signed on ${result.signedOn}, in ${where}.`
          : `${slug}'s agreement and DPA aren't recorded as signed, in ${where}. Until they are, the live server takes no real staff data for ${slug}.`,
      );
      break;
    case "unchanged":
      console.log(`Nothing to change: already recorded as signed on ${result.signedOn}.`);
      break;
    case "cleared":
      console.log(
        `Removed: ${slug} no longer has an agreement recorded (it said ${result.was}), in ${where}. The live server takes no real staff data for ${slug} until one is recorded.`,
      );
      break;
    case "recorded":
      console.log(
        `Recorded: ${slug}'s agreement and DPA signed on ${result.signedOn}${result.was ? ` (was ${result.was})` : ""}, in ${where}. Real staff data can be imported for ${slug} now.`,
      );
  }
  process.exit(0);
} catch (err) {
  console.error(`Recording it failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { setShiftsLine } from "./shifts-line-owner";

// Sets (or clears) a firm's shifts line: the number we bought for it in Twilio, which its
// WhatsApps and texts go from and which staff message. Uses the owner connection
// (DATABASE_ADMIN_URL). Changing a number the firm already has needs --replace (a typo would
// otherwise leave the real number with no firm, and its messages would be dropped).
//
//   npm run firm:line -- --firm acme --number "+44 7700 900000"
//   npm run firm:line -- --firm acme --number "+44 7700 900111" --replace
//   npm run firm:line -- --firm acme --clear

const USAGE =
  'Usage: npm run firm:line -- --firm <slug> (--number "+44 7700 900000" [--replace] | --clear)';

// An unknown or malformed option gets the usage line, not a stack trace (audit L82).
function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        number: { type: "string" },
        clear: { type: "boolean", default: false },
        replace: { type: "boolean", default: false },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
if (!values.firm || (!values.number && !values.clear) || (values.number && values.clear)) {
  console.error(USAGE);
  process.exit(2);
}

const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
try {
  const result = await setShiftsLine(
    adminUrl,
    values.firm,
    values.clear ? null : (values.number ?? null),
    { replace: values.replace },
  );
  const was = (before: string | null) => (before ? ` (it was ${before})` : "");
  switch (result.status) {
    case "set":
      console.log(
        `The shifts line for ${values.firm} is now ${result.number}${was(result.before)}, in ${where}.`,
      );
      break;
    case "cleared":
      console.log(`${values.firm} has no shifts line now${was(result.before)}, in ${where}.`);
      break;
    case "unchanged":
      console.log("Nothing to change: that's already how it is.");
      break;
    case "no_firm":
      console.log(`There's no firm with the slug "${values.firm}" in ${where}.`);
      break;
    case "taken":
      console.log("Another firm already has that number. Each number belongs to one firm.");
      break;
    case "has_other":
      console.log(
        `${values.firm} already has ${result.before}. To change it, run the same command with --replace.`,
      );
      break;
    case "bad_number":
      console.log("That isn't a phone number we can read. Use +44 7700 900000 or 07700 900000.");
      break;
  }
  process.exit(["set", "cleared", "unchanged"].includes(result.status) ? 0 : 1);
} catch (err) {
  console.error(`Setting the shifts line failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

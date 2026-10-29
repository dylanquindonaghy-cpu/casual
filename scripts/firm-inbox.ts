import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { setInbox } from "./inbox-owner";

// Sets (or clears) a firm's staffing inbox (P7.1): its address at our email provider, which its
// own staffing mailbox forwards to. Uses the owner connection (DATABASE_ADMIN_URL). Changing an
// address the firm already has needs --replace (a typo would otherwise leave the real address with
// no firm, and its emails would be dropped).
//
//   npm run firm:inbox -- --firm acme --address staffing-acme@inbound.example.com
//   npm run firm:inbox -- --firm acme --address staffing2-acme@inbound.example.com --replace
//   npm run firm:inbox -- --firm acme --clear

const USAGE =
  "Usage: npm run firm:inbox -- --firm <slug> (--address <address> [--replace] | --clear)";

// An unknown or malformed option gets the usage line, not a stack trace (audit L82).
function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        address: { type: "string" },
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
if (!values.firm || (!values.address && !values.clear) || (values.address && values.clear)) {
  console.error(USAGE);
  process.exit(2);
}

const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
try {
  const result = await setInbox(
    adminUrl,
    values.firm,
    values.clear ? null : (values.address ?? null),
    { replace: values.replace },
  );
  const was = (before: string | null) => (before ? ` (it was ${before})` : "");
  switch (result.status) {
    case "set":
      console.log(
        `The staffing inbox for ${values.firm} is now ${result.address}${was(result.before)}, in ${where}.`,
      );
      break;
    case "cleared":
      console.log(`${values.firm} has no staffing inbox now${was(result.before)}, in ${where}.`);
      break;
    case "unchanged":
      console.log("Nothing to change: that's already how it is.");
      break;
    case "no_firm":
      console.log(`There's no firm with the slug "${values.firm}" in ${where}.`);
      break;
    case "taken":
      console.log("Another firm already has that address. Each address belongs to one firm.");
      break;
    case "has_other":
      console.log(
        `${values.firm} already has ${result.before}. To change it, run the same command with --replace.`,
      );
      break;
    case "bad_address":
      console.log(
        "That isn't an email address we can read. Use staffing-acme@inbound.example.com.",
      );
      break;
  }
  process.exit(["set", "cleared", "unchanged"].includes(result.status) ? 0 : 1);
} catch (err) {
  console.error(`Setting the staffing inbox failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

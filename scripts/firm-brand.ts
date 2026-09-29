import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { setFirmBrand, type BrandChanges } from "./firm-brand-owner";

// Sets a firm's brand: the name, logo, colour and sign-off its staff see on the portal and in
// every message (Phase 8). Uses the owner connection (DATABASE_ADMIN_URL). Give only what changes.
// The sign-off always ends "Shift Team" (golden rule 8): only the name part can be shorter.
//
//   npm run firm:brand -- --firm acme --colour "#1d4ed8"
//   npm run firm:brand -- --firm acme --logo "https://www.acme-events.example/logo.png"
//   npm run firm:brand -- --firm acme --name "Acme Events Ltd" --sign-off "Acme Shift Team"
//   npm run firm:brand -- --firm acme --no-logo --default-sign-off

const USAGE =
  'Usage: npm run firm:brand -- --firm <slug> [--name "…"] [--colour "#1d4ed8"] [--logo https://… | --no-logo] [--sign-off "Acme Shift Team" | --default-sign-off]';

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        name: { type: "string" },
        colour: { type: "string" },
        color: { type: "string" }, // the American spelling works too
        logo: { type: "string" },
        "no-logo": { type: "boolean", default: false },
        "sign-off": { type: "string" },
        "default-sign-off": { type: "boolean", default: false },
      },
    }).values;
  } catch {
    // An option it doesn't know (a typo, say): the usage, not a stack trace.
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const colour = values.colour ?? values.color;
const changes: BrandChanges = {
  ...(values.name !== undefined ? { name: values.name } : {}),
  ...(colour !== undefined ? { colour } : {}),
  ...(values.logo !== undefined ? { logo: values.logo } : values["no-logo"] ? { logo: null } : {}),
  ...(values["sign-off"] !== undefined
    ? { signOff: values["sign-off"] }
    : values["default-sign-off"]
      ? { signOff: null }
      : {}),
};
const clash =
  (values.logo !== undefined && values["no-logo"]) ||
  (values["sign-off"] !== undefined && values["default-sign-off"]) ||
  (values.colour !== undefined && values.color !== undefined);
if (!values.firm || Object.keys(changes).length === 0 || clash) {
  console.error(USAGE);
  process.exit(2);
}

const WHY = {
  name: "The name must be 2 to 80 characters.",
  colour: 'The colour must be a hex colour like "#1d4ed8".',
  logo: "The logo must be an https:// address (at most 500 characters).",
  signOff:
    'The sign-off must end "Shift Team", like "Acme Shift Team" (letters, numbers, spaces or & \' . - before it).',
} as const;

const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
try {
  const result = await setFirmBrand(adminUrl, values.firm, changes);
  switch (result.status) {
    case "saved":
      console.log(`Saved ${result.fields.join(", ")} for ${values.firm}, in ${where}.`);
      break;
    case "unchanged":
      console.log("Nothing to change: that's already how it is.");
      break;
    case "no_firm":
      console.log(`There's no firm with the slug "${values.firm}" in ${where}.`);
      break;
    case "bad":
      console.log(`${WHY[result.field]} Nothing was changed.`);
      break;
  }
  process.exit(result.status === "saved" || result.status === "unchanged" ? 0 : 1);
} catch (err) {
  console.error(`Setting the brand failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

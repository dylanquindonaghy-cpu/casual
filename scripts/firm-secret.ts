import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { SECRET_MAX_BYTES, secretsKey } from "../src/lib/secret-store/crypto";
import { listSecrets, removeSecret, setSecret } from "./firm-secret-owner";

// Sets, removes or lists a firm's secrets (P5.1; docs/runbooks.md "A firm's secrets"): its own
// credentials for its systems, sealed with SECRETS_KEY before they reach the database. Uses the
// owner connection (DATABASE_ADMIN_URL) and SECRETS_KEY (the worker's own, so the worker can open
// them). The value is read from standard input, never an argument (it would sit in the shell's
// history and the process list), and is never printed.
//
//   npm run -s firm:secret -- --firm acme                                  (names and dates only)
//   printf '%s' "$KEY" | npm run -s firm:secret -- --firm acme --name portal.api_key
//   npm run -s firm:secret -- --firm acme --name portal.api_key --remove

const USAGE =
  "Usage: npm run firm:secret -- --firm <slug> [--name <name> [--remove]] (a value: on standard input)";

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        name: { type: "string" },
        remove: { type: "boolean", default: false },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
if (!values.firm || (values.remove && values.name === undefined)) {
  console.error(USAGE);
  process.exit(2);
}
const slug = values.firm.trim().toLowerCase();
const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;

try {
  if (values.name === undefined) {
    const result = await listSecrets(adminUrl, slug);
    if (result.status === "no_firm") {
      console.log(`There's no firm with the slug "${slug}" in ${where}.`);
      process.exit(1);
    }
    console.log(
      result.rows.length === 0
        ? `${slug} has no secrets.`
        : `${slug}'s secrets (names only):\n${result.rows
            .map((r) => `  ${r.name}   set ${r.updatedAt.toISOString()} (key ${r.keyId})`)
            .join("\n")}`,
    );
    process.exit(0);
  }
  const name = values.name.trim();
  if (values.remove) {
    const result = await removeSecret(adminUrl, slug, name);
    console.log(
      result.status === "removed"
        ? `Removed ${name} from ${slug}'s secrets, in ${where}.`
        : result.status === "not_there"
          ? `${slug} has no secret called ${name}. Nothing was changed.`
          : result.status === "no_firm"
            ? `There's no firm with the slug "${slug}" in ${where}.`
            : `"${name}" isn't a secret's name (lower case words joined by dots, like portal.api_key).`,
    );
    process.exit(result.status === "removed" ? 0 : 1);
  }
  const key = secretsKey(process.env.SECRETS_KEY ?? "");
  if (!key) {
    console.error(
      "SECRETS_KEY isn't set to 32 random bytes in base64 (the worker's: openssl rand -base64 32).",
    );
    process.exit(2);
  }
  if (process.stdin.isTTY) {
    console.error(`Give the value on standard input, not typed here. ${USAGE}`);
    process.exit(2);
  }
  // One trailing newline (from echo or a file) isn't part of the value.
  const value = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (value.length === 0) {
    console.error("The value on standard input is empty. Nothing was changed.");
    process.exit(2);
  }
  if (Buffer.byteLength(value, "utf8") > SECRET_MAX_BYTES) {
    console.error(`The value is over ${SECRET_MAX_BYTES} bytes. Nothing was changed.`);
    process.exit(2);
  }
  const result = await setSecret(adminUrl, slug, key, name, value);
  switch (result.status) {
    case "added":
    case "replaced":
      console.log(
        `${result.status === "added" ? "Added" : "Replaced"} ${name} for ${slug}, in ${where}.`,
      );
      process.exit(0);
      break;
    case "no_firm":
      console.log(`There's no firm with the slug "${slug}" in ${where}.`);
      break;
    default:
      console.log(
        `"${name}" isn't a secret's name (lower case words joined by dots, like portal.api_key).`,
      );
  }
  process.exit(1);
} catch (err) {
  console.error(`Changing the firm's secrets failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import {
  isSettingKey,
  SETTING_KEYS,
  SETTING_WORDS,
  type EffectiveSetting,
  type SettingKey,
} from "../src/lib/onboarding/settings";
import { readFirmSettings, setFirmSettings } from "./firm-settings-owner";

// Shows or sets a firm's settings: the ones the onboarding checklist asks the firm to agree (Phase
// 9; docs/runbooks.md "Onboarding a pilot firm"). Uses the owner connection (DATABASE_ADMIN_URL).
// Nothing given after --firm: shows them, as the app reads them.
//
//   npm run -s firm:settings -- --firm acme
//   npm run -s firm:settings -- --firm acme --set urgent_window_hours=12 --set quiet_hours.start=21:30

const USAGE = `Usage: npm run firm:settings -- --firm <slug> [--set key=value …]. Keys: ${SETTING_KEYS.join(", ")}.`;

function readArgs() {
  try {
    return parseArgs({
      options: { firm: { type: "string" }, set: { type: "string", multiple: true } },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const changes: [SettingKey, string][] = [];
for (const pair of values.set ?? []) {
  const at = pair.indexOf("=");
  const key = at > 0 ? pair.slice(0, at).trim() : "";
  if (!isSettingKey(key)) {
    console.error(`"${pair}" isn't key=value with a known key. ${USAGE}`);
    process.exit(2);
  }
  changes.push([key, pair.slice(at + 1)]);
}
if (!values.firm) {
  console.error(USAGE);
  process.exit(2);
}
const slug = values.firm.trim().toLowerCase();

const show = (settings: EffectiveSetting[]) =>
  settings
    .map(
      (s) =>
        `  ${s.key} = ${String(s.value)}${s.source === "default" ? " (default)" : ""}   ${SETTING_WORDS[s.key]}`,
    )
    .join("\n");

const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
try {
  if (changes.length === 0) {
    const result = await readFirmSettings(adminUrl, slug);
    if (result.status === "no_firm") {
      console.log(`There's no firm with the slug "${slug}" in ${where}.`);
      process.exit(1);
    }
    console.log(`${slug}'s settings, as the app reads them:\n${show(result.settings)}`);
    process.exit(0);
  }
  const result = await setFirmSettings(adminUrl, slug, changes);
  switch (result.status) {
    case "saved":
      console.log(
        `Saved ${result.keys.join(", ")} for ${slug}, in ${where}. Now:\n${show(result.settings)}`,
      );
      break;
    case "unchanged":
      console.log("Nothing to change: that's already how it is.");
      break;
    case "no_firm":
      console.log(`There's no firm with the slug "${slug}" in ${where}.`);
      break;
    case "bad":
      console.log(
        `That isn't a value the app would use for ${result.key} (${SETTING_WORDS[result.key]}). Nothing was changed.`,
      );
      break;
  }
  process.exit(result.status === "saved" || result.status === "unchanged" ? 0 : 1);
} catch (err) {
  console.error(`Changing the settings failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

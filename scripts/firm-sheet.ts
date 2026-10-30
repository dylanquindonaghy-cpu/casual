import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { syncErrorWords } from "../src/lib/roster/sheets/error-words";
import { loadServiceAccountKey } from "../src/lib/roster/sheets/google";
import { sheetMappingSchema, type SheetMapping } from "../src/lib/roster/sheets/mapping";
import {
  connectSheet,
  disableSheet,
  forgetSheet,
  showSheet,
  spreadsheetIdFrom,
  type SheetSource,
} from "./firm-sheet-owner";

// Connects, replaces, switches off or shows a firm's Google Sheet (PLAN.md Parking lot, "Connect
// the real Google Sheets"; docs/runbooks.md "Google Sheets sync failing"). Owner only: uses the
// owner connection (DATABASE_ADMIN_URL). A spreadsheet can belong to one firm only.
//
//   npm run -s firm:sheet -- --firm acme                       (where it stands)
//   npm run -s firm:sheet -- --firm acme --sheet <link or id>  (connect, default columns: also
//                                                               when connecting a sheet again)
//   npm run -s firm:sheet -- --firm acme --sheet <link> --mapping columns.json
//   npm run -s firm:sheet -- --firm acme --sheet <link> --replace [--same-ids]
//   npm run -s firm:sheet -- --firm acme --disable
//   npm run -s firm:sheet -- --firm acme --forget --sheet <link>  (let a switched-off sheet go)
//
// The sync reads the sheet only when the worker runs with SHEETS_TRANSPORT=google.

const USAGE =
  "Usage: npm run firm:sheet -- --firm <slug> [--sheet <link or id> [--mapping <file.json>] [--replace] [--same-ids] | --disable | --forget --sheet <link or id>]";

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        sheet: { type: "string" },
        mapping: { type: "string" },
        replace: { type: "boolean", default: false },
        "same-ids": { type: "boolean", default: false },
        disable: { type: "boolean", default: false },
        forget: { type: "boolean", default: false },
      },
    }).values;
  } catch {
    console.error(USAGE);
    process.exit(2);
  }
}

const values = readArgs();
const connecting = values.mapping !== undefined || values.replace || values["same-ids"];
if (
  !values.firm ||
  (values.disable && (values.sheet !== undefined || values.forget)) ||
  (values.forget && (values.sheet === undefined || connecting)) ||
  (values.sheet === undefined && connecting)
) {
  console.error(USAGE);
  process.exit(2);
}
const slug = values.firm.trim().toLowerCase();

function readMapping(path: string): SheetMapping {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.error(`Can't read ${path} as a JSON file.`);
    process.exit(2);
  }
  const parsed = sheetMappingSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      `${path} isn't a column mapping (see DEFAULT_SHEET_MAPPING in src/lib/roster/sheets/mapping.ts for its shape).`,
    );
    process.exit(2);
  }
  return parsed.data;
}

// The service account's email, when this machine has its key: what the firm shares its sheet with.
function serviceAccountEmail(): string | null {
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (!path) return null;
  try {
    return loadServiceAccountKey(path).client_email;
  } catch {
    return null;
  }
}

const shareStep = () => {
  const email = serviceAccountEmail();
  return email
    ? `The firm shares the sheet with ${email} (as Editor).`
    : "The firm shares the sheet with our service account's email (as Editor): it's the client_email in the key file.";
};

const when = (d: Date | null) => (d ? d.toISOString() : "never");
const describe = (s: SheetSource) =>
  [
    `  Sheet: https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit`,
    `  ${s.enabled ? "On: the sync reads it." : "Off: the sync doesn't read it."}`,
    `  Columns: ${s.defaultMapping ? "the default headings" : "a mapping of their own"}`,
    `  Last synced: ${when(s.lastSyncedAt)}. Last tried: ${when(s.lastAttemptedAt)}.`,
    s.lastErrorCode
      ? `  Failing: ${syncErrorWords(s.lastErrorCode)} (${s.lastErrorCode}).`
      : "  No error.",
  ].join("\n");

const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
const noFirm = () => {
  console.log(`There's no firm with the slug "${slug}" in ${where}.`);
  process.exit(1);
};

const sheetIdOrExit = (input: string): string => {
  const id = spreadsheetIdFrom(input);
  if (!id) {
    console.error(
      "That isn't a Google Sheets link (https://docs.google.com/spreadsheets/d/…) or a spreadsheet id.",
    );
    process.exit(2);
  }
  return id;
};

try {
  if (values.disable) {
    const result = await disableSheet(adminUrl, slug);
    if (result.status === "no_firm") noFirm();
    console.log(
      result.status === "disabled"
        ? `${slug}'s sheet is switched off, in ${where}. Nothing more is read from it, and nothing more written to it once a sync already running ends.
` +
            "Its shifts stay here as they are: workers can't book them, and the office can't change them in the app (it's told to change them in the sheet). People already booked stay booked. Connect a sheet again to bring them back to life."
        : `${slug} has no sheet switched on: nothing to do.`,
    );
    process.exit(0);
  }

  if (values.forget && values.sheet !== undefined) {
    const result = await forgetSheet(adminUrl, slug, sheetIdOrExit(values.sheet));
    switch (result.status) {
      case "no_firm":
        noFirm();
        break;
      case "forgotten":
        console.log(
          `${slug} no longer holds that sheet, in ${where}: another firm can connect it now. Its shifts and history here stay.`,
        );
        break;
      case "on":
        console.log(`That's ${slug}'s sheet now: switch it off first (--disable).`);
        process.exit(1);
      case "none":
        console.log(`${slug} has never had that sheet: nothing to do.`);
    }
    process.exit(0);
  }

  if (values.sheet !== undefined) {
    const spreadsheetId = sheetIdOrExit(values.sheet);
    const mapping = values.mapping === undefined ? undefined : readMapping(values.mapping);
    const result = await connectSheet(adminUrl, slug, {
      spreadsheetId,
      ...(mapping ? { mapping } : {}),
      replace: values.replace,
      sameIds: values["same-ids"],
    });
    switch (result.status) {
      case "no_firm":
        noFirm();
        break;
      case "connected":
        console.log(
          `${result.replaced ? "Replaced" : "Connected"} ${slug}'s sheet, in ${where}.\n` +
            `${shareStep()}\n` +
            "Its locale must be United Kingdom (File, Settings, Locale), or the sync refuses it.\n" +
            "The worker reads it at its next sync, if it's running with SHEETS_TRANSPORT=google (on the server, from the first deploy): within a minute on a day with shifts on, otherwise within 15. Check with:\n" +
            `  npm run -s firm:sheet -- --firm ${slug}`,
        );
        break;
      case "mapping_changed":
        console.log(
          `${slug}'s sheet is the same; its columns are now ${mapping ? "the mapping in that file" : "the default headings"}. The next sync reads it that way.`,
        );
        break;
      case "unchanged":
        console.log(
          `Nothing to change: that sheet is already connected, with ${mapping ? "those columns" : "the default headings"}.`,
        );
        break;
      case "booked_ahead":
        console.log(
          `${slug} has ${result.shifts === 1 ? "1 shift" : `${result.shifts} shifts`} ahead from a rota sheet with people booked. Shifts and staff are matched to the sheet by their Shift ID and Staff ID, so the sheet you're connecting must use the same ones (a copy of the old sheet, say): if it reused "S7" for another shift, its first sync would cancel or move the people booked on S7.\n` +
            "If it does use the same IDs, run the same command with --same-ids.",
        );
        process.exit(1);
      case "has_sheet":
        console.log(
          `${slug} already has another sheet switched on. To use this one instead, run the same command with --replace (the old one is switched off, not deleted).`,
        );
        process.exit(1);
      case "has_connector":
        console.log(
          `${slug} takes its rota from a connected system (a connector), so a sheet can't be switched on as well. Switch the connector off first.`,
        );
        process.exit(1);
      case "agreement_needed":
        console.log(
          `${slug}'s agreement and DPA aren't recorded as signed in ${where}, so its sheet (real staff) can't be connected yet. Record them first: npm run firm:agreement -- --firm ${slug} --signed <the date>.`,
        );
        process.exit(1);
      case "taken":
        console.log(
          "That sheet is already connected to another firm, so it can't be connected here. A sheet belongs to one firm only: check the link.",
        );
        process.exit(1);
    }
    process.exit(0);
  }

  const result = await showSheet(adminUrl, slug);
  if (result.status === "no_firm") noFirm();
  else if (!result.source) {
    console.log(`${slug} has no Google Sheet (its rota is kept in the app).`);
  } else {
    console.log(`${slug}'s Google Sheet:\n${describe(result.source)}`);
  }
  process.exit(0);
} catch (err) {
  console.error(`Couldn't change the sheet: ${errorCode(err)}.`);
  process.exit(1);
}

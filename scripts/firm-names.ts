import { parseArgs } from "node:util";
import { databaseName } from "../src/lib/db/admin/urls";
import { NAME_KINDS } from "../src/lib/db/schema";
import { adminEnv } from "../src/lib/env";
import { errorCode } from "../src/lib/jobs/firm-job";
import { pounds } from "../src/lib/portal/pay-format";
import { listNames, setName, type MappedNameRow, type NameField } from "./firm-names-owner";

// Shows or changes a firm's name map (P3.2; docs/runbooks.md "Onboarding a pilot firm"): what the
// firm's own system calls a role, a qualification, a staff type or a cancellation reason, and the
// ShiftDesk code it stands for, or skip. The rota sheet and the file import read role names through
// it. Uses the owner connection (DATABASE_ADMIN_URL). One change a run.
//
//   npm run -s firm:names -- --firm acme
//   npm run -s firm:names -- --firm acme --kind role --name "Door Supervisor (NLW)" --code door_supervisor --rate 12.21
//   npm run -s firm:names -- --firm acme --kind role --name "Holiday" --code skip
//   npm run -s firm:names -- --firm acme --kind role --name "Holiday" --remove

const USAGE = `Usage: npm run firm:names -- --firm <slug> [--kind ${NAME_KINDS.join("|")} --name "<their name>" (--code <code or skip> [--rate <£ an hour, roles only>] | --remove)]`;

function readArgs() {
  try {
    return parseArgs({
      options: {
        firm: { type: "string" },
        kind: { type: "string" },
        name: { type: "string" },
        code: { type: "string" },
        rate: { type: "string" },
        remove: { type: "boolean" },
      },
    }).values;
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
const slug = values.firm.trim().toLowerCase();
const changing = [values.kind, values.name, values.code, values.rate, values.remove].some(
  (v) => v !== undefined,
);
if (changing && (values.kind === undefined || values.name === undefined)) {
  console.error(USAGE);
  process.exit(2);
}

const line = (r: MappedNameRow) =>
  `  ${r.kind}: "${r.name}" -> ${r.code ?? "skip"}${r.payRatePence !== null ? ` (${pounds(r.payRatePence)} an hour)` : ""}`;

const WHY: Record<NameField, string> = {
  kind: `the kind is one of ${NAME_KINDS.join(", ")}`,
  name: "the name is 1 to 200 characters",
  code: "a role is letters, numbers and spaces (door supervisor); a qualification one of the firm's credential types; a staff type casual; a cancellation reason casual, firm, client or unknown; or skip. --remove takes no code",
  rate: "a pay rate is for a role that isn't skipped, in pounds an hour (12.21), at most £1,000",
};

const adminUrl = adminEnv().DATABASE_ADMIN_URL;
const where = `the ${databaseName(adminUrl)} database on ${new URL(adminUrl).hostname}`;
try {
  if (!changing) {
    const result = await listNames(adminUrl, slug);
    if (result.status === "no_firm") {
      console.log(`There's no firm with the slug "${slug}" in ${where}.`);
      process.exit(1);
    }
    console.log(
      result.rows.length === 0
        ? `${slug} has no name map: every name is read as ShiftDesk spells it.`
        : `${slug}'s name map:\n${result.rows.map(line).join("\n")}`,
    );
    process.exit(0);
  }
  const result = await setName(adminUrl, slug, {
    kind: values.kind ?? "",
    name: values.name ?? "",
    code: values.code,
    rate: values.rate,
    remove: values.remove,
  });
  switch (result.status) {
    case "saved":
      console.log(`Saved for ${slug}, in ${where}:\n${line(result.row)}`);
      if (result.noRule) {
        console.log(
          `Note: ${slug} has no credential rule for ${result.row.code ?? ""} yet, so its shifts can't be offered until it has one (npm run firm:check lists them).`,
        );
      }
      break;
    case "removed":
      console.log(`Removed from ${slug}'s name map, in ${where}.`);
      break;
    case "unchanged":
      console.log("Nothing to change: that's already how it is.");
      break;
    case "not_there":
      console.log("That name isn't on the map. Nothing was changed.");
      break;
    case "no_firm":
      console.log(`There's no firm with the slug "${slug}" in ${where}.`);
      break;
    case "bad":
      console.log(`That isn't allowed: ${WHY[result.field]}. Nothing was changed.`);
      break;
  }
  process.exit(["saved", "removed", "unchanged"].includes(result.status) ? 0 : 1);
} catch (err) {
  console.error(`Changing the name map failed (${errorCode(err)}). Nothing was changed.`);
  process.exit(1);
}

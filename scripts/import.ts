import { parseArgs } from "node:util";
import { resolveFirmBySlug } from "../src/lib/db/directory";
import { withFirm } from "../src/lib/db/scoped";
import { ImportFileError } from "../src/lib/imports/errors";
import { importFromFile, ImportSetupError } from "../src/lib/imports/from-file";
import { errorCode } from "../src/lib/jobs/firm-job";
import { FILE_ERROR_TEXT, summarise } from "../src/lib/imports/messages";

// Imports workers, credentials or shifts for a firm from a .csv or .xlsx file, as one of its office
// users, until the office import screen exists (Phase 5). A dry run unless --apply is given.
//
//   npm run import -- --firm acme --kind workers --as acme.admin@example.com ./workers.csv
//   npm run import -- --firm acme --kind workers --as acme.admin@example.com ./workers.csv --apply
//
// It connects as the restricted app role (DATABASE_URL), inside the firm's own withFirm
// transaction, exactly as the web app will. Real data only after Gate B (PLAN.md Phase 9).

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    firm: { type: "string" },
    kind: { type: "string" },
    as: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

const [path] = positionals;
if (!values.firm || !values.kind || !values.as || !path || positionals.length !== 1) {
  console.error(
    "Usage: npm run import -- --firm <slug> --kind workers|credentials|shifts|pay --as <office email> <file> [--apply]",
  );
  process.exit(2);
}

try {
  const result = await importFromFile(
    { firmSlug: values.firm, kind: values.kind, officeEmail: values.as, path, apply: values.apply },
    { run: withFirm, resolveFirm: resolveFirmBySlug },
  );
  console.log(summarise(result));
  if (result.dryRun) console.log("Run it again with --apply to save it.");
  process.exit(0);
} catch (err) {
  if (err instanceof ImportFileError) console.error(FILE_ERROR_TEXT[err.code]);
  else if (err instanceof ImportSetupError) console.error(err.message);
  // Anything else: a code only. A database error's message can quote a row (names, numbers).
  else console.error(`The import failed (${errorCode(err)}). Nothing was saved.`);
  process.exit(1);
}

import { existsSync, readFileSync } from "node:fs";
import { SERVER_LOGS } from "../../playwright.config";
import { scanLogText, scanReport } from "../../scripts/logs-scan";
import { seedFirms } from "../../src/lib/db/admin/seed-data";

const FIRM_LINES = seedFirms()
  .map((f) => f.shiftsLine)
  .filter((line): line is string => line !== null);

// After every e2e run: the worker's and the web app's own output for the whole run (logins, shifts,
// requests, WhatsApps and texts from seeded workers and strangers, pay, GDPR) must hold no phone
// number or email address (docs/testing.md "Pre-pilot checklist": log masking). A finding fails
// the run. The messages themselves go to the outbox file, never the log. The one number that may
// appear is a firm's own shifts line (a business number, printed whole by the console transport on
// purpose: src/lib/messaging/console.ts): the seeded firms' lines are allowed, nothing else.
export default function teardown(): void {
  const reports: string[] = [];
  let found = 0;
  for (const file of SERVER_LOGS) {
    if (!existsSync(file)) throw new Error(`${file} is missing: the servers' output wasn't kept`);
    const findings = scanLogText(readFileSync(file, "utf8"), { allowNumbers: FIRM_LINES });
    found += findings.length;
    reports.push(scanReport(file, findings));
  }
  console.log(reports.join("\n"));
  // The servers' errors (their output goes to the files, so Playwright no longer shows them).
  for (const file of SERVER_LOGS) {
    const errors = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes('"level":"error"'));
    if (errors.length > 0) {
      console.log(
        `${file}: ${errors.length} error lines, the last few:\n${errors.slice(-5).join("\n")}`,
      );
    }
  }
  if (found > 0) throw new Error("personal data in the servers' logs (see above)");
}

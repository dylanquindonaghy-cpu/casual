import { existsSync, readFileSync } from "node:fs";
import { OUTBOX, SERVER_LOGS } from "../../playwright.config";
import { scanReport } from "../../scripts/logs-scan";
import { seedFirms } from "../../src/lib/db/admin/seed-data";
import { FRAME_FAILS_ON_PURPOSE, PAGE_FAILS_ON_PURPOSE } from "../../src/lib/e2e/fails-once";
import { checkServerOutput } from "./server-output";

const FIRM_LINES = seedFirms()
  .map((f) => f.shiftsLine)
  .filter((line): line is string => line !== null);

// The only server errors an e2e run should have: the error-screen tests' failures on purpose
// (tests/e2e/error-page.spec.ts, src/lib/e2e/fails-once.ts).
const ON_PURPOSE = new Set([PAGE_FAILS_ON_PURPOSE, FRAME_FAILS_ON_PURPOSE]);

// Every login token the run sent (from the console transport's outbox file).
function sentTokens(outbox: string): string[] {
  if (!existsSync(outbox)) return [];
  return [...readFileSync(outbox, "utf8").matchAll(/\/l#([A-Za-z0-9_-]{43})/g)].map(
    (m) => m[1] ?? "",
  );
}

// After every e2e run, the worker's and the web app's own output for the whole run (logins, shifts,
// requests, WhatsApps and texts from seeded workers and strangers, pay, GDPR) is checked
// (tests/e2e/server-output.ts): no phone number or email address (docs/testing.md "Pre-pilot
// checklist": log masking; the messages themselves go to the outbox file, and the seeded firms'
// own shifts lines, business numbers, are allowed), no login token or session cookie outside the
// console transport's own prints (audit L53, L11), and no server error but the error-screen tests'
// failures on purpose (audit L64: a page, action or job that failed where no test looked used to
// pass the run). Any finding fails the run.
export default function teardown(): void {
  checkRun(OUTBOX, SERVER_LOGS);
}

// The same checks for any run: its outbox and its servers' output (the walkthrough's run too:
// tests/e2e/walkthrough-teardown.ts).
export function checkRun(outbox: string, serverLogs: readonly string[]): void {
  const reports: string[] = [];
  const failures: string[] = [];
  const tokens = sentTokens(outbox);
  for (const file of serverLogs) {
    if (!existsSync(file)) throw new Error(`${file} is missing: the servers' output wasn't kept`);
    const { findings, errors } = checkServerOutput(readFileSync(file, "utf8"), {
      allowNumbers: FIRM_LINES,
      sentTokens: tokens,
      expectedErrors: ON_PURPOSE,
    });
    reports.push(scanReport(file, findings));
    if (findings.length > 0) failures.push(`${file}: personal data or login tokens (see above)`);
    if (errors.length > 0) {
      reports.push(
        `${file}: ${errors.length} unexpected server errors, the last few:\n${errors.slice(-5).join("\n")}`,
      );
      failures.push(`${file}: unexpected server errors (see above)`);
    }
  }
  console.log(reports.join("\n"));
  if (failures.length > 0) throw new Error(failures.join("; "));
}

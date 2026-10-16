// Run by scripts/invariants.sh after a verify run with the browser tests (audit L62). Playwright
// exits 0 when a test is skipped (test.skip, test.fixme, testInfo.skip() at run time) or marked as
// expected to fail (test.fail), so its exit code can't prove every browser test ran and passed.
// This reads each JSON report scripts/e2e.mjs wrote and requires: at least one test, and every
// test expected to pass and passing on its first try (no skipped, failed or flaky ones).
//   node scripts/check-e2e-report.mjs REPORT.json [REPORT.json …]
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

function* testsOf(suite) {
  for (const spec of suite.specs ?? [])
    for (const test of spec.tests ?? []) yield { title: `${spec.file}: ${spec.title}`, test };
  for (const child of suite.suites ?? []) yield* testsOf(child);
}

export function checkReport(report) {
  const problems = [];
  let total = 0;
  for (const suite of report.suites ?? []) {
    for (const { title, test } of testsOf(suite)) {
      total += 1;
      if (test.expectedStatus !== "passed")
        problems.push(
          `${title} is marked to ${test.expectedStatus === "skipped" ? "skip" : "fail"}`,
        );
      else if (test.status !== "expected") problems.push(`${title} was ${test.status}`);
    }
  }
  for (const error of report.errors ?? [])
    problems.push(`run error: ${String(error.message ?? error).split("\n")[0]}`);
  if (total === 0) problems.push("no browser tests ran");
  return { total, problems };
}

const invoked =
  !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) {
  const files = process.argv.slice(2);
  let bad = files.length === 0;
  if (bad) console.log("   no browser-test report given");
  for (const file of files) {
    let report;
    try {
      report = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      console.log(`   ${file}: missing or unreadable`);
      bad = true;
      continue;
    }
    const { total, problems } = checkReport(report);
    console.log(`   ${file}: ${total} browser tests, ${problems.length} skipped, failed or flaky`);
    for (const p of problems.slice(0, 10)) console.log(`     ${p}`);
    if (problems.length) bad = true;
  }
  process.exit(bad ? 1 : 0);
}

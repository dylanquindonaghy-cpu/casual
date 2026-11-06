import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// "Still coming?" has no automatic effect (Phase 28.2; golden rule 1; docs/compliance.md): a
// casual's "Yes, I'm coming" (assignments.still_coming_at, shift.still_coming) is shown to the
// office to plan cover, and nothing else reads it. This tripwire reads the code that decides or
// counts anything about a casual (the rules engine, the reliability loader, the offer waves and
// candidates, strikes, and the Watch list) and fails if any of it mentions "still coming" in any
// spelling, comments included. Adding one on purpose means changing docs/compliance.md first.

const ROOT = process.cwd();
const GUARDED = [
  "src/lib/rules",
  "src/lib/office/reliability.ts",
  "src/lib/offers",
  "src/lib/strikes",
  // The Watch list (Phase 26.7): who the dashboard asks the office to keep an eye on.
  "src/lib/office/dashboard-cards-data.ts",
];
const STILL_COMING = /still[\s_-]?coming/i;

function sourceFiles(path: string): string[] {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(ts|tsx|sql)$/.test(entry.name) ? [child] : [];
  });
}

describe("nothing that decides or counts reads 'still coming'", () => {
  const files = GUARDED.flatMap(sourceFiles);

  it("reads every guarded place (the list isn't empty or out of date)", () => {
    for (const path of GUARDED) expect(existsSync(join(ROOT, path))).toBe(true);
    expect(files).toEqual(
      expect.arrayContaining([
        "src/lib/rules/reliability.ts",
        "src/lib/rules/eligibility.ts",
        "src/lib/office/reliability.ts",
        "src/lib/offers/waves.ts",
        "src/lib/offers/candidates.ts",
        "src/lib/strikes/issue.ts",
        "src/lib/office/dashboard-cards-data.ts",
      ]),
    );
  });

  it("the pattern finds the column and the action where they are meant to be", () => {
    const schema = readFileSync(join(ROOT, "src/lib/db/schema/roster.ts"), "utf8");
    const confirm = readFileSync(join(ROOT, "src/lib/portal/still-coming.ts"), "utf8");
    expect(schema).toMatch(STILL_COMING);
    expect(confirm).toMatch(STILL_COMING);
    for (const spelling of [
      "still_coming_at",
      "stillComingAt",
      "shift.still_coming",
      "Still coming",
    ]) {
      expect(spelling).toMatch(STILL_COMING);
    }
  });

  it("no rules, reliability, offer-wave, strikes or Watch list file mentions it", () => {
    const offenders = files.filter((path) =>
      STILL_COMING.test(readFileSync(join(ROOT, path), "utf8")),
    );
    expect(offenders.map((p) => relative(ROOT, join(ROOT, p)))).toEqual([]);
  });
});

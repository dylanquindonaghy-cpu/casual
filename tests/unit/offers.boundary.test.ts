import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// One offer path (Phase 4: "only eligible workers are ever notified"). A shift offer reaches a
// worker only through the offer-wave job (src/lib/offers/waves.ts), which sends only to the
// workers its candidate list returns (src/lib/offers/candidates.ts), and that list keeps only the
// workers the booking rules allow (previewBooking) and the daily offer cap lets through
// (mayOfferToday). This test is a tripwire: a new file writing an offer or building the offer
// message must be added here on purpose, and go through the candidate list. The proof that
// workers left out never get one is behaviour, in tests/integration/offers.candidates.test.ts and
// offers.waves.test.ts. Tests are exempt.

const ROOT = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

// Code only: comments may name these freely. A line comment starts a line or follows a space, so
// "a//b" in a string or "https://" isn't one.
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const files = sourceFiles(ROOT).map((path) => ({
  path: relative(process.cwd(), path).replace(/\\/g, "/"),
  text: withoutComments(readFileSync(path, "utf8")),
}));

const WAVES = "src/lib/offers/waves.ts";
const CANDIDATES = "src/lib/offers/candidates.ts";
const TEMPLATES = "src/lib/messaging/templates.ts";

const OFFER_INSERT =
  /\binsert\(\s*(?:\w+\.)*offers\s*\)|insert\s+into\s+(?:"?\w+"?\.)?"?offers"?(?![\w"])/i;

const CALLS: [string, RegExp, string[]][] = [
  // Drizzle (`insert(offers)`, `insert(schema.offers)`) or SQL (`insert into offers`,
  // `insert into public."offers"`).
  ["writes an offer", OFFER_INSERT, [WAVES]],
  // An alias would hide the table from the check above.
  ["imports the offers table under another name", /\boffers\s+as\s+\w/, []],
  [
    "builds the shift offer message (shiftUrgentMessage)",
    /\bshiftUrgentMessage\(/,
    [TEMPLATES, WAVES],
  ],
  ["builds the shift offer push (urgentPush)", /\burgentPush\(/, [TEMPLATES, WAVES]],
  [
    "builds the shift offer text message (shiftUrgentSms)",
    /\bshiftUrgentSms\(/,
    [TEMPLATES, WAVES],
  ],
  ["picks offer recipients (waveCandidates)", /\bwaveCandidates\(/, [CANDIDATES, WAVES]],
];

const text = (path: string) => files.find((f) => f.path === path)?.text ?? "";

describe("the offer boundary", () => {
  it.each(CALLS)("only the offer-wave code %s", (_name, pattern, allowed) => {
    const callers = files.filter((f) => pattern.test(f.text)).map((f) => f.path);
    expect(callers.sort()).toEqual([...allowed].sort());
  });

  it("the candidate list asks the booking rules and the daily cap about every worker", () => {
    const candidates = text(CANDIDATES);
    expect(candidates).toMatch(/\bpreviewBooking\(/);
    expect(candidates).toMatch(/\bmayOfferToday\(/);
    // Workers come from one query in the file, and the rules then check each one.
    expect(candidates.match(/\bfrom workers\b/g)).toHaveLength(1);
    expect(candidates).not.toMatch(/\.from\(\s*workers\s*\)/);
  });

  it("the wave job offers to the candidate list's workers and reads no workers of its own", () => {
    const waves = text(WAVES);
    expect(waves).toMatch(/=\s*await waveCandidates\(/);
    expect(waves).toMatch(/=\s*pickWave\(\s*candidates\b/);
    expect(waves).not.toMatch(/\bfrom workers\b|\.from\(\s*workers\s*\)/);
  });

  it("the check catches the ways code can write an offer, and not updates", () => {
    for (const code of [
      "await tx.insert(offers).values({ workerId })",
      "await tx.insert( schema.offers ).values({ workerId })",
      "await tx.execute(sql`insert into offers (firm_id) values (1)`)",
      'await tx.execute(sql`INSERT INTO public."offers" (firm_id) values (1)`)',
      'await tx.execute(sql`insert into "offers" (firm_id) values (1)`)',
    ]) {
      expect(OFFER_INSERT.test(code), code).toBe(true);
    }
    for (const code of [
      "await tx.update(offers).set({ response: 'accepted' })",
      "await tx.execute(sql`insert into offers_archive (firm_id) values (1)`)",
    ]) {
      expect(OFFER_INSERT.test(code), code).toBe(false);
    }
    expect(withoutComments('const p = "a//b"; await tx.insert(offers)')).toMatch(OFFER_INSERT);
    expect(withoutComments("// await tx.insert(offers)")).not.toMatch(OFFER_INSERT);
  });
});

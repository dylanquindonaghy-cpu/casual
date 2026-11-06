import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Two offer paths (Phase 4: "only eligible workers are ever notified"; Phase 5: the office's "Offer
// to someone"). A shift offer reaches a worker only through the offer-wave job
// (src/lib/offers/waves.ts) or the office-offer job (src/lib/offers/office-offer.ts). Both send
// only to workers the candidate list returns (src/lib/offers/candidates.ts), and that list keeps
// only the workers the booking rules allow (previewBookings: the booking rules for many workers at
// once, held to booking's own previewBooking pair for pair by
// tests/integration/eligibility.batch.test.ts) and the daily offer cap lets through (mayOfferToday). This test is a tripwire: a new file writing an offer or building an offer
// message must be added here on purpose, and go through the candidate list. The proof that
// workers left out never get one is behaviour, in tests/integration/offers.candidates.test.ts,
// offers.waves.test.ts, office.offer.test.ts and notify.policy.test.ts. Tests are exempt.

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
const OFFICE = "src/lib/offers/office-offer.ts";
// The demo seed writes made-up offer history for the demo's dashboard (golden rule 7: fake data
// only) and sends nothing: no message and no job. It takes the offer-count lock before its insert,
// like every offer writer. It doesn't go through the candidate list, so it doesn't check the daily
// offer cap (mayOfferToday) either: tests/integration/seed.test.ts checks the cap on what it wrote,
// and proves each seeded offer is to a worker the booking rules allow for its session and that none
// is sent. It may write offers and nothing else on this list.
const SEED = "src/lib/db/admin/seed.ts";

const OFFER_INSERT =
  /\binsert\(\s*(?:\w+\.)*offers\s*\)|insert\s+into\s+(?:"?\w+"?\.)?"?offers"?(?![\w"])/i;

const CALLS: [string, RegExp, string[]][] = [
  // Drizzle (`insert(offers)`, `insert(schema.offers)`) or SQL (`insert into offers`,
  // `insert into public."offers"`).
  ["writes an offer", OFFER_INSERT, [WAVES, OFFICE, SEED]],
  // An alias would hide the table from the check above.
  ["imports the offers table under another name", /\boffers\s+as\s+\w/, []],
  [
    "builds the urgent offer message (shiftUrgentMessage)",
    /\bshiftUrgentMessage\(/,
    [TEMPLATES, WAVES, OFFICE],
  ],
  ["builds the urgent offer push (urgentPush)", /\burgentPush\(/, [TEMPLATES, WAVES, OFFICE]],
  [
    "builds the urgent offer text message (shiftUrgentSms)",
    /\bshiftUrgentSms\(/,
    [TEMPLATES, WAVES, OFFICE],
  ],
  [
    "builds the office offer message (shiftOfferMessage)",
    /\bshiftOfferMessage\(/,
    [TEMPLATES, OFFICE],
  ],
  [
    "builds the office offer text message (shiftOfferSms)",
    /\bshiftOfferSms\(/,
    [TEMPLATES, OFFICE],
  ],
  ["builds the office offer push (offerPush)", /\bofferPush\(/, [TEMPLATES, OFFICE]],
  ["picks offer recipients (waveCandidates)", /\bwaveCandidates\(/, [CANDIDATES, WAVES, OFFICE]],
  // A casual's travel area limits every offer but the office's own (12G.3; D2): only the office
  // offer may pass `byHand`, so a wave can never skip it.
  ["skips the travel area (byHand: true)", /\bbyHand\s*:\s*true\b/, [OFFICE]],
];

const text = (path: string) => files.find((f) => f.path === path)?.text ?? "";

describe("the offer boundary", () => {
  it.each(CALLS)("only the offer-wave code %s", (_name, pattern, allowed) => {
    const callers = files.filter((f) => pattern.test(f.text)).map((f) => f.path);
    expect(callers.sort()).toEqual([...allowed].sort());
  });

  it("the candidate list asks the booking rules and the daily cap about every worker", () => {
    const candidates = text(CANDIDATES);
    // Every worker the cap lets through is asked about, and only those the rules allow are kept.
    expect(candidates).toMatch(
      /\bpreviewBookings\(tx, \{[^}]*workerIds: capped\.map\(\(r\) => r\.worker_id\)/,
    );
    expect(candidates).toMatch(
      /for \(const r of capped\) \{\s*if \(!verdicts\.get\(pairKey\(shift\.id, r\.worker_id\)\)\?\.ok\) continue;/,
    );
    expect(candidates).toMatch(/\bmayOfferToday\(/);
    // Workers come from one query in the file, and the rules then check each one.
    expect(candidates.match(/\bfrom workers\b/g)).toHaveLength(1);
    expect(candidates).not.toMatch(/\.from\(\s*workers\s*\)/);
  });

  it("the wave job offers to the candidate list's workers and reads no workers of its own", () => {
    const waves = text(WAVES);
    // (Read in its own short transaction since Phase 10: `await inFirm((tx) => waveCandidates(`.)
    expect(waves).toMatch(/=\s*await (?:inFirm\(\(tx\) =>\s*)?waveCandidates\(/);
    expect(waves).toMatch(/=\s*pickWave\(\s*candidates\b/);
    expect(waves).not.toMatch(/\bfrom workers\b|\.from\(\s*workers\s*\)/);
  });

  // Every file on the "writes an offer" list, the seed included: each takes the lock before its
  // insert, so two writers at the same moment can't both see "2 today" for one casual. The seed
  // takes it like the rest; the daily cap on what it wrote is checked by
  // tests/integration/seed.test.ts.
  it("every file that writes offers takes the offer-count lock before its insert", () => {
    const writers = CALLS.find(([name]) => name === "writes an offer")?.[2] ?? [];
    expect(writers.length).toBeGreaterThan(0);
    expect(writers).toContain(SEED);
    for (const path of writers) {
      const code = text(path);
      const lock = code.indexOf("lockOfferCounts(");
      const insert = code.search(OFFER_INSERT);
      expect(insert, path).toBeGreaterThan(-1);
      expect(lock, path).toBeGreaterThan(-1);
      expect(lock, path).toBeLessThan(insert);
    }
  });

  it("the office offer asks the candidate list and messages the candidate's own number", () => {
    const office = text(OFFICE);
    expect(office).toMatch(/await waveCandidates\(/);
    expect(office).toMatch(/mobile:\s*candidate\.mobile/);
    // The only other read of workers there is their names, for the office's list.
    expect(office.match(/\.from\(\s*workers\s*\)/g)).toHaveLength(1);
    expect(office).not.toMatch(/mobile_e164|mobileE164/);
  });

  // Reliability doesn't change who's offered first (Phase 26.7, cas-7; decision 3: "offer order
  // unchanged until a month of pilot data"). It's read only where people see it: the office's
  // Casuals pages, a session's list of who asked, the dashboard's Watch list (and, since Phase
  // 27.10, Coming up's "On the watch list" chip, by the card's own rule) and the casual's own
  // Profile. A new reader goes on this list on purpose, and never in the offer code.
  it("reliability is read only by the pages that show it, never by the offer code", () => {
    const READS = /from\s+"[^"]*\/reliability"/;
    const readers = files.filter((f) => READS.test(f.text)).map((f) => f.path);
    expect(readers.sort()).toEqual(
      [
        "src/app/office/casuals/[id]/page.tsx",
        "src/app/office/reliability-bar.tsx",
        "src/app/profile/profile-view.tsx",
        "src/lib/office/casual-follow-up.ts",
        "src/lib/office/casuals.ts",
        "src/lib/office/coming-up.ts",
        "src/lib/office/dashboard-cards-data.ts",
        "src/lib/office/reliability.ts",
        "src/lib/office/session-casuals.ts",
        "src/lib/office/session-page-copy.ts",
        // Phase 30.1: Home's "Your record" card shows Profile's own figure (RELIABILITY_MIN, the
        // Reliability type), never anything that picks who's offered.
        "src/lib/portal/home-board.ts",
        // Phase 28.13: only RELIABILITY_DAYS, Booked's Past window and the attendance form's gate
        // (the same days the figure counts), never the figure itself.
        "src/lib/portal/my-shifts.ts",
        "src/lib/portal/profile.ts",
        // Phase 28.2: only RELIABILITY_DAYS, the window in which a casual may question a mark
        // ("Think this mark is wrong?": askAboutMark), the same days the figure counts.
        "src/lib/portal/requests.ts",
      ].sort(),
    );
    // Nothing that picks or ranks who's offered reads it, or the loader that counts it.
    for (const f of files) {
      if (
        !/^src\/(lib\/offers\/|lib\/rules\/allocation|lib\/roster\/allocation|worker\/)/.test(
          f.path,
        )
      )
        continue;
      expect(f.text, f.path).not.toMatch(READS);
      expect(f.text, f.path).not.toMatch(/\bloadCasualRecords\(|\breliabilityOf\(/);
    }
    expect(files.some((f) => f.path === WAVES)).toBe(true);
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

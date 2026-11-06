import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOG_TYPES } from "@/lib/office/log-types";
import { eventWords } from "@/lib/office/event-words";

// A casual's "No thanks" has no automatic effect (Phase 28.15; golden rule 1): her decline
// (offers.response 'declined', offer.declined) is shown to the office as "Said no", and nothing that
// decides or counts reads it. This tripwire reads the code that decides or counts anything about a
// casual (the rules engine, the reliability loader, the offer waves and candidates, strikes and the
// Watch list) and fails if any of it mentions a decline in any spelling, comments included, except
// src/lib/offers/close.ts, where acceptOwnOffer counts an offer she said no to as hers to accept
// when she takes the shift after all. The office's offer state (src/lib/office/offer-state.ts) shows
// it as "Said no"; it decides nothing.

const ROOT = process.cwd();
const GUARDED = [
  "src/lib/rules",
  "src/lib/office/reliability.ts",
  "src/lib/offers",
  "src/lib/strikes",
  "src/lib/office/dashboard-cards-data.ts",
];
const ALLOWED = ["src/lib/offers/close.ts"];
const DECLINE = /declin/i;

function sourceFiles(path: string): string[] {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(ts|tsx|sql)$/.test(entry.name) ? [child] : [];
  });
}

describe("nothing that decides or counts reads a decline", () => {
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
        "src/lib/offers/close.ts",
        "src/lib/strikes/issue.ts",
        "src/lib/office/dashboard-cards-data.ts",
      ]),
    );
  });

  it("the pattern finds the decline where it is meant to be", () => {
    for (const path of [
      "src/lib/offers/close.ts",
      "src/lib/office/offer-state.ts",
      "src/lib/portal/my-offers.ts",
    ]) {
      expect(readFileSync(join(ROOT, path), "utf8")).toMatch(DECLINE);
    }
    for (const spelling of ["declined", "offer.declined", "Declined", "declineOffer"]) {
      expect(spelling).toMatch(DECLINE);
    }
  });

  it("only close.ts mentions it among the rules, reliability, offer-wave, strikes and Watch list files", () => {
    const offenders = files.filter(
      (path) => !ALLOWED.includes(path) && DECLINE.test(readFileSync(join(ROOT, path), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("close.ts reads it in acceptOwnOffer only, never in closeOpenOffers", () => {
    const close = readFileSync(join(ROOT, "src/lib/offers/close.ts"), "utf8");
    const closeOpen = close.slice(close.indexOf("export async function closeOpenOffers"));
    expect(closeOpen).not.toMatch(/"declined"/);
    const accept = close.slice(
      close.indexOf("export async function acceptOwnOffer"),
      close.indexOf("export async function closeOpenOffers"),
    );
    expect(accept).toMatch(/"declined"/);
  });
});

describe("offer.declined in the action log", () => {
  it("is in the Offers group, with words", () => {
    expect(LOG_TYPES.offers.actions).toContain("offer.declined");
    const words = eventWords(
      {
        action: "offer.declined",
        actorType: "worker",
        actorId: "w1",
        data: { offerId: "o1", shiftId: "s1", workerId: "w1" },
      },
      { worker: () => "Sam Booker", office: () => "Office" },
    );
    expect(words).toBe("Sam Booker said no to the offer.");
  });
});

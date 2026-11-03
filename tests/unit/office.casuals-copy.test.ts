import { describe, expect, it } from "vitest";
import type { NeedsItem, Qualification } from "@/lib/credentials/status";
import {
  blocksBooking,
  CASUAL_VIEW_WORDS,
  countLine,
  needsLine,
  photoCell,
  photoNeedLine,
  photoNeedsUpdate,
  qualificationLine,
  RELIABILITY_HOW,
  REMIND_LINE,
  remindAllButton,
  standingWords,
  strikesText,
} from "@/lib/office/casuals-copy";

// Casuals' words (Phase 24, 24.4: round 7 of the canvas; docs/screens.md `/office/casuals`): each
// qualification by its short name with its date, what needs updating (worst first), the staff
// photo's state and date, and the live strikes. 2026 is this year: its dates leave the year out.

const YEAR = 2026;
const q = (o: Partial<Qualification> = {}): Qualification => ({
  type: "SIA_DS",
  name: "SIA door supervisor licence",
  neededFor: ["door_supervisor"],
  appliedCounts: false,
  renewing: false,
  uploadable: true,
  status: "valid",
  expiresOn: "2027-05-12",
  evidenceUploadId: null,
  waiting: null,
  rejected: null,
  ...o,
});
const need = (o: Partial<Qualification>, blocks: NeedsItem["blocks"] = null): NeedsItem => ({
  level: blocks ? 1 : 2,
  qualification: q(o),
  blocks,
});

describe("a qualification's line", () => {
  it("its short name, its state and the date that goes with it", () => {
    expect(qualificationLine(q(), YEAR)).toBe("SIA DS: valid until 12 May 2027");
    expect(qualificationLine(q({ expiresOn: null }), YEAR)).toBe("SIA DS: valid");
    expect(
      qualificationLine(
        q({ type: "SIA_SG", status: "expiring_soon", expiresOn: "2026-11-14" }),
        YEAR,
      ),
    ).toBe("SIA SG: expires 14 Nov");
    expect(qualificationLine(q({ status: "expired", expiresOn: "2026-09-22" }), YEAR)).toBe(
      "SIA DS: expired 22 Sep",
    );
    expect(qualificationLine(q({ status: "being_checked" }), YEAR)).toBe("SIA DS: being checked");
    expect(qualificationLine(q({ status: "applied" }), YEAR)).toBe("SIA DS: applied for");
    expect(qualificationLine(q({ status: "missing", expiresOn: null }), YEAR)).toBe(
      "SIA DS: missing",
    );
    expect(qualificationLine(q({ status: "suspended" }), YEAR)).toBe("SIA DS: suspended");
    expect(qualificationLine(q({ status: "rejected" }), YEAR)).toBe("SIA DS: not accepted");
    // A type with no short name: its own, capitalised.
    expect(qualificationLine(q({ type: "DBS", name: "DBS check" }), YEAR)).toBe(
      "DBS check: valid until 12 May 2027",
    );
    // It stops a shift they're booked on.
    expect(
      qualificationLine(
        q({ type: "FIRST_AID", status: "expiring_soon", expiresOn: "2026-10-30" }),
        YEAR,
        true,
      ),
    ).toBe("First aid: expires 30 Oct (booked shift)");
  });

  it("whether something needing updating stops a booking", () => {
    const needs = [need({ type: "FIRST_AID" }, { role: "steward", day: "2026-10-31" })];
    expect(blocksBooking(needs, "FIRST_AID")).toBe(true);
    expect(blocksBooking(needs, "SIA_DS")).toBe(false);
    expect(blocksBooking([need({ type: "SIA_DS" })], "SIA_DS")).toBe(false);
  });
});

describe("Needs updating", () => {
  it("the worst first, in the same words, then how many more; Nothing", () => {
    expect(needsLine([], YEAR)).toBe("Nothing");
    expect(
      needsLine([need({ type: "SIA_SG", status: "expiring_soon", expiresOn: "2026-11-14" })], YEAR),
    ).toBe("SIA SG: expires 14 Nov");
    expect(
      needsLine(
        [
          need(
            { type: "FIRST_AID", status: "expiring_soon", expiresOn: "2026-10-30" },
            { role: "steward", day: "2026-10-31" },
          ),
          need({ status: "expired", expiresOn: "2026-09-01" }),
          need({ type: "CSAS", status: "missing", expiresOn: null }),
        ],
        YEAR,
      ),
    ).toBe("First aid: expires 30 Oct (booked shift), and 2 more");
  });
});

describe("the staff photo's cell", () => {
  const taken = { id: "p1", uploadedOn: "2025-08-03", renewBy: "2028-08-03" };
  it("its state, a tone only when it needs someone, and its date", () => {
    expect(photoCell({ status: "up_to_date", current: taken, waiting: null }, YEAR)).toEqual({
      words: "Up to date",
      tone: null,
      date: "3 Aug 2025",
    });
    // Due soon or overdue: the day to renew it by, never the day it was taken (it read as a due
    // date: the launch review).
    const old = { id: "p1", uploadedOn: "2023-08-03", renewBy: "2026-08-03" };
    expect(photoCell({ status: "overdue", current: old, waiting: null }, YEAR)).toEqual({
      words: "Overdue",
      tone: "urgent",
      date: "renew by 3 Aug",
    });
    const soon = { id: "p1", uploadedOn: "2023-11-23", renewBy: "2026-11-23" };
    expect(photoCell({ status: "due_soon", current: soon, waiting: null }, YEAR)).toEqual({
      words: "Due soon",
      tone: "attention",
      date: "renew by 23 Nov",
    });
    expect(
      photoCell(
        { status: "due_soon", current: { ...soon, renewBy: "2027-01-10" }, waiting: null },
        YEAR,
      ),
    ).toEqual({ words: "Due soon", tone: "attention", date: "renew by 10 Jan 2027" });
    expect(
      photoCell(
        { status: "waiting", current: null, waiting: { id: "p2", uploadedOn: "2026-10-25" } },
        YEAR,
      ),
    ).toEqual({ words: "Waiting for check", tone: "quiet", date: "Sent 25 Oct" });
    expect(photoCell({ status: "missing", current: null, waiting: null }, YEAR)).toEqual({
      words: "Missing",
      tone: "attention",
      date: null,
    });
  });
});

describe("the rest", () => {
  it("live strikes and the views' names", () => {
    expect(strikesText(0)).toBe("None");
    expect(strikesText(2)).toBe("2");
    expect(CASUAL_VIEW_WORDS).toEqual({
      all: "All",
      regulars: "Regulars",
      reliable: "Reliable",
      cancel_often: "Cancels often",
      not_worked: "Not worked lately",
      needs: "Need updating",
      uploads: "Uploads to check",
    });
  });
});

// The launch review (3 Nov 2026): a casual's own page lists a missing or overdue staff photo the
// way Casuals' Need updating counts it (O5), Remind says it's for licences (O6), and the counts,
// chips and reliability line in plain words.
describe("the launch review's words", () => {
  const photo = (status: "up_to_date" | "due_soon" | "overdue" | "missing" | "waiting") => ({
    status,
  });

  it("a casual's page lists a missing or overdue photo, as Need updating counts it (O5)", () => {
    expect(photoNeedLine(photo("missing"))).toBe("Staff photo is missing.");
    expect(photoNeedLine(photo("overdue"))).toBe("Staff photo is overdue.");
    for (const s of ["up_to_date", "due_soon", "waiting"] as const) {
      expect(photoNeedLine(photo(s)), s).toBeNull();
    }
    // The same rule as the list's Need updating (casuals.ts photoNeeds).
    expect(
      (["up_to_date", "due_soon", "overdue", "missing", "waiting"] as const).filter((s) =>
        photoNeedsUpdate(photo(s)),
      ),
    ).toEqual(["overdue", "missing"]);
  });

  it("Remind all names who it's for, and the line under the list says photos are asked for in the app (O6)", () => {
    expect(remindAllButton(5)).toBe("Remind all 5 with a licence to renew");
    expect(remindAllButton(1)).toBe("Remind all 1 with a licence to renew");
    expect(REMIND_LINE).toBe(
      "Remind is for licences. It sends the licence message again with its upload link: by text, or by email if they chose it or texts can't reach them. Each one is logged. They can't take shifts that need it until the new one is checked. Staff photos are asked for in the app.",
    );
  });

  it("the four counts' lines", () => {
    expect(countLine("regulars")).toBe("Worked 6 of the last 8 weeks");
    expect(countLine("reliable")).toBe(
      "Turned up 95% or more. Needs 5 shifts in 90 days to count.",
    );
    expect(countLine("cancel_often")).toBe(
      "3 or more late cancellations (under 48 hours) in 90 days",
    );
    expect(countLine("not_worked")).toBe("Nothing worked in 60 days");
  });

  it("someone who has never worked is new, not lapsed; the reliability line in words", () => {
    const none = { regular: false, reliable: false, cancelOften: false, notWorkedLately: true };
    expect(standingWords(none, null)).toEqual([
      { words: "New: not worked yet", tone: "attention" },
    ]);
    expect(standingWords(none, new Date("2026-08-01T10:00:00Z"))).toEqual([
      { words: "Not worked lately", tone: "attention" },
    ]);
    expect(
      standingWords(
        { regular: true, reliable: true, cancelOften: true, notWorkedLately: false },
        null,
      ),
    ).toEqual([
      { words: "Regular", tone: "done" },
      { words: "Reliable", tone: "done" },
      { words: "Cancels often", tone: "attention" },
    ]);
    expect(RELIABILITY_HOW).toBe(
      "Shifts worked out of shifts booked (no-shows and cancellations under 48 hours count against them), from what the office marked.",
    );
  });
});

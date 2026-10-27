import { describe, expect, it } from "vitest";
import type { NeedsItem, Qualification } from "@/lib/credentials/status";
import {
  blocksBooking,
  CASUAL_VIEW_WORDS,
  needsLine,
  photoCell,
  qualificationLine,
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
    expect(photoCell({ status: "overdue", current: taken, waiting: null }, YEAR)).toEqual({
      words: "Overdue",
      tone: "urgent",
      date: "3 Aug 2025",
    });
    expect(photoCell({ status: "due_soon", current: taken, waiting: null }, YEAR)).toEqual({
      words: "Due soon",
      tone: "attention",
      date: "3 Aug 2025",
    });
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
      needs: "Need updating",
      uploads: "Uploads to check",
    });
  });
});

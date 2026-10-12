import { describe, expect, it } from "vitest";
import { requirementChip } from "@/lib/credentials/requirements";
import {
  gettingThereLines,
  placesText,
  requirementWords,
  strikeNoteText,
} from "@/lib/portal/shift-page-copy";

// A shift's page in plain words (docs/office-v2.md 4.4; 12H.2): Getting there, each requirement's
// status against the shift's last day, places and the strike note.

const TZ = "Europe/London";
const arriveBy = new Date("2026-11-07T09:00:00Z"); // 09:00 in London (GMT)

describe("Getting there", () => {
  it("worked out: the distance by road, then car and public transport", () => {
    expect(
      gettingThereLines(
        {
          kind: "estimated",
          straightMetres: 9000,
          arriveBy,
          car: { minutes: 21, metres: 13518 },
          publicTransport: { minutes: 38 },
        },
        TZ,
      ),
    ).toEqual(["8.4 miles away", "About 21 min by car", "About 38 min by public transport"]);
  });

  it("no public transport in time, over 90 min by car, or no road distance: says so", () => {
    expect(
      gettingThereLines(
        { kind: "estimated", straightMetres: 11000, arriveBy, car: null, publicTransport: null },
        TZ,
      ),
    ).toEqual([
      "About 7 miles away (straight line)",
      "Over 90 min by car",
      "No public transport by 09:00",
    ]);
  });

  it("not worked out yet, or nothing known", () => {
    expect(gettingThereLines({ kind: "straight", straightMetres: 11000 }, TZ)).toEqual([
      "About 7 miles away (straight line)",
      "Travel time not known yet",
    ]);
    expect(gettingThereLines({ kind: "straight", straightMetres: 300 }, TZ)).toEqual([
      "About 1 mile away (straight line)",
      "Travel time not known yet",
    ]);
    expect(gettingThereLines({ kind: "unknown" }, TZ)).toEqual(["Distance not known yet"]);
  });
});

describe("What it needs: her status for each", () => {
  const on = { lastDay: "2026-11-07", year: 2026, uploadable: true };

  it("valid through the shift: You have it, with the date (and its year when not the shift's)", () => {
    expect(requirementWords({ status: "valid", expiresOn: "2027-03-03" }, on)).toEqual({
      words: "You have it, valid until 3 Mar 2027",
      upload: false,
      tone: "done",
    });
    expect(requirementWords({ status: "expiring_soon", expiresOn: "2026-11-07" }, on).words).toBe(
      "You have it, valid until 7 Nov",
    );
    expect(requirementWords({ status: "valid", expiresOn: null }, on).words).toBe("You have it");
  });

  it("valid today but not on the shift's last day: Expires before this shift", () => {
    expect(requirementWords({ status: "expiring_soon", expiresOn: "2026-11-06" }, on)).toEqual({
      words: "Expires before this shift:",
      upload: true,
      tone: "urgent",
    });
    expect(
      requirementWords({ status: "valid", expiresOn: "2026-11-06" }, { ...on, uploadable: false })
        .words,
    ).toBe("Expires before this shift: ask the office.");
  });

  it("missing, expired and not accepted: upload it, or ask the office for one she can't send", () => {
    expect(requirementWords({ status: "missing", expiresOn: null }, on)).toEqual({
      words: "Missing:",
      upload: true,
      tone: "urgent",
    });
    expect(
      requirementWords({ status: "missing", expiresOn: null }, { ...on, uploadable: false }).words,
    ).toBe("Missing: ask the office.");
    expect(requirementWords({ status: "expired", expiresOn: "2026-10-01" }, on).words).toBe(
      "Expired on 1 Oct:",
    );
    expect(requirementWords({ status: "expired", expiresOn: null }, on).words).toBe("Expired:");
    expect(requirementWords({ status: "rejected", expiresOn: null }, on).words).toBe(
      "Not accepted:",
    );
  });

  it("being checked, applied for and suspended: what's happening, never an upload", () => {
    expect(requirementWords({ status: "being_checked", expiresOn: null }, on)).toEqual({
      words: "Being checked",
      upload: false,
      tone: "attention",
    });
    expect(requirementWords({ status: "applied", expiresOn: null }, on)).toEqual({
      words: "Applied for, not issued yet",
      upload: false,
      tone: "attention",
    });
    expect(requirementWords({ status: "suspended", expiresOn: null }, on)).toEqual({
      words: "Suspended: contact the office.",
      upload: false,
      tone: "urgent",
    });
  });
});

describe("places, the strike note and the chips", () => {
  it("says how many of how many are left, and the firm's own notice", () => {
    expect(placesText(1, 4)).toBe("1 of 4 left");
    expect(strikeNoteText(48)).toBe(
      "Cancelling less than 48 hours before the start gives you a strike.",
    );
  });

  it("labels a requirement as the office does: a short name, or its own name capitalised", () => {
    expect(requirementChip({ code: "SIA_DS", name: "SIA door supervisor licence" })).toBe("SIA DS");
    expect(requirementChip({ code: "CSAS", name: "CSAS accreditation" })).toBe("CSAS");
    expect(requirementChip({ code: "DBS", name: "DBS check" })).toBe("DBS check");
  });
});

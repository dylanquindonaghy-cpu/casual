import { describe, expect, it } from "vitest";
import { inHand, markCovers, type CoveredNeed, type SortedMark } from "@/lib/portal/in-hand";

// Phase 29.3: one rule for whether the office's "Mark as sorted" still covers a need as it stands
// (src/lib/portal/in-hand.ts markCovers): the casual's "in hand" and the office's "Sorted by" and
// "Remind all" (src/lib/office/casual-follow-up.ts, src/lib/office/casuals.ts) both use it.

const expired: CoveredNeed = { type: "SIA_DS", status: "expired", expiresOn: "2026-10-01" };
const mark: SortedMark = {
  type: "SIA_DS",
  status: "expired",
  day: "2026-10-20",
  changedAfter: false,
};

describe("markCovers", () => {
  it("a mark after the expiry covers it; a mark before a newer expiry doesn't", () => {
    expect(markCovers(expired, mark)).toBe(true);
    // Renewed, then expired again on 25 Oct: the 20 Oct mark was about the earlier lapse.
    expect(markCovers({ ...expired, expiresOn: "2026-10-25" }, mark)).toBe(false);
    // The day after the expiry is the first day it's expired: marked that day, it covers it.
    expect(markCovers({ ...expired, expiresOn: "2026-10-19" }, mark)).toBe(true);
    expect(markCovers({ ...expired, expiresOn: "2026-10-20" }, mark)).toBe(false);
  });

  it("a different type or status is never covered; no mark covers nothing", () => {
    expect(markCovers({ ...expired, type: "STEWARD_L2" }, mark)).toBe(false);
    expect(markCovers({ ...expired, status: "expiring_soon" }, mark)).toBe(false);
    expect(markCovers(expired, null)).toBe(false);
    expect(markCovers(expired, undefined)).toBe(false);
  });

  it("a change to that type's records after the mark ends it", () => {
    expect(markCovers(expired, { ...mark, changedAfter: true })).toBe(false);
  });

  it("expiring soon: covered from 30 days before the expiry", () => {
    const soon: CoveredNeed = { type: "SIA_DS", status: "expiring_soon", expiresOn: "2026-11-20" };
    const soonMark = { ...mark, status: "expiring_soon", day: "2026-10-21" };
    expect(markCovers(soon, soonMark)).toBe(true);
    expect(markCovers(soon, { ...soonMark, day: "2026-10-20" })).toBe(false);
    // A newer card expiring later: the old mark was about the one before.
    expect(markCovers({ ...soon, expiresOn: "2026-12-20" }, soonMark)).toBe(false);
  });

  it("no date says when it began (missing, the staff photo): only a mark known unchanged since", () => {
    const photo: CoveredNeed = { type: "photo", status: "missing", expiresOn: null };
    const photoMark = { type: "photo", status: "missing", day: "2026-10-20" };
    expect(markCovers(photo, { ...photoMark, changedAfter: false })).toBe(true);
    expect(markCovers(photo, { ...photoMark, changedAfter: true })).toBe(false);
    expect(markCovers(photo, photoMark)).toBe(false); // not known
  });

  it("not accepted: covered when marked on or after the turned-down upload was sent", () => {
    const turned: CoveredNeed = {
      type: "SIA_DS",
      status: "rejected",
      expiresOn: null,
      rejected: { sentOn: "2026-10-22" },
    };
    const m = { ...mark, status: "rejected" };
    expect(markCovers(turned, { ...m, day: "2026-10-22" })).toBe(true);
    expect(markCovers(turned, { ...m, day: "2026-10-21" })).toBe(false);
  });

  it("the casual's in hand is the same rule, less what isn't hers to do", () => {
    const q = { ...expired, renewing: false, rejected: null };
    expect(inHand(q, mark)).toBe(markCovers(q, mark));
    expect(inHand({ ...q, expiresOn: "2026-10-25" }, mark)).toBe(false);
    // Being checked is the office's own to-do: covered for the office, never "in hand" for her.
    const checking = { type: "SIA_DS", status: "being_checked" as const, expiresOn: null };
    const checkMark = { ...mark, status: "being_checked" };
    expect(markCovers(checking, checkMark)).toBe(true);
    expect(inHand({ ...checking, renewing: false, rejected: null }, checkMark)).toBe(false);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import {
  strikeSectionLines,
  WITHDRAWN_AFTER_EVIDENCE,
  WITHDRAWN_MAYBE_AFTER_EVIDENCE,
} from "@/lib/office/cancellations-copy";
import { eventWords } from "@/lib/office/event-words";
import { LOG_TYPES } from "@/lib/office/log-types";
import { keepText, strikeButtons, withdrawText } from "@/lib/office/strike-actions-copy";
import type { CasualStrike } from "@/lib/office/strikes";
import {
  liveCountText,
  STRIKE_VIEW_EMPTY,
  STRIKE_VIEW_WORDS,
  strikeLine,
  strikesIntro,
  strikeStatusText,
} from "@/lib/office/strikes-copy";
import type { MyStrike, MyStrikes } from "@/lib/portal/my-strikes";
import {
  myStrikeCancelled,
  myStrikeCountText,
  myStrikeRuleText,
  myStrikeSession,
  myStrikesMoreText,
  myStrikeStatus,
  myStrikeTitle,
} from "@/lib/portal/my-strikes-copy";
import type { Profile } from "@/lib/portal/profile";

// The Strikes page, withdrawing and keeping a strike, and the casual's Strikes on Profile (12C.5;
// docs/office-v2.md 3.5, 4.6), in words. tests/integration/strikes.page.test.ts runs them on the
// database. Times in London (GMT in November).

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));
const { ProfileView } = await import("@/app/profile/profile-view");
const { StrikeActions } = await import("@/app/office/cancellations/[ref]/strike-actions");

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);

const strike = (o: Partial<CasualStrike> = {}): CasualStrike => ({
  assignmentId: "4f2a9c1b-0000-4000-8000-000000000001",
  ref: "4F2A9C1B",
  role: "steward",
  siteName: "Riverside Arena",
  startsAt: at("2026-11-07T14:00:00Z"),
  cancelledAt: at("2026-11-06T18:00:00Z"),
  noticeHours: 20,
  status: "live",
  counting: true,
  expiresAt: at("2027-02-04T18:00:00Z"),
  reviewNeeded: false,
  evidence: {
    status: "sent",
    sentAt: at("2026-11-06T18:01:00Z"),
    stuck: false,
    nothingSent: false,
  },
  ...o,
});

describe("the Strikes page's words", () => {
  it("views, empty states, the intro and the live count", () => {
    expect(STRIKE_VIEW_WORDS).toEqual({ live: "Live", review: "Needs review", all: "All" });
    expect(STRIKE_VIEW_EMPTY).toEqual({
      live: "No live strikes.",
      review: "No strikes need a review.",
      all: "No strikes yet.",
    });
    expect(strikesIntro(48, 90)).toBe(
      "A casual who cancels with less than 48 hours' notice gets a strike automatically. It counts for 90 days. Nothing else happens on its own: what to do next is a person's decision.",
    );
    expect([0, 1, 2].map(liveCountText)).toEqual([
      "No live strikes",
      "1 live strike",
      "2 live strikes",
    ]);
  });

  it("a strike's line (session and notice) and where it stands", () => {
    expect(strikeLine(strike(), TZ)).toBe(
      "Steward at Riverside Arena · 14:00 on Sat 7 Nov · cancelled 18:00 on Fri 6 Nov (20 hours' notice)",
    );
    expect(strikeLine(strike({ siteName: null }), TZ)).toBe(
      "Steward · 14:00 on Sat 7 Nov · cancelled 18:00 on Fri 6 Nov (20 hours' notice)",
    );
    expect(strikeStatusText(strike(), TZ)).toBe("Counts until Thu 4 Feb");
    expect(strikeStatusText(strike({ counting: false }), TZ)).toBe("No longer counts");
    expect(strikeStatusText(strike({ status: "withdrawn", counting: false }), TZ)).toBe(
      "Withdrawn",
    );
  });
});

describe("the record's Strike section and its buttons' answers", () => {
  const base = {
    status: "live" as const,
    expiresAt: at("2027-02-04T18:00:00Z"),
    reviewNeeded: false,
    evidence: { status: "sent", to: null, sentAt: null },
  };
  it("flagged, kept after a review, withdrawn with or without its reason, oldest first", () => {
    expect(strikeSectionLines(base, TZ)).toEqual([]);
    expect(strikeSectionLines({ ...base, reviewNeeded: true }, TZ)).toEqual([
      "Flagged for a review: the casual's reason is one a person should look at.",
    ]);
    expect(
      strikeSectionLines(
        { ...base, reviewed: { by: "Sam Rota", at: at("2026-11-09T10:15:00Z") } },
        TZ,
      ),
    ).toEqual(["Kept after a review by Sam Rota at 10:15 on Mon 9 Nov."]);
    const withdrawn = {
      ...base,
      status: "withdrawn" as const,
      withdrawn: { by: "Sam Rota", at: at("2026-11-09T10:15:00Z"), reason: "Booked by mistake" },
    };
    // Its evidence email had gone: a reminder to tell the strikes team.
    expect(strikeSectionLines(withdrawn, TZ)).toEqual([
      "Withdrawn by Sam Rota at 10:15 on Mon 9 Nov.",
      "Why: Booked by mistake",
      "The evidence email had already gone to the strikes team: let them know it's withdrawn.",
    ]);
    expect(WITHDRAWN_AFTER_EVIDENCE).toMatch(/strikes team/);
    // It failed in a way that may have arrived: a softer reminder; proven not sent: none.
    expect(
      strikeSectionLines(
        { ...withdrawn, evidence: { status: "failed", to: null, sentAt: null } },
        TZ,
      ),
    ).toEqual([
      "Withdrawn by Sam Rota at 10:15 on Mon 9 Nov.",
      "Why: Booked by mistake",
      "The evidence email may have reached the strikes team: let them know it's withdrawn.",
    ]);
    expect(WITHDRAWN_MAYBE_AFTER_EVIDENCE).toMatch(/may have/);
    expect(
      strikeSectionLines(
        {
          ...withdrawn,
          evidence: { status: "failed", to: null, sentAt: null, nothingSent: true },
        },
        TZ,
      ),
    ).toHaveLength(2);
    // It hadn't (withdrawn before it went): no reminder.
    const unsent = { ...withdrawn, evidence: { status: "pending", to: null, sentAt: null } };
    expect(strikeSectionLines(unsent, TZ)).toEqual([
      "Withdrawn by Sam Rota at 10:15 on Mon 9 Nov.",
      "Why: Booked by mistake",
    ]);
    // After the casual's details were deleted, the reason goes; who and when stay.
    expect(
      strikeSectionLines({ ...unsent, withdrawn: { ...withdrawn.withdrawn, reason: null } }, TZ),
    ).toEqual([
      "Withdrawn by Sam Rota at 10:15 on Mon 9 Nov.",
      "Why: deleted with the casual's details.",
    ]);
    // Kept after a review, then withdrawn: both, oldest first.
    expect(
      strikeSectionLines(
        { ...unsent, reviewed: { by: "Ann Office", at: at("2026-11-08T09:00:00Z") } },
        TZ,
      ),
    ).toEqual([
      "Kept after a review by Ann Office at 09:00 on Sun 8 Nov.",
      "Withdrawn by Sam Rota at 10:15 on Mon 9 Nov.",
      "Why: Booked by mistake",
    ]);
  });

  it("every answer in plain words", () => {
    for (const status of [
      "withdrawn",
      "invalid",
      "not_live",
      "erased",
      "not_found",
      "not_allowed",
      "logged_out",
      "error",
    ] as const) {
      expect(withdrawText({ status })).toMatch(/\.$/);
    }
    expect(withdrawText({ status: "withdrawn" })).toBe(
      "Withdrawn. It no longer counts, and the casual sees it as withdrawn.",
    );
    expect(withdrawText({ status: "invalid" })).toBe(
      "Write why you're withdrawing it (500 characters at most).",
    );
    for (const status of [
      "kept",
      "already_kept",
      "not_live",
      "not_found",
      "not_allowed",
      "logged_out",
      "error",
    ] as const) {
      expect(keepText({ status })).toMatch(/\.$/);
    }
    expect(withdrawText({ status: "erased" })).toBe(
      "This casual's details were deleted, so their strikes can't be withdrawn.",
    );
    expect(keepText({ status: "kept" })).toBe("Kept, and marked as reviewed.");
    expect(keepText({ status: "already_kept" })).toBe("This strike has already been reviewed.");
  });

  it("which buttons a strike's record shows: by its status, a review and the casual's details", () => {
    const reviewed = { by: "Sam Rota", at: at("2026-11-09T10:15:00Z") };
    const both = { canWithdraw: true, canKeep: true };
    const none = { canWithdraw: false, canKeep: false };
    expect(strikeButtons({ status: "live", reviewed: null }, false)).toEqual(both);
    expect(strikeButtons({ status: "live" }, false)).toEqual(both);
    expect(strikeButtons({ status: "live", reviewed }, false)).toEqual({
      canWithdraw: true,
      canKeep: false,
    });
    // A deleted casual's strike can still be kept, never withdrawn.
    expect(strikeButtons({ status: "live", reviewed: null }, true)).toEqual({
      canWithdraw: false,
      canKeep: true,
    });
    expect(strikeButtons({ status: "live", reviewed }, true)).toEqual(none);
    // Withdrawn: nothing to do, reviewed or not, deleted or not.
    expect(strikeButtons({ status: "withdrawn", reviewed: null }, false)).toEqual(none);
    expect(strikeButtons({ status: "withdrawn", reviewed }, false)).toEqual(none);
    expect(strikeButtons({ status: "withdrawn", reviewed: null }, true)).toEqual(none);
  });

  // The record always renders the buttons for whoever may change strikes, so an answer outlives the
  // refresh that takes its button away (19.1; tests/e2e/office.strikes.spec.ts sees it on screen).
  it("the buttons: both, one or none, and nothing at all when there's no button and no answer", () => {
    const draw = (canWithdraw: boolean, canKeep: boolean) =>
      renderToStaticMarkup(
        createElement(StrikeActions, {
          assignmentId: "4f2a9c1b-0000-4000-8000-000000000001",
          canWithdraw,
          canKeep,
        }),
      );
    const buttons = (html: string) =>
      [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(buttons(draw(true, true))).toEqual(["Withdraw strike…", "Keep strike"]);
    expect(buttons(draw(true, false))).toEqual(["Withdraw strike…"]);
    expect(buttons(draw(false, true))).toEqual(["Keep strike"]);
    expect(draw(false, false)).toBe("");
  });
});

describe("the log", () => {
  const data = {
    assignmentId: "4f2a9c1b-0000-4000-8000-000000000001",
    shiftId: "4f2a9c1b-0000-4000-8000-000000000002",
    workerId: "4f2a9c1b-0000-4000-8000-000000000003",
  };
  const say = (action: string, d: Record<string, unknown>) =>
    eventWords(
      { action, actorType: "office", actorId: "o", data: d },
      { worker: () => "Ann Booker", office: () => "Sam Rota" },
    );
  it("withdrawn and kept: ids only (never the reason), in the Strikes group, in plain words", () => {
    expect(passesLogCheck(data)).toBe(true);
    expect(passesLogCheck({ ...data, outcome: "kept" })).toBe(true);
    expect(LOG_TYPES.strikes.actions).toEqual(
      expect.arrayContaining(["strike.withdrawn", "strike.reviewed"]),
    );
    expect(say("strike.withdrawn", data)).toBe(
      "Sam Rota withdrew Ann Booker's strike. It no longer counts.",
    );
    expect(say("strike.reviewed", { ...data, outcome: "kept" })).toBe(
      "Sam Rota kept Ann Booker's strike after a review.",
    );
  });
});

describe("the casual's Strikes on Profile", () => {
  const mine = (o: Partial<MyStrike> = {}): MyStrike => ({
    shiftId: "4f2a9c1b-0000-4000-8000-000000000010",
    role: "steward",
    siteName: "Riverside Arena",
    startsAt: at("2026-11-07T14:00:00Z"),
    endsAt: at("2026-11-07T22:00:00Z"),
    cancelledAt: at("2026-11-06T18:00:00Z"),
    noticeHours: 20,
    expiresAt: at("2027-02-04T18:00:00Z"),
    status: "live",
    counting: true,
    ...o,
  });

  it("the count, the rule, and each strike's session, notice, until when and status", () => {
    expect(myStrikeCountText(0, 90)).toBe("You have 0 strikes in the last 90 days.");
    expect(myStrikeCountText(1, 90)).toBe("You have 1 strike in the last 90 days.");
    expect(myStrikeRuleText(48)).toBe(
      "A strike is given when you cancel less than 48 hours before a shift starts.",
    );
    expect(myStrikeTitle(mine())).toBe("Steward at Riverside Arena");
    expect(myStrikeSession(mine(), TZ)).toBe("Sat 7 Nov, 14:00 to 22:00");
    expect(myStrikeCancelled(mine(), TZ)).toBe(
      "Cancelled 18:00 on Fri 6 Nov, with 20 hours' notice.",
    );
    expect(myStrikeStatus(mine(), TZ)).toBe("Counts until Thu 4 Feb");
    expect(myStrikeStatus(mine({ status: "withdrawn", counting: false }), TZ)).toBe(
      "Withdrawn by the office",
    );
    expect(myStrikeStatus(mine({ counting: false }), TZ)).toBe("No longer counts");
  });

  const profile: Profile = {
    firstName: "Ann",
    lastName: "Booker",
    mobile: "+447700900123",
    email: null,
    qualifications: [],
    rightToWork: { checked: false, checkedOn: null, expired: false },
    rolesWithoutRule: [],
    photo: { status: "missing", current: null, waiting: null },
    unavailable: [],
    today: "2026-11-09",
    notifyChannel: "whatsapp",
    offerAlerts: true,
    textsOff: false,
  };
  const render = (strikes: MyStrikes) =>
    renderToStaticMarkup(
      createElement(ProfileView, { profile, signOff: "Acme Events Shift Team", strikes }),
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");

  it("shows the section, with 'Tell us what happened' only under a strike that still counts", () => {
    const text = render({
      timeZone: TZ,
      counting: 1,
      liveDays: 90,
      noticeHours: 48,
      strikes: [mine(), mine({ shiftId: "x2", status: "withdrawn", counting: false })],
      more: false,
    });
    expect(text).toContain("Strikes");
    expect(text).toContain("You have 1 strike in the last 90 days.");
    expect(text).toContain("Counts until Thu 4 Feb");
    expect(text).toContain("Withdrawn by the office");
    expect(text.match(/Tell us what happened/g)).toHaveLength(1);
    expect(text).not.toContain("most recent");
    // None yet: the count and the rule.
    const none = render({
      timeZone: TZ,
      counting: 0,
      liveDays: 90,
      noticeHours: 48,
      strikes: [],
      more: false,
    });
    expect(none).toContain("You have 0 strikes in the last 90 days.");
    expect(none).toContain("A strike is given when you cancel less than 48 hours");
  });

  it("one 'Tell us what happened' per session, and a note when there are more than it shows", () => {
    // Two strikes on the same session (booked again after cancelling): only the newer one asks.
    const text = render({
      timeZone: TZ,
      counting: 2,
      liveDays: 90,
      noticeHours: 48,
      strikes: [mine({ cancelledAt: at("2026-11-07T09:00:00Z") }), mine()],
      more: true,
    });
    expect(text.match(/Tell us what happened/g)).toHaveLength(1);
    expect(myStrikesMoreText(20)).toBe("Showing your 20 most recent strikes.");
    expect(text).toContain("Showing your 2 most recent strikes.");
  });
});

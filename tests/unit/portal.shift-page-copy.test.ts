import { describe, expect, it } from "vitest";
import { casualChip, requirementChip } from "@/lib/credentials/requirements";
import {
  bookedLinks,
  CALENDAR_AGAIN,
  calendarHref,
  changedSinceText,
  gettingThereLines,
  MESSAGE_OFFICE,
  NO_PAY_YET,
  payAsk,
  placesText,
  reasonsNeedOffice,
  requirementWords,
  strikeNote,
  strikeNoteText,
  travelSentence,
} from "@/lib/portal/shift-page-copy";
import { travelLineText } from "@/lib/travel/line-copy";

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
    // Phase 28.5: one she can't send herself is the office's to sort, with "Message the office".
    expect(
      requirementWords({ status: "valid", expiresOn: "2026-11-06" }, { ...on, uploadable: false }),
    ).toEqual({
      words: "Expires before this shift.",
      upload: false,
      tone: "urgent",
      message: true,
    });
  });

  it("expires before the shift, with her new one already sent: being checked, no upload", () => {
    expect(
      requirementWords({ status: "expiring_soon", expiresOn: "2026-11-06", renewing: true }, on),
    ).toEqual({
      words: "Expires before this shift: your new one is being checked.",
      upload: false,
      tone: "attention",
    });
    // Valid through the shift: her renewal changes nothing she reads.
    expect(
      requirementWords({ status: "valid", expiresOn: "2027-03-03", renewing: true }, on).words,
    ).toBe("You have it, valid until 3 Mar 2027");
  });

  it("missing, expired and not accepted: upload it, or ask the office for one she can't send", () => {
    expect(requirementWords({ status: "missing", expiresOn: null }, on)).toEqual({
      words: "Missing:",
      upload: true,
      tone: "urgent",
    });
    expect(
      requirementWords({ status: "missing", expiresOn: null }, { ...on, uploadable: false }),
    ).toEqual({ words: "Missing.", upload: false, tone: "urgent", message: true });
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
    // Phase 28.5: "Suspended." then a "Message the office" link (it was "Suspended: contact the
    // office.", a dead end).
    expect(requirementWords({ status: "suspended", expiresOn: null }, on)).toEqual({
      words: "Suspended.",
      upload: false,
      tone: "urgent",
      message: true,
    });
  });
});

describe("places, the strike note and the chips", () => {
  it("says how many of how many are left, and the firm's own notice", () => {
    expect(placesText(1, 4)).toBe("1 of 4 left");
    expect(strikeNoteText(48)).toBe(
      "Cancelling less than 48 hours before the start gives you a strike. A strike is a record, not a fine. It never comes off your pay.",
    );
  });

  it("labels a requirement as the office does: a short name, or its own name capitalised", () => {
    expect(requirementChip({ code: "SIA_DS", name: "SIA door supervisor licence" })).toBe("SIA DS");
    expect(requirementChip({ code: "CSAS", name: "CSAS accreditation" })).toBe("CSAS");
    expect(requirementChip({ code: "DBS", name: "DBS check" })).toBe("DBS check");
  });

  // Phase 27.2: a casual may not know the office's short codes, so her chips say the full name.
  it("labels a requirement for the casual by its full name, never a short code", () => {
    const ds = { code: "SIA_DS", name: "SIA door supervisor licence" };
    const sg = { code: "SIA_SG", name: "SIA security guard licence" };
    expect(casualChip(ds)).toBe("SIA door supervisor licence");
    expect(casualChip({ code: "CSAS", name: "CSAS accreditation" })).toBe("CSAS accreditation");
    expect(casualChip({ code: "FIRST_AID", name: "first aid at work certificate" })).toBe(
      "First aid at work certificate",
    );
    // A one-of group: "A or B", capitalised once.
    expect(casualChip({ ...sg, group: [sg, ds] })).toBe(
      "SIA security guard licence or SIA door supervisor licence",
    );
    expect(
      casualChip({
        code: "FIRST_AID",
        name: "first aid at work certificate",
        group: [
          { code: "FIRST_AID", name: "first aid at work certificate" },
          { code: "EFAW", name: "emergency first aid certificate" },
        ],
      }),
    ).toBe("First aid at work certificate or emergency first aid certificate");
  });
});

// Phase 28.5 (docs/screens.md "The casual app, Phase 28" 28.5): the review's fixes on the shift's
// page, and every link to the office built from 28.2's contract (src/lib/portal/message-office.ts).
describe("Phase 28.5: the shift page's words and links", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const at = (iso: string) => new Date(iso);
  const HOUR = 3_600_000;

  it("the strike note names the hours inside the firm's notice, and the rule further off", () => {
    const now = at("2026-11-05T21:35:00Z"); // Thu 5 Nov, 21:35 (the review's capture)
    const startsAt = at("2026-11-07T10:30:00Z"); // Sat 7 Nov, 10:30: 36h55m away
    expect(strikeNote({ startsAt, now, noticeHours: 48 })).toBe(
      "This shift starts in 36 hours. If you cancel it, you'll get a strike.",
    );
    // Counted as the cancel sheet counts: rounded down, "1 hour", "less than an hour", days from 48.
    expect(
      strikeNote({ startsAt: new Date(now.getTime() + 37.9 * HOUR), now, noticeHours: 48 }),
    ).toBe("This shift starts in 37 hours. If you cancel it, you'll get a strike.");
    expect(
      strikeNote({ startsAt: new Date(now.getTime() + 1.5 * HOUR), now, noticeHours: 48 }),
    ).toBe("This shift starts in 1 hour. If you cancel it, you'll get a strike.");
    expect(
      strikeNote({ startsAt: new Date(now.getTime() + 20 * 60_000), now, noticeHours: 48 }),
    ).toBe("This shift starts in less than an hour. If you cancel it, you'll get a strike.");
    expect(
      strikeNote({ startsAt: new Date(now.getTime() + 50 * HOUR), now, noticeHours: 72 }),
    ).toBe("This shift starts in 2 days. If you cancel it, you'll get a strike.");
    // At or past the notice: no strike for cancelling now, so the firm's rule as before.
    expect(strikeNote({ startsAt, now, noticeHours: 24 })).toBe(strikeNoteText(24));
    expect(
      strikeNote({ startsAt: new Date(now.getTime() + 48 * HOUR), now, noticeHours: 48 }),
    ).toBe(strikeNoteText(48));
  });

  it("travel not worked out yet: the travel line's one sentence (line-copy, one source); worked out: none", () => {
    const straight = { kind: "straight", straightMetres: 3200 } as const;
    expect(travelSentence(straight, TZ)).toBe(travelLineText(straight, TZ));
    expect(travelSentence({ kind: "unknown" }, TZ)).toBe(travelLineText({ kind: "unknown" }, TZ));
    expect(
      travelSentence(
        {
          kind: "estimated",
          straightMetres: 9000,
          arriveBy,
          car: { minutes: 21, metres: 13518 },
          publicTransport: { minutes: 38 },
        },
        TZ,
      ),
    ).toBeNull();
  });

  it("the pay button: Messages about the pay before the end, the pay query after (golden rule 9)", () => {
    const shift = { id: ID, endsAt: at("2026-11-07T22:00:00Z") };
    expect(payAsk(shift, at("2026-11-07T21:59:00Z"))).toEqual({
      label: "Ask the office about the pay",
      href: `/messages?shift=${ID}&about=pay`,
    });
    expect(payAsk(shift, at("2026-11-07T22:00:00Z"))).toEqual({
      label: "Raise a pay query",
      href: `/pay/query?shift=${ID}`,
    });
  });

  it("her booking's links: Running late? from 3 hours before, Message the office once started, the calendar until the end", () => {
    const booking = {
      id: ID,
      startsAt: at("2026-11-07T14:00:00Z"),
      endsAt: at("2026-11-07T22:00:00Z"),
      status: "confirmed",
    };
    const calendar = `/shifts/${ID}/calendar`;
    expect(bookedLinks(booking, at("2026-11-07T10:59:00Z"))).toEqual({
      late: null,
      started: null,
      calendar,
    });
    expect(bookedLinks(booking, at("2026-11-07T11:00:00Z"))).toEqual({
      late: `/messages?shift=${ID}&about=late`,
      started: null,
      calendar,
    });
    expect(bookedLinks(booking, at("2026-11-07T14:00:00Z"))).toEqual({
      late: `/messages?shift=${ID}&about=late`,
      started: `/messages?shift=${ID}&about=started`,
      calendar,
    });
    // Ended, or marked by the office: nothing to say on the day, and no calendar.
    const none = { late: null, started: null, calendar: null };
    expect(bookedLinks(booking, at("2026-11-07T22:00:00Z"))).toEqual(none);
    expect(bookedLinks({ ...booking, status: "completed" }, at("2026-11-07T15:00:00Z"))).toEqual(
      none,
    );
    expect(calendarHref(ID)).toBe(calendar);
  });

  it("the reasons that send her to the office get Message the office; the others don't", () => {
    expect(reasonsNeedOffice(["credential_suspended"])).toBe(true);
    expect(reasonsNeedOffice(["rest", "blocked_site"])).toBe(true);
    expect(reasonsNeedOffice(["not_active"])).toBe(true);
    expect(reasonsNeedOffice(["no_rule"])).toBe(true);
    expect(reasonsNeedOffice(["credential_missing", "overlap", "weekly_hours"])).toBe(false);
    expect(reasonsNeedOffice(undefined)).toBe(false);
    expect(MESSAGE_OFFICE).toBe("Message the office");
  });

  it("Changed since you booked: the briefing's parts in her words, and when the last changed", () => {
    expect(
      changedSinceText(
        { fields: ["instructions", "meetingPoint"], at: at("2026-11-03T14:05:00Z") },
        TZ,
      ),
    ).toBe("Changed since you booked: instructions and meeting point (Tue 3 Nov, 14:05)");
    expect(
      changedSinceText(
        { fields: ["meetingPoint", "uniform", "payRatePence"], at: at("2026-07-01T08:30:00Z") },
        TZ,
      ),
    ).toBe("Changed since you booked: meeting point, uniform and pay (Wed 1 Jul, 09:30)");
    expect(changedSinceText({ fields: [], at: at("2026-11-03T14:05:00Z") }, TZ)).toBeNull();
    expect(CALENDAR_AGAIN).toBe("The times changed. Add it to your calendar again.");
    expect(NO_PAY_YET).toBe("Not given yet.");
  });
});

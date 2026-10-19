import { describe, expect, it } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import {
  askedDays,
  AUTOMATIC,
  cancelReplyText,
  loggedCheck,
  MAX_BODY,
  shiftsReplyText,
  type CancelReplyInput,
  type EnquiryChecks,
  type ListedShift,
  type ShiftsReplyInput,
} from "@/lib/inbound/personal-reply";
import { shiftsLineReply } from "@/lib/messaging/templates";
import { checkEligibility } from "@/lib/rules/eligibility";

// The shifts line's personal replies (docs/office-v2.md 5.7 items 1-3; 12D.2): the words, built by
// code. Times are London (BST in October).

const TZ = "Europe/London";
const firm = { name: "Acme Events", signOff: "Acme Events Shift Team" };
const LINK = "http://acme.localhost:3000/shifts/open";
const PROFILE = "http://acme.localhost:3000/profile/travel";

const estimated = (car: number, metres: number, pt: number | null) =>
  ({
    kind: "estimated",
    straightMetres: metres,
    arriveBy: new Date("2026-10-10T06:30:00Z"),
    car: { minutes: car, metres },
    publicTransport: pt === null ? null : { minutes: pt },
  }) as const;

const arena: ListedShift = {
  shiftId: "s1",
  role: "door_supervisor",
  eventName: "Northern Lights Live",
  siteName: "Acme Demo Arena",
  startsAt: new Date("2026-10-10T07:00:00Z"), // 08:00 BST
  endsAt: new Date("2026-10-10T15:00:00Z"),
  payRatePence: 1550,
  post: "Gate A",
  urgent: true,
  holdsCsas: false,
  travel: estimated(12, 4989, 24), // 3.1 miles
};
const patrol: ListedShift = {
  shiftId: "s2",
  role: "csas_officer",
  eventName: "Night patrols",
  siteName: "Northgate Town Centre",
  startsAt: new Date("2026-10-10T16:00:00Z"),
  endsAt: new Date("2026-10-10T22:00:00Z"),
  payRatePence: 1500,
  post: "town centre patrol",
  urgent: false,
  holdsCsas: true,
  travel: estimated(21, 13518, 38), // 8.4 miles
};

const FRIDAY = new Date("2026-10-09T18:00:00Z");
const base = (o: Partial<ShiftsReplyInput> = {}): ShiftsReplyInput => ({
  firstName: "Zoe",
  firm,
  timeZone: TZ,
  asked: askedDays("anything on saturday?", FRIDAY, TZ),
  booked: [],
  shifts: [arena, patrol],
  travelOn: true,
  area: { maxMinutes: 45 },
  offerAlerts: true,
  links: { take: LINK, profile: PROFILE },
  ...o,
});

describe("the days a message names (code, not AI)", () => {
  it("a weekday, the weekend, today, tomorrow; none", () => {
    expect(askedDays("any shifts saturday?", FRIDAY, TZ)).toEqual({
      dates: ["2026-10-10"],
      forWords: "For Saturday",
      onWords: "on Saturday",
    });
    expect(askedDays("Any shifts this weekend?", FRIDAY, TZ)).toEqual({
      dates: ["2026-10-10", "2026-10-11"],
      forWords: "For the weekend",
      onWords: "at the weekend",
    });
    expect(askedDays("work today", FRIDAY, TZ)?.dates).toEqual(["2026-10-09"]);
    expect(askedDays("work tomorrow", FRIDAY, TZ)?.dates).toEqual(["2026-10-10"]);
    // A Friday asking about Friday means today; about Thursday, next week's.
    expect(askedDays("fri", FRIDAY, TZ)?.dates).toEqual(["2026-10-09"]);
    expect(askedDays("thursday please", FRIDAY, TZ)?.dates).toEqual(["2026-10-15"]);
    expect(askedDays("sat or sun", FRIDAY, TZ)).toMatchObject({
      dates: ["2026-10-10", "2026-10-11"],
      forWords: "For Saturday and Sunday",
    });
    expect(askedDays("any shifts?", FRIDAY, TZ)).toBeNull();
    // Short forms that are also ordinary words: days only where they read as days.
    for (const ordinary of [
      "I sat my test, any shifts?",
      "c'mon, any work?",
      "c\u2019mon, any work?",
      "lying in the sun, any shifts?",
      "getting wed next month, any work after?",
      "we'd like more shifts",
    ]) {
      expect(askedDays(ordinary, FRIDAY, TZ), ordinary).toBeNull();
    }
    expect(askedDays("any shifts sat?", FRIDAY, TZ)?.dates).toEqual(["2026-10-10"]);
    expect(askedDays("anything on sun", FRIDAY, TZ)?.dates).toEqual(["2026-10-11"]);
    expect(askedDays("can I do wed", FRIDAY, TZ)?.dates).toEqual(["2026-10-14"]);
    expect(askedDays("mon please", FRIDAY, TZ)?.dates).toEqual(["2026-10-12"]);
    expect(askedDays("I sat my test, any shifts sat?", FRIDAY, TZ)?.dates).toEqual(["2026-10-10"]);
    // Her words are looked up as keys: a built-in name ("constructor", any case) is just a word.
    expect(askedDays("any constructor shifts sat?", FRIDAY, TZ)?.dates).toEqual(["2026-10-10"]);
    expect(askedDays("Constructor work tomorrow?", FRIDAY, TZ)?.dates).toEqual(["2026-10-10"]);
    expect(askedDays("constructor tostring valueof hasownproperty", FRIDAY, TZ)).toBeNull();
    // A possessive is its word ("Saturday's", "tomorrow's", a phone's curly apostrophe too).
    expect(askedDays("anything for Saturday's event?", FRIDAY, TZ)?.dates).toEqual(["2026-10-10"]);
    expect(askedDays("what's tomorrow\u2019s shift", FRIDAY, TZ)?.dates).toEqual(["2026-10-10"]);
    expect(askedDays("the sun's out, any shifts?", FRIDAY, TZ)).toBeNull();
    // On a Sunday, "this weekend" is what's left of it.
    expect(askedDays("weekend?", new Date("2026-10-11T09:00:00Z"), TZ)?.dates).toEqual([
      "2026-10-11",
    ]);
  });
});

describe("the shifts reply on WhatsApp", () => {
  it("§5.7's list: the booked line, the day words, each shift and its travel line, the link", () => {
    const { text, listed } = shiftsReplyText(
      base({
        asked: askedDays("anything this weekend?", FRIDAY, TZ),
        booked: [
          {
            role: "steward",
            eventName: "Riverside Food Festival",
            startsAt: new Date("2026-10-11T09:00:00Z"),
            endsAt: new Date("2026-10-11T17:00:00Z"),
          },
        ],
      }),
      "whatsapp",
    );
    expect(listed).toBe(2);
    expect(text).toBe(
      [
        "Hi Zoe, you're booked on Sun 11 Oct (Steward · Riverside Food Festival · 10:00–18:00). For the weekend you can take:",
        "1. Door supervisor · Northern Lights Live, Acme Demo Arena · Sat 10 Oct 08:00–16:00 · £15.50/h · Gate A · urgent",
        "   3.1 miles · 12 min by car · 24 min by public transport",
        "2. CSAS officer · Night patrols, Northgate Town Centre · Sat 10 Oct 17:00–23:00 · £15.00/h · town centre patrol · you hold CSAS",
        "   8.4 miles · 21 min by car · 38 min by public transport",
        `Take one here: ${LINK}`,
        AUTOMATIC,
        "— Acme Events Shift Team",
      ].join("\n"),
    );
  });

  it("no day named: no day words and no booked line; no pay rate: no £", () => {
    const { text } = shiftsReplyText(
      base({ asked: null, shifts: [{ ...arena, payRatePence: null, post: null }] }),
      "whatsapp",
    );
    expect(text.split("\n").slice(0, 2)).toEqual([
      "Hi Zoe, shifts you can take:",
      "1. Door supervisor · Northern Lights Live, Acme Demo Arena · Sat 10 Oct 08:00–16:00 · urgent",
    ]);
    expect(text).not.toContain("£");
    expect(text).not.toContain("booked");
  });

  it("no home area: no travel lines, and how to add one before Take one here", () => {
    const { text } = shiftsReplyText(base({ area: null }), "whatsapp");
    expect(text).not.toMatch(/min by car|miles/);
    expect(text).toContain(
      `Add your home area to see how far each one is: ${PROFILE}\nTake one here: ${LINK}`,
    );
    // Never a postcode: only "your home area".
    expect(text).not.toMatch(/ZZ\d/);
  });

  it("travel line variants: no public transport in time; distance not known yet", () => {
    const { text } = shiftsReplyText(
      base({
        shifts: [
          { ...arena, travel: estimated(12, 4989, null) },
          { ...patrol, travel: { kind: "unknown" } },
        ],
      }),
      "whatsapp",
    );
    expect(text).toContain("   3.1 miles · 12 min by car · no public transport by 07:30");
    expect(text).toContain("   Distance not known yet");
  });

  it("more than five: the first five, then + N more with the link", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...arena, shiftId: `s${i}` }));
    const { text, listed } = shiftsReplyText(base({ shifts: seven }), "whatsapp");
    expect(listed).toBe(5);
    expect(text).toContain(`\n5. Door supervisor`);
    expect(text).not.toContain("\n6. ");
    expect(text).toContain(`+ 2 more: ${LINK}\nTake one here: ${LINK}`);
  });

  it("nothing she can take: §5.7's words, with her area and the day; without them, plainer", () => {
    expect(shiftsReplyText(base({ shifts: [] }), "whatsapp").text).toBe(
      `Hi Zoe, there's nothing you can take on Saturday within 45 minutes of your home area right now. We'll message you if something comes up. All open shifts: ${LINK}\n${AUTOMATIC}\n— Acme Events Shift Team`,
    );
    expect(
      shiftsReplyText(base({ shifts: [], asked: null, area: null, offerAlerts: false }), "whatsapp")
        .text,
    ).toBe(
      `Hi Zoe, there's nothing you can take right now. All open shifts: ${LINK}\n${AUTOMATIC}\n— Acme Events Shift Team`,
    );
  });
});

describe("the shifts reply by text", () => {
  it("the text version: shorter, at most three, the distance and both times, signed with a hyphen", () => {
    const { text, listed } = shiftsReplyText(base(), "sms");
    expect(listed).toBe(2);
    expect(text).toBe(
      `Acme Events: shifts for you: 1) Sat 10 Oct 08:00-16:00 Door supervisor, Acme Demo Arena, £15.50/h, 3.1 miles, 12 min by car, 24 min by public transport. 2) Sat 10 Oct 17:00-23:00 CSAS officer, Northgate Town Centre, £15.00/h, 8.4 miles, 21 min by car, 38 min by public transport. Take one: ${LINK} ${AUTOMATIC} - Acme Events Shift Team`,
    );
    // Or why they aren't known, as the app says it (no "·": it isn't in the plain text alphabet).
    const why = (travel: ListedShift["travel"]) =>
      shiftsReplyText(base({ shifts: [{ ...arena, travel }] }), "sms").text;
    expect(why({ kind: "unknown" })).toContain("£15.50/h, distance not known yet.");
    expect(why({ kind: "straight", straightMetres: 11000 })).toContain(
      "£15.50/h, about 7 miles (straight line), travel time not known yet.",
    );
    expect(
      why({
        kind: "estimated",
        straightMetres: 90000,
        arriveBy: new Date("2026-10-10T06:30:00Z"),
        car: null,
        publicTransport: null,
      }),
    ).toContain(
      "£15.50/h, about 56 miles (straight line), over 90 min by car, no public transport by 07:30.",
    );
    expect(text).not.toContain("·");
    const four = Array.from({ length: 4 }, (_, i) => ({ ...arena, shiftId: `s${i}` }));
    const many = shiftsReplyText(base({ shifts: four }), "sms");
    expect(many.listed).toBe(3);
    expect(many.text).toContain("+ 1 more.");
  });
});

describe("the 1,600-character limit", () => {
  // Every field at its longest: event and post 200 characters each, a long site and role.
  const long: ListedShift = {
    ...arena,
    role: "response_team_lead_with_a_very_long_role_name_x",
    eventName: "E".repeat(200),
    siteName: "S".repeat(200),
    post: "P".repeat(200),
    holdsCsas: true,
    travel: estimated(89, 140000, 89),
  };
  const five = Array.from({ length: 5 }, (_, i) => ({ ...long, shiftId: `s${i}` }));
  it.each(["whatsapp", "sms"] as const)(
    "five shifts at their longest stay within it on %s",
    (channel) => {
      const { text, listed } = shiftsReplyText(
        base({
          shifts: five,
          booked: [
            {
              role: "steward",
              eventName: "B".repeat(200),
              startsAt: new Date("2026-10-10T05:00:00Z"),
              endsAt: new Date("2026-10-10T06:00:00Z"),
            },
          ],
        }),
        channel,
      );
      expect(text.length).toBeLessThanOrEqual(MAX_BODY);
      expect(listed).toBe(channel === "whatsapp" ? 5 : 3);
      // The names are cut, never the dates, times, pay or links.
      expect(text).toContain("Sat 10 Oct");
      expect(text).toContain("£15.50/h");
      expect(text).toContain(LINK);
    },
  );
});

describe("never over the limit, whatever the names", () => {
  // Six bookings on the days she named, each with a 200-character event, and names far longer
  // than any real one: the booked line is cut and capped too, in every branch.
  const booked = Array.from({ length: 6 }, (_, i) => ({
    role: "steward",
    eventName: `${i}${"B".repeat(199)}`,
    startsAt: new Date("2026-10-10T05:00:00Z"),
    endsAt: new Date("2026-10-10T06:00:00Z"),
  }));
  it.each(["whatsapp", "sms"] as const)(
    "six long bookings, with shifts and with none, on %s",
    (channel) => {
      for (const shifts of [[arena, patrol], []]) {
        const { text } = shiftsReplyText(base({ shifts, booked }), channel);
        expect(text.length).toBeLessThanOrEqual(MAX_BODY);
        expect(text).toContain(LINK);
      }
    },
  );
  it("the booked line names two, then how many more", () => {
    const { text } = shiftsReplyText(base({ shifts: [], booked }), "whatsapp");
    expect(text).toMatch(
      /you're booked on Sat 10 Oct \(Steward · 0B+… · 06:00–07:00\) and Sat 10 Oct \(Steward · 1B+… · 06:00–07:00\) and 4 more\./,
    );
  });
  it("a first name of 300 characters, and a firm name of 2,000: still within, with the link", () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      const long = shiftsReplyText(base({ firstName: "Z".repeat(300) }), channel);
      expect(long.text.length).toBeLessThanOrEqual(MAX_BODY);
      expect(long.text).not.toContain("Z".repeat(41));
      const huge = shiftsReplyText(
        base({ firm: { name: "A".repeat(2000), signOff: "Acme Shift Team" } }),
        channel,
      );
      expect(huge.text.length).toBeLessThanOrEqual(MAX_BODY);
      expect(huge.text).toContain(LINK);
    }
  });
  it("the last resort, when even the link alone is too long, is still signed (14.3; golden rule 8)", () => {
    const huge = `${LINK}?${"x".repeat(1700)}`;
    for (const [channel, end] of [
      ["whatsapp", "\n— Acme Events Shift Team"],
      ["sms", " - Acme Events Shift Team"],
    ] as const) {
      for (const shifts of [[arena], []]) {
        const { text, listed } = shiftsReplyText(
          base({ shifts, links: { take: huge, profile: PROFILE } }),
          channel,
        );
        expect(listed).toBe(0);
        expect(text.length).toBeLessThanOrEqual(MAX_BODY);
        expect(text.startsWith(`Shifts you can take: ${LINK}?xxx`)).toBe(true);
        expect(text.endsWith(end)).toBe(true);
      }
    }
  });
  it('a text\'s cut names end with three dots (GSM-7), never "…"', () => {
    const long = { ...arena, siteName: "S".repeat(200), role: "r".repeat(100) };
    const { text } = shiftsReplyText(base({ shifts: [long] }), "sms");
    expect(text).toContain("SSS...");
    expect(text).not.toContain("…");
  });
  it("the cancel reply with every name at its longest stays within", () => {
    const text = cancelReplyText(
      {
        firstName: "K".repeat(300),
        firm,
        timeZone: TZ,
        next: {
          role: "r".repeat(300),
          eventName: "E".repeat(200),
          siteName: "S".repeat(200),
          startsAt: new Date("2026-10-07T09:30:00Z"),
          endsAt: new Date("2026-10-07T17:30:00Z"),
          post: "P".repeat(200),
          link: "http://acme.localhost:3000/shifts/x1",
        },
        strike: { thresholdHours: 48 },
        others: 1,
        links: { booked: "http://acme.localhost:3000/" },
      },
      "whatsapp",
    );
    expect(text.length).toBeLessThan(700);
    expect(text).toContain("http://acme.localhost:3000/shifts/x1");
  });
});

describe("the cancel reply", () => {
  const next: NonNullable<CancelReplyInput["next"]> = {
    role: "steward",
    eventName: "Raceday",
    siteName: "Acme Demo Racecourse",
    startsAt: new Date("2026-10-07T09:30:00Z"),
    endsAt: new Date("2026-10-07T17:30:00Z"),
    post: "parade ring",
    link: "http://acme.localhost:3000/shifts/x1",
  };
  const cancel = (o: Partial<CancelReplyInput>): CancelReplyInput => ({
    firstName: "Kieran",
    firm,
    timeZone: TZ,
    next,
    strike: null,
    others: 0,
    links: { booked: "http://acme.localhost:3000/" },
    ...o,
  });

  it("names the booking; the strike sentence only when a strike would apply", () => {
    expect(cancelReplyText(cancel({ strike: { thresholdHours: 48 } }), "whatsapp")).toBe(
      `Hi Kieran, you're booked on Steward · Raceday, Acme Demo Racecourse · Wed 7 Oct 10:30–18:30 · parade ring. To cancel, open it and tap Cancel this shift: http://acme.localhost:3000/shifts/x1. It starts in less than 48 hours, so cancelling now gives you a strike. ${AUTOMATIC}\n— Acme Events Shift Team`,
    );
    expect(cancelReplyText(cancel({}), "whatsapp")).not.toContain("strike");
  });

  it("Your other shifts only with two or more bookings ahead", () => {
    expect(cancelReplyText(cancel({ others: 1 }), "whatsapp")).toContain(
      "Your other shifts: http://acme.localhost:3000/ Automatic reply.",
    );
    expect(cancelReplyText(cancel({ others: 0 }), "whatsapp")).not.toContain("Your other shifts");
  });

  it("no booking ahead; by text, a hyphen sign-off", () => {
    expect(cancelReplyText(cancel({ next: null }), "sms")).toBe(
      `Hi Kieran, you have no shifts booked, so there's nothing to cancel. ${AUTOMATIC} - Acme Events Shift Team`,
    );
  });
});

describe("the other instant replies", () => {
  it("the pay reply: the link only, never a list, with how to reach a person", () => {
    const pay = shiftsLineReply(firm, { intent: "pay", link: "http://acme.localhost:3000/pay" });
    expect(pay).toBe(
      `Your hours, rates and pay dates: http://acme.localhost:3000/pay (you'll get a code to log in). ${AUTOMATIC} — Acme Events Shift Team`,
    );
    expect(pay).not.toMatch(/shifts you can take|£|\d\./);
  });
});

describe("enquiry.checks passes the log's check", () => {
  it("at its biggest: five sessions with every check, 50 not offered, a cancel's booking", () => {
    const verdict = checkEligibility({
      now: new Date("2026-11-01T09:00:00Z"),
      timeZone: TZ,
      worker: { id: "w1", status: "active", roles: ["door_supervisor"] },
      credentials: [{ type: "SIA_DS", status: "valid", expiresOn: "2027-01-01" }],
      shift: {
        id: "s1",
        role: "door_supervisor",
        startsAt: new Date("2026-11-07T14:00:00Z"),
        endsAt: new Date("2026-11-07T22:00:00Z"),
        siteId: "11111111-1111-4111-8111-111111111111",
        requiredTypes: ["SIA_DS"],
        extraTypes: ["FIRST_AID", "CSAS"],
      },
      otherAssignments: [
        { startsAt: new Date("2026-11-07T00:00:00Z"), endsAt: new Date("2026-11-07T04:00:00Z") },
      ],
      unavailableDates: ["2026-11-07"],
      settings: {
        minRestHours: 11,
        weeklyHoursCap: 48,
        travelBufferMinutes: 30,
        appliedAllowancePct: 0,
        appliedAllowedTypes: [],
        appliedInUseCount: 0,
        deployedCount: 0,
        blockedSites: [],
      },
    });
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const sample: EnquiryChecks & { sent: boolean; channel: string; workerId: string } = {
      template: "shifts_list",
      days: ["2026-10-10", "2026-10-11"],
      area: { maxMinutes: 45 },
      offered: Array.from({ length: 5 }, (_, i) => ({
        shiftId: id(i),
        car: 12,
        publicTransport: null,
        checks: verdict.checks.map(loggedCheck),
      })),
      more: 3,
      notOffered: Array.from({ length: 50 }, (_, i) => ({
        shiftId: id(100 + i),
        reasons: [
          { code: "hidden" },
          { code: "outside_area" },
          { code: "credential_missing", type: "FIRST_AID" },
          { code: "overlap", from: "2026-10-10T07:00:00.000Z", to: "2026-10-10T15:00:00.000Z" },
          { code: "held", to: "2026-10-09T20:00:00.000Z" },
        ],
      })),
      notOfferedMore: 12,
      notChecked: 7,
      bookings: [id(999)],
      sent: true,
      channel: "whatsapp",
      workerId: id(7),
    };
    expect(verdict.checks.length).toBeGreaterThan(9);
    expect(passesLogCheck({ ...sample })).toBe(true);
    // And the AI's fallback reason beside message.received's own fields.
    expect(
      passesLogCheck({
        channel: "whatsapp",
        handledAs: "office",
        intent: "office",
        aiFallback: "not_connected",
        workerId: id(7),
      }),
    ).toBe(true);
  });
});

describe("travel areas switched off for the firm (13.4)", () => {
  it("no travel lines and no ask for a home area, by WhatsApp or text", () => {
    const off = base({
      travelOn: false,
      area: null,
      shifts: [
        { ...arena, travel: undefined },
        { ...patrol, travel: undefined },
      ],
    });
    for (const channel of ["whatsapp", "sms"] as const) {
      const { text, listed } = shiftsReplyText(off, channel);
      expect(listed).toBe(2);
      expect(text).not.toMatch(/home area|min by car|miles|public transport/i);
      expect(text).not.toContain(PROFILE);
    }
    // Nothing to take: no "within N minutes of your home area" either.
    const none = shiftsReplyText({ ...off, shifts: [] }, "whatsapp").text;
    expect(none).toContain("there's nothing you can take on Saturday right now.");
  });
});

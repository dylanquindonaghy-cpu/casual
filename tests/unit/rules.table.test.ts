import { describe, expect, it } from "vitest";
import {
  checkEligibility,
  isEligibilityPass,
  type EligibilityInput,
  type EligibilityPass,
  type RuleCode,
} from "@/lib/rules/eligibility";

// The rules engine as a table (docs/rules-and-credentials.md, "Test cases": every row there is a
// test here, named as in the doc), then the edges: overrides, the pass, clock changes, purity.

const H = 3_600_000;
const at = (iso: string) => new Date(iso);
// Saturday 7 Nov 2026 (GMT, so London time = UTC): the shift is 14:00-22:00, taken on 1 Nov.
const SHIFT_START = at("2026-11-07T14:00:00Z");

function input(
  o: {
    worker?: Partial<EligibilityInput["worker"]>;
    credentials?: EligibilityInput["credentials"];
    shift?: Partial<EligibilityInput["shift"]>;
    others?: [string, string][];
    unavailableDates?: string[];
    settings?: Partial<EligibilityInput["settings"]>;
    now?: Date;
    overrides?: EligibilityInput["overrides"];
  } = {},
): EligibilityInput {
  return {
    now: o.now ?? at("2026-11-01T09:00:00Z"),
    timeZone: "Europe/London",
    worker: { id: "w1", status: "active", roles: ["door_supervisor", "steward"], ...o.worker },
    credentials: o.credentials ?? [{ type: "SIA_DS", status: "valid", expiresOn: "2027-11-01" }],
    shift: {
      id: "s1",
      role: "door_supervisor",
      startsAt: SHIFT_START,
      endsAt: at("2026-11-07T22:00:00Z"),
      siteId: "site-1",
      requiredTypes: ["SIA_DS"],
      ...o.shift,
    },
    otherAssignments: (o.others ?? []).map(([s, e]) => ({ startsAt: at(s), endsAt: at(e) })),
    unavailableDates: o.unavailableDates ?? [],
    settings: {
      minRestHours: 11,
      weeklyHoursCap: 48,
      travelBufferMinutes: 0,
      appliedAllowancePct: 0,
      appliedAllowedTypes: ["SIA_DS"],
      appliedInUseCount: 0,
      deployedCount: 0,
      blockedSites: [],
      ...o.settings,
    },
    names: { SIA_DS: "SIA door supervisor licence", PTS: "PTS card" },
    overrides: o.overrides,
  };
}

const codes = (i: EligibilityInput) => checkEligibility(i).codes;
const OK: RuleCode[] = [];

// A week of other bookings: n hours from Mon 2 to Fri 6 Nov, starting 06:00 each day, 8 h a day
// with anything over 40 on Monday, so none ends near Saturday's shift (no rest clash).
function hoursThisWeek(n: number): [string, string][] {
  const perDay = [8, 8, 8, 8, 8];
  perDay[0] = (perDay[0] ?? 8) + Math.max(0, n - 40);
  let short = Math.max(0, 40 - n);
  for (let d = 4; d >= 0 && short > 0; d--) {
    const cut = Math.min(perDay[d] ?? 0, short);
    perDay[d] = (perDay[d] ?? 0) - cut;
    short -= cut;
  }
  return perDay.flatMap((len, i): [string, string][] => {
    if (len === 0) return [];
    const start = at(`2026-11-0${i + 2}T06:00:00Z`);
    return [[start.toISOString(), new Date(start.getTime() + len * H).toISOString()]];
  });
}

describe("docs/rules-and-credentials.md test cases", () => {
  it("Valid licence, free day -> ok", () => {
    const result = checkEligibility(input());
    expect(result).toMatchObject({ ok: true, reasons: [], codes: [] });
  });

  it("Licence expires the day before the shift -> fail: expired reason", () => {
    const result = checkEligibility(
      input({ credentials: [{ type: "SIA_DS", status: "valid", expiresOn: "2026-11-06" }] }),
    );
    expect(result.codes).toEqual(["credential_expired"]);
    expect(result.reasons).toEqual([
      "Your SIA door supervisor licence expires on 6 Nov, before this shift. Renew it, then send the new number to the office.",
    ]);
  });

  it("Licence expires on the shift date -> ok (in date on the day)", () => {
    expect(
      codes(input({ credentials: [{ type: "SIA_DS", status: "valid", expiresOn: "2026-11-07" }] })),
    ).toEqual(OK);
  });

  it("Missing required credential -> fail", () => {
    const result = checkEligibility(input({ credentials: [] }));
    expect(result.codes).toEqual(["credential_missing"]);
    expect(result.reasons).toEqual([
      "This shift needs a valid SIA door supervisor licence. Send it to the office to be checked.",
    ]);
  });

  const applied = [{ type: "SIA_DS", status: "applied" as const, expiresOn: null }];
  it("Applied, allowance 15%, 10 deployed, 1 applied in use: 2/11 = 18% -> fail", () => {
    const result = checkEligibility(
      input({
        credentials: applied,
        settings: { appliedAllowancePct: 15, deployedCount: 10, appliedInUseCount: 1 },
      }),
    );
    expect(result.codes).toEqual(["applied_over_allowance"]);
    expect(result.reasons).toEqual([
      "Your SIA door supervisor licence is still being processed. Only a few people waiting for theirs can work each day, and today's places are taken.",
    ]);
  });

  it("Applied, allowance 15%, 20 deployed, 1 in use: 2/21 = 9.5% -> ok", () => {
    expect(
      codes(
        input({
          credentials: applied,
          settings: { appliedAllowancePct: 15, deployedCount: 20, appliedInUseCount: 1 },
        }),
      ),
    ).toEqual(OK);
  });

  it("Applied, allowance 0 -> fail", () => {
    expect(
      codes(
        input({ credentials: applied, settings: { appliedAllowancePct: 0, deployedCount: 100 } }),
      ),
    ).toEqual(["applied_over_allowance"]);
  });

  it("Overlap by 1 minute: other 08:00-14:00, shift 13:59-20:00 -> fail", () => {
    const result = checkEligibility(
      input({
        shift: { startsAt: at("2026-11-07T13:59:00Z"), endsAt: at("2026-11-07T20:00:00Z") },
        others: [["2026-11-07T08:00:00Z", "2026-11-07T14:00:00Z"]],
      }),
    );
    expect(result.codes).toEqual(["overlap"]);
    expect(result.reasons).toEqual(["You're already booked at 08:00 that day."]);
  });

  it("Back-to-back with 11 h rest: other ends 22:00, shift starts 09:00 next day -> ok", () => {
    expect(
      codes(
        input({
          shift: { startsAt: at("2026-11-07T09:00:00Z"), endsAt: at("2026-11-07T17:00:00Z") },
          others: [["2026-11-06T14:00:00Z", "2026-11-06T22:00:00Z"]],
        }),
      ),
    ).toEqual(OK);
  });

  it("Back-to-back with 10 h rest: shift starts 08:00 -> fail", () => {
    const result = checkEligibility(
      input({
        shift: { startsAt: at("2026-11-07T08:00:00Z"), endsAt: at("2026-11-07T16:00:00Z") },
        others: [["2026-11-06T14:00:00Z", "2026-11-06T22:00:00Z"]],
      }),
    );
    expect(result.codes).toEqual(["rest"]);
    expect(result.reasons).toEqual([
      "This is too close to your previous shift (11 hours' rest needed).",
    ]);
  });

  it("Weekly cap 48, has 40 h, shift 8 h: 48 -> ok", () => {
    expect(codes(input({ others: hoursThisWeek(40) }))).toEqual(OK);
  });

  it("Weekly cap 48, has 41 h, shift 8 h: 49 -> fail", () => {
    const result = checkEligibility(input({ others: hoursThisWeek(41) }));
    expect(result.codes).toEqual(["weekly_hours"]);
    expect(result.reasons).toEqual(["This would take you over your weekly hours limit."]);
  });

  it("Marked unavailable: date in unavailableDates -> fail", () => {
    const result = checkEligibility(input({ unavailableDates: ["2026-11-07"] }));
    expect(result.codes).toEqual(["unavailable"]);
    expect(result.reasons).toEqual([
      "You've marked yourself unavailable that day. Change it in your profile to take this shift.",
    ]);
  });

  it("Blocked site: siteId in blockedSites -> fail", () => {
    const result = checkEligibility(input({ settings: { blockedSites: ["site-1"] } }));
    expect(result.codes).toEqual(["blocked_site"]);
    expect(result.reasons).toEqual(["This site isn't available to you. Contact the office."]);
  });

  it("Wrong role: roles = ['steward'], shift role 'door_supervisor' -> fail", () => {
    const result = checkEligibility(input({ worker: { roles: ["steward"] } }));
    expect(result.codes).toEqual(["wrong_role"]);
    expect(result.reasons).toEqual(["This shift needs a door supervisor."]);
  });

  it("Multiple failures: expired + overlap -> ok=false, both reasons listed", () => {
    const result = checkEligibility(
      input({
        credentials: [{ type: "SIA_DS", status: "valid", expiresOn: "2026-10-03" }],
        others: [["2026-11-07T10:00:00Z", "2026-11-07T15:00:00Z"]],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.codes).toEqual(["credential_expired", "overlap"]);
    expect(result.reasons).toEqual([
      "Your SIA door supervisor licence expired on 3 Oct. Renew it, then send the new number to the office.",
      "You're already booked at 10:00 that day.",
    ]);
    expect(result.pass).toBeUndefined();
  });

  it("No credential rule for the role -> fail: 'This shift isn't ready to take yet. Ask the office.'", () => {
    const result = checkEligibility(input({ shift: { requiredTypes: null } }));
    expect(result.codes).toEqual(["no_rule"]);
    expect(result.reasons).toEqual(["This shift isn't ready to take yet. Ask the office."]);
  });

  it("Shift already started: now at or after startsAt -> fail: 'This shift has already started.'", () => {
    const result = checkEligibility(input({ now: SHIFT_START }));
    expect(result.codes).toEqual(["started"]);
    expect(result.reasons).toEqual(["This shift has already started."]);
  });

  it("Rule needs no credential: empty list, worker has no credentials -> ok", () => {
    expect(codes(input({ shift: { requiredTypes: [] }, credentials: [] }))).toEqual(OK);
  });
});

describe("the worker and the shift", () => {
  it.each(["inactive", "blocked"] as const)("a %s account can't take shifts", (status) => {
    const result = checkEligibility(input({ worker: { status } }));
    expect(result.codes).toEqual(["not_active"]);
    expect(result.reasons).toEqual(["Your account isn't active. Contact the office."]);
  });

  it("a shift that has started (or starts this instant) can't be taken", () => {
    expect(codes(input({ now: SHIFT_START }))).toEqual(["started"]);
    expect(codes(input({ now: at("2026-11-07T15:00:00Z") }))).toEqual(["started"]);
    expect(checkEligibility(input({ now: SHIFT_START })).reasons).toEqual([
      "This shift has already started.",
    ]);
  });

  it("uses 'an' before a vowel in a role", () => {
    const result = checkEligibility(input({ shift: { role: "event_steward", requiredTypes: [] } }));
    expect(result.reasons).toEqual(["This shift needs an event steward."]);
  });
});

describe("credentials: status and date both count", () => {
  it("a 'valid' status with a past expiry is expired (the date is never ignored)", () => {
    const result = checkEligibility(
      input({ credentials: [{ type: "SIA_DS", status: "valid", expiresOn: "2025-12-31" }] }),
    );
    expect(result.codes).toEqual(["credential_expired"]);
    // Expired before today, in another year: the year is shown.
    expect(result.reasons[0]).toBe(
      "Your SIA door supervisor licence expired on 31 Dec 2025. Renew it, then send the new number to the office.",
    );
  });

  it("an 'expired' status fails even with a future date; so does 'suspended'", () => {
    expect(
      codes(
        input({ credentials: [{ type: "SIA_DS", status: "expired", expiresOn: "2028-01-01" }] }),
      ),
    ).toEqual(["credential_expired"]);
    const suspended = checkEligibility(
      input({ credentials: [{ type: "SIA_DS", status: "suspended", expiresOn: "2028-01-01" }] }),
    );
    expect(suspended.codes).toEqual(["credential_suspended"]);
    expect(suspended.reasons).toEqual([
      "Your SIA door supervisor licence is suspended. Contact the office.",
    ]);
  });

  it("a valid credential with no expiry passes; any one good credential of the type is enough", () => {
    expect(
      codes(input({ credentials: [{ type: "SIA_DS", status: "valid", expiresOn: null }] })),
    ).toEqual(OK);
    expect(
      codes(
        input({
          credentials: [
            { type: "SIA_DS", status: "expired", expiresOn: "2025-01-01" },
            { type: "SIA_DS", status: "valid", expiresOn: "2029-01-01" },
          ],
        }),
      ),
    ).toEqual(OK);
  });

  it("every required type is checked, each with its own reason; a code without a name reads as words", () => {
    const result = checkEligibility(
      input({ shift: { requiredTypes: ["SIA_DS", "PTS", "RAIL_DA"] }, credentials: [] }),
    );
    expect(result.codes).toEqual([
      "credential_missing",
      "credential_missing",
      "credential_missing",
    ]);
    expect(result.reasons[2]).toBe(
      "This shift needs a valid RAIL DA. Send it to the office to be checked.",
    );
  });

  it("an 'applied' credential is used only when there is no valid one", () => {
    // Valid and applied both held: the valid one is enough, the allowance isn't touched.
    expect(
      codes(
        input({
          credentials: [...applied(), { type: "SIA_DS", status: "valid", expiresOn: "2029-01-01" }],
          settings: { appliedAllowancePct: 0 },
        }),
      ),
    ).toEqual(OK);
  });
  function applied() {
    return [{ type: "SIA_DS", status: "applied" as const, expiresOn: null }];
  }
});

describe("bookings around the shift", () => {
  it("the travel buffer turns a near miss into an overlap; without it, it's a rest problem", () => {
    const others: [string, string][] = [["2026-11-07T06:00:00Z", "2026-11-07T13:30:00Z"]];
    const buffered = checkEligibility(input({ others, settings: { travelBufferMinutes: 45 } }));
    expect(buffered.codes).toEqual(["overlap"]);
    expect(buffered.reasons).toEqual([
      "This is too close to your booking at 06:00 to travel between them.",
    ]);
    expect(codes(input({ others }))).toEqual(["rest"]);
  });

  it("rest is checked before the next booking too", () => {
    const result = checkEligibility(
      input({ others: [["2026-11-08T03:00:00Z", "2026-11-08T11:00:00Z"]] }),
    );
    expect(result.codes).toEqual(["rest"]);
    expect(result.reasons).toEqual([
      "This is too close to your next shift (11 hours' rest needed).",
    ]);
  });

  it("an overlap on another day says which day", () => {
    const result = checkEligibility(
      input({
        shift: { startsAt: at("2026-11-07T00:30:00Z"), endsAt: at("2026-11-07T06:00:00Z") },
        others: [["2026-11-06T22:00:00Z", "2026-11-07T02:00:00Z"]],
      }),
    );
    expect(result.reasons).toEqual(["You're already booked at 22:00 on Fri 6 Nov."]);
  });

  it("the week is Monday to Sunday (local); a Sunday night shift counts only its hours inside the week", () => {
    // Shift: Mon 9 Nov 15:00-19:00 (4 h). Other bookings: Sun 8 Nov 20:00 - Mon 9 Nov 04:00 (4 h in
    // this week) and 40 h Tue-Sat. 4 + 40 + 4 = 48: ok. Counting the whole Sunday shift would be 52.
    const others: [string, string][] = [
      ["2026-11-08T20:00:00Z", "2026-11-09T04:00:00Z"],
      ...[10, 11, 12, 13, 14].map((d): [string, string] => [
        `2026-11-${d}T12:00:00Z`,
        `2026-11-${d}T20:00:00Z`,
      ]),
    ];
    const shift = { startsAt: at("2026-11-09T15:00:00Z"), endsAt: at("2026-11-09T19:00:00Z") };
    expect(codes(input({ shift, others, settings: { minRestHours: 0 } }))).toEqual(OK);
    expect(
      codes(input({ shift, others, settings: { minRestHours: 0, weeklyHoursCap: 47 } })),
    ).toEqual(["weekly_hours"]);
  });

  it("counts real hours across the October clock change (the week has a 25-hour Sunday)", () => {
    // Week of Mon 19 Oct 2026 (BST until Sun 25 Oct 01:00 UTC). Sun 25 Oct 00:00-06:00 local is
    // 7 real hours. With 41 h already booked, a 7-hour Sunday shift makes 48: ok at 48, not at 47.
    const shift = { startsAt: at("2026-10-24T23:00:00Z"), endsAt: at("2026-10-25T06:00:00Z") };
    const others: [string, string][] = [19, 20, 21, 22, 23].map((d, i): [string, string] => [
      `2026-10-${d}T08:00:00Z`,
      `2026-10-${d}T${i === 4 ? "17" : "16"}:00:00Z`,
    ]);
    const now = at("2026-10-01T09:00:00Z");
    expect(codes(input({ shift, others, now }))).toEqual(OK);
    expect(codes(input({ shift, others, now, settings: { weeklyHoursCap: 47 } }))).toEqual([
      "weekly_hours",
    ]);
  });

  it("a night shift is blocked if either day it touches is marked unavailable; ending at midnight touches one", () => {
    const night = { startsAt: at("2026-11-07T22:00:00Z"), endsAt: at("2026-11-08T06:00:00Z") };
    expect(codes(input({ shift: night, unavailableDates: ["2026-11-08"] }))).toEqual([
      "unavailable",
    ]);
    const toMidnight = { startsAt: at("2026-11-07T16:00:00Z"), endsAt: at("2026-11-08T00:00:00Z") };
    expect(codes(input({ shift: toMidnight, unavailableDates: ["2026-11-08"] }))).toEqual(OK);
  });
});

describe("overrides, the pass, and purity", () => {
  const tired = {
    others: [["2026-11-07T04:00:00Z", "2026-11-07T08:00:00Z"]] as [string, string][],
  };

  it("the office can override rest, weekly hours and unavailable; the override is reported", () => {
    const result = checkEligibility(
      input({
        ...tired,
        unavailableDates: ["2026-11-07"],
        overrides: ["rest", "unavailable", "weekly_hours"],
      }),
    );
    expect(result).toMatchObject({ ok: true, codes: [], overridden: ["rest", "unavailable"] });
    expect(isEligibilityPass(result.pass)).toBe(true);
    expect(result.pass?.overridden).toEqual(["rest", "unavailable"]);
  });

  it("credentials and everything else can never be overridden: asking to is refused outright", () => {
    for (const code of ["credential_expired", "credential_missing", "wrong_role", "overlap"]) {
      const sneaky = [code] as unknown as EligibilityInput["overrides"];
      expect(() =>
        checkEligibility(input({ credentials: [], worker: { roles: [] }, overrides: sneaky })),
      ).toThrow();
    }
    // The allowed overrides don't lift a credential failure.
    const result = checkEligibility(
      input({ credentials: [], overrides: ["rest", "weekly_hours", "unavailable", "started"] }),
    );
    expect(result.codes).toEqual(["credential_missing"]);
  });

  it("the office can book a shift that has started (a late replacement); a worker can't", () => {
    const late = input({ now: at("2026-11-07T15:00:00Z") });
    expect(codes(late)).toEqual(["started"]);
    expect(checkEligibility({ ...late, overrides: ["started"] })).toMatchObject({
      ok: true,
      overridden: ["started"],
    });
  });

  it("the pass keeps its own frozen copy of the overrides", () => {
    const result = checkEligibility(input({ ...tired, overrides: ["rest"] }));
    result.overridden.length = 0;
    expect(result.pass?.overridden).toEqual(["rest"]);
    expect(Object.isFrozen(result.pass?.overridden)).toBe(true);
  });

  it("a pass comes only from checkEligibility, only when ok, and names the worker and shift", () => {
    const { pass } = checkEligibility(input());
    expect(pass).toMatchObject({ workerId: "w1", shiftId: "s1", overridden: [] });
    expect(isEligibilityPass(pass)).toBe(true);
    const forged = { workerId: "w1", shiftId: "s1", overridden: [] } as unknown as EligibilityPass;
    expect(isEligibilityPass(forged)).toBe(false);
    expect(Object.isFrozen(pass)).toBe(true);
    expect(checkEligibility(input({ credentials: [] })).pass).toBeUndefined();
  });

  it("is pure: it never changes its input, and the same input gives the same answer", () => {
    const i = input({
      ...tired,
      credentials: [{ type: "SIA_DS", status: "valid", expiresOn: "2026-10-03" }],
    });
    const before = JSON.stringify(i);
    const first = checkEligibility(i);
    const second = checkEligibility(i);
    expect(JSON.stringify(i)).toBe(before);
    expect({ ...second, pass: undefined }).toEqual({ ...first, pass: undefined });
  });

  it("never throws on odd but typed input (500 generated cases)", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const statuses = ["valid", "expired", "applied", "suspended"] as const;
    for (let n = 0; n < 500; n++) {
      const start = Date.UTC(2026, 0, 1) + Math.floor(rand() * 365 * 24) * H;
      const i = input({
        shift: {
          startsAt: new Date(start),
          endsAt: new Date(start + (1 + Math.floor(rand() * 16)) * H),
        },
        credentials:
          rand() < 0.5
            ? []
            : [
                {
                  type: "SIA_DS",
                  status: statuses[Math.floor(rand() * 4)] ?? "valid",
                  expiresOn: rand() < 0.3 ? null : "2026-06-15",
                },
              ],
        others: [
          [
            new Date(start - rand() * 48 * H).toISOString(),
            new Date(start + rand() * 48 * H).toISOString(),
          ],
        ],
        settings: {
          travelBufferMinutes: Math.floor(rand() * 120),
          appliedAllowancePct: Math.floor(rand() * 30),
        },
        now: new Date(start - (rand() - 0.2) * 100 * H),
      });
      const result = checkEligibility(i);
      expect(result.codes.length).toBe(result.reasons.length);
      expect(result.ok).toBe(result.codes.length === 0);
    }
  });
});

// Found by the guardrails review.
describe("credentials over a whole night, and suspensions", () => {
  const night = { startsAt: at("2026-11-07T22:00:00Z"), endsAt: at("2026-11-08T06:00:00Z") };

  it("a night shift needs the credential in date until it ends, not just on the day it starts", () => {
    const expiresSaturday = [{ type: "SIA_DS", status: "valid" as const, expiresOn: "2026-11-07" }];
    const result = checkEligibility(input({ shift: night, credentials: expiresSaturday }));
    expect(result.codes).toEqual(["credential_expired"]);
    expect(result.reasons).toEqual([
      "Your SIA door supervisor licence expires on 7 Nov, before this shift. Renew it, then send the new number to the office.",
    ]);
    const expiresSunday = [{ type: "SIA_DS", status: "valid" as const, expiresOn: "2026-11-08" }];
    expect(codes(input({ shift: night, credentials: expiresSunday }))).toEqual(OK);
  });

  it("uses the local date: a shift at 00:30 BST (still the day before in UTC) needs the licence that day", () => {
    const early = { startsAt: at("2026-06-13T23:30:00Z"), endsAt: at("2026-06-14T07:00:00Z") };
    const now = at("2026-06-01T09:00:00Z");
    const cred = (expiresOn: string) => [{ type: "SIA_DS", status: "valid" as const, expiresOn }];
    expect(codes(input({ now, shift: early, credentials: cred("2026-06-13") }))).toEqual([
      "credential_expired",
    ]);
    expect(codes(input({ now, shift: early, credentials: cred("2026-06-14") }))).toEqual(OK);
  });

  it("a suspended credential fails even alongside an 'applied' or a valid one of the same type", () => {
    const suspended = { type: "SIA_DS", status: "suspended" as const, expiresOn: "2028-01-01" };
    const withApplied = input({
      credentials: [suspended, { type: "SIA_DS", status: "applied", expiresOn: null }],
      settings: { appliedAllowancePct: 15, deployedCount: 50 },
    });
    expect(codes(withApplied)).toEqual(["credential_suspended"]);
    const withValid = input({
      credentials: [suspended, { type: "SIA_DS", status: "valid", expiresOn: "2029-01-01" }],
    });
    expect(codes(withValid)).toEqual(["credential_suspended"]);
  });

  it("the expiry message only uses dates before the shift; a credential marked expired says so", () => {
    const marked = checkEligibility(
      input({ credentials: [{ type: "SIA_DS", status: "expired", expiresOn: "2028-01-01" }] }),
    );
    expect(marked.reasons).toEqual([
      "Your SIA door supervisor licence is marked as expired. Renew it, then send the new number to the office.",
    ]);
    const mixed = checkEligibility(
      input({
        shift: { startsAt: at("2026-11-20T09:00:00Z"), endsAt: at("2026-11-20T17:00:00Z") },
        credentials: [
          { type: "SIA_DS", status: "valid", expiresOn: "2026-11-06" },
          { type: "SIA_DS", status: "expired", expiresOn: "2026-12-01" },
        ],
      }),
    );
    expect(mixed.reasons).toEqual([
      "Your SIA door supervisor licence expires on 6 Nov, before this shift. Renew it, then send the new number to the office.",
    ]);
  });
});

describe("weeks, rest and bookings: more edges", () => {
  it("a Sunday night shift is checked against both weeks it touches", () => {
    // Sun 8 Nov 22:00 - Mon 9 Nov 06:00 puts 6 h into the week of Mon 9 Nov, which already has
    // 48 h booked (Mon 9 - Sat 14, 12:00-20:00): 54 h, over a 48 h cap.
    const others = [9, 10, 11, 12, 13, 14].map((d): [string, string] => {
      const start = at(`2026-11-${String(d).padStart(2, "0")}T12:00:00Z`);
      return [start.toISOString(), new Date(start.getTime() + 8 * H).toISOString()];
    });
    const shift = { startsAt: at("2026-11-08T22:00:00Z"), endsAt: at("2026-11-09T06:00:00Z") };
    expect(codes(input({ shift, others, settings: { minRestHours: 0 } }))).toEqual([
      "weekly_hours",
    ]);
    expect(
      codes(input({ shift, others, settings: { minRestHours: 0, weeklyHoursCap: 54 } })),
    ).toEqual(OK);
  });

  it("rest across the spring clock change counts real hours (22:00 GMT to 09:00 BST is 10)", () => {
    const now = at("2026-03-01T09:00:00Z");
    const shift = { startsAt: at("2026-03-29T08:00:00Z"), endsAt: at("2026-03-29T16:00:00Z") };
    const others: [string, string][] = [["2026-03-28T14:00:00Z", "2026-03-28T22:00:00Z"]];
    expect(codes(input({ now, shift, others }))).toEqual(["rest"]);
  });

  it("says 1 hour's rest, not 1 hours'", () => {
    const result = checkEligibility(
      input({
        others: [["2026-11-07T13:00:00Z", "2026-11-07T13:30:00Z"]],
        settings: { minRestHours: 1 },
      }),
    );
    expect(result.reasons).toEqual([
      "This is too close to your previous shift (1 hour's rest needed).",
    ]);
  });

  it("the shift itself, passed among the other bookings, isn't counted against itself", () => {
    const self = { shiftId: "s1", startsAt: SHIFT_START, endsAt: at("2026-11-07T22:00:00Z") };
    expect(checkEligibility({ ...input(), otherAssignments: [self] }).ok).toBe(true);
  });
});

describe("input that doesn't make sense is refused, never waved through", () => {
  it.each([
    ["a NaN rest setting", { settings: { minRestHours: Number.NaN } }],
    ["a NaN weekly cap", { settings: { weeklyHoursCap: Number.NaN } }],
    ["a negative travel buffer", { settings: { travelBufferMinutes: -120 } }],
    ["an allowance over 100%", { settings: { appliedAllowancePct: 150 } }],
    [
      "a date that isn't yyyy-mm-dd",
      { credentials: [{ type: "SIA_DS", status: "valid" as const, expiresOn: "2026-11-6" }] },
    ],
    ["an unavailable date that isn't yyyy-mm-dd", { unavailableDates: ["7/11/2026"] }],
    ["a shift that ends before it starts", { shift: { endsAt: at("2026-11-07T13:00:00Z") } }],
    [
      "a booking that ends before it starts",
      { others: [["2026-11-07T10:00:00Z", "2026-11-07T09:00:00Z"]] as [string, string][] },
    ],
  ])("%s", (_label, bad) => {
    expect(() => checkEligibility(input(bad))).toThrow();
  });

  it("an unknown time zone", () => {
    expect(() => checkEligibility({ ...input(), timeZone: "Europe/Atlantis" })).toThrow();
  });
});

describe("the applied allowance is per credential type", () => {
  it("an application in progress counts only for types that allow it (SIA licences), never e.g. a PTS card", () => {
    const appliedPts = input({
      shift: { requiredTypes: ["PTS"] },
      credentials: [{ type: "PTS", status: "applied", expiresOn: null }],
      settings: { appliedAllowancePct: 15, deployedCount: 50 },
    });
    const result = checkEligibility(appliedPts);
    expect(result.codes).toEqual(["credential_missing"]);
    expect(result.reasons).toEqual([
      "Your PTS card is still being processed. This shift needs a valid one. Send it to the office when you have it.",
    ]);
    // The same numbers pass for an SIA licence, which allows it.
    expect(
      codes(
        input({
          credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
          settings: { appliedAllowancePct: 15, deployedCount: 50 },
        }),
      ),
    ).toEqual(OK);
  });

  it("an 'applied' credential with a future expiry, for a type that needs a valid one, is still 'being processed'", () => {
    const result = checkEligibility(
      input({
        shift: { requiredTypes: ["PTS"] },
        credentials: [{ type: "PTS", status: "applied", expiresOn: "2027-01-01" }],
      }),
    );
    expect(result.codes).toEqual(["credential_missing"]);
    expect(result.reasons).toEqual([
      "Your PTS card is still being processed. This shift needs a valid one. Send it to the office when you have it.",
    ]);
  });

  it("an 'applied' credential beside an old expired one reports the old expiry", () => {
    const result = checkEligibility(
      input({
        shift: { requiredTypes: ["PTS"] },
        credentials: [
          { type: "PTS", status: "applied", expiresOn: null },
          { type: "PTS", status: "valid", expiresOn: "2026-09-01" },
        ],
      }),
    );
    expect(result.codes).toEqual(["credential_expired"]);
    expect(result.reasons).toEqual([
      "Your PTS card expired on 1 Sep. Renew it, then send the new number to the office.",
    ]);
  });

  it("with no type allowing 'applied', even an SIA licence in progress needs to be valid", () => {
    const result = checkEligibility(
      input({
        credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
        settings: { appliedAllowedTypes: [], appliedAllowancePct: 15, deployedCount: 50 },
      }),
    );
    expect(result.codes).toEqual(["credential_missing"]);
  });

  it("a type that allows 'applied' still needs the firm's allowance: 0% refuses", () => {
    expect(
      codes(
        input({
          credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
          settings: { appliedAllowancePct: 0, deployedCount: 50 },
        }),
      ),
    ).toEqual(["applied_over_allowance"]);
  });
});

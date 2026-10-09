import { describe, expect, it } from "vitest";
import { EXPIRING_SOON_DAYS, WARNING_DAYS } from "@/lib/credentials/expiry";
import {
  listQualifications,
  needsUpdating,
  qualificationStatus,
  rightToWork,
  type CredentialRecord,
  type Qualification,
} from "@/lib/credentials/status";
import { needsSummary } from "@/lib/portal/qualification-copy";
import { addDays } from "@/lib/time/zoned";
import { need } from "../helpers/qualifications";

// A casual's qualifications as they stand today (12F.1; docs/office-v2.md 3.7, 4.2, 4.6; Rules 15):
// the status of each type from its records, which types are listed, and "Needs updating" in its
// four levels.

const TODAY = "2026-11-02";
const day = (n: number) => addDays(TODAY, n);
const valid = (expiresOn: string | null): CredentialRecord => ({ status: "valid", expiresOn });
const status = (...records: CredentialRecord[]) => qualificationStatus(records, TODAY);

describe("one shared 'expiring soon' window", () => {
  it("is the expiry job's first warning: 30 days", () => {
    expect(EXPIRING_SOON_DAYS).toBe(30);
    expect(EXPIRING_SOON_DAYS).toBe(Math.max(...WARNING_DAYS));
  });
});

describe("qualificationStatus: the full table, at the boundary dates", () => {
  it.each([
    ["no record", [], "missing", null],
    ["valid, no expiry", [valid(null)], "valid", null],
    ["valid, 31 days left", [valid(day(31))], "valid", day(31)],
    ["valid, 30 days left: expiring soon", [valid(day(30))], "expiring_soon", day(30)],
    ["valid, 1 day left", [valid(day(1))], "expiring_soon", day(1)],
    ["valid, expires today: still in date", [valid(TODAY)], "expiring_soon", TODAY],
    ["valid, expired yesterday", [valid(day(-1))], "expired", day(-1)],
    [
      "marked expired, with a date",
      [{ status: "expired", expiresOn: day(-40) }],
      "expired",
      day(-40),
    ],
    ["marked expired, no date", [{ status: "expired", expiresOn: null }], "expired", null],
    ["applied for", [{ status: "applied", expiresOn: null }], "applied", null],
    ["suspended", [{ status: "suspended", expiresOn: day(200) }], "suspended", day(200)],
  ] as const)("%s", (_name, records, expected, expiresOn) => {
    expect(status(...records)).toEqual({ status: expected, expiresOn });
  });

  it("several records: suspended beats everything, as the rules engine reads it", () => {
    expect(status(valid(day(400)), { status: "suspended", expiresOn: null }).status).toBe(
      "suspended",
    );
  });

  it("an in-date one counts over an old one, the longest-lasting first", () => {
    expect(status({ status: "expired", expiresOn: day(-10) }, valid(day(400)))).toEqual({
      status: "valid",
      expiresOn: day(400),
    });
    expect(status(valid(day(10)), valid(day(400)), valid(null))).toEqual({
      status: "valid",
      expiresOn: null,
    });
    expect(status(valid(day(10)), valid(day(20)))).toEqual({
      status: "expiring_soon",
      expiresOn: day(20),
    });
  });

  it("being renewed (applied for) counts over an expired one; the latest expired date shows", () => {
    expect(
      status({ status: "expired", expiresOn: day(-10) }, { status: "applied", expiresOn: null }),
    ).toEqual({ status: "applied", expiresOn: null });
    expect(status(valid(day(-30)), { status: "expired", expiresOn: day(-5) })).toEqual({
      status: "expired",
      expiresOn: day(-5),
    });
  });
});

const RULES = [
  { role: "steward", requiredTypes: ["STEWARD_L2"] },
  { role: "door_supervisor", requiredTypes: ["SIA_DS"] },
  { role: "response_team_lead", requiredTypes: ["SIA_DS", "FIRST_AID", "RTW"] },
  { role: "csas_officer", requiredTypes: ["CSAS"] },
];
const NAMES = new Map([
  ["STEWARD_L2", "Level 2 spectator safety qualification"],
  ["SIA_DS", "SIA door supervisor licence"],
  ["FIRST_AID", "first aid at work certificate"],
  ["CSAS", "CSAS accreditation"],
  ["RTW", "right to work check"],
]);
const list = (roles: string[], records: ({ type: string } & CredentialRecord)[]) =>
  listQualifications({ roles, rules: RULES, names: NAMES, records, today: TODAY });

describe("which qualifications are listed", () => {
  it("every type her roles need, with the roles that need it; a listed type with no record is Missing", () => {
    const q = list(
      ["door_supervisor", "response_team_lead"],
      [{ type: "SIA_DS", ...valid(day(400)) }],
    );
    expect(q).toEqual([
      {
        type: "FIRST_AID",
        name: "first aid at work certificate",
        status: "missing",
        expiresOn: null,
        neededFor: ["response_team_lead"],
      },
      {
        type: "SIA_DS",
        name: "SIA door supervisor licence",
        status: "valid",
        expiresOn: day(400),
        neededFor: ["door_supervisor", "response_team_lead"],
      },
    ]);
  });

  it("a type nothing she does needs isn't listed, whatever she holds; right to work never is", () => {
    const q = list(
      ["steward"],
      [
        { type: "STEWARD_L2", ...valid(null) },
        { type: "SIA_DS", status: "expired", expiresOn: day(-5) },
        { type: "OWN_CARD", ...valid(null) },
        { type: "RTW", ...valid(null) },
      ],
    );
    expect(q.map((x) => x.type)).toEqual(["STEWARD_L2"]);
    expect(list(["response_team_lead"], []).map((x) => x.type)).not.toContain("RTW");
  });

  it("worst first: suspended, expired, missing, expiring soon, applied for, valid", () => {
    const q = listQualifications({
      roles: ["all"],
      rules: [{ role: "all", requiredTypes: ["A", "B", "C", "D", "E", "F"] }],
      names: new Map(),
      records: [
        { type: "A", ...valid(null) },
        { type: "B", status: "applied", expiresOn: null },
        { type: "C", ...valid(day(5)) },
        { type: "E", status: "expired", expiresOn: day(-1) },
        { type: "F", status: "suspended", expiresOn: null },
      ],
      today: TODAY,
    });
    expect(q.map((x) => [x.type, x.status])).toEqual([
      ["F", "suspended"],
      ["E", "expired"],
      ["D", "missing"],
      ["C", "expiring_soon"],
      ["B", "applied"],
      ["A", "valid"],
    ]);
  });

  it("right to work: checked with its date, or not checked (a status only)", () => {
    expect(rightToWork([])).toEqual({ checked: false, checkedOn: null });
    expect(
      rightToWork([
        { type: "RTW", ...valid(null), checkedOn: "2026-01-12" },
        { type: "RTW", ...valid(null), checkedOn: "2025-06-01" },
      ]),
    ).toEqual({ checked: true, checkedOn: "2026-01-12" });
    expect(rightToWork([{ type: "RTW", ...valid(null), checkedOn: null }])).toEqual({
      checked: true,
      checkedOn: null,
    });
    expect(
      rightToWork([{ type: "RTW", status: "expired", expiresOn: day(-1), checkedOn: null }]),
    ).toEqual({ checked: false, checkedOn: null });
  });
});

const qual = (o: Partial<Qualification>): Qualification => ({
  type: "SIA_DS",
  name: "SIA door supervisor licence",
  status: "valid",
  expiresOn: day(400),
  neededFor: ["door_supervisor"],
  ...o,
});

describe("needsUpdating: the four levels, in order", () => {
  it("1 blocks a booked shift, 2 expired or suspended, 3 expiring soon, 4 missing", () => {
    const items = needsUpdating({
      qualifications: [
        qual({ type: "M", name: "missing one", status: "missing", expiresOn: null }),
        qual({ type: "S", name: "soon one", status: "expiring_soon", expiresOn: day(20) }),
        qual({ type: "X", name: "expired one", status: "expired", expiresOn: day(-3) }),
        qual({ type: "U", name: "suspended one", status: "suspended", expiresOn: null }),
        qual({
          type: "B",
          name: "blocking one",
          status: "expiring_soon",
          expiresOn: day(4),
          neededFor: ["steward"],
        }),
        qual({ type: "A", name: "applied one", status: "applied", expiresOn: null }),
        qual({ type: "V", name: "valid one" }),
      ],
      bookings: [{ role: "steward", startDay: day(5), endDay: day(5) }],
      today: TODAY,
    });
    expect(items.map((i) => [i.level, i.qualification.type])).toEqual([
      [1, "B"],
      [2, "U"],
      [2, "X"],
      [3, "S"],
      [4, "M"],
    ]);
    expect(items[0]?.blocks).toEqual({ role: "steward", day: day(5) });
  });

  it("level 1: missing, expired or suspended for a booked role; or in date until before it ends", () => {
    const booking = { role: "door_supervisor", startDay: day(40), endDay: day(41) };
    const level = (q: Partial<Qualification>) =>
      needsUpdating({ qualifications: [qual(q)], bookings: [booking], today: TODAY })[0]?.level;
    expect(level({ status: "missing", expiresOn: null })).toBe(1);
    expect(level({ status: "expired", expiresOn: day(-1) })).toBe(1);
    expect(level({ status: "suspended", expiresOn: null })).toBe(1);
    // A night shift ending on day 41: valid until day 40 isn't enough; day 41 is.
    expect(level({ status: "valid", expiresOn: day(40) })).toBe(1);
    expect(level({ status: "valid", expiresOn: day(41) })).toBeUndefined();
    expect(level({ status: "valid", expiresOn: null })).toBeUndefined();
    // Applied for: nothing for her to do yet, booked or not.
    expect(level({ status: "applied", expiresOn: null })).toBeUndefined();
    // A booking for a role that doesn't need it doesn't count.
    expect(
      needsUpdating({
        qualifications: [qual({ status: "expired", expiresOn: day(-1) })],
        bookings: [{ role: "steward", startDay: day(2), endDay: day(2) }],
        today: TODAY,
      })[0]?.level,
    ).toBe(2);
  });

  it("the earliest booked shift it stops is the one named", () => {
    const [item] = needsUpdating({
      qualifications: [qual({ status: "missing", expiresOn: null })],
      bookings: [
        { role: "door_supervisor", startDay: day(9), endDay: day(9) },
        { role: "door_supervisor", startDay: day(3), endDay: day(3) },
      ],
      today: TODAY,
    });
    expect(item?.blocks).toEqual({ role: "door_supervisor", day: day(3) });
  });

  it("nothing to update: no rows", () => {
    expect(needsUpdating({ qualifications: [qual({})], bookings: [], today: TODAY })).toEqual([]);
  });
});

describe("the office's one-line summary", () => {
  it("'Nothing', or the first and how many more", () => {
    expect(needsSummary([])).toBe("Nothing");
    expect(
      needsSummary([need(4, { status: "missing", name: "first aid at work certificate" })]),
    ).toBe("First aid at work certificate: missing");
    expect(
      needsSummary([
        need(
          1,
          { status: "expired", expiresOn: day(-1) },
          { role: "door_supervisor", day: day(2) },
        ),
        need(4, { status: "missing" }),
        need(4, { status: "missing" }),
      ]),
    ).toBe("SIA door supervisor licence: expired (booked shift), and 2 more");
  });
});

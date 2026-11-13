import { describe, expect, it } from "vitest";
import { licenceOf } from "@/lib/office/not-offered";
import { licenceWhy } from "@/lib/office/offer-words";
import { checkEligibility, type EligibilityInput } from "@/lib/rules/eligibility";

// "Not offered, and why" names the card (Phase 37.3, w1-03): licenceOf reads the rules' own checks,
// here real checkEligibility results for every state, so the order the rules push a failure and
// its check in is pinned too. It never decides anything: it only reads `codes` and `checks`.

const TZ = "Europe/London";
const NOW = new Date("2026-11-11T10:00:00Z"); // Wed 11 Nov 2026
const TODAY = "2026-11-11";
const DS = "SIA_DS";
const SG = "SIA_SG";
const MH = "MANUAL_HANDLING";
const NAMES = {
  [DS]: "SIA door supervisor licence",
  [SG]: "SIA security guard licence",
  [MH]: "manual handling certificate",
};

type Cred = EligibilityInput["credentials"][number];
interface Case {
  credentials: Cred[];
  required?: string[];
  extra?: string[];
  anyOf?: string[];
  allowance?: { pct: number; types: string[]; inUse: number; deployed: number };
  // A night session by default: Sat 14 Nov 20:00 to Sun 15 Nov 04:00.
  startsAt?: Date;
  endsAt?: Date;
  status?: "active" | "inactive";
}

function run(c: Case) {
  const input: EligibilityInput = {
    now: NOW,
    timeZone: TZ,
    worker: { id: "w1", status: c.status ?? "active", roles: ["door_supervisor"] },
    credentials: c.credentials,
    shift: {
      id: "s1",
      role: "door_supervisor",
      siteId: null,
      requiredTypes: c.required ?? [DS],
      extraTypes: c.extra ?? [],
      anyOfTypes: c.anyOf ?? [],
      startsAt: c.startsAt ?? new Date("2026-11-14T20:00:00Z"),
      endsAt: c.endsAt ?? new Date("2026-11-15T04:00:00Z"),
    },
    otherAssignments: [],
    unavailableDates: [],
    settings: {
      minRestHours: 11,
      weeklyHoursCap: 48,
      travelBufferMinutes: 0,
      appliedAllowancePct: c.allowance?.pct ?? 0,
      appliedAllowedTypes: c.allowance?.types ?? [],
      appliedInUseCount: c.allowance?.inUse ?? 0,
      deployedCount: c.allowance?.deployed ?? 0,
      blockedSites: [],
    },
    names: NAMES,
  };
  const v = checkEligibility(input);
  expect(v.ok).toBe(false);
  return licenceOf(v.codes[0], v.checks, NAMES, TODAY, 2026);
}

const valid = (type: string, expiresOn: string | null): Cred => ({
  type,
  status: "valid",
  expiresOn,
});

describe("licenceOf: the first card the rules found, from real rule results", () => {
  it("a valid licence and a missing session extra: the extra, by the firm's name", () => {
    const l = run({ credentials: [valid(DS, "2028-01-01")], extra: [MH] });
    expect(l).toEqual({ names: [NAMES[MH]], state: "missing", date: null, year: 2026 });
    expect(licenceWhy(l!)).toBe("Needs manual handling certificate (none on file)");
  });

  it("a licence that ran out yesterday: out of date, with that date", () => {
    const l = run({ credentials: [valid(DS, "2026-11-10")] });
    expect(l).toMatchObject({ state: "out_of_date", date: "2026-11-10" });
    expect(licenceWhy(l!)).toBe("SIA door supervisor licence out of date (10 Nov)");
  });

  it("valid today but running out during the night session: runs out, with its day", () => {
    const l = run({ credentials: [valid(DS, "2026-11-14")] });
    expect(l).toMatchObject({ state: "runs_out", date: "2026-11-14" });
    expect(licenceWhy(l!)).toBe("SIA door supervisor licence runs out Sat 14 Nov");
  });

  it("marked expired with a past date: out of date, never 'runs out'", () => {
    const l = run({ credentials: [{ type: DS, status: "expired", expiresOn: "2025-10-07" }] });
    expect(l).toMatchObject({ state: "out_of_date", date: "2025-10-07" });
    expect(licenceWhy(l!)).toBe("SIA door supervisor licence out of date (7 Oct 2025)");
  });

  it("marked expired with a date after the session: marked expired, never 'runs out'", () => {
    const l = run({ credentials: [{ type: DS, status: "expired", expiresOn: "2027-06-01" }] });
    expect(l).toMatchObject({ state: "marked_expired", date: null });
    expect(licenceWhy(l!)).toBe("SIA door supervisor licence marked expired");
  });

  it("marked expired with no date: marked expired", () => {
    const l = run({ credentials: [{ type: DS, status: "expired", expiresOn: null }] });
    expect(l).toMatchObject({ state: "marked_expired" });
  });

  it("an application first and an expired dated record: out of date, never 'marked expired'", () => {
    const l = run({
      credentials: [{ type: DS, status: "applied", expiresOn: null }, valid(DS, "2026-10-07")],
    });
    // The rule shows the latest valid record, dated before the session: out of date, with it.
    expect(l?.state).toBe("out_of_date");
    const l2 = run({
      credentials: [
        { type: DS, status: "applied", expiresOn: null },
        { type: DS, status: "expired", expiresOn: "2026-10-07" },
      ],
    });
    // The record shown is the application (held "applied"): no state it doesn't show.
    expect(l2).toMatchObject({ state: "out_of_date", date: null });
    expect(licenceWhy(l2!)).toBe("SIA door supervisor licence out of date");
  });

  it("suspended", () => {
    const l = run({
      credentials: [valid(DS, "2028-01-01"), { type: DS, status: "suspended", expiresOn: null }],
    });
    expect(l).toMatchObject({ state: "suspended" });
    expect(licenceWhy(l!)).toBe("SIA door supervisor licence suspended");
  });

  it("applied for a card that must be valid: applied, not counted", () => {
    const l = run({
      credentials: [valid(DS, "2028-01-01"), { type: MH, status: "applied", expiresOn: null }],
      extra: [MH],
    });
    expect(l).toMatchObject({ state: "applied", names: [NAMES[MH]] });
    expect(licenceWhy(l!)).toBe("Manual handling certificate applied for, not counted");
  });

  it("applied over the firm's allowance", () => {
    const l = run({
      credentials: [{ type: DS, status: "applied", expiresOn: null }],
      allowance: { pct: 10, types: [DS], inUse: 1, deployed: 4 },
    });
    expect(l).toMatchObject({ state: "over_allowance" });
    expect(licenceWhy(l!)).toBe("SIA door supervisor licence applied for, over the allowance");
  });

  it("none of a one-of group: every name in the group", () => {
    const l = run({ credentials: [], required: [], anyOf: [SG, DS] });
    expect(l).toMatchObject({ state: "missing", names: [NAMES[SG], NAMES[DS]] });
    expect(licenceWhy(l!)).toBe(
      "Needs SIA security guard licence or SIA door supervisor licence (none on file)",
    );
  });

  it("a first no that isn't a card: no licence detail", () => {
    const l = run({ credentials: [], status: "inactive" });
    expect(l).toBeUndefined();
  });

  it("a type with no name of the firm's: its code in words", () => {
    const v = checkEligibility({
      now: NOW,
      timeZone: TZ,
      worker: { id: "w1", status: "active", roles: ["door_supervisor"] },
      credentials: [],
      shift: {
        id: "s1",
        role: "door_supervisor",
        siteId: null,
        requiredTypes: ["FIRST_AID"],
        extraTypes: [],
        anyOfTypes: [],
        startsAt: new Date("2026-11-14T20:00:00Z"),
        endsAt: new Date("2026-11-15T04:00:00Z"),
      },
      otherAssignments: [],
      unavailableDates: [],
      settings: {
        minRestHours: 11,
        weeklyHoursCap: 48,
        travelBufferMinutes: 0,
        appliedAllowancePct: 0,
        appliedAllowedTypes: [],
        appliedInUseCount: 0,
        deployedCount: 0,
        blockedSites: [],
      },
    });
    const l = licenceOf(v.codes[0], v.checks, {}, TODAY, 2026);
    expect(licenceWhy(l!)).toBe("Needs first aid (none on file)");
  });
});

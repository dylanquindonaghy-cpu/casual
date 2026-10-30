import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHECK_CODES,
  checkEligibility,
  type CheckCode,
  type EligibilityInput,
  type RuleCode,
} from "@/lib/rules/eligibility";

// The rules engine's checks (12D.2; docs/office-v2.md 3.6 "Checks made by code";
// docs/rules-and-credentials.md): every check it ran comes back with the figures it used, on a pass
// and on a fail, and the list never changes the decision: `ok` is "every check passed" (overrides
// aside), and each failing code has its failed check.

const at = (iso: string) => new Date(iso);
// Saturday 7 Nov 2026, 14:00-22:00 London (GMT), decided on 1 Nov.
function input(o: Partial<EligibilityInput> & { others?: [string, string][] } = {}) {
  const { others, ...rest } = o;
  return {
    now: at("2026-11-01T09:00:00Z"),
    timeZone: "Europe/London",
    worker: { id: "w1", status: "active" as const, roles: ["door_supervisor"] },
    credentials: [{ type: "SIA_DS", status: "valid" as const, expiresOn: "2027-11-01" }],
    shift: {
      id: "s1",
      role: "door_supervisor",
      startsAt: at("2026-11-07T14:00:00Z"),
      endsAt: at("2026-11-07T22:00:00Z"),
      siteId: "site-1",
      requiredTypes: ["SIA_DS"],
      extraTypes: [],
      anyOfTypes: [],
    },
    otherAssignments: (others ?? []).map(([s, e]) => ({ startsAt: at(s), endsAt: at(e) })),
    unavailableDates: [],
    settings: {
      minRestHours: 11,
      weeklyHoursCap: 48,
      travelBufferMinutes: 0,
      appliedAllowancePct: 0,
      appliedAllowedTypes: ["SIA_DS"],
      appliedInUseCount: 0,
      deployedCount: 0,
      blockedSites: [],
    },
    ...rest,
  } satisfies EligibilityInput;
}

const byCode = (r: ReturnType<typeof checkEligibility>, code: CheckCode) =>
  r.checks.filter((c) => c.code === code);

// Which check a failure belongs to.
const CHECK_OF: Record<RuleCode, CheckCode> = {
  started: "started",
  not_active: "active",
  wrong_role: "role",
  no_rule: "qualification",
  credential_missing: "qualification",
  credential_expired: "qualification",
  credential_suspended: "qualification",
  applied_over_allowance: "qualification",
  overlap: "overlap",
  rest: "rest",
  weekly_hours: "weekly_hours",
  unavailable: "days_off",
  blocked_site: "site",
};

describe("every check, passed, with its figures", () => {
  it("a free day with an in-date licence: each check once, all passed", () => {
    const r = checkEligibility(input());
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.code)).toEqual(CHECK_CODES);
    expect(r.checks.every((c) => c.passed)).toBe(true);
    expect(r.checks).toEqual([
      { code: "started", passed: true, detail: { startsAt: "2026-11-07T14:00:00.000Z" } },
      { code: "active", passed: true, detail: { status: "active" } },
      { code: "role", passed: true, detail: { role: "door_supervisor" } },
      {
        code: "qualification",
        passed: true,
        detail: {
          type: "SIA_DS",
          neededBy: "role",
          held: "valid",
          expiresOn: "2027-11-01",
          until: "2026-11-07",
        },
      },
      {
        code: "overlap",
        passed: true,
        detail: { withStart: null, withEnd: null, bufferMinutes: 0 },
      },
      {
        code: "rest",
        passed: true,
        detail: { hoursBefore: null, hoursAfter: null, minimumHours: 11 },
      },
      { code: "weekly_hours", passed: true, detail: { hours: 8, capHours: 48 } },
      { code: "days_off", passed: true, detail: { dates: [] } },
      { code: "site", passed: true, detail: { siteId: "site-1" } },
    ]);
  });

  it("rest and weekly hours carry the real gaps and the week's hours", () => {
    // Friday 20:00-03:00 (11 h before), and Sunday 09:00-17:00 (11 h after).
    const r = checkEligibility(
      input({
        others: [
          ["2026-11-06T20:00:00Z", "2026-11-07T03:00:00Z"],
          ["2026-11-08T09:00:00Z", "2026-11-08T17:00:00Z"],
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(byCode(r, "rest")[0]?.detail).toEqual({
      hoursBefore: 11,
      hoursAfter: 11,
      minimumHours: 11,
    });
    expect(byCode(r, "weekly_hours")[0]?.detail).toEqual({ hours: 23, capHours: 48 });
  });
});

describe("every check, failed, with its figures", () => {
  it.each([
    [
      "started",
      input({ now: at("2026-11-07T15:00:00Z") }),
      "started",
      { startsAt: "2026-11-07T14:00:00.000Z" },
    ],
    [
      "account not active",
      input({ worker: { id: "w1", status: "inactive", roles: ["door_supervisor"] } }),
      "active",
      { status: "inactive" },
    ],
    [
      "wrong role",
      input({ worker: { id: "w1", status: "active", roles: ["steward"] } }),
      "role",
      { role: "door_supervisor" },
    ],
    [
      "missing qualification",
      input({ credentials: [] }),
      "qualification",
      { type: "SIA_DS", neededBy: "role", held: "none", expiresOn: null, until: "2026-11-07" },
    ],
    [
      "expired the day before",
      input({ credentials: [{ type: "SIA_DS", status: "valid", expiresOn: "2026-11-06" }] }),
      "qualification",
      {
        type: "SIA_DS",
        neededBy: "role",
        held: "valid",
        expiresOn: "2026-11-06",
        until: "2026-11-07",
      },
    ],
    [
      "suspended",
      input({ credentials: [{ type: "SIA_DS", status: "suspended", expiresOn: "2027-01-01" }] }),
      "qualification",
      {
        type: "SIA_DS",
        neededBy: "role",
        held: "suspended",
        expiresOn: "2027-01-01",
        until: "2026-11-07",
      },
    ],
    [
      "a session's own requirement missing",
      input({
        shift: {
          id: "s1",
          role: "door_supervisor",
          startsAt: at("2026-11-07T14:00:00Z"),
          endsAt: at("2026-11-07T22:00:00Z"),
          siteId: "site-1",
          requiredTypes: ["SIA_DS"],
          extraTypes: ["FIRST_AID"],
          anyOfTypes: [],
        },
      }),
      "qualification",
      {
        type: "FIRST_AID",
        neededBy: "session",
        held: "none",
        expiresOn: null,
        until: "2026-11-07",
      },
    ],
    [
      "a clash",
      input({ others: [["2026-11-07T08:00:00Z", "2026-11-07T14:01:00Z"]] }),
      "overlap",
      {
        withStart: "2026-11-07T08:00:00.000Z",
        withEnd: "2026-11-07T14:01:00.000Z",
        bufferMinutes: 0,
      },
    ],
    [
      "under the rest gap",
      input({ others: [["2026-11-07T00:00:00Z", "2026-11-07T04:00:00Z"]] }),
      "rest",
      { hoursBefore: 10, hoursAfter: null, minimumHours: 11 },
    ],
    [
      "over the weekly cap",
      input({
        others: [
          ["2026-11-02T08:00:00Z", "2026-11-02T22:00:00Z"],
          ["2026-11-03T08:00:00Z", "2026-11-03T22:00:00Z"],
          ["2026-11-04T08:00:00Z", "2026-11-04T21:00:00Z"],
        ],
      }),
      "weekly_hours",
      { hours: 49, capHours: 48 },
    ],
    [
      "a day off",
      input({ unavailableDates: ["2026-11-07"] }),
      "days_off",
      { dates: ["2026-11-07"] },
    ],
    [
      "a blocked site",
      input({
        settings: {
          minRestHours: 11,
          weeklyHoursCap: 48,
          travelBufferMinutes: 0,
          appliedAllowancePct: 0,
          appliedAllowedTypes: [],
          appliedInUseCount: 0,
          deployedCount: 0,
          blockedSites: ["site-1"],
        },
      }),
      "site",
      { siteId: "site-1" },
    ],
  ] as const)("%s", (_, given, code, detail) => {
    const r = checkEligibility(given);
    expect(r.ok).toBe(false);
    const failed = r.checks.filter((c) => !c.passed);
    expect(failed).toEqual([{ code, passed: false, detail }]);
    // Each failure has its failed check; nothing passed is reported failed.
    expect([...new Set(r.codes.map((c) => CHECK_OF[c]))]).toEqual([code]);
  });

  it("an application counted within the allowance: a passed check saying so (not left out)", () => {
    const r = checkEligibility(
      input({
        credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
        settings: {
          minRestHours: 11,
          weeklyHoursCap: 48,
          travelBufferMinutes: 0,
          appliedAllowancePct: 50,
          appliedAllowedTypes: ["SIA_DS"],
          appliedInUseCount: 0,
          deployedCount: 3,
          blockedSites: [],
        },
      }),
    );
    expect(r.ok).toBe(true);
    expect(byCode(r, "qualification")).toEqual([
      {
        code: "qualification",
        passed: true,
        detail: {
          type: "SIA_DS",
          neededBy: "role",
          held: "applied",
          expiresOn: null,
          until: "2026-11-07",
        },
      },
    ]);
  });

  it("every required type gets exactly one qualification check, whatever the outcome", () => {
    const cases = [
      { status: "valid" as const, expiresOn: "2027-01-01" },
      { status: "valid" as const, expiresOn: "2026-11-06" },
      { status: "expired" as const, expiresOn: null },
      { status: "suspended" as const, expiresOn: null },
      { status: "applied" as const, expiresOn: null },
    ];
    for (const pct of [0, 50]) {
      for (const c of cases) {
        const r = checkEligibility(
          input({
            credentials: [{ type: "SIA_DS", ...c }],
            settings: {
              minRestHours: 11,
              weeklyHoursCap: 48,
              travelBufferMinutes: 0,
              appliedAllowancePct: pct,
              appliedAllowedTypes: ["SIA_DS"],
              appliedInUseCount: 0,
              deployedCount: 3,
              blockedSites: [],
            },
          }),
        );
        expect(byCode(r, "qualification")).toHaveLength(1);
        expect(byCode(r, "qualification")[0]?.passed).toBe(r.ok);
      }
    }
  });

  it("no rule for the role: one failed qualification check saying so", () => {
    const r = checkEligibility(
      input({
        shift: {
          id: "s1",
          role: "door_supervisor",
          startsAt: at("2026-11-07T14:00:00Z"),
          endsAt: at("2026-11-07T22:00:00Z"),
          siteId: null,
          requiredTypes: null,
          extraTypes: [],
          anyOfTypes: [],
        },
      }),
    );
    expect(byCode(r, "qualification")).toEqual([
      { code: "qualification", passed: false, detail: { rule: "none", role: "door_supervisor" } },
    ]);
  });
});

describe("the checks never change the decision", () => {
  const cases: EligibilityInput[] = [
    input(),
    input({ credentials: [] }),
    input({
      unavailableDates: ["2026-11-07"],
      others: [["2026-11-07T08:00:00Z", "2026-11-07T15:00:00Z"]],
    }),
    input({
      now: at("2026-11-07T15:00:00Z"),
      credentials: [{ type: "SIA_DS", status: "applied", expiresOn: null }],
    }),
    input({ others: [["2026-11-07T00:00:00Z", "2026-11-07T04:00:00Z"]], overrides: ["rest"] }),
    input({ worker: { id: "w1", status: "blocked", roles: [] } }),
  ];
  it.each(cases.map((c, i) => [i, c] as const))(
    "case %i: ok is every check passed, overrides aside",
    (_, c) => {
      const r = checkEligibility(c);
      const overridden = new Set<CheckCode>(r.overridden.map((o) => CHECK_OF[o]));
      const blocking = r.checks.filter((x) => !x.passed && !overridden.has(x.code));
      expect(r.ok).toBe(blocking.length === 0);
      for (const code of r.codes)
        expect(r.checks.some((x) => x.code === CHECK_OF[code] && !x.passed)).toBe(true);
    },
  );
});

describe("docs/rules-and-credentials.md lists every check", () => {
  // The "Checks made by code" table: one row per code, in the engine's order, and no other.
  it("the doc's table has exactly CHECK_CODES, in order", () => {
    const doc = readFileSync("docs/rules-and-credentials.md", "utf8");
    const start = doc.indexOf("## Checks made by code");
    expect(start).toBeGreaterThan(-1);
    const section = doc.slice(start, doc.indexOf("\n## ", start + 1));
    const codes = section
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => /^\| `([a-z_]+)`/.exec(line)?.[1]);
    expect(codes).toEqual([...CHECK_CODES]);
  });
});

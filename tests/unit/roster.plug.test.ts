import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { credentialRules, ROLE_PATTERN, shifts } from "@/lib/db/schema";
import { noticeHours } from "@/lib/roster/notice";
import {
  cancelInputSchema,
  rosterShiftSchema,
  rosterStaffSchema,
  shiftWindowSchema,
} from "@/lib/roster/plug";

// The shapes every roster adapter checks its source's data against (the boundary, CLAUDE.md:
// validate every external input with zod), and the one notice-hours calculation.

const staff = {
  ref: "row-12",
  firstName: "Priya",
  lastName: "Example",
  mobileE164: "+447700900123",
  roles: ["steward", "door_supervisor"],
  status: "active",
};

const start = new Date("2026-11-07T09:00:00Z");
const shift = {
  ref: "sheet-row-4",
  siteName: "Acme Demo Arena",
  role: "steward",
  startsAt: start,
  endsAt: new Date("2026-11-07T17:00:00Z"),
  headcount: 2,
  status: "open",
  instructions: null,
  assigned: [{ slot: 1, staffRef: "row-12" }],
};

describe("rosterStaffSchema", () => {
  it("accepts a person as an adapter should hand them over, trimming names", () => {
    expect(rosterStaffSchema.parse({ ...staff, firstName: "  Priya " }).firstName).toBe("Priya");
  });

  it.each([
    ["a number that isn't E.164", { mobileE164: "07700 900123" }],
    ["a role that isn't snake_case", { roles: ["Door Supervisor"] }],
    ["a blank first name", { firstName: "   " }],
    ["a blank ref", { ref: " " }],
    ["an unknown status", { status: "deleted" }],
  ])("refuses %s", (_label, change) => {
    expect(rosterStaffSchema.safeParse({ ...staff, ...change }).success).toBe(false);
  });
});

describe("rosterShiftSchema", () => {
  it("accepts a shift with its holders, and one with none", () => {
    expect(rosterShiftSchema.parse(shift).assigned).toHaveLength(1);
    expect(rosterShiftSchema.parse({ ...shift, assigned: [], siteName: null }).siteName).toBeNull();
  });

  it.each([
    ["an end at the start", { endsAt: start }],
    ["an end before the start", { endsAt: new Date("2026-11-07T08:00:00Z") }],
    ["a headcount of 0", { headcount: 0 }],
    ["a headcount over 1000", { headcount: 1001 }],
    ["a role that isn't snake_case", { role: "Steward" }],
    ["an unknown status", { status: "closed" }],
    ["a slot beyond the headcount", { assigned: [{ slot: 3, staffRef: "row-12" }] }],
    ["slot 0", { assigned: [{ slot: 0, staffRef: "row-12" }] }],
    [
      "two holders for one slot",
      {
        assigned: [
          { slot: 1, staffRef: "row-12" },
          { slot: 1, staffRef: "row-13" },
        ],
      },
    ],
    [
      "one person in two slots",
      {
        assigned: [
          { slot: 1, staffRef: "row-12" },
          { slot: 2, staffRef: "row-12" },
        ],
      },
    ],
  ])("refuses %s", (_label, change) => {
    expect(rosterShiftSchema.safeParse({ ...shift, ...change }).success).toBe(false);
  });
});

describe("shiftWindowSchema and cancelInputSchema", () => {
  it("a window must end after it starts", () => {
    const to = new Date("2026-11-08T00:00:00Z");
    expect(shiftWindowSchema.safeParse({ from: start, to }).success).toBe(true);
    expect(shiftWindowSchema.safeParse({ from: start, to: start }).success).toBe(false);
    expect(shiftWindowSchema.safeParse({ from: to, to: start }).success).toBe(false);
  });

  it("a cancellation needs a real reason, says who cancelled and when they asked", () => {
    const at = new Date("2026-11-06T09:00:00Z");
    expect(cancelInputSchema.parse({ reason: " Unwell ", by: "worker", at })).toEqual({
      reason: "Unwell",
      by: "worker",
      at,
    });
    expect(cancelInputSchema.safeParse({ reason: "Venue shut", by: "firm", at }).success).toBe(
      true,
    );
    for (const bad of [
      { reason: "", by: "worker", at },
      { reason: "   ", by: "firm", at },
      { reason: "x".repeat(501), by: "worker", at },
      { reason: "Unwell", by: "ai", at },
      { reason: "Unwell", by: "worker" },
      { reason: "Unwell", by: "worker", at: "2026-11-06T09:00:00Z" },
    ]) {
      expect(cancelInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("ROLE_PATTERN", () => {
  const checkSql = (table: PgTable, name: string) => {
    const check = getTableConfig(table).checks.find((c) => c.name === name);
    if (!check) throw new Error(`no check ${name}`);
    return new PgDialect().sqlToQuery(check.value).sql;
  };

  it("is the pattern the database's role checks use, so zod and Postgres agree", () => {
    expect(checkSql(shifts, "shifts_role_format")).toContain(`'${ROLE_PATTERN}'`);
    expect(checkSql(credentialRules, "credential_rules_role_format")).toContain(
      `'${ROLE_PATTERN}'`,
    );
  });
});

describe("noticeHours", () => {
  const at = (iso: string) => new Date(iso);
  const S = at("2026-11-07T09:00:00Z");

  it.each([
    ["48 hours before", "2026-11-05T09:00:00Z", 48],
    ["26 hours before", "2026-11-06T07:00:00Z", 26],
    ["20 minutes before", "2026-11-07T08:40:00Z", 0.33],
    ["40 minutes before", "2026-11-07T08:20:00Z", 0.67],
    ["30 seconds before", "2026-11-07T08:59:30Z", 0.01],
    ["just under 18 seconds before (under half a hundredth)", "2026-11-07T08:59:42.001Z", 0],
    [
      "exactly 18 seconds before (half a hundredth rounds away from zero)",
      "2026-11-07T08:59:42Z",
      0.01,
    ],
    ["exactly 18 seconds after", "2026-11-07T09:00:18Z", -0.01],
    ["1.005 hours before (exact, not a float slip)", "2026-11-07T07:59:42Z", 1.01],
    ["90 minutes after the start", "2026-11-07T10:30:00Z", -1.5],
  ])("%s", (_label, cancelledAt, expected) => {
    expect(noticeHours(S, at(cancelledAt))).toBe(expected);
  });

  it("is 0, never -0, for a cancellation a moment after the start", () => {
    expect(Object.is(noticeHours(S, at("2026-11-07T09:00:00.001Z")), 0)).toBe(true);
    expect(Object.is(noticeHours(S, S), 0)).toBe(true);
  });

  it("counts real elapsed hours across the October clock change (UTC, not wall-clock time)", () => {
    // 02:30 BST on Saturday 24 Oct to 01:30 GMT on Sunday 25 Oct 2026: 23 hours on the wall
    // clock, 24 real hours.
    expect(noticeHours(at("2026-10-25T01:30:00Z"), at("2026-10-24T01:30:00Z"))).toBe(24);
  });
});

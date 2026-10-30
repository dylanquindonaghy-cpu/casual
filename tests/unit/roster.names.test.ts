import { describe, expect, it } from "vitest";
import type { NameKind } from "@/lib/db/schema";
import {
  nameKey,
  normaliseQualification,
  normaliseRole,
  readQualificationName,
  readRoleName,
  readRoleNames,
  type MappedName,
  type NameMap,
} from "@/lib/roster/names";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import { parseSheet } from "@/lib/roster/sheets/parse";

// A firm's name map (P3.2; src/lib/roster/names.ts): its own system's names for roles, read as
// ShiftDesk codes or skipped, with normaliseRole() as the fallback. Made-up names only.

const names = (roles: Record<string, string | null>): NameMap =>
  new Map<NameKind, Map<string, MappedName>>([
    ["role", new Map(Object.entries(roles).map(([k, code]) => [k, { code, payRatePence: null }]))],
  ]);
const MAP = names({
  "door supervisor (nlw)": "door_supervisor",
  "door supervisor (llw)": "door_supervisor",
  "12d": "traffic_marshal",
  holiday: null,
  "not set": null,
});

describe("a name's key", () => {
  it("trimmed, lower case, one space between words; nothing empty, too long or with a control character", () => {
    expect(nameKey("  Door  Supervisor\t(NLW) ")).toBe("door supervisor (nlw)");
    expect(nameKey("12D")).toBe("12d");
    // Control and format characters too (a soft hyphen, a zero-width space, a direction mark):
    // what an ICU database calls "control".
    for (const bad of [
      "",
      "   ",
      "x".repeat(201),
      "door\u0000supervisor",
      "a\u0085b",
      "door\u00adsupervisor",
      "door\u200bsupervisor",
      "a\u202eb",
    ]) {
      expect(nameKey(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(nameKey("x".repeat(200))).toHaveLength(200);
    // A line separator is white space: one space, like a tab.
    expect(nameKey("a\u2028b")).toBe("a b");
  });
});

describe("a role's name", () => {
  it("the firm's map first: a mapped name is its code, a skipped one is skipped", () => {
    expect(readRoleName("Door Supervisor (NLW)", MAP)).toEqual({ role: "door_supervisor" });
    expect(readRoleName("door supervisor  (llw)", MAP)).toEqual({ role: "door_supervisor" });
    expect(readRoleName("12D", MAP)).toEqual({ role: "traffic_marshal" });
    expect(readRoleName("HOLIDAY", MAP)).toEqual({ skip: true });
  });

  it("a name the map doesn't have is read as before; one neither can read is null", () => {
    expect(readRoleName("Steward", MAP)).toEqual({ role: "steward" });
    expect(readRoleName("Door Supervisor (NLW)")).toBeNull();
    expect(readRoleName("12D")).toBeNull();
    expect(readRoleName("Event Manager (PAYE)", MAP)).toBeNull();
    // No map at all: exactly normaliseRole().
    for (const raw of ["Steward", "door-supervisor", "Track Operative", "12D", "(x)", ""]) {
      const role = normaliseRole(raw);
      expect(readRoleName(raw), raw).toEqual(role === null ? null : { role });
    }
  });

  it("a worker's list: the codes once each, the skipped names left out, null if any can't be read", () => {
    expect(
      readRoleNames(["Door Supervisor (NLW)", "Door Supervisor (LLW)", "Holiday", "steward"], MAP),
    ).toEqual(["door_supervisor", "steward"]);
    expect(readRoleNames(["Holiday", "Not Set"], MAP)).toEqual([]);
    expect(readRoleNames(["steward", "Event Manager (PAYE)"], MAP)).toBeNull();
    expect(readRoleNames([])).toEqual([]);
  });
});

describe("a qualification's name (the credentials import)", () => {
  const QUALS: NameMap = new Map<NameKind, Map<string, MappedName>>([
    [
      "qualification",
      new Map([
        ["nhss 12d", { code: "TM_12D", payRatePence: null }],
        ["induction", { code: null, payRatePence: null }],
      ]),
    ],
  ]);
  it("the map first, else the import's own spelling; null for one neither can read", () => {
    expect(readQualificationName("NHSS 12D", QUALS)).toEqual({ code: "TM_12D" });
    expect(readQualificationName("Induction", QUALS)).toEqual({ skip: true });
    expect(readQualificationName("sia ds", QUALS)).toEqual({ code: "SIA_DS" });
    expect(readQualificationName("Chapter 8 (TM)", QUALS)).toBeNull();
    expect(normaliseQualification("first-aid")).toBe("FIRST_AID");
    expect(normaliseQualification("X".repeat(51))).toBeNull();
    // No map: exactly the import's spelling.
    expect(readQualificationName("NHSS 12D")).toEqual({ code: "NHSS_12D" });
  });
});

describe("the rota sheet through the map", () => {
  const LONDON = "Europe/London";
  const staffHeader = ["Staff ID", "First name", "Last name", "Mobile", "Roles", "Status"];
  const shiftHeader = [
    "Shift ID",
    "Date",
    "Start",
    "End",
    "Site",
    "Role",
    "Needed",
    "Status",
    "Instructions",
    "Assigned",
  ];
  const shift = (ref: string, role: string, date = "07/11/2026") => [
    ref,
    date,
    "09:00",
    "17:00",
    "",
    role,
    "1",
    "",
    "",
    "",
  ];
  const input = {
    staffRows: [
      staffHeader,
      ["S1", "Ada", "Example", "07700 900301", "Door Supervisor (NLW), Holiday", ""],
      ["S2", "Ben", "Example", "07700 900302", "Event Manager (PAYE)", ""],
    ],
    shiftRows: [
      shiftHeader,
      shift("E1", "Door Supervisor (LLW)"),
      shift("E2", "Holiday"),
      // A skipped role isn't a session, whatever else the row says (its date here).
      shift("E3", "Not Set", "someday"),
      shift("E4", "12D"),
      shift("E5", "Event Manager (PAYE)"),
    ],
  };

  it("mapped roles come in as their codes; skipped ones don't, and aren't problems; the rest as before", () => {
    const parsed = parseSheet(input, DEFAULT_SHEET_MAPPING, LONDON, MAP);
    expect(parsed.skipped).toEqual([
      { row: 3, ref: "E2" },
      { row: 4, ref: "E3" },
    ]);
    expect(parsed.staff.map((s) => [s.ref, s.roles])).toEqual([["S1", ["door_supervisor"]]]);
    expect(parsed.shifts.map((s) => [s.ref, s.role])).toEqual([
      ["E1", "door_supervisor"],
      ["E4", "traffic_marshal"],
    ]);
    expect(parsed.problems).toEqual([
      { tab: "staff", row: 3, problem: "bad_role" },
      { tab: "shifts", row: 6, problem: "bad_role" },
    ]);
  });

  it("with no map, every one of those names is a bad role, as before", () => {
    const parsed = parseSheet(input, DEFAULT_SHEET_MAPPING, LONDON);
    expect(parsed.staff).toEqual([]);
    expect(parsed.shifts.map((s) => s.ref)).toEqual(["E2"]);
    expect(parsed.problems.map((p) => [p.tab, p.row, p.problem])).toEqual([
      ["staff", 2, "bad_role"],
      ["staff", 3, "bad_role"],
      ["shifts", 2, "bad_role"],
      ["shifts", 4, "bad_date"],
      ["shifts", 5, "bad_role"],
      ["shifts", 6, "bad_role"],
    ]);
  });
});

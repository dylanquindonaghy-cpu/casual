import { describe, expect, it } from "vitest";
import { memoryRosterFixture, type MemoryFault } from "../helpers/memory-roster-plug";
import {
  contractCheck,
  describeRosterContract,
  NOW,
  ROSTER_CONTRACT,
  runCheck,
  type RosterHarness,
} from "../helpers/roster-contract";

// The RosterPlug contract run against the in-memory reference adapter. The native, Sheets and CSV
// adapters run the same describeRosterContract() in their own tests. The second half proves the
// contract can fail: each check is run against a plug broken in the way that check exists to catch.

const clock = { now: () => NOW };

const memory = (faults: MemoryFault[] = []): RosterHarness => ({
  writable: async () => memoryRosterFixture({ clock, canWrite: true, faults }),
  readOnly: async () => memoryRosterFixture({ clock, canWrite: false, faults }),
  twoFirms: async () => ({
    mine: memoryRosterFixture({ clock, canWrite: true, faults }),
    theirs: memoryRosterFixture({ clock, canWrite: true }),
  }),
});

describeRosterContract("in-memory reference adapter", memory());

describe("the contract suite", () => {
  it("has unique check names, covering every RosterPlug member, read-only and two firms", () => {
    const names = ROSTER_CONTRACT.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const member of ["listStaff", "getShifts", "assign", "markCancelled", "canWrite"]) {
      expect(names.some((n) => n.includes(member))).toBe(true);
    }
    expect(ROSTER_CONTRACT.some((c) => c.mode === "readOnly")).toBe(true);
    expect(ROSTER_CONTRACT.some((c) => c.mode === "twoFirms")).toBe(true);
  });

  const FIRST_YES = "first yes wins: the next person is told it's filled, and nothing changes";
  const IN_FLIGHT =
    "two assign calls in flight together on one plug for the last slot: exactly one gets it";
  const WINDOWED =
    "getShifts returns the shifts starting in [from, to), every status, each a valid RosterShift";
  const CANCEL =
    "markCancelled frees the slot, stores who, why and the notice hours, and the slot can be taken again";
  const FIRM_CANCEL =
    "a cancellation by the office is stored as the office's, with its reason (golden rule 12)";
  const ASKED_AT =
    "markCancelled counts notice from when the person asked (cancel.at), not from when it runs";
  const REFUSED =
    "markCancelled refuses a blank reason or a cancel.at after its clock, and changes nothing";
  const READ_ONLY =
    "a read-only source says canWrite false; assign and markCancelled return needs_approval and change nothing";
  const LISTED = "listStaff returns everyone in the source by ref, each a valid RosterStaff";
  const TENANCY =
    "another firm's staff and shifts are out of reach: never listed, not_found by id, left unchanged";

  const cases: [MemoryFault, string][] = [
    ["double_assign", FIRST_YES],
    ["double_assign", IN_FLIGHT],
    ["ignore_window", WINDOWED],
    ["zero_notice", CANCEL],
    ["stay_filled", CANCEL],
    ["drop_reason", CANCEL],
    ["ignore_by", FIRM_CANCEL],
    ["drop_reason", FIRM_CANCEL],
    ["notice_from_clock", ASKED_AT],
    ["blank_reason", REFUSED],
    ["future_at_ok", REFUSED],
    ["write_read_only", READ_ONLY],
    ["bad_mobile", LISTED],
    ["ids_as_refs", LISTED],
    ["cross_firm", TENANCY],
  ];

  it.each(cases)("catches a plug with the %s fault in: %s", async (fault, name) => {
    const check = contractCheck(name);
    // Control: the same check passes on a healthy plug.
    await expect(runCheck(check, memory())).resolves.toBeUndefined();
    await expect(runCheck(check, memory([fault]))).rejects.toThrow();
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HOUR, MINUTE } from "@/lib/auth/clock";
import { SHIFT_SOURCES } from "@/lib/db/schema";
import {
  rosterShiftSchema,
  rosterStaffSchema,
  type CancelInput,
  type RosterPlug,
  type RosterShift,
} from "@/lib/roster/plug";
import { checkEligibility, type EligibilityPass } from "@/lib/rules/eligibility";

// The RosterPlug contract: what every adapter (native, Sheets, CSV) must do, checked the same way
// for each. An adapter's test seeds SCENARIO into its own source (our tables, a mocked sheet...)
// and hands back a plug on it whose clock reads NOW, the ids and refs it gave each person and
// shift, and a reader for the cancellation evidence it stored. Then describeRosterContract() runs
// every check. The checks are exported one by one so roster.contract.test.ts can prove each can
// fail (against deliberately broken plugs).

export const NOW = new Date("2026-11-06T09:00:00.000Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
export const WINDOW = { from: NOW, to: at(14 * 24) };

export type StaffKey = "alice" | "bob" | "cara";
export type ShiftKey =
  "now" | "open" | "pair" | "booked" | "draft" | "cancelled" | "past" | "later" | "edge";

export interface ScenarioStaff {
  key: StaffKey;
  firstName: string;
  lastName: string;
  mobileE164: string;
  roles: string[];
  status: "active" | "inactive" | "blocked";
}

export interface ScenarioShift {
  key: ShiftKey;
  siteName: string | null;
  role: string;
  startsAt: Date;
  endsAt: Date;
  headcount: number;
  status: "draft" | "open" | "filled" | "cancelled";
  instructions: string | null;
  holders: StaffKey[]; // slot 1, slot 2, ...
}

const shift = (
  key: ShiftKey,
  startHours: number,
  o: Partial<Omit<ScenarioShift, "key" | "startsAt" | "endsAt">> = {},
): ScenarioShift => ({
  key,
  siteName: "Acme Demo Arena",
  role: "steward",
  startsAt: at(startHours),
  endsAt: at(startHours + 8),
  headcount: 1,
  status: "open",
  instructions: null,
  holders: [],
  ...o,
});

// Fake people only: numbers in Ofcom's drama range, a made-up venue.
export const SCENARIO: { staff: ScenarioStaff[]; shifts: ScenarioShift[] } = {
  staff: [
    {
      key: "alice",
      firstName: "Alice",
      lastName: "Contract",
      mobileE164: "+447700900701",
      roles: ["steward"],
      status: "active",
    },
    {
      key: "bob",
      firstName: "Bob",
      lastName: "Contract",
      mobileE164: "+447700900702",
      roles: ["steward", "door_supervisor"],
      status: "active",
    },
    {
      key: "cara",
      firstName: "Cara",
      lastName: "Contract",
      mobileE164: "+447700900703",
      roles: ["steward"],
      status: "inactive",
    },
  ],
  shifts: [
    shift("now", 0, { instructions: "Report to Gate C" }), // starts exactly at the window's start
    shift("open", 48),
    shift("pair", 72, { headcount: 2, siteName: null }),
    shift("booked", 26, { status: "filled", holders: ["bob"] }),
    shift("draft", 24, { status: "draft" }),
    shift("cancelled", 30, { status: "cancelled" }),
    shift("past", -48), // before the window
    shift("later", 40 * 24), // after the window
    shift("edge", 14 * 24), // starts exactly at the window's end, which is excluded
  ],
};

type Keyed<T> = { staff: Record<StaffKey, T>; shifts: Record<ShiftKey, T> };

// What the adapter stored for one cancellation, read back from its source (for native: the
// assignments row's status, cancel_reason and notice_hours).
export interface CancellationRecord {
  assignmentId: string;
  staffRef: string;
  by: "worker" | "firm";
  reason: string;
  noticeHours: number;
}

export interface RosterFixture {
  plug: RosterPlug;
  ids: Keyed<string>; // our ids, as the portal passes them to assign / markCancelled
  refs: Keyed<string>; // the source's keys, as listStaff / getShifts report them
  cancellations(): Promise<CancellationRecord[]>;
}

export interface RosterHarness {
  // A fresh source holding SCENARIO and a writable plug on it, clock at NOW.
  writable(): Promise<RosterFixture>;
  // The same source, read-only (canWrite false). Omitted for sources that are always writable.
  readOnly?(): Promise<RosterFixture>;
  // Two firms, each seeded with SCENARIO in its own source, each with its own plug.
  twoFirms(): Promise<{ mine: RosterFixture; theirs: RosterFixture }>;
}

export interface ContractCheck {
  name: string;
  mode: "writable" | "readOnly" | "twoFirms";
  run(f: RosterFixture, theirs?: RosterFixture): Promise<void>;
}

// A pass for the contract's bookings. Plugs record and the rules decide, so the contract mints
// each pass from a minimal input that passes: it says nothing about the person (the booking path,
// src/lib/roster/book.ts, checks the real rows); it lets the contract book through assign.
export function passFor(shiftId: string, workerId: string): EligibilityPass {
  const startsAt = new Date(NOW.getTime() + 365 * 24 * HOUR);
  const result = checkEligibility({
    now: NOW,
    timeZone: "Europe/London",
    worker: { id: workerId, status: "active", roles: ["contract"] },
    credentials: [],
    shift: {
      id: shiftId,
      role: "contract",
      siteId: null,
      requiredTypes: [],
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
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
  if (!result.pass) throw new Error("the contract's pass input should always pass");
  return result.pass;
}

export const book = (plug: RosterPlug, shiftId: string, workerId: string) =>
  plug.assign(shiftId, workerId, passFor(shiftId, workerId));

const shiftOf = async (f: RosterFixture, key: ShiftKey): Promise<RosterShift> => {
  const list = await f.plug.getShifts(WINDOW.from, WINDOW.to);
  const found = list.find((s) => s.ref === f.refs.shifts[key]);
  if (!found) throw new Error(`getShifts didn't return the "${key}" shift`);
  return found;
};

const holdersOf = async (f: RosterFixture, key: ShiftKey) =>
  (await shiftOf(f, key)).assigned.map((a) => ({ slot: a.slot, staffRef: a.staffRef }));

const inWindow: ShiftKey[] = ["now", "open", "pair", "booked", "draft", "cancelled"];

const byWorker: CancelInput = { reason: "Unwell", by: "worker", at: NOW };

const listStaffChecks: ContractCheck[] = [
  {
    name: "listStaff returns everyone in the source by ref, each a valid RosterStaff",
    mode: "writable",
    async run(f) {
      const staff = await f.plug.listStaff();
      for (const person of staff) expect(() => rosterStaffSchema.parse(person)).not.toThrow();
      expect(staff.map((s) => s.ref).sort()).toEqual(Object.values(f.refs.staff).sort());
      const bob = staff.find((s) => s.ref === f.refs.staff.bob);
      expect(bob).toMatchObject({
        firstName: "Bob",
        lastName: "Contract",
        mobileE164: "+447700900702",
        status: "active",
      });
      expect([...(bob?.roles ?? [])].sort()).toEqual(["door_supervisor", "steward"]);
      expect(staff.find((s) => s.ref === f.refs.staff.cara)?.status).toBe("inactive");
    },
  },
];

const getShiftsChecks: ContractCheck[] = [
  {
    name: "getShifts returns the shifts starting in [from, to), every status, each a valid RosterShift",
    mode: "writable",
    async run(f) {
      const list = await f.plug.getShifts(WINDOW.from, WINDOW.to);
      for (const s of list) expect(() => rosterShiftSchema.parse(s)).not.toThrow();
      expect(list.map((s) => s.ref).sort()).toEqual(inWindow.map((k) => f.refs.shifts[k]).sort());
      const byRef = new Map(list.map((s) => [s.ref, s]));
      const now = byRef.get(f.refs.shifts.now);
      expect(now).toMatchObject({
        role: "steward",
        siteName: "Acme Demo Arena",
        headcount: 1,
        status: "open",
        instructions: "Report to Gate C",
      });
      expect(now?.startsAt.toISOString()).toBe(NOW.toISOString());
      expect(now?.endsAt.toISOString()).toBe(at(8).toISOString());
      expect(byRef.get(f.refs.shifts.pair)).toMatchObject({ headcount: 2, siteName: null });
      expect(byRef.get(f.refs.shifts.draft)?.status).toBe("draft");
      expect(byRef.get(f.refs.shifts.cancelled)?.status).toBe("cancelled");
    },
  },
  {
    name: "getShifts shows who holds each slot, by staff ref",
    mode: "writable",
    async run(f) {
      expect(await holdersOf(f, "booked")).toEqual([{ slot: 1, staffRef: f.refs.staff.bob }]);
      expect(await holdersOf(f, "open")).toEqual([]);
      expect((await shiftOf(f, "booked")).status).toBe("filled");
    },
  },
  {
    name: "getShifts refuses a window that doesn't end after it starts",
    mode: "writable",
    async run(f) {
      await expect(f.plug.getShifts(WINDOW.to, WINDOW.from)).rejects.toThrow();
      await expect(f.plug.getShifts(NOW, NOW)).rejects.toThrow();
    },
  },
  {
    name: "what listStaff and getShifts return are copies: changing them changes nothing",
    mode: "writable",
    async run(f) {
      const staff = await f.plug.listStaff();
      staff[0]?.roles.push("intruder");
      staff.pop();
      const shifts = await f.plug.getShifts(WINDOW.from, WINDOW.to);
      const booked = shifts.find((s) => s.ref === f.refs.shifts.booked);
      booked?.assigned.pop();
      booked?.startsAt.setTime(0);
      expect((await f.plug.listStaff()).flatMap((s) => s.roles)).not.toContain("intruder");
      expect(await f.plug.listStaff()).toHaveLength(SCENARIO.staff.length);
      expect(await holdersOf(f, "booked")).toHaveLength(1);
      expect((await shiftOf(f, "booked")).startsAt.getTime()).toBe(at(26).getTime());
    },
  },
];

const assignChecks: ContractCheck[] = [
  {
    name: "assign refuses without an unused eligibility pass for exactly that person and shift, and changes nothing",
    mode: "writable",
    async run(f) {
      const { open, pair } = f.ids.shifts;
      const { alice, bob } = f.ids.staff;
      const forged = { workerId: alice, shiftId: open, overridden: [] };
      const refused = [
        undefined, // none at all
        forged, // looks like a pass, but the rules engine never issued it
        passFor(open, bob), // someone else's
        passFor(pair, alice), // another shift's
      ];
      for (const pass of refused) {
        await expect(
          f.plug.assign(open, alice, pass as unknown as EligibilityPass),
        ).rejects.toThrow();
      }
      expect(await holdersOf(f, "open")).toEqual([]);
      // A pass is used up by its booking: kept and shown again later, it books nothing.
      const pass = passFor(open, alice);
      expect((await f.plug.assign(open, alice, pass)).status).toBe("assigned");
      expect((await f.plug.markCancelled(open, alice, byWorker)).status).toBe("cancelled");
      await expect(f.plug.assign(open, alice, pass)).rejects.toThrow();
      expect(await holdersOf(f, "open")).toEqual([]);
    },
  },
  {
    name: "a writable source says canWrite true and names one of the known sources",
    mode: "writable",
    async run(f) {
      expect(f.plug.canWrite).toBe(true);
      expect(SHIFT_SOURCES).toContain(f.plug.source);
    },
  },
  {
    name: "assign fills the free slot; the shift then shows the holder and is filled",
    mode: "writable",
    async run(f) {
      const result = await book(f.plug, f.ids.shifts.open, f.ids.staff.alice);
      expect(result).toEqual({ status: "assigned", assignmentId: expect.any(String), slot: 1 });
      expect(await holdersOf(f, "open")).toEqual([{ slot: 1, staffRef: f.refs.staff.alice }]);
      expect((await shiftOf(f, "open")).status).toBe("filled");
    },
  },
  {
    name: "first yes wins: the next person is told it's filled, and nothing changes",
    mode: "writable",
    async run(f) {
      expect((await book(f.plug, f.ids.shifts.open, f.ids.staff.alice)).status).toBe("assigned");
      expect(await book(f.plug, f.ids.shifts.open, f.ids.staff.bob)).toEqual({ status: "filled" });
      expect(await holdersOf(f, "open")).toEqual([{ slot: 1, staffRef: f.refs.staff.alice }]);
      expect(await book(f.plug, f.ids.shifts.booked, f.ids.staff.alice)).toEqual({
        status: "filled",
      });
      expect(await holdersOf(f, "booked")).toEqual([{ slot: 1, staffRef: f.refs.staff.bob }]);
    },
  },
  {
    // Catches a plug that reads, awaits (e.g. a network call), then writes. The race between
    // separate connections is assign.race's job (docs/testing.md).
    name: "two assign calls in flight together on one plug for the last slot: exactly one gets it",
    mode: "writable",
    async run(f) {
      const results = await Promise.all([
        book(f.plug, f.ids.shifts.open, f.ids.staff.alice),
        book(f.plug, f.ids.shifts.open, f.ids.staff.bob),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["assigned", "filled"]);
      expect(await holdersOf(f, "open")).toHaveLength(1);
    },
  },
  {
    name: "a two-person shift fills slot 1 then slot 2, and is open until both are taken",
    mode: "writable",
    async run(f) {
      expect(await book(f.plug, f.ids.shifts.pair, f.ids.staff.alice)).toMatchObject({
        status: "assigned",
        slot: 1,
      });
      expect((await shiftOf(f, "pair")).status).toBe("open");
      expect(await book(f.plug, f.ids.shifts.pair, f.ids.staff.bob)).toMatchObject({
        status: "assigned",
        slot: 2,
      });
      expect(await holdersOf(f, "pair")).toEqual([
        { slot: 1, staffRef: f.refs.staff.alice },
        { slot: 2, staffRef: f.refs.staff.bob },
      ]);
      expect((await shiftOf(f, "pair")).status).toBe("filled");
    },
  },
  {
    name: "the same person can't take two slots on one shift",
    mode: "writable",
    async run(f) {
      expect((await book(f.plug, f.ids.shifts.pair, f.ids.staff.alice)).status).toBe("assigned");
      expect(await book(f.plug, f.ids.shifts.pair, f.ids.staff.alice)).toEqual({
        status: "already_assigned",
      });
      expect(await holdersOf(f, "pair")).toEqual([{ slot: 1, staffRef: f.refs.staff.alice }]);
    },
  },
  {
    name: "draft and cancelled shifts can't be taken",
    mode: "writable",
    async run(f) {
      for (const key of ["draft", "cancelled"] as const) {
        expect(await book(f.plug, f.ids.shifts[key], f.ids.staff.alice)).toEqual({
          status: "not_open",
        });
        expect(await holdersOf(f, key)).toEqual([]);
      }
    },
  },
  {
    name: "an unknown shift or person is not_found",
    mode: "writable",
    async run(f) {
      expect(await book(f.plug, randomUUID(), f.ids.staff.alice)).toEqual({ status: "not_found" });
      expect(await book(f.plug, f.ids.shifts.open, randomUUID())).toEqual({ status: "not_found" });
      expect(await f.plug.markCancelled(randomUUID(), f.ids.staff.bob, byWorker)).toEqual({
        status: "not_found",
      });
      expect(await f.plug.markCancelled(f.ids.shifts.booked, randomUUID(), byWorker)).toEqual({
        status: "not_found",
      });
      expect(await holdersOf(f, "open")).toEqual([]);
      expect(await holdersOf(f, "booked")).toHaveLength(1);
      expect(await f.cancellations()).toEqual([]);
    },
  },
];

const cancelChecks: ContractCheck[] = [
  {
    name: "markCancelled frees the slot, stores who, why and the notice hours, and the slot can be taken again",
    mode: "writable",
    async run(f) {
      // "booked" starts 26 hours after NOW.
      const result = await f.plug.markCancelled(f.ids.shifts.booked, f.ids.staff.bob, byWorker);
      expect(result).toEqual({
        status: "cancelled",
        assignmentId: expect.any(String),
        noticeHours: 26,
      });
      if (result.status !== "cancelled") return;
      expect(await f.cancellations()).toEqual([
        {
          assignmentId: result.assignmentId,
          staffRef: f.refs.staff.bob,
          by: "worker",
          reason: "Unwell",
          noticeHours: 26,
        },
      ]);
      expect(await holdersOf(f, "booked")).toEqual([]);
      expect((await shiftOf(f, "booked")).status).toBe("open");
      expect(await book(f.plug, f.ids.shifts.booked, f.ids.staff.alice)).toMatchObject({
        status: "assigned",
        slot: 1,
      });
      expect(await holdersOf(f, "booked")).toEqual([{ slot: 1, staffRef: f.refs.staff.alice }]);
    },
  },
  {
    name: "a cancellation by the office is stored as the office's, with its reason (golden rule 12)",
    mode: "writable",
    async run(f) {
      const result = await f.plug.markCancelled(f.ids.shifts.booked, f.ids.staff.bob, {
        reason: "  Event called off by the venue ",
        by: "firm",
        at: NOW,
      });
      expect(result).toMatchObject({ status: "cancelled", noticeHours: 26 });
      expect(await f.cancellations()).toEqual([
        {
          assignmentId: expect.any(String),
          staffRef: f.refs.staff.bob,
          by: "firm",
          reason: "Event called off by the venue",
          noticeHours: 26,
        },
      ]);
      expect(await holdersOf(f, "booked")).toEqual([]);
    },
  },
  {
    name: "markCancelled counts notice from when the person asked (cancel.at), not from when it runs",
    mode: "writable",
    async run(f) {
      // Asked 2 hours before NOW (say the job ran late): 28 hours' notice, not 26.
      const asked = new Date(NOW.getTime() - 2 * HOUR);
      const result = await f.plug.markCancelled(f.ids.shifts.booked, f.ids.staff.bob, {
        ...byWorker,
        at: asked,
      });
      expect(result).toMatchObject({ status: "cancelled", noticeHours: 28 });
      expect((await f.cancellations()).map((c) => c.noticeHours)).toEqual([28]);
    },
  },
  {
    name: "markCancelled refuses a blank reason or a cancel.at after its clock, and changes nothing",
    mode: "writable",
    async run(f) {
      for (const cancel of [
        { ...byWorker, reason: "" },
        { ...byWorker, reason: "   " },
        { ...byWorker, at: new Date(NOW.getTime() + MINUTE) },
      ]) {
        await expect(
          f.plug.markCancelled(f.ids.shifts.booked, f.ids.staff.bob, cancel),
        ).rejects.toThrow();
      }
      expect(await holdersOf(f, "booked")).toEqual([{ slot: 1, staffRef: f.refs.staff.bob }]);
      expect(await f.cancellations()).toEqual([]);
    },
  },
  {
    name: "markCancelled for someone not on the shift is not_assigned, including a second cancel",
    mode: "writable",
    async run(f) {
      expect(await f.plug.markCancelled(f.ids.shifts.booked, f.ids.staff.alice, byWorker)).toEqual({
        status: "not_assigned",
      });
      expect(
        (await f.plug.markCancelled(f.ids.shifts.booked, f.ids.staff.bob, byWorker)).status,
      ).toBe("cancelled");
      expect(await f.plug.markCancelled(f.ids.shifts.booked, f.ids.staff.bob, byWorker)).toEqual({
        status: "not_assigned",
      });
      expect(await f.cancellations()).toHaveLength(1);
    },
  },
];

const readOnlyChecks: ContractCheck[] = [
  {
    name: "a read-only source says canWrite false; assign and markCancelled return needs_approval and change nothing",
    mode: "readOnly",
    async run(f) {
      expect(f.plug.canWrite).toBe(false);
      const before = await f.plug.getShifts(WINDOW.from, WINDOW.to);
      expect(await book(f.plug, f.ids.shifts.open, f.ids.staff.alice)).toEqual({
        status: "needs_approval",
      });
      expect(await f.plug.markCancelled(f.ids.shifts.booked, f.ids.staff.bob, byWorker)).toEqual({
        status: "needs_approval",
      });
      expect(await f.plug.getShifts(WINDOW.from, WINDOW.to)).toEqual(before);
      expect(await holdersOf(f, "booked")).toEqual([{ slot: 1, staffRef: f.refs.staff.bob }]);
      expect(await f.cancellations()).toEqual([]);
    },
  },
  {
    name: "a read-only source still lists its staff and shifts",
    mode: "readOnly",
    async run(f) {
      expect((await f.plug.listStaff()).map((s) => s.ref).sort()).toEqual(
        Object.values(f.refs.staff).sort(),
      );
      expect((await f.plug.getShifts(WINDOW.from, WINDOW.to)).map((s) => s.ref).sort()).toEqual(
        inWindow.map((k) => f.refs.shifts[k]).sort(),
      );
    },
  },
];

const tenancyChecks: ContractCheck[] = [
  {
    name: "another firm's staff and shifts are out of reach: never listed, not_found by id, left unchanged",
    mode: "twoFirms",
    async run(mine, theirs) {
      if (!theirs) throw new Error("this check needs two firms");
      // Both firms hold the same scenario, so a leak shows up as extra rows.
      expect(await mine.plug.listStaff()).toHaveLength(SCENARIO.staff.length);
      expect(await mine.plug.getShifts(WINDOW.from, WINDOW.to)).toHaveLength(inWindow.length);
      expect(await book(mine.plug, theirs.ids.shifts.open, mine.ids.staff.alice)).toEqual({
        status: "not_found",
      });
      expect(await book(mine.plug, mine.ids.shifts.open, theirs.ids.staff.alice)).toEqual({
        status: "not_found",
      });
      expect(
        await mine.plug.markCancelled(theirs.ids.shifts.booked, theirs.ids.staff.bob, byWorker),
      ).toEqual({ status: "not_found" });
      expect(await holdersOf(theirs, "open")).toEqual([]);
      expect(await holdersOf(theirs, "booked")).toEqual([
        { slot: 1, staffRef: theirs.refs.staff.bob },
      ]);
      expect(await holdersOf(mine, "open")).toEqual([]);
      expect(await theirs.cancellations()).toEqual([]);
    },
  },
];

export const ROSTER_CONTRACT: readonly ContractCheck[] = [
  ...listStaffChecks,
  ...getShiftsChecks,
  ...assignChecks,
  ...cancelChecks,
  ...readOnlyChecks,
  ...tenancyChecks,
];

export function contractCheck(name: string): ContractCheck {
  const check = ROSTER_CONTRACT.find((c) => c.name === name);
  if (!check) throw new Error(`no contract check named "${name}"`);
  return check;
}

// Runs one check on fresh fixtures from the harness. Read-only checks need harness.readOnly.
export async function runCheck(check: ContractCheck, harness: RosterHarness): Promise<void> {
  if (check.mode === "twoFirms") {
    const { mine, theirs } = await harness.twoFirms();
    return check.run(mine, theirs);
  }
  const make = check.mode === "writable" ? harness.writable : harness.readOnly;
  if (!make) throw new Error(`the harness has no ${check.mode} source`);
  return check.run(await make.call(harness));
}

// Registers one test per check. Read-only checks run only for sources that can be read-only (the
// harness supplies readOnly).
export function describeRosterContract(label: string, harness: RosterHarness): void {
  describe(`RosterPlug contract: ${label}`, () => {
    for (const check of ROSTER_CONTRACT) {
      if (check.mode === "readOnly" && !harness.readOnly) continue;
      it(check.name, () => runCheck(check, harness));
    }
  });
}

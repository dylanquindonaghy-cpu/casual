import { randomUUID } from "node:crypto";
import type { Clock } from "@/lib/auth/clock";
import { noticeHours } from "@/lib/roster/notice";
import {
  cancelInputSchema,
  rosterShiftSchema,
  rosterStaffSchema,
  shiftWindowSchema,
  type AssignResult,
  type CancelResult,
  type RosterPlug,
  type RosterShift,
  type RosterStaff,
} from "@/lib/roster/plug";
import {
  SCENARIO,
  type CancellationRecord,
  type RosterFixture,
  type ShiftKey,
  type StaffKey,
} from "./roster-contract";

// A reference RosterPlug held in memory: a test double that proves the contract suite is
// consistent and, with `faults`, that each contract check can fail. No firm uses it. Refs differ
// from ids on purpose (like a sheet's row keys), so the contract can't mix the two up. Each
// fixture is one "firm"; the cross_firm fault makes a plug look rows up across all of them.

export type MemoryFault =
  | "double_assign" // assign ignores taken slots
  | "ignore_window" // getShifts returns every shift
  | "zero_notice" // markCancelled reports 0 notice hours
  | "notice_from_clock" // notice counted from the plug's clock, not cancel.at
  | "future_at_ok" // accepts a cancel.at after the clock
  | "stay_filled" // a cancelled slot leaves the shift marked filled
  | "blank_reason" // markCancelled accepts a blank reason
  | "ignore_by" // every cancellation stored as the worker's
  | "drop_reason" // the reason isn't stored
  | "write_read_only" // a read-only plug still writes
  | "bad_mobile" // listStaff returns a number that isn't E.164
  | "ids_as_refs" // listStaff reports our ids instead of the source's refs
  | "cross_firm"; // lookups and listings reach other fixtures' ("firms'") rows

interface Person extends RosterStaff {
  id: string;
}
interface Holder {
  workerId: string;
  assignmentId: string;
}
interface Slotted {
  id: string;
  row: RosterShift; // row.assigned stays empty: holders is the truth
  holders: Map<number, Holder>;
}

// Every fixture's rows, for the cross_firm fault only.
const everyone = { people: new Map<string, Person>(), shifts: new Map<string, Slotted>() };

export function memoryRosterFixture(opts: {
  clock: Clock;
  canWrite: boolean;
  faults?: MemoryFault[];
}): RosterFixture {
  const faults = new Set(opts.faults ?? []);
  const ids = { staff: {}, shifts: {} } as RosterFixture["ids"];
  const refs = { staff: {}, shifts: {} } as RosterFixture["refs"];

  const ownPeople = new Map<string, Person>();
  for (const { key, ...rest } of SCENARIO.staff) {
    const id = randomUUID();
    const person = { id, ...rosterStaffSchema.parse({ ref: `staff-row-${key}`, ...rest }) };
    ownPeople.set(id, person);
    everyone.people.set(id, person);
    ids.staff[key as StaffKey] = id;
    refs.staff[key as StaffKey] = person.ref;
  }

  const ownShifts = new Map<string, Slotted>();
  for (const { key, holders, ...rest } of SCENARIO.shifts) {
    const id = randomUUID();
    const row = rosterShiftSchema.parse({ ref: `shift-row-${key}`, ...rest, assigned: [] });
    const slotted: Slotted = { id, row, holders: new Map() };
    holders.forEach((staffKey, i) =>
      slotted.holders.set(i + 1, { workerId: ids.staff[staffKey], assignmentId: randomUUID() }),
    );
    ownShifts.set(id, slotted);
    everyone.shifts.set(id, slotted);
    ids.shifts[key as ShiftKey] = id;
    refs.shifts[key as ShiftKey] = row.ref;
  }

  const people = faults.has("cross_firm") ? everyone.people : ownPeople;
  const shifts = faults.has("cross_firm") ? everyone.shifts : ownShifts;
  const cancelled: CancellationRecord[] = [];
  const refOf = (workerId: string) => everyone.people.get(workerId)?.ref ?? "unknown";
  const writes = opts.canWrite || faults.has("write_read_only");

  const plug: RosterPlug = {
    source: "native",
    canWrite: opts.canWrite,

    async listStaff() {
      return [...people.values()].map(({ id, ...person }) => ({
        ...person,
        ref: faults.has("ids_as_refs") ? id : person.ref,
        mobileE164: faults.has("bad_mobile") ? "07700 900701" : person.mobileE164,
        roles: [...person.roles],
      }));
    },

    async getShifts(from, to) {
      const window = shiftWindowSchema.parse({ from, to });
      return [...shifts.values()]
        .filter(
          (s) =>
            faults.has("ignore_window") ||
            (s.row.startsAt.getTime() >= window.from.getTime() &&
              s.row.startsAt.getTime() < window.to.getTime()),
        )
        .sort(
          (a, b) =>
            a.row.startsAt.getTime() - b.row.startsAt.getTime() ||
            a.row.ref.localeCompare(b.row.ref),
        )
        .map(({ row, holders }) => ({
          ...row,
          startsAt: new Date(row.startsAt),
          endsAt: new Date(row.endsAt),
          assigned: [...holders.entries()]
            .sort(([a], [b]) => a - b)
            .map(([slot, h]) => ({ slot, staffRef: refOf(h.workerId) })),
        }));
    },

    async assign(shiftId, workerId): Promise<AssignResult> {
      if (!writes) return { status: "needs_approval" };
      const s = shifts.get(shiftId);
      if (!s || !people.has(workerId)) return { status: "not_found" };
      if (s.row.status === "draft" || s.row.status === "cancelled") return { status: "not_open" };
      if ([...s.holders.values()].some((h) => h.workerId === workerId)) {
        return { status: "already_assigned" };
      }
      let slot = 1;
      while (slot <= s.row.headcount && s.holders.has(slot)) slot += 1;
      if (faults.has("double_assign")) slot = 1;
      else if (slot > s.row.headcount) return { status: "filled" };
      const assignmentId = randomUUID();
      s.holders.set(slot, { workerId, assignmentId });
      if (s.holders.size >= s.row.headcount) s.row.status = "filled";
      return { status: "assigned", assignmentId, slot };
    },

    async markCancelled(shiftId, workerId, input): Promise<CancelResult> {
      const cancel = faults.has("blank_reason") ? input : cancelInputSchema.parse(input);
      const now = opts.clock.now();
      if (cancel.at.getTime() > now.getTime() && !faults.has("future_at_ok")) {
        throw new Error("a cancellation can't be dated after the clock");
      }
      if (!writes) return { status: "needs_approval" };
      const s = shifts.get(shiftId);
      if (!s || !people.has(workerId)) return { status: "not_found" };
      const held = [...s.holders.entries()].find(([, h]) => h.workerId === workerId);
      if (!held) return { status: "not_assigned" };
      const [slot, holder] = held;
      s.holders.delete(slot);
      if (s.row.status === "filled" && !faults.has("stay_filled")) s.row.status = "open";
      const from = faults.has("notice_from_clock") ? now : cancel.at;
      const notice = faults.has("zero_notice") ? 0 : noticeHours(s.row.startsAt, from);
      cancelled.push({
        assignmentId: holder.assignmentId,
        staffRef: refOf(workerId),
        by: faults.has("ignore_by") ? "worker" : cancel.by,
        reason: faults.has("drop_reason") ? "" : cancel.reason,
        noticeHours: notice,
      });
      return { status: "cancelled", assignmentId: holder.assignmentId, noticeHours: notice };
    },
  };

  return { plug, ids, refs, cancellations: async () => cancelled.map((c) => ({ ...c })) };
}

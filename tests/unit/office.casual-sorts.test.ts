import { describe, expect, it } from "vitest";
import { CASUAL_SORTS, sortRows, type CasualRow } from "@/lib/office/casuals";
import { SORT_WORDS } from "@/lib/office/casuals-copy";
import type { Reliability } from "@/lib/rules/reliability";

// The Casuals list's sorts (Phase 26.7, cas-3; the claims-auditor's round 2): "By name" keeps the
// list's own order; "Least reliable first" (a figure before New); "Last worked longest ago" (never
// worked first of all); "Most strikes first". Each keeps the list's order among equals.

const figure = (percent: number): Reliability => ({
  kind: "figure",
  percent,
  band: percent >= 90 ? "green" : percent >= 75 ? "amber" : "red",
  counts: { worked: 9, noShows: 1, lateCancels: 0 },
});
const fresh: Reliability = {
  kind: "new",
  counted: 1,
  counts: { worked: 1, noShows: 0, lateCancels: 0 },
};

const row = (
  name: string,
  o: { reliability?: Reliability; lastWorked?: string | null; strikes?: number } = {},
): CasualRow => ({
  id: name,
  name,
  roles: ["steward"],
  status: "active",
  qualifications: [],
  travel: null,
  liveStrikes: o.strikes ?? 0,
  needs: [],
  rolesWithoutRule: [],
  photo: { status: "missing", current: null, waiting: null },
  record: {
    workerId: name,
    reliability: o.reliability ?? fresh,
    standing: { regular: false, reliable: false, cancelOften: false, notWorkedLately: false },
    lastWorked: o.lastWorked ? new Date(o.lastWorked) : null,
    weeksWorked: 0,
  },
  mobile: null,
  photoNeeds: false,
  remindAbout: null,
  lastReminder: null,
  sorted: null,
  note: null,
});

// By name (the list's own order).
const list = [
  row("Ann", { reliability: figure(95), lastWorked: "2026-10-30T10:00:00Z", strikes: 0 }),
  row("Ben", { reliability: fresh, lastWorked: null, strikes: 1 }),
  row("Cal", { reliability: figure(70), lastWorked: "2026-08-01T10:00:00Z", strikes: 2 }),
  row("Dee", { reliability: figure(70), lastWorked: "2026-09-15T10:00:00Z", strikes: 1 }),
  row("Eve", { reliability: figure(88), lastWorked: "2026-10-01T10:00:00Z", strikes: 0 }),
];
const names = (rows: CasualRow[]) => rows.map((r) => r.name);

describe("the Casuals list's sorts", () => {
  it("four, each with its words", () => {
    expect([...CASUAL_SORTS]).toEqual(["default", "least_reliable", "last_worked", "strikes"]);
    expect(SORT_WORDS).toEqual({
      default: "By name",
      least_reliable: "Least reliable first",
      last_worked: "Last worked longest ago",
      strikes: "Most strikes first",
    });
  });

  it("By name: the list as it is", () => {
    expect(names(sortRows(list, "default"))).toEqual(["Ann", "Ben", "Cal", "Dee", "Eve"]);
  });

  it("Least reliable first: the lowest figure first, New after every figure, ties in order", () => {
    expect(names(sortRows(list, "least_reliable"))).toEqual(["Cal", "Dee", "Eve", "Ann", "Ben"]);
  });

  it("Last worked longest ago: never worked first, then the oldest", () => {
    expect(names(sortRows(list, "last_worked"))).toEqual(["Ben", "Cal", "Dee", "Eve", "Ann"]);
  });

  it("Most strikes first: the most live strikes first, ties in order", () => {
    expect(names(sortRows(list, "strikes"))).toEqual(["Cal", "Ben", "Dee", "Ann", "Eve"]);
  });

  it("leaves the list it was given as it was", () => {
    sortRows(list, "strikes");
    expect(names(list)).toEqual(["Ann", "Ben", "Cal", "Dee", "Eve"]);
  });
});

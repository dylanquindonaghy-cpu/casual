import { describe, expect, it } from "vitest";
import { sessionBody, staffWorker } from "@/lib/connector/demo-portal";
import type { NameMap } from "@/lib/roster/names";

// The made-up portal's records (P5.3; src/lib/connector/demo-portal.ts), read and put in the planner
// API's body or a worker's, its role and staff-type names through the firm's name map (P3.2). Our
// own made-up field names and people only.

const names: NameMap = new Map([
  [
    "role",
    new Map([
      ["steward (day)", { code: "steward", payRatePence: 1260 }],
      ["holiday", { code: null, payRatePence: null }],
    ]),
  ],
  ["staff_type", new Map([["permanent", { code: null, payRatePence: null }]])],
]);

const session = (o: Record<string, unknown> = {}) => ({
  ref: "PORTAL-S1",
  site: { name: "Riverside Arena", postcode: "ZZ9 9ZZ" },
  role_name: "Steward (Day)",
  starts_at: "2026-11-07T08:00:00Z",
  ends_at: "2026-11-07T16:00:00Z",
  places: 2,
  status: "open",
  ...o,
});

const staff = (o: Record<string, unknown> = {}) => ({
  ref: "PORTAL-W1",
  first_name: "Ann",
  last_name: "Example",
  mobile: "+447700900123",
  role_names: ["Steward (Day)", "Holiday", "door supervisor"],
  status: "active",
  ...o,
});

describe("a session record", () => {
  it("in the planner API's body: its role through the map, the map's pay rate when it has none", () => {
    expect(sessionBody(session(), names)).toEqual({
      status: "ok",
      value: {
        site: { name: "Riverside Arena", postcode: "ZZ9 9ZZ" },
        role: "steward",
        starts_at: "2026-11-07T08:00:00Z",
        ends_at: "2026-11-07T16:00:00Z",
        places: 2,
        status: "open",
        pay_rate_pence: 1260,
      },
    });
    // Its own pay rate wins; a name the map doesn't have is read as normaliseRole() reads it.
    expect(sessionBody(session({ pay_rate_pence: 1300 }), names)).toMatchObject({
      value: { pay_rate_pence: 1300 },
    });
    expect(sessionBody(session({ role_name: "Door Supervisor" }), names)).toMatchObject({
      value: { role: "door_supervisor" },
    });
    expect(
      (sessionBody(session({ role_name: "Door Supervisor" }), names) as { value: object }).value,
    ).not.toHaveProperty("pay_rate_pence");
  });

  it("cancelled: nothing else of it, and the source's reason only if it gives one", () => {
    expect(
      sessionBody(session({ status: "cancelled", change_reason: "event_cancelled" }), names),
    ).toEqual({
      status: "ok",
      value: { status: "cancelled", change_reason: "event_cancelled" },
    });
    expect(sessionBody(session({ status: "cancelled" }), names)).toEqual({
      status: "ok",
      value: { status: "cancelled" },
    });
  });

  it("a role the map skips isn't brought in; one neither can read, or a record that isn't one, is refused", () => {
    expect(sessionBody(session({ role_name: "Holiday" }), names)).toEqual({ status: "skipped" });
    expect(sessionBody(session({ role_name: "!!!" }), names)).toEqual({
      status: "unreadable",
      code: "bad_role",
    });
    for (const bad of [
      null,
      "text",
      session({ places: "two" }),
      session({ status: "maybe" }),
      {},
    ]) {
      expect(sessionBody(bad, names)).toEqual({ status: "unreadable", code: "bad_record" });
    }
  });
});

describe("a staff record", () => {
  it("as a worker: roles through the map (a skipped one left off), mobile and status as given", () => {
    expect(staffWorker(staff(), names)).toEqual({
      status: "ok",
      value: {
        ref: "PORTAL-W1",
        firstName: "Ann",
        lastName: "Example",
        mobileE164: "+447700900123",
        roles: ["steward", "door_supervisor"],
        status: "active",
      },
    });
    expect(staffWorker(staff({ email: "ann@example.com" }), names)).toMatchObject({
      value: { email: "ann@example.com" },
    });
  });

  it("a staff type the map skips isn't brought in; a role neither can read, or a bad record, is refused", () => {
    expect(staffWorker(staff({ staff_type: "Permanent" }), names)).toEqual({ status: "skipped" });
    expect(staffWorker(staff({ staff_type: "Casual" }), names)).toMatchObject({ status: "ok" });
    expect(staffWorker(staff({ role_names: ["!!!"] }), names)).toEqual({
      status: "unreadable",
      code: "bad_role",
    });
    for (const bad of [
      staff({ mobile: "07700 900123" }),
      staff({ status: "blocked" }),
      staff({ ref: "a b" }),
    ]) {
      expect(staffWorker(bad, names)).toEqual({ status: "unreadable", code: "bad_record" });
    }
  });
});

import { describe, expect, it } from "vitest";
import { HOUR, MINUTE } from "@/lib/auth/clock";
import { connectorPullDue } from "@/lib/connector/cadence";

// When a connector's source is read in full (P5.4; src/lib/connector/cadence.ts): the next 48
// hours every 15 minutes, everything nightly in the firm's own time, backing off while failing.

const LONDON = "Europe/London";
const at = (iso: string) => new Date(iso);
const due = (o: {
  now: string;
  full?: string | null;
  near?: string | null;
  attempted?: string | null;
  failing?: boolean;
  zone?: string;
}) =>
  connectorPullDue({
    lastFullAt: o.full ? at(o.full) : null,
    lastNearAt: o.near ? at(o.near) : null,
    lastAttemptedAt: o.attempted ? at(o.attempted) : null,
    failing: o.failing ?? false,
    now: at(o.now),
    timeZone: o.zone ?? LONDON,
  });

describe("the reconcile pull's cadence", () => {
  it("never read in full: a full pull at once, whatever the hour", () => {
    expect(due({ now: "2026-11-02T14:00:00Z" })).toBe("full");
  });

  it("the next 48 hours every 15 minutes (a full pull counts as one)", () => {
    const full = "2026-11-02T03:00:00Z";
    expect(due({ now: "2026-11-02T03:10:00Z", full })).toBeNull();
    expect(due({ now: "2026-11-02T03:15:00Z", full })).toBe("near");
    expect(due({ now: "2026-11-02T10:14:00Z", full, near: "2026-11-02T10:00:00Z" })).toBeNull();
    expect(due({ now: "2026-11-02T10:15:00Z", full, near: "2026-11-02T10:00:00Z" })).toBe("near");
  });

  it("everything once a night, between 02:00 and 05:00 in the firm's time", () => {
    const full = "2026-11-02T03:00:00Z"; // last night's
    const near = "2026-11-03T01:50:00Z";
    expect(due({ now: "2026-11-03T01:59:00Z", full, near })).toBeNull(); // 01:59 London (GMT)
    expect(due({ now: "2026-11-03T02:00:00Z", full, near })).toBe("full");
    // Once that night: a full pull at 02:00 isn't followed by another at 03:00.
    expect(due({ now: "2026-11-03T03:00:00Z", full: "2026-11-03T02:00:00Z", near })).toBe("near");
    // In summer time the night is an hour earlier in UTC.
    expect(
      due({
        now: "2026-07-03T01:00:00Z",
        full: "2026-07-02T01:00:00Z",
        near: "2026-07-03T00:50:00Z",
      }),
    ).toBe("full");
    // Another firm's zone, its own night.
    expect(
      due({
        now: "2026-11-03T02:00:00Z",
        full,
        near,
        zone: "America/New_York",
      }),
    ).toBeNull();
  });

  it("over 26 hours without a full pull: one now, whatever the hour", () => {
    const now = at("2026-11-03T14:00:00Z");
    const full = new Date(now.getTime() - 26 * HOUR).toISOString();
    const near = new Date(now.getTime() - 5 * MINUTE).toISOString();
    expect(due({ now: now.toISOString(), full, near })).toBe("full");
  });

  it("while failing: every 30 minutes, not every 15", () => {
    const full = "2026-11-02T03:00:00Z";
    const near = "2026-11-02T09:00:00Z";
    const attempted = "2026-11-02T10:00:00Z";
    expect(due({ now: "2026-11-02T10:20:00Z", full, near, attempted, failing: true })).toBeNull();
    expect(due({ now: "2026-11-02T10:30:00Z", full, near, attempted, failing: true })).toBe("near");
    // Not failing, the same times: due at once.
    expect(due({ now: "2026-11-02T10:20:00Z", full, near, attempted })).toBe("near");
  });
});

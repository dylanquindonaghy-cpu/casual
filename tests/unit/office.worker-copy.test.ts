import { describe, expect, it } from "vitest";
import { eventWords, type Names } from "@/lib/office/event-words";
import { keepResultText, toCheckText } from "@/lib/office/today-copy";
import { signOutResultText, siteBlockResultText, statusResultText } from "@/lib/office/worker-copy";

// A worker's page in the office (src/lib/office/worker-copy.ts), the dashboard's "Bookings to
// check" (src/lib/office/today-copy.ts) and the changes in the action log (event-words.ts), word
// for word as docs/screens.md gives them.

const name = "Ann Booker";

describe("a worker's page", () => {
  it("making inactive, active again, unblocking", () => {
    const done = (
      change: "deactivate" | "reactivate" | "unblock",
      futureBookings = 0,
      now: "active" | "inactive" = change === "deactivate" ? "inactive" : "active",
    ) => statusResultText({ status: "done", change, name, futureBookings, now });
    expect(done("deactivate")).toBe(
      "Ann Booker is now inactive. They've been logged out, and can't log in or take shifts.",
    );
    expect(done("deactivate", 1)).toBe(
      "Ann Booker is now inactive. They've been logged out, and can't log in or take shifts. They're booked on 1 shift ahead: it's on the dashboard to cancel or keep.",
    );
    expect(done("deactivate", 3)).toBe(
      "Ann Booker is now inactive. They've been logged out, and can't log in or take shifts. They're booked on 3 shifts ahead: they're on the dashboard to cancel or keep.",
    );
    expect(done("reactivate")).toBe(
      "Ann Booker is active again. They log in with a new link. If your rota sheet or a staff file you import says they're inactive, change it there too, or the next sync or import makes them inactive again.",
    );
    expect(done("unblock")).toBe(
      "Ann Booker is unblocked and active again. If they're blocked in your rota sheet or a staff file you import, change it there too, or the next sync or import blocks them again.",
    );
    // The office had made them inactive before a sheet blocked them: they stay inactive.
    expect(done("unblock", 0, "inactive")).toBe(
      "Ann Booker is unblocked, but still inactive: the office made them inactive. If they're back, use Make active again. If they're blocked in your rota sheet or a staff file you import, change it there too, or the next sync or import blocks them again.",
    );
  });

  it("a change that doesn't apply to their status says what it is", () => {
    const same = (
      change: "deactivate" | "reactivate" | "unblock",
      current: "active" | "inactive" | "blocked",
    ) => statusResultText({ status: "unchanged", change, name, current });
    expect(same("deactivate", "inactive")).toBe("Ann Booker is already inactive.");
    expect(same("reactivate", "active")).toBe("Ann Booker is already active.");
    expect(same("deactivate", "blocked")).toBe(
      "Ann Booker is blocked, so they can't take shifts already.",
    );
    expect(same("reactivate", "blocked")).toBe("Ann Booker is blocked: use Unblock instead.");
    expect(same("unblock", "active")).toBe("Ann Booker isn't blocked.");
    expect(same("unblock", "inactive")).toBe("Ann Booker isn't blocked.");
  });

  it("log out on every device, and the sites", () => {
    expect(signOutResultText({ status: "done", name, sessionsEnded: 2, loggedIn: true })).toBe(
      "Ann Booker has been logged out on every device. Notifications are off on their phones until they turn them on again.",
    );
    // Only phones' notifications to turn off.
    expect(signOutResultText({ status: "done", name, sessionsEnded: 0, loggedIn: false })).toBe(
      "Ann Booker wasn't logged in anywhere. Notifications are off on their phones until they turn them on again.",
    );
    expect(
      signOutResultText({ status: "unchanged", name, sessionsEnded: 0, loggedIn: false }),
    ).toBe("Ann Booker wasn't logged in anywhere.");
    const site = (status: "done" | "unchanged", kind: "block" | "unblock", futureBookings = 0) =>
      siteBlockResultText({ status, name, site: "Riverside Arena", futureBookings }, kind);
    expect(site("done", "block")).toBe("Ann Booker can't work at Riverside Arena now.");
    expect(site("done", "block", 2)).toBe(
      "Ann Booker can't work at Riverside Arena now. They're booked there on 2 shifts ahead: they're on the dashboard to cancel or keep.",
    );
    expect(site("unchanged", "block")).toBe("Ann Booker is already blocked from Riverside Arena.");
    expect(site("done", "unblock")).toBe("Ann Booker can work at Riverside Arena again.");
    expect(site("unchanged", "unblock")).toBe("Ann Booker wasn't blocked from Riverside Arena.");
  });

  it("refusals, and what went wrong", () => {
    expect(statusResultText({ status: "not_found" })).toBe("That worker isn't on your books.");
    expect(statusResultText({ status: "not_allowed" })).toBe("You can't change workers' access.");
    expect(statusResultText({ status: "erased" })).toBe(
      "This worker's details were deleted: there's nothing to change.",
    );
    expect(statusResultText({ status: "no_reason" })).toBe("Choose a reason.");
    expect(siteBlockResultText({ status: "no_site" }, "block")).toBe(
      "That site isn't there any more.",
    );
    expect(signOutResultText({ status: "logged_out" })).toBe(
      "Your session has ended. Log in again.",
    );
    expect(statusResultText({ status: "error" })).toBe(
      "Something went wrong. Nothing was changed. Try again.",
    );
    expect(statusResultText({ status: "unknown" })).toBe(
      "Something went wrong. Reload the page to see if it changed.",
    );
  });
});

describe("the dashboard's bookings to check", () => {
  const b = {
    shiftId: "s1",
    workerId: "w1",
    worker: name,
    role: "steward",
    site: "Riverside Arena",
    startsAt: new Date("2026-11-04T09:00:00Z"),
    endsAt: new Date("2026-11-04T17:00:00Z"),
  };
  it("says why each is there", () => {
    expect(toCheckText({ ...b, cause: "inactive" })).toBe(
      "Ann Booker is booked, but is no longer active.",
    );
    expect(toCheckText({ ...b, cause: "blocked" })).toBe("Ann Booker is booked, but is blocked.");
    expect(toCheckText({ ...b, cause: "site_blocked" })).toBe(
      "Ann Booker is booked, but is blocked from Riverside Arena.",
    );
  });

  it("keeping one", () => {
    expect(keepResultText({ status: "kept", name, cause: "site_blocked" }, name)).toBe(
      "Kept. Ann Booker's booking stays, and it won't show here again unless something changes.",
    );
    expect(keepResultText({ status: "kept", name, cause: "inactive" }, name)).toBe(
      "Kept. Ann Booker's booking stays, and it won't show here again unless something changes. They can't log in and get no reminders: tell them yourself.",
    );
    expect(keepResultText({ status: "already", name }, name)).toBe(
      "Ann Booker's booking was already kept.",
    );
    expect(keepResultText({ status: "not_flagged", name }, name)).toBe(
      "Ann Booker's booking doesn't need checking any more.",
    );
    expect(keepResultText({ status: "not_found" }, name)).toBe(
      "Ann Booker's booking isn't there any more (cancelled, or the shift has started).",
    );
    expect(keepResultText({ status: "error" }, name)).toBe(
      "Something went wrong. Reload the page to see if it was kept.",
    );
  });
});

describe("the changes in the action log", () => {
  const names: Names = {
    worker: (id) => (id === "w1" ? name : "Someone"),
    office: (id) => (id === "o1" ? "Sam Rota" : "The office"),
    site: (id) => (id === "x1" ? "Riverside Arena" : "a site"),
  };
  const ev = (action: string, data: Record<string, unknown>) =>
    eventWords(
      { action, actorType: "office", actorId: "o1", data: { workerId: "w1", ...data } },
      names,
    );

  it("names who, whom, the reason and the site", () => {
    expect(ev("worker.deactivated", { reason: "left", futureBookings: 2 })).toBe(
      "Sam Rota made Ann Booker inactive. Reason: They've left. 2 bookings ahead to check.",
    );
    expect(ev("worker.reactivated", { reason: "back" })).toBe(
      "Sam Rota made Ann Booker active again. Reason: They're back.",
    );
    expect(ev("worker.unblocked", { reason: "mistake" })).toBe(
      "Sam Rota unblocked Ann Booker. Reason: Blocked by mistake.",
    );
    expect(ev("worker.unblocked", { reason: "sorted", stillInactive: true })).toBe(
      "Sam Rota unblocked Ann Booker. Reason: The problem is sorted. They stay inactive: the office had made them inactive.",
    );
    expect(
      ev("worker.site_blocked", { siteId: "x1", reason: "client_asked", futureBookings: 1 }),
    ).toBe(
      "Sam Rota blocked Ann Booker from Riverside Arena. Reason: The client asked. 1 booking ahead to check.",
    );
    expect(ev("worker.site_unblocked", { siteId: "x1", reason: "client_ok" })).toBe(
      "Sam Rota unblocked Ann Booker from Riverside Arena. Reason: The client is happy for them to work there.",
    );
    expect(ev("worker.signed_out", { sessionsEnded: 1, linksSpent: 0 })).toBe(
      "Sam Rota logged Ann Booker out on every device.",
    );
    expect(ev("worker.signed_out", { sessionsEnded: 0, linksSpent: 0, devicesForgotten: 1 })).toBe(
      "Sam Rota turned off notifications on Ann Booker's phones.",
    );
    expect(ev("booking.kept", { shiftId: "s1", cause: "site_blocked" })).toBe(
      "Sam Rota kept Ann Booker's booking, though they're blocked from the site.",
    );
  });
});

import { describe, expect, it } from "vitest";
import { eventWords, type Names } from "@/lib/office/event-words";
import { teamResultText } from "@/lib/office/team-copy";

// The office team page in plain words (src/lib/office/team-copy.ts, as docs/screens.md
// `/office/team` gives them) and its changes in the action log (src/lib/office/event-words.ts).

const name = "Sam Rota";

describe("the office team page's answers", () => {
  it("says what happened, for each change", () => {
    const done = (change: "disable" | "enable" | "role" | "sign_out", role = "resourcer") =>
      teamResultText({
        status: "done",
        change,
        name,
        role: role as "resourcer",
        sessionsEnded: 1,
      });
    expect(done("disable")).toBe(
      "Sam Rota's access is off. They've been logged out everywhere and can't log in until it's turned back on.",
    );
    expect(done("enable")).toBe("Sam Rota can log in again. They'll need a new login link.");
    expect(done("role", "payroll")).toBe(
      "Sam Rota is now Payroll. This applies from their next page.",
    );
    expect(done("sign_out")).toBe(
      "Sam Rota has been logged out on every device. They can log in again with a new link.",
    );
  });

  it("says when nothing needed changing", () => {
    const same = (change: "disable" | "enable" | "role" | "sign_out") =>
      teamResultText({ status: "unchanged", change, name, role: "admin" });
    expect(same("disable")).toBe("Sam Rota's access is already off.");
    expect(same("enable")).toBe("Sam Rota can already log in.");
    expect(same("role")).toBe("Sam Rota is already Admin.");
    expect(same("sign_out")).toBe("Sam Rota wasn't logged in anywhere.");
  });

  it("says why when it refuses, and that nothing changed when it fails", () => {
    expect(teamResultText({ status: "last_admin", name })).toBe(
      "Sam Rota is the only admin. Make someone else an admin first.",
    );
    expect(teamResultText({ status: "self" })).toBe(
      "You can't change your own access. Ask another admin.",
    );
    expect(teamResultText({ status: "not_found" })).toBe("That person isn't on your office team.");
    expect(teamResultText({ status: "not_allowed" })).toBe(
      "Only admins can change the office team.",
    );
    expect(teamResultText({ status: "logged_out" })).toBe("Your session has ended. Log in again.");
    expect(teamResultText({ status: "error" })).toBe(
      "Something went wrong. Nothing was changed. Try again.",
    );
    // The browser's request failed: the server may have finished.
    expect(teamResultText({ status: "unknown" })).toBe(
      "Something went wrong. Reload the page to see if it changed.",
    );
  });
});

describe("the changes in the action log", () => {
  const names: Names = {
    worker: () => "Someone",
    office: (id) => (id === "o1" ? "Ann Admin" : id === "o2" ? "Sam Rota" : "The office"),
  };
  const ev = (action: string, data: Record<string, unknown>, actorType = "office") =>
    eventWords(
      {
        action,
        actorType,
        actorId: actorType === "office" ? "o1" : null,
        data: { officeUserId: "o2", ...data },
      },
      names,
    );

  it("names the admin and the person", () => {
    expect(ev("office_user.disabled", { role: "resourcer", sessionsEnded: 2 })).toBe(
      "Ann Admin turned off Sam Rota's office access. They were logged out everywhere.",
    );
    expect(ev("office_user.enabled", {})).toBe(
      "Ann Admin turned Sam Rota's office access back on.",
    );
    expect(ev("office_user.role_changed", { from: "resourcer", to: "payroll" })).toBe(
      "Ann Admin changed Sam Rota's office role from Resourcer to Payroll.",
    );
    expect(ev("office_user.signed_out", { sessionsEnded: 1 })).toBe(
      "Ann Admin logged Sam Rota out of the office on every device.",
    );
  });

  it("from the command line (the system): in the passive", () => {
    expect(ev("office_user.disabled", { sessionsEnded: 1, linksSpent: 0 }, "system")).toBe(
      "Sam Rota's office access was turned off. They were logged out everywhere.",
    );
    // Not logged in anywhere: nothing to say about logging out.
    expect(ev("office_user.disabled", { sessionsEnded: 0, linksSpent: 0 }, "system")).toBe(
      "Sam Rota's office access was turned off.",
    );
    expect(ev("office_user.enabled", {}, "system")).toBe(
      "Sam Rota's office access was turned back on.",
    );
    expect(ev("office_user.role_changed", { from: "admin", to: "resourcer" }, "system")).toBe(
      "Sam Rota's office role was changed from Admin to Resourcer.",
    );
    expect(ev("office_user.signed_out", {}, "system")).toBe(
      "Sam Rota was logged out of the office on every device.",
    );
  });
});

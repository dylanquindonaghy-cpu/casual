import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventWords } from "@/lib/office/event-words";
import {
  ALL_LOGGED_ACTIONS,
  isLogType,
  LOG_TYPE_KEYS,
  LOG_TYPES,
  logTypeLabel,
} from "@/lib/office/log-types";

// The action log (docs/screens.md `/office/log`) shows every event the app records, each in a plain
// group for the "type" filter (src/lib/office/log-types.ts) and in plain words
// (src/lib/office/event-words.ts). This test reads the code for every action name it records and
// fails if one has no group or no words, so a new kind of event can't slip past the office.

const ROOT = join(process.cwd(), "src");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

// Every "word.word" string in the code. Today each one is an event kind; a new string of this shape
// that isn't one must be listed in NOT_EVENTS here on purpose.
const ACTION = /"([a-z_]+\.[a-z_]+)"/g;
const NOT_EVENTS = new Set<string>([]);
const recorded = new Set(
  sourceFiles(ROOT)
    .filter((path) => !path.endsWith("log-types.ts") && !path.endsWith("event-words.ts"))
    .flatMap((path) => [...readFileSync(path, "utf8").matchAll(ACTION)].map((m) => m[1] ?? ""))
    .filter((action) => !NOT_EVENTS.has(action)),
);

const names = {
  worker: () => "Ann Booker",
  office: () => "Sam Rota",
  credential: () => "SIA door supervisor licence",
};

describe("the action log's types and words", () => {
  it("every action the code records is in exactly one group", () => {
    expect(recorded.size).toBeGreaterThan(50);
    const missing = [...recorded].filter((a) => !ALL_LOGGED_ACTIONS.includes(a));
    expect(missing).toEqual([]);
    const all = LOG_TYPE_KEYS.flatMap((key) => [...LOG_TYPES[key].actions]);
    expect(all.length).toBe(new Set(all).size);
  });

  it("no group lists an action the code never records", () => {
    expect(ALL_LOGGED_ACTIONS.filter((a) => !recorded.has(a))).toEqual([]);
  });

  it.each([...ALL_LOGGED_ACTIONS])("%s has plain words", (action) => {
    const text = eventWords({ action, actorType: "office", actorId: "o", data: {} }, names);
    expect(text).not.toMatch(/^Recorded:/);
    expect(text).toMatch(/[.:]$/);
    expect(text).not.toMatch(/undefined|null|\[object/);
  });

  it("some words, as the log shows them", () => {
    const say = (action: string, data: Record<string, unknown> = {}, actorType = "system") =>
      eventWords({ action, actorType, actorId: "a", data }, names);
    expect(say("auth.login", {}, "worker")).toBe("Ann Booker logged in.");
    expect(say("auth.login", {}, "office")).toBe("Sam Rota logged in.");
    expect(say("auth.link_rejected", { reason: "expired" })).toBe(
      "A login link was refused: it had run out.",
    );
    expect(say("auth.otp_failed", { attemptsLeft: 2 }, "worker")).toBe(
      "Ann Booker typed a wrong code (2 tries left).",
    );
    expect(say("request.approved", { type: "time_change", withNote: true }, "office")).toBe(
      "Sam Rota approved Ann Booker's request (time change), with a note.",
    );
    expect(say("request.created", { type: "swap" }, "worker")).toBe(
      "Ann Booker sent a request (swap).",
    );
    expect(say("credential.expired", { type: "SIA_DS", notified: true })).toBe(
      "Ann Booker's SIA door supervisor licence has expired: they were told.",
    );
    expect(say("credential.expired", { type: "SIA_DS", notified: false })).toBe(
      "Ann Booker's SIA door supervisor licence has expired.",
    );
    expect(say("worker.unavailable_added", { day: "2026-11-04" }, "worker")).toBe(
      "Ann Booker marked a day off (Wed 4 Nov).",
    );
    // No name when the event can't say whose it was (a login link for an unknown number).
    expect(say("auth.link_requested", { kind: "worker", matched: true })).toBe(
      "A worker asked for a login link.",
    );
    expect(say("auth.link_requested", { kind: "worker", matched: true, workerId: "w" })).toBe(
      "Ann Booker asked for a login link.",
    );
    expect(say("auth.link_requested", { kind: "worker", matched: false })).toBe(
      "A login link was asked for (a number we don't know).",
    );
    expect(say("auth.otp_sent")).toBe("A pay-page code was sent.");
    expect(say("roster.sheet_conflict", { holderNotInSheet: true })).toBe(
      "Someone booked on this shift in the app isn't in the rota sheet's staff list.",
    );
    expect(say("roster.sheet_conflict", { notBooked: 1 })).toBe(
      "The rota sheet names someone the app couldn't book on this shift.",
    );
    expect(
      say("pay_record.imported", {
        workerId: "w",
        periodStart: "2026-10-26",
        periodEnd: "2026-11-01",
      }),
    ).toBe("A pay record was added for Ann Booker (Mon 26 Oct to Sun 1 Nov).");
    expect(say("import.completed", { created: 3, updated: 1, skipped: 0 }, "office")).toBe(
      "Sam Rota imported a file: 3 added, 1 changed, 0 skipped.",
    );
    expect(say("roster.synced", { shifts: 12 })).toBe("The rota sheet was read (12 shifts).");
    expect(say("shift.status_changed", { from: "open", to: "cancelled" })).toBe(
      "The rota sheet changed it from open to cancelled.",
    );
  });

  it("group labels, and checking a type from the page's query", () => {
    expect(logTypeLabel("shift.cancelled")).toBe("Cancellations");
    expect(logTypeLabel("offer.sent")).toBe("Offers");
    expect(logTypeLabel("something.new")).toBe("Other");
    expect(isLogType("offers")).toBe(true);
    expect(isLogType("toString")).toBe(false);
    expect(isLogType("")).toBe(false);
  });
});

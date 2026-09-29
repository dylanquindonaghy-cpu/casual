import { describe, expect, it } from "vitest";
import {
  reminderPush,
  shiftReminder24hMessage,
  shiftReminder2hMessage,
} from "@/lib/messaging/templates";

// Shift reminder copy (docs/messaging-templates.md: shift_reminder_24h, shift_reminder_2h and the
// reminder push). Every message ends with the firm's sign-off, never a person's name.

const voice = { name: "Acme Events", signOff: "Acme Events Shift Team" };

describe("shift_reminder_24h", () => {
  it("the day, times, the site if there is one, the link, how to cancel, the sign-off", () => {
    expect(
      shiftReminder24hMessage(voice, {
        site: "Acme Demo Arena",
        day: "tomorrow",
        start: "08:00",
        end: "16:00",
        link: "https://acme.example/shifts/1",
      }),
    ).toBe(
      "Reminder: tomorrow 08:00–16:00 at Acme Demo Arena. Details: https://acme.example/shifts/1. Can't make it? Cancel in the app as early as you can. — Acme Events Shift Team",
    );
    expect(
      shiftReminder24hMessage(voice, {
        site: null,
        day: "today",
        start: "19:00",
        end: "03:00",
        link: "L",
      }),
    ).toBe(
      "Reminder: today 19:00–03:00. Details: L. Can't make it? Cancel in the app as early as you can. — Acme Events Shift Team",
    );
  });
});

describe("shift_reminder_2h", () => {
  it("the site if there is one, the start, the link to the instructions, the sign-off", () => {
    expect(
      shiftReminder2hMessage(voice, { site: "Acme Demo Arena", start: "08:00", link: "L" }),
    ).toBe(
      "Your shift at Acme Demo Arena starts at 08:00. Meeting point and instructions: L. — Acme Events Shift Team",
    );
    expect(shiftReminder2hMessage(voice, { site: null, start: "08:00", link: "L" })).toBe(
      "Your shift starts at 08:00. Meeting point and instructions: L. — Acme Events Shift Team",
    );
  });
});

describe("the reminder push", () => {
  it("24h: 'Tomorrow: {site}' / '{start}–{end}. Tap for instructions.'", () => {
    expect(
      reminderPush({
        kind: "24h",
        site: "Acme Demo Arena",
        day: "tomorrow",
        start: "08:00",
        end: "16:00",
      }),
    ).toEqual({ title: "Tomorrow: Acme Demo Arena", body: "08:00–16:00. Tap for instructions." });
  });

  it("2h: 'Today: {site}' / 'Starts at {start}. Tap for instructions.'; no site: 'your shift'", () => {
    expect(
      reminderPush({ kind: "2h", site: null, day: "today", start: "08:00", end: "16:00" }),
    ).toEqual({ title: "Today: your shift", body: "Starts at 08:00. Tap for instructions." });
  });
});

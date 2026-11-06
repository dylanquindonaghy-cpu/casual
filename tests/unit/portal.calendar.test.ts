import { describe, expect, it } from "vitest";
import {
  calendarFileName,
  foldLine,
  icsText,
  icsTime,
  shiftCalendar,
  type CalendarShift,
} from "@/lib/portal/calendar";

// "Add to my calendar" (Phase 28.5; docs/screens.md "The casual app, Phase 28" 28.5;
// docs/api-and-jobs.md `GET /shifts/{id}/calendar`): the iCalendar file (RFC 5545) for one booked
// shift. Only the role and the firm, the times in UTC, the site and its address, and a link back:
// never pay or instructions. A stable UID per booking, so adding it again replaces the entry.

const ASSIGNMENT = "22222222-2222-4222-8222-222222222222";
const SHIFT = "11111111-1111-4111-8111-111111111111";
const base: CalendarShift = {
  assignmentId: ASSIGNMENT,
  role: "door_supervisor",
  firmName: "Acme Events",
  // Sat 7 Nov 2026, 14:00 to 22:00 London (GMT): the same in UTC.
  startsAt: new Date("2026-11-07T14:00:00Z"),
  endsAt: new Date("2026-11-07T22:00:00Z"),
  site: {
    name: "Demo Arena",
    addressLine1: "1 Test Road",
    addressLine2: null,
    town: "Leeds",
    postcode: "LS1 1AA",
  },
  link: `https://acme.example/shifts/${SHIFT}`,
  sequence: 0,
  stamp: new Date("2026-11-02T09:00:00Z"),
};

// The file's logical lines: unfolded (a CRLF and one space join a folded line), split on CRLF.
const unfolded = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

describe("the shift's calendar file", () => {
  it("one VEVENT in a VCALENDAR, CRLF line ends, the times in UTC ending in Z", () => {
    const ics = shiftCalendar(base);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/); // no bare line breaks
    const lines = unfolded(ics);
    expect(lines.slice(0, 2)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0"]);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1);
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(lines).toContain("DTSTART:20261107T140000Z");
    expect(lines).toContain("DTEND:20261107T220000Z");
    expect(lines).toContain("DTSTAMP:20261102T090000Z");
    // In summer time the UTC time is an hour before London's.
    const summer = unfolded(
      shiftCalendar({
        ...base,
        startsAt: new Date("2026-07-04T09:00:00Z"),
        endsAt: new Date("2026-07-04T17:30:00Z"),
      }),
    );
    expect(summer).toContain("DTSTART:20260704T090000Z");
    expect(summer).toContain("DTEND:20260704T173000Z");
    expect(icsTime(new Date("2026-11-07T14:00:00.123Z"))).toBe("20261107T140000Z");
  });

  it("the role and the firm, the site and its address, and the link back to the shift", () => {
    const lines = unfolded(shiftCalendar(base));
    expect(lines).toContain("SUMMARY:Door supervisor · Acme Events");
    expect(lines).toContain("LOCATION:Demo Arena\\, 1 Test Road\\, Leeds\\, LS1 1AA");
    expect(lines).toContain(`URL:https://acme.example/shifts/${SHIFT}`);
    expect(lines).toContain(`DESCRIPTION:Your shift: https://acme.example/shifts/${SHIFT}`);
    // No site: no LOCATION line, never "null".
    const nowhere = shiftCalendar({ ...base, site: null });
    expect(nowhere).not.toContain("LOCATION");
    expect(nowhere).not.toMatch(/null|undefined/);
  });

  it("a stable UID per booking, whatever else changes; SEQUENCE counts the moves", () => {
    const uid = (ics: string) => unfolded(ics).find((l) => l.startsWith("UID:"));
    const first = shiftCalendar(base);
    const moved = shiftCalendar({
      ...base,
      startsAt: new Date("2026-11-07T16:00:00Z"),
      endsAt: new Date("2026-11-08T00:00:00Z"),
      sequence: 1,
      stamp: new Date("2026-11-03T12:00:00Z"),
    });
    expect(uid(first)).toBe(`UID:shift-booking-${ASSIGNMENT}`);
    expect(uid(moved)).toBe(uid(first));
    expect(unfolded(first)).toContain("SEQUENCE:0");
    expect(unfolded(moved)).toContain("SEQUENCE:1");
    expect(
      uid(shiftCalendar({ ...base, assignmentId: "33333333-3333-4333-8333-333333333333" })),
    ).not.toBe(uid(first));
  });

  it("escapes commas, semicolons, backslashes and line breaks in text", () => {
    expect(icsText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
    const lines = unfolded(
      shiftCalendar({
        ...base,
        firmName: "Smith; Jones, & Co",
        site: { ...base.site!, name: "Hall 2; North, East" },
      }),
    );
    expect(lines).toContain("SUMMARY:Door supervisor · Smith\\; Jones\\, & Co");
    expect(lines.find((l) => l.startsWith("LOCATION:"))).toBe(
      "LOCATION:Hall 2\\; North\\, East\\, 1 Test Road\\, Leeds\\, LS1 1AA",
    );
  });

  it("folds lines at 75 octets, never splitting a character", () => {
    const long = shiftCalendar({
      ...base,
      site: {
        name: "The Very Long Name Of A Riverside Exhibition And Conference Centre — North Hall",
        addressLine1: "Unit 14, The Old Granary Buildings, Riverside Industrial Estate",
        addressLine2: "Off Station Approach",
        town: "Kingston upon Hull",
        postcode: "HU1 1AA",
      },
    });
    const physical = long.split("\r\n").filter((l) => l !== "");
    const bytes = (l: string) => new TextEncoder().encode(l).length;
    for (const line of physical) expect(bytes(line), line).toBeLessThanOrEqual(75);
    expect(physical.some((l) => l.startsWith(" "))).toBe(true); // something was folded
    // Unfolded, it reads as it was.
    expect(unfolded(long).find((l) => l.startsWith("LOCATION:"))).toBe(
      "LOCATION:The Very Long Name Of A Riverside Exhibition And Conference Centre — North Hall\\, Unit 14\\, The Old Granary Buildings\\, Riverside Industrial Estate\\, Off Station Approach\\, Kingston upon Hull\\, HU1 1AA",
    );
    // A multi-byte character at the edge moves whole to the next line.
    const edge = foldLine(`${"x".repeat(74)}é${"y".repeat(10)}`);
    const [head, tail] = edge.split("\r\n");
    expect(head).toBe("x".repeat(74));
    expect(tail).toBe(` é${"y".repeat(10)}`);
    expect(foldLine("short")).toBe("short");
  });

  it("holds no pay, no instructions and nobody else", () => {
    const ics = shiftCalendar(base);
    expect(ics).not.toMatch(/pay/i);
    expect(ics).not.toContain("£");
    expect(ics).not.toMatch(/instruction|meet at|gate|uniform|hi-vis/i);
    // Only these properties, in this order.
    expect(unfolded(ics).map((l) => l.split(":")[0])).toEqual([
      "BEGIN",
      "VERSION",
      "PRODID",
      "CALSCALE",
      "METHOD",
      "BEGIN",
      "UID",
      "SEQUENCE",
      "DTSTAMP",
      "DTSTART",
      "DTEND",
      "SUMMARY",
      "LOCATION",
      "URL",
      "DESCRIPTION",
      "STATUS",
      "TRANSP",
      "END",
      "END",
      "",
    ]);
  });

  it("is named by the day it starts, in the firm's time zone", () => {
    expect(calendarFileName(new Date("2026-11-07T14:00:00Z"), "Europe/London")).toBe(
      "shift-2026-11-07.ics",
    );
    // 23:30 UTC on 4 July is 00:30 on 5 July in London.
    expect(calendarFileName(new Date("2026-07-04T23:30:00Z"), "Europe/London")).toBe(
      "shift-2026-07-05.ics",
    );
  });
});

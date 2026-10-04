import { describe, expect, it } from "vitest";
import {
  cellRange,
  columnIndex,
  columnLetters,
  columnRange,
  parseRange,
  quoteTab,
} from "@/lib/roster/sheets/a1";
import { DEFAULT_SHEET_MAPPING, sheetMappingSchema } from "@/lib/roster/sheets/mapping";
import {
  normaliseRole,
  parseSheet,
  parseSheetDate,
  parseSheetTime,
  SheetLayoutError,
} from "@/lib/roster/sheets/parse";
import { SHIFT_HEADER, shiftRow, STAFF_HEADER, staffRow } from "../helpers/fake-sheets";

// A firm's sheet (cell text) to RosterStaff / RosterShift, with bad rows reported by row number
// and a code only.

const LONDON = "Europe/London";
const staff = [
  staffRow({
    ref: "N001",
    first: "Ada",
    last: "Example",
    mobile: "07700 900301",
    roles: "Track Operative, COSS",
  }),
  staffRow({
    ref: "N002",
    first: "Ben",
    last: "Example",
    mobile: "+44 7700 900302",
    roles: "track_operative",
    status: "Inactive",
  }),
];
const shifts = [
  shiftRow({
    ref: "P1",
    date: "07/11/2026",
    start: "22:00",
    end: "06:00",
    site: "Demo Junction",
    role: "track operative",
    needed: "2",
    assigned: "N001",
  }),
  shiftRow({
    ref: "P2",
    date: "2027-06-14",
    start: "09:30",
    end: "17:30",
    role: "COSS",
    assigned: "",
  }),
];
const parse = (s = staff, h = shifts) =>
  parseSheet(
    { staffRows: [STAFF_HEADER, ...s], shiftRows: [SHIFT_HEADER, ...h] },
    DEFAULT_SHEET_MAPPING,
    LONDON,
  );

describe("parseSheet: good rows", () => {
  it("reads staff: numbers to E.164, roles to snake_case, a blank status as active", () => {
    expect(parse().staff).toEqual([
      {
        ref: "N001",
        firstName: "Ada",
        lastName: "Example",
        mobileE164: "+447700900301",
        roles: ["track_operative", "coss"],
        status: "active",
        row: 2,
      },
      {
        ref: "N002",
        firstName: "Ben",
        lastName: "Example",
        mobileE164: "+447700900302",
        roles: ["track_operative"],
        status: "inactive",
        row: 3,
      },
    ]);
  });

  it("reads shifts in London time to UTC; a night shift ends the next day; holders in slot order", () => {
    const [night, summer] = parse().shifts;
    expect(night).toMatchObject({
      ref: "P1",
      siteName: "Demo Junction",
      role: "track_operative",
      headcount: 2,
      status: "open",
      assigned: [{ slot: 1, staffRef: "N001" }],
      holdersReadable: true,
      row: 2,
    });
    expect(night?.startsAt.toISOString()).toBe("2026-11-07T22:00:00.000Z");
    expect(night?.endsAt.toISOString()).toBe("2026-11-08T06:00:00.000Z");
    // June is BST: 09:30 in London is 08:30 UTC. A blank "Needed" means 1.
    expect(summer).toMatchObject({ siteName: null, headcount: 1, status: "open", assigned: [] });
    expect(summer?.startsAt.toISOString()).toBe("2027-06-14T08:30:00.000Z");
  });

  it("finds columns by header text in any order and any case", () => {
    const shuffled = (rows: string[][]) => rows.map((r) => [...r].reverse());
    const upper = (rows: string[][]) => [
      rows[0]?.map((h) => ` ${h.toUpperCase()} `) ?? [],
      ...rows.slice(1),
    ];
    const result = parseSheet(
      {
        staffRows: upper(shuffled([STAFF_HEADER, ...staff])),
        shiftRows: upper(shuffled([SHIFT_HEADER, ...shifts])),
      },
      DEFAULT_SHEET_MAPPING,
      LONDON,
    );
    expect(result.staff.map((s) => s.ref)).toEqual(["N001", "N002"]);
    expect(result.shifts.map((s) => s.ref)).toEqual(["P1", "P2"]);
    expect(result.layout).toEqual({ shiftsTab: "Shifts", refColumn: 9, assignedColumn: 0 });
    expect(result.problems).toEqual([]);
  });

  it("marks a shift filled when every place is held, and reads Cancelled and Draft", () => {
    const rows = [
      shiftRow({
        ref: "F",
        date: "07/11/2026",
        start: "09:00",
        end: "17:00",
        role: "steward",
        assigned: "N001",
      }),
      shiftRow({
        ref: "C",
        date: "07/11/2026",
        start: "09:00",
        end: "17:00",
        role: "steward",
        status: "Cancelled",
      }),
      shiftRow({
        ref: "D",
        date: "07/11/2026",
        start: "09:00",
        end: "17:00",
        role: "steward",
        status: "draft",
      }),
    ];
    expect(parse(staff, rows).shifts.map((s) => s.status)).toEqual([
      "filled",
      "cancelled",
      "draft",
    ]);
  });

  it("skips blank rows without a problem", () => {
    expect(parse([...staff, ["", " ", ""]], [...shifts, []]).problems).toEqual([]);
  });
});

describe("parseSheet: mobiles as the imports read them (audit L68)", () => {
  it("a number cell that lost its 0 is a UK mobile; a +44 landline isn't", () => {
    const result = parse([
      ...staff,
      staffRow({ ref: "N003", first: "Cy", last: "Example", mobile: "7700900303", roles: "coss" }),
      staffRow({
        ref: "N004",
        first: "Di",
        last: "Example",
        mobile: "+44 20 7946 0000",
        roles: "coss",
      }),
    ]);
    expect(result.staff.find((s) => s.ref === "N003")?.mobileE164).toBe("+447700900303");
    expect(result.problems).toEqual([{ tab: "staff", row: 5, problem: "bad_mobile" }]);
  });
});

describe("parseSheet: bad rows are skipped and reported by row and code only", () => {
  it.each([
    [
      "staff",
      staffRow({ ref: "", first: "A", last: "B", mobile: "07700900303", roles: "coss" }),
      "missing_ref",
    ],
    [
      "staff",
      staffRow({ ref: "N001", first: "A", last: "B", mobile: "07700900303", roles: "coss" }),
      "duplicate_ref",
    ],
    [
      "staff",
      staffRow({ ref: "N003", first: "", last: "B", mobile: "07700900303", roles: "coss" }),
      "missing_name",
    ],
    [
      "staff",
      staffRow({ ref: "N003", first: "A", last: "B", mobile: "not a number", roles: "coss" }),
      "bad_mobile",
    ],
    [
      "staff",
      staffRow({ ref: "N003", first: "A", last: "B", mobile: "07700 900301", roles: "coss" }),
      "duplicate_mobile",
    ],
    [
      "staff",
      staffRow({ ref: "N003", first: "A", last: "B", mobile: "07700900303", roles: "C.O.S.S." }),
      "bad_role",
    ],
    [
      "staff",
      staffRow({
        ref: "N003",
        first: "A",
        last: "B",
        mobile: "07700900303",
        roles: "coss",
        status: "on leave",
      }),
      "bad_status",
    ],
  ])("a %s row: %j -> %s", (tab, row, problem) => {
    const result = parse([...staff, row], shifts);
    expect(result.problems).toEqual([{ tab, row: 4, problem }]);
    expect(result.staff).toHaveLength(2);
  });

  const base = { ref: "P9", date: "08/11/2026", start: "09:00", end: "17:00", role: "coss" };
  it.each([
    [{ ...base, ref: "" }, "missing_ref"],
    [{ ...base, ref: "P1" }, "duplicate_ref"],
    [{ ...base, date: "31/02/2026" }, "bad_date"],
    [{ ...base, date: "tomorrow" }, "bad_date"],
    [{ ...base, start: "25:00" }, "bad_time"],
    [{ ...base, end: "5pm" }, "bad_time"],
    // Audit L67: a finish equal to the start isn't a 24-hour shift; a time the clocks skip (the
    // March Sunday, 01:00 to 02:00) isn't moved an hour; nor is a shift of 24 hours or more made of
    // the October Sunday's hour that happens twice.
    [{ ...base, start: "09:00", end: "09:00" }, "bad_time"],
    [{ ...base, date: "28/03/2027", start: "01:30", end: "06:00" }, "bad_time"],
    [{ ...base, date: "27/03/2027", start: "22:00", end: "01:30" }, "bad_time"],
    [{ ...base, date: "31/10/2027", start: "01:30", end: "01:15" }, "bad_time"],
    // Audit L70: a weekday that isn't that date's, a month that isn't a month.
    [{ ...base, date: "Mon 8 Nov 2026" }, "bad_date"],
    [{ ...base, date: "8 Novx 2026" }, "bad_date"],
    [{ ...base, role: "C.O.S.S." }, "bad_role"],
    [{ ...base, needed: "0" }, "bad_headcount"],
    [{ ...base, needed: "two" }, "bad_headcount"],
    [{ ...base, needed: "1001" }, "bad_headcount"],
    [{ ...base, status: "maybe" }, "bad_status"],
    [{ ...base, instructions: "x".repeat(2001) }, "text_too_long"],
  ])("a shift row %j -> %s", (cells, problem) => {
    const result = parse(staff, [...shifts, shiftRow(cells)]);
    expect(result.problems).toEqual([{ tab: "shifts", row: 4, problem }]);
    expect(result.shifts).toHaveLength(2);
  });

  it.each([
    ["N001, N999", "unknown_staff"],
    ["N001, N001", "duplicate_holder"],
    ["N001, N002", "over_headcount"],
  ])(
    "an assigned cell %j is reported (%s) and the shift synced without touching its holders",
    (assigned, problem) => {
      const result = parse(staff, [...shifts, shiftRow({ ...base, assigned })]);
      expect(result.problems).toEqual([{ tab: "shifts", row: 4, problem }]);
      expect(result.shifts[2]).toMatchObject({ ref: "P9", holdersReadable: false, assigned: [] });
    },
  );

  it("a problem never carries a cell's contents", () => {
    const secret = "07700 900399 Mr Secret";
    const result = parse([
      ...staff,
      staffRow({ ref: "N009", first: "A", last: "B", mobile: secret, roles: "coss" }),
    ]);
    expect(JSON.stringify(result.problems)).not.toContain("900399");
    expect(Object.keys(result.problems[0] ?? {}).sort()).toEqual(["problem", "row", "tab"]);
  });

  it("a missing or doubled column stops the whole read", () => {
    const noAssigned = SHIFT_HEADER.filter((h) => h !== "Assigned");
    expect(() =>
      parseSheet(
        { staffRows: [STAFF_HEADER], shiftRows: [noAssigned] },
        DEFAULT_SHEET_MAPPING,
        LONDON,
      ),
    ).toThrow(SheetLayoutError);
    try {
      parseSheet(
        { staffRows: [[...STAFF_HEADER, "mobile"]], shiftRows: [SHIFT_HEADER] },
        DEFAULT_SHEET_MAPPING,
        LONDON,
      );
    } catch (err) {
      expect(err).toMatchObject({ code: "duplicate_column", tab: "staff" });
    }
    // Optional columns may be absent.
    const minimal = ["Shift ID", "Date", "Start", "End", "Role", "Assigned"];
    expect(
      parseSheet({ staffRows: [STAFF_HEADER], shiftRows: [minimal] }, DEFAULT_SHEET_MAPPING, LONDON)
        .shifts,
    ).toEqual([]);
  });
});

describe("cells", () => {
  it.each([
    ["07/11/2026", { year: 2026, month: 11, day: 7 }],
    ["7/11/2026", { year: 2026, month: 11, day: 7 }],
    ["2026-11-07", { year: 2026, month: 11, day: 7 }],
    ["Sat 7 Nov 2026", { year: 2026, month: 11, day: 7 }],
    ["7 November 2026", { year: 2026, month: 11, day: 7 }],
    ["29/02/2028", { year: 2028, month: 2, day: 29 }],
    // The same reader for every import column (audit L70): a weekday that's right, months in full
    // or three letters (and "Sept"), a time after the date (Excel's date-and-time cells) ignored.
    ["Saturday, 12 June 2027", { year: 2027, month: 6, day: 12 }],
    ["sat 12 jun 2027", { year: 2027, month: 6, day: 12 }],
    ["12 Sept 2027", { year: 2027, month: 9, day: 12 }],
    ["12/06/2027 00:00", { year: 2027, month: 6, day: 12 }],
    ["12/06/2027 23:59:59", { year: 2027, month: 6, day: 12 }],
    ["2027-06-12T00:00", { year: 2027, month: 6, day: 12 }],
    // Usual short weekdays, as typed into rotas (they worked before the stricter names).
    ["Tues 15 Jun 2027", { year: 2027, month: 6, day: 15 }],
    ["Weds 16 Jun 2027", { year: 2027, month: 6, day: 16 }],
    ["Thurs 17 Jun 2027", { year: 2027, month: 6, day: 17 }],
    ["Thur 17 Jun 2027", { year: 2027, month: 6, day: 17 }],
    // Times as Excel and other systems write them after a date.
    ["07/11/2026 12:00 AM", { year: 2026, month: 11, day: 7 }],
    ["07/11/2026 9:00:00 AM", { year: 2026, month: 11, day: 7 }],
    ["07/11/2026 00:00:00.000", { year: 2026, month: 11, day: 7 }],
    ["2026-11-07T09:00:00Z", { year: 2026, month: 11, day: 7 }],
  ])("date %j", (raw, expected) => {
    expect(parseSheetDate(raw)).toEqual(expected);
  });

  it.each([
    "29/02/2027",
    "11/07",
    "2026/11/07",
    "7 Nobember 2026",
    "07/11/1999",
    "",
    // Audit L70: the weekday must be the date's, and a month name a real one.
    "Mon 12 Jun 2027",
    "Satur 12 Jun 2027",
    "12 Junk 2027",
    "12 Juneteenth 2027",
    "12/06/2027 25:00",
    "12/06/2027 13:00 PM",
    "Thurs 18 Jun 2027", // a Friday
  ])("not a date: %j", (raw) => {
    expect(parseSheetDate(raw)).toBeNull();
  });

  it("times and roles", () => {
    expect(parseSheetTime("9:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseSheetTime("22.30")).toEqual({ hour: 22, minute: 30 });
    expect(parseSheetTime("06:00:00")).toEqual({ hour: 6, minute: 0 });
    expect(parseSheetTime("24:00")).toBeNull();
    expect(normaliseRole(" Door Supervisor ")).toBe("door_supervisor");
    expect(normaliseRole("track-operative")).toBe("track_operative");
    expect(normaliseRole("1st aider")).toBeNull();
  });

  it("A1 ranges: tab names are always quoted, quotes doubled", () => {
    expect(quoteTab("Nick's rota")).toBe("'Nick''s rota'");
    expect([columnLetters(0), columnLetters(25), columnLetters(26), columnLetters(701)]).toEqual([
      "A",
      "Z",
      "AA",
      "ZZ",
    ]);
    expect(columnIndex("AA")).toBe(26);
    expect(cellRange("Shifts", 9, 7)).toBe("'Shifts'!J7");
    expect(columnRange("Shifts", 0)).toBe("'Shifts'!A:A");
    expect(parseRange("'Nick''s rota'!C12")).toEqual({ tab: "Nick's rota", column: 2, row: 12 });
    expect(parseRange("'Shifts'!A:A")).toEqual({ tab: "Shifts", column: 0 });
    expect(parseRange("'Staff'")).toEqual({ tab: "Staff" });
  });

  it("the default mapping is a valid mapping; a mapping needs its required columns", () => {
    expect(sheetMappingSchema.parse(DEFAULT_SHEET_MAPPING)).toEqual(DEFAULT_SHEET_MAPPING);
    expect(sheetMappingSchema.safeParse({ version: 1 }).success).toBe(false);
  });
});

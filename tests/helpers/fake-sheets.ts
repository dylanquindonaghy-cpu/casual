import { parseRange } from "@/lib/roster/sheets/a1";
import {
  SheetsError,
  type SheetsClient,
  type SheetsErrorCode,
  type SheetWrite,
} from "@/lib/roster/sheets/client";
import { DEFAULT_SHEET_MAPPING } from "@/lib/roster/sheets/mapping";
import { wallTimeOf } from "@/lib/time/zoned";

// An in-memory Google Sheets for tests: never the network. Counts every read and write request,
// can fail the next one with a given code, and can run a hook before a read (to simulate the
// office editing the sheet mid-sync). `reads` counts batch reads of cells; the locale request
// (one per sync) is counted apart, in `localeReads`.

export class FakeSheets implements SheetsClient {
  private books = new Map<string, Map<string, string[][]>>();
  private locales = new Map<string, string>();
  reads = 0;
  localeReads = 0;
  writes = 0;
  lastWrites: SheetWrite[] = [];
  failNextRead: SheetsErrorCode | null = null;
  failNextLocale: SheetsErrorCode | null = null;
  failNextWrite: SheetsErrorCode | null = null;
  beforeRead: ((readNumber: number) => void) | null = null;

  create(
    spreadsheetId: string,
    tabs: Record<string, string[][]>,
    options: { locale?: string } = {},
  ): void {
    this.locales.set(spreadsheetId, options.locale ?? "en_GB");
    this.books.set(
      spreadsheetId,
      new Map(Object.entries(tabs).map(([name, rows]) => [name, rows.map((r) => [...r])])),
    );
  }

  // The live rows of a tab, for a test to read or edit (as the office would).
  tab(spreadsheetId: string, name: string): string[][] {
    const rows = this.books.get(spreadsheetId)?.get(name);
    if (!rows) throw new Error(`no tab ${name} in ${spreadsheetId}`);
    return rows;
  }

  // One cell by row number (1 = header) and header name.
  cell(spreadsheetId: string, tab: string, row: number, header: string): string {
    const rows = this.tab(spreadsheetId, tab);
    const column = (rows[0] ?? []).indexOf(header);
    return rows[row - 1]?.[column] ?? "";
  }

  setCell(spreadsheetId: string, tab: string, row: number, header: string, value: string): void {
    const rows = this.tab(spreadsheetId, tab);
    const column = (rows[0] ?? []).indexOf(header);
    if (column < 0) throw new Error(`no column ${header}`);
    const target = rows[row - 1];
    if (!target) throw new Error(`no row ${row}`);
    target[column] = value;
  }

  // As the office would change it: File → Settings → Locale.
  setLocale(spreadsheetId: string, locale: string): void {
    this.locales.set(spreadsheetId, locale);
  }

  async locale(spreadsheetId: string): Promise<string> {
    this.localeReads += 1;
    if (this.failNextLocale) {
      const code = this.failNextLocale;
      this.failNextLocale = null;
      throw new SheetsError(code);
    }
    const locale = this.locales.get(spreadsheetId);
    if (locale === undefined) throw new SheetsError("sheet_not_found");
    return locale;
  }

  async batchGet(spreadsheetId: string, ranges: string[]): Promise<string[][][]> {
    this.reads += 1;
    this.beforeRead?.(this.reads);
    if (this.failNextRead) {
      const code = this.failNextRead;
      this.failNextRead = null;
      throw new SheetsError(code);
    }
    const book = this.books.get(spreadsheetId);
    if (!book) throw new SheetsError("sheet_not_found");
    return ranges.map((range) => {
      const r = parseRange(range);
      const rows = book.get(r.tab);
      if (!rows) throw new SheetsError("sheet_unreadable"); // as Google answers: a 400
      if (r.column === undefined) return rows.map((row) => [...row]);
      return rows.map((row) => [row[r.column ?? 0] ?? ""]);
    });
  }

  async batchUpdate(spreadsheetId: string, writes: SheetWrite[]): Promise<void> {
    this.writes += 1;
    this.lastWrites = writes;
    if (this.failNextWrite) {
      const code = this.failNextWrite;
      this.failNextWrite = null;
      throw new SheetsError(code);
    }
    const book = this.books.get(spreadsheetId);
    if (!book) throw new SheetsError("sheet_not_found");
    for (const w of writes) {
      const r = parseRange(w.range);
      if (r.column === undefined || r.row === undefined) throw new Error(`not a cell: ${w.range}`);
      const rows = book.get(r.tab);
      if (!rows) throw new SheetsError("sheet_unreadable"); // as Google answers: a 400
      while (rows.length < r.row) rows.push([]);
      const row = rows[r.row - 1] ?? [];
      while (row.length <= r.column) row.push("");
      row[r.column] = w.value;
    }
  }
}

const { staff: S, shifts: H } = DEFAULT_SHEET_MAPPING;
export const STAFF_HEADER = [
  S.columns.ref,
  S.columns.firstName,
  S.columns.lastName,
  S.columns.mobile,
  S.columns.roles,
  S.columns.status ?? "Status",
];
export const SHIFT_HEADER = [
  H.columns.ref,
  H.columns.date,
  H.columns.start,
  H.columns.end,
  H.columns.site ?? "Site",
  H.columns.role,
  H.columns.headcount ?? "Needed",
  H.columns.status ?? "Status",
  H.columns.instructions ?? "Instructions",
  H.columns.assigned,
];

export interface StaffCells {
  ref: string;
  first: string;
  last: string;
  mobile: string;
  roles: string;
  status?: string;
}
export const staffRow = (s: StaffCells) => [
  s.ref,
  s.first,
  s.last,
  s.mobile,
  s.roles,
  s.status ?? "",
];

export interface ShiftCells {
  ref: string;
  date: string;
  start: string;
  end: string;
  site?: string;
  role: string;
  needed?: string;
  status?: string;
  instructions?: string;
  assigned?: string;
}
export const shiftRow = (s: ShiftCells) => [
  s.ref,
  s.date,
  s.start,
  s.end,
  s.site ?? "",
  s.role,
  s.needed ?? "",
  s.status ?? "",
  s.instructions ?? "",
  s.assigned ?? "",
];

const pad = (n: number) => String(n).padStart(2, "0");
// How an instant reads in the sheet's London wall-clock cells.
export const londonDate = (at: Date) => {
  const w = wallTimeOf(at, "Europe/London");
  return `${pad(w.day)}/${pad(w.month)}/${w.year}`;
};
export const londonTime = (at: Date) => {
  const w = wallTimeOf(at, "Europe/London");
  return `${pad(w.hour)}:${pad(w.minute)}`;
};

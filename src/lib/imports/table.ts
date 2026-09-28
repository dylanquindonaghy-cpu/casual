import { parseCsv } from "./csv";
import { ImportFileError, MAX_COLUMNS, MAX_FILE_BYTES, MAX_ROWS } from "./errors";
import { readXlsx } from "./xlsx";

// An uploaded file (bytes) to rows of cell text, whatever it is: an .xlsx workbook (a zip:
// starts "PK") or UTF-8 text as CSV. An old binary .xls (starts D0 CF 11 E0) is refused with its
// own code, so the office can be told to save it as .xlsx or .csv. rows[0] is the header row.

export function readTable(bytes: Uint8Array): string[][] {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ImportFileError("too_big");
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  let rows: string[][];
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    rows = readXlsx(bytes);
  } else if (starts(0xd0, 0xcf, 0x11, 0xe0)) {
    throw new ImportFileError("old_excel");
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ImportFileError("not_text");
    }
    if (text.includes("\u0000")) throw new ImportFileError("not_text");
    rows = parseCsv(text);
  }
  // Blank rows at the end don't count.
  while (rows.length > 0 && (rows.at(-1) ?? []).every((c) => c.trim() === "")) rows.pop();
  if (rows.length < 2) throw new ImportFileError("empty");
  if (rows.length - 1 > MAX_ROWS) throw new ImportFileError("too_many_rows");
  if (rows.some((r) => r.length > MAX_COLUMNS)) throw new ImportFileError("too_many_columns");
  return rows;
}

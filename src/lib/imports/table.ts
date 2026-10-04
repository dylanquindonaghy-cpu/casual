import { parseCsv } from "./csv";
import { ImportFileError, MAX_COLUMNS, MAX_FILE_BYTES, MAX_ROWS } from "./errors";
import { readXlsx } from "./xlsx";

// An uploaded file (bytes) to rows of cell text, whatever it is: an .xlsx workbook (a zip:
// starts "PK") or text as CSV. An old binary .xls (starts D0 CF 11 E0) is refused with its own
// code, so the office can be told to save it as .xlsx or .csv. rows[0] is the header row.
//
// CSV text is UTF-8, or else Windows-1252: what Excel on Windows writes for "CSV (Comma delimited)",
// where "£" and accented letters are single bytes (audit L69). Bytes Windows-1252 leaves undefined,
// or a NUL, mean it's neither (UTF-16, a binary file): refused with a message saying how to save it.

export function readTable(bytes: Uint8Array): string[][] {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ImportFileError("too_big");
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  let rows: string[][];
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    rows = readXlsx(bytes);
  } else if (starts(0xd0, 0xcf, 0x11, 0xe0)) {
    throw new ImportFileError("old_excel");
  } else {
    const text = decodeText(bytes);
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

// The five bytes Windows-1252 leaves undefined (decoded as the C1 controls of the same number).
const UNDEFINED_IN_1252 = /[\u0081\u008d\u008f\u0090\u009d]/;
// Text that isn't Windows-1252 after all, read as if it were: UTF-8 with one stray byte ("RenÃ©e"),
// or a Mac's own CSV, where é and ü come out as Ž and Ÿ inside a word ("RenŽe"). Refused rather
// than imported with every such name changed.
const MISREAD = /[ÂÃ][\u0080-\u00bf]|[a-zà-ÿ][ŽŸ]/;

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const text = new TextDecoder("windows-1252").decode(bytes);
    if (UNDEFINED_IN_1252.test(text) || MISREAD.test(text)) throw new ImportFileError("not_text");
    return text;
  }
}

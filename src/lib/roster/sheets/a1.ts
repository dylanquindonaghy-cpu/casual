// A1 notation for Google Sheets ranges: 'Tab name'!C7. Tab names are always quoted (a quote
// inside is doubled), so any tab name is safe in a range.

export function quoteTab(tab: string): string {
  return `'${tab.replaceAll("'", "''")}'`;
}

// 0 -> A, 25 -> Z, 26 -> AA.
export function columnLetters(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`bad column index ${index}`);
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function columnIndex(letters: string): number {
  if (!/^[A-Z]{1,3}$/.test(letters)) throw new Error(`bad column letters ${letters}`);
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// The whole tab, one cell, or one whole column.
export const tabRange = (tab: string) => quoteTab(tab);
export const cellRange = (tab: string, column: number, row: number) =>
  `${quoteTab(tab)}!${columnLetters(column)}${row}`;
export const columnRange = (tab: string, column: number) =>
  `${quoteTab(tab)}!${columnLetters(column)}:${columnLetters(column)}`;

export interface ParsedRange {
  tab: string;
  // Absent for a whole tab. A single cell has row set; a whole column doesn't.
  column?: number;
  row?: number;
}

export function parseRange(range: string): ParsedRange {
  const m = /^'((?:[^']|'')+)'(?:!([A-Z]{1,3})(\d+)?(?::([A-Z]{1,3}))?)?$/.exec(range);
  if (!m?.[1]) throw new Error(`unsupported range ${range}`);
  const tab = m[1].replaceAll("''", "'");
  if (!m[2]) return { tab };
  const column = columnIndex(m[2]);
  if (m[4] && columnIndex(m[4]) !== column) throw new Error(`multi-column range ${range}`);
  return m[3] ? { tab, column, row: Number(m[3]) } : { tab, column };
}

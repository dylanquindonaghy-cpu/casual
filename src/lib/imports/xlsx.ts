import { inflateRawSync } from "node:zlib";
import { columnIndex } from "../roster/sheets/a1";
import { ImportFileError, MAX_COLUMNS, MAX_ROWS, MAX_UNPACKED_BYTES } from "./errors";

// A small reader for Excel workbooks (.xlsx: a zip of XML files), enough for importing a list:
// the first worksheet's cells as text. No dependency: Node's zlib inflates, and the few XML parts
// we need are read with plain string scanning, in linear time (no regex that can backtrack over
// a hostile file). Limits guard against zip bombs and memory blow-ups: every part is capped at
// MAX_UNPACKED_BYTES once inflated, and rows and columns are counted while reading, so a tiny
// file can't claim a cell at row 1,000,000 or column XFD. Encrypted, ZIP64 or odd files are refused.
//
// Cells come back as the text an office would read: shared and inline strings as written,
// TRUE/FALSE, numbers as stored, and cells formatted as dates or times as dd/mm/yyyy, HH:mm or
// "dd/mm/yyyy HH:mm" (the importer's date parsing takes those). Row positions are kept: rows[i]
// is the sheet's row i + 1, so problems can name the row the office sees in Excel.

const bad = (): never => {
  throw new ImportFileError("bad_xlsx");
};

// ---- zip ----

interface Entry {
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function readZip(buf: Buffer): Map<string, Entry> {
  const minEocd = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) bad();
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) bad();
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const entry = {
      flags: buf.readUInt16LE(at + 8),
      method: buf.readUInt16LE(at + 10),
      compressedSize: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
    };
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    if ([entry.compressedSize, entry.size, entry.offset].includes(0xffffffff)) bad(); // ZIP64
    entries.set(name.replace(/^\/+/, ""), entry);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readPart(buf: Buffer, entries: Map<string, Entry>, name: string): string | null {
  const entry = entries.get(name);
  if (!entry) return null;
  if (entry.flags & 0x1) bad(); // encrypted
  if (entry.size > MAX_UNPACKED_BYTES) throw new ImportFileError("too_big");
  const at = entry.offset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) bad();
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) bad();
  let raw: Buffer;
  if (entry.method === 0) raw = data;
  else if (entry.method === 8) {
    try {
      raw = inflateRawSync(data, { maxOutputLength: MAX_UNPACKED_BYTES });
    } catch (err) {
      if (err instanceof RangeError) throw new ImportFileError("too_big");
      return bad();
    }
  } else return bad();
  return raw.toString("utf8");
}

// ---- XML (just enough) ----

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
// A character reference outside Unicode is a broken file; control characters (NUL included,
// which Postgres refuses in text) are dropped, keeping tab and line breaks.
function fromCode(code: number): string {
  if (!Number.isInteger(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) bad();
  if (code < 0x20 && code !== 0x9 && code !== 0xa && code !== 0xd) return "";
  return String.fromCodePoint(code);
}
export function decodeXml(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]{1,8}|#\d{1,10}|[a-z]{1,8});/g, (whole, name: string) => {
      if (name.startsWith("#x")) return fromCode(parseInt(name.slice(2), 16));
      if (name.startsWith("#")) return fromCode(parseInt(name.slice(1), 10));
      return ENTITIES[name] ?? whole;
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

// Drops namespace prefixes from tag names (<x:c> -> <c>); attributes keep theirs (r:id).
const unprefix = (xml: string) => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, "<$1");

function attrs(tag: string): Record<string, string> {
  if (tag.length > 10_000) bad(); // real attributes are short; keeps the regex below cheap
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    out[m[1] ?? ""] = decodeXml(m[3] ?? m[4] ?? "");
  }
  return out;
}

// Each <name ...>inner</name> or <name .../> in order, found with indexOf (linear: a missing
// ">" or closing tag is a broken file, refused at once). Not for elements nested in themselves.
function* elements(
  xml: string,
  name: string,
): Generator<{ attrs: Record<string, string>; inner: string }> {
  const needle = `<${name}`;
  const closing = `</${name}>`;
  let at = 0;
  for (;;) {
    const i = xml.indexOf(needle, at);
    if (i < 0) return;
    const next = xml[i + needle.length];
    if (
      next !== ">" &&
      next !== "/" &&
      next !== " " &&
      next !== "\t" &&
      next !== "\n" &&
      next !== "\r"
    ) {
      at = i + needle.length; // a longer name (<cols> when looking for <c>)
      continue;
    }
    const gt = xml.indexOf(">", i);
    if (gt < 0) bad();
    const selfClosing = xml[gt - 1] === "/";
    const attrText = xml.slice(i + needle.length, selfClosing ? gt - 1 : gt);
    if (selfClosing) {
      yield { attrs: attrs(attrText), inner: "" };
      at = gt + 1;
      continue;
    }
    const close = xml.indexOf(closing, gt + 1);
    if (close < 0) bad();
    yield { attrs: attrs(attrText), inner: xml.slice(gt + 1, close) };
    at = close + closing.length;
  }
}

// A string item's text: every <t> run, skipping phonetic guides (<rPh>...</rPh>).
function textOf(xml: string): string {
  let plain = "";
  let at = 0;
  for (;;) {
    const i = xml.indexOf("<rPh", at);
    if (i < 0) break;
    const end = xml.indexOf("</rPh>", i);
    if (end < 0) bad();
    plain += xml.slice(at, i);
    at = end + "</rPh>".length;
  }
  plain += xml.slice(at);
  return [...elements(plain, "t")].map((t) => decodeXml(t.inner)).join("");
}

// ---- dates ----

const BUILTIN_DATE = new Set([
  14, 15, 16, 17, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 32, 33, 45, 46, 47]);
const BUILTIN_DATETIME = new Set([22]);

type DateKind = "date" | "time" | "datetime" | null;

export function dateKindOf(numFmtId: number, formatCode: string | undefined): DateKind {
  if (BUILTIN_DATE.has(numFmtId)) return "date";
  if (BUILTIN_TIME.has(numFmtId)) return "time";
  if (BUILTIN_DATETIME.has(numFmtId)) return "datetime";
  if (!formatCode) return null;
  const elapsed = /\[(h+|m+|s+)\]/i.test(formatCode);
  const code = formatCode
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/_./g, "")
    .replace(/\*./g, "");
  const hasTime = elapsed || /[hs]/i.test(code);
  const hasDate = /[dy]/i.test(code) || (/m/i.test(code) && !hasTime);
  if (hasDate && hasTime) return "datetime";
  if (hasDate) return "date";
  if (hasTime) return "time";
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatSerial(
  serial: number,
  kind: Exclude<DateKind, null>,
  date1904: boolean,
): string {
  // Days since 1899-12-30 (Excel's 1900 system, which counts a 29 Feb 1900 that never was) or
  // since 1904-01-01. The serial is a wall-clock time with no zone: read it as UTC fields.
  // The day is the whole part, never moved by rounding the time: a licence expiring 12/06/2027
  // 23:59:59 expires on the 12th, not the 13th (audit M15). The time is rounded to the minute
  // within that day, at most 23:59.
  // Rounded to the second first, as Excel shows it (a stored 45000.99999999999 is midnight).
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const seconds = Math.round(serial * 86_400);
  const days = Math.floor(seconds / 86_400);
  const minutes = Math.min(Math.floor((seconds - days * 86_400) / 60), 1439);
  const d = new Date(epoch + days * 86_400_000);
  const day = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  return kind === "date" ? day : kind === "time" ? time : `${day} ${time}`;
}

// ---- the workbook ----

export function readXlsx(bytes: Uint8Array): string[][] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readZip(buf);
  const part = (name: string) => {
    const xml = readPart(buf, entries, name);
    return xml === null ? null : unprefix(xml);
  };

  const workbook = part("xl/workbook.xml") ?? bad();
  const date1904 = /<workbookPr\b[^>]*date1904\s*=\s*"(1|true)"/.test(workbook);
  const [firstSheet] = [...elements(workbook, "sheet")];
  const relId = firstSheet?.attrs["r:id"] ?? bad();
  const rels = part("xl/_rels/workbook.xml.rels") ?? bad();
  const target = [...elements(rels, "Relationship")].find((r) => r.attrs.Id === relId)?.attrs
    .Target;
  if (!target) bad();
  const sheetPath = target?.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheet = part(sheetPath.replace(/\/\.\//g, "/")) ?? bad();

  const shared = [...elements(part("xl/sharedStrings.xml") ?? "", "si")].map((si) =>
    textOf(si.inner),
  );

  const styles = part("xl/styles.xml") ?? "";
  const formats = new Map<number, string>();
  for (const f of elements(styles, "numFmt")) {
    formats.set(Number(f.attrs.numFmtId), f.attrs.formatCode ?? "");
  }
  const [cellXfs] = [...elements(styles, "cellXfs")];
  const styleKinds = [...elements(cellXfs?.inner ?? "", "xf")].map((xf) => {
    const id = Number(xf.attrs.numFmtId ?? 0);
    return dateKindOf(id, formats.get(id));
  });

  const rows: string[][] = [];
  let nextRow = 1;
  for (const row of elements(sheet, "row")) {
    const rowNumber = row.attrs.r ? Number(row.attrs.r) : nextRow;
    if (!Number.isInteger(rowNumber) || rowNumber < nextRow || rowNumber > 1_048_576) bad();
    nextRow = rowNumber + 1;
    const cells: string[] = [];
    let nextCol = 0;
    let hasText = false;
    for (const c of elements(row.inner, "c")) {
      const ref = /^([A-Z]{1,3})\d+$/.exec(c.attrs.r ?? "");
      const col = ref?.[1] ? columnIndex(ref[1]) : nextCol;
      nextCol = col + 1;
      const v = [...elements(c.inner, "v")][0]?.inner;
      const value = v === undefined ? undefined : decodeXml(v);
      let text = "";
      switch (c.attrs.t) {
        case "s":
          text = shared[Number(value)] ?? "";
          break;
        case "inlineStr":
          text = textOf([...elements(c.inner, "is")][0]?.inner ?? "");
          break;
        case "str":
          text = value ?? "";
          break;
        case "b":
          text = value === "1" ? "TRUE" : value === "0" ? "FALSE" : "";
          break;
        case "e":
          text = "";
          break;
        default: {
          if (value === undefined || value === "") break;
          const kind = styleKinds[Number(c.attrs.s ?? 0)] ?? null;
          const n = Number(value);
          text = kind && Number.isFinite(n) ? formatSerial(n, kind, date1904) : value;
        }
      }
      if (text === "") continue; // formatting-only cells don't count or pad
      if (col >= MAX_COLUMNS) throw new ImportFileError("too_many_columns");
      hasText = true;
      while (cells.length < col) cells.push("");
      cells[col] = text;
    }
    if (!hasText) continue; // empty rows (Excel writes them for formatting) are skipped
    // The header is row 1: at most MAX_ROWS data rows after it.
    if (rowNumber > MAX_ROWS + 1) throw new ImportFileError("too_many_rows");
    while (rows.length < rowNumber - 1) rows.push([]);
    rows.push(cells);
  }
  return rows;
}

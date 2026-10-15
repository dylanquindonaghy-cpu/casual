import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/imports/csv";
import {
  ImportFileError,
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_UNPACKED_BYTES,
} from "@/lib/imports/errors";
import { readTable } from "@/lib/imports/table";
import { dateKindOf, formatSerial, readXlsx } from "@/lib/imports/xlsx";

// Reading an uploaded file: CSV as spreadsheets write it, and .xlsx workbooks. The workbooks here
// are written by exceljs (a dev-only dependency), not by our own code, so the reader is checked
// against an independent writer.

const utf8 = (s: string) => new TextEncoder().encode(s);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof ImportFileError ? err.code : `other: ${String(err)}`;
  }
  return "no error";
};

describe("parseCsv", () => {
  it("reads quoted fields with commas, line breaks and doubled quotes; CRLF; drops a BOM", () => {
    const text = '﻿First name,Notes\r\n"Ada","Gate C, north"\r\n"Ben","Said ""hi""\nthen left"\r\n';
    expect(parseCsv(text)).toEqual([
      ["First name", "Notes"],
      ["Ada", "Gate C, north"],
      ["Ben", 'Said "hi"\nthen left'],
    ]);
  });

  it("detects semicolons and tabs as the delimiter from the header line", () => {
    expect(parseCsv("a;b;c\n1;2,5;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2,5", "3"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields and a last line with no newline", () => {
    expect(parseCsv("a,b,c\n1,,3\n,,")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
      ["", "", ""],
    ]);
  });

  it("refuses a quote that never closes", () => {
    expect(code(() => parseCsv('a,b\n"open,1'))).toBe("bad_csv");
  });
});

describe("readTable", () => {
  it("reads CSV text and drops blank rows at the end", () => {
    expect(readTable(utf8("Name\nAda\n\n,\n"))).toEqual([["Name"], ["Ada"]]);
  });

  // Excel on Windows, "CSV (Comma delimited)": Windows-1252, "£" is the byte A3 (audit L69).
  it("reads a Windows Excel CSV: the pound sign and accented names come through", () => {
    const bytes = new Uint8Array([
      ...Buffer.from("Name,Rate\r\nRen", "latin1"),
      0xe9, // é
      ...Buffer.from("e,", "latin1"),
      0xa3, // £
      ...Buffer.from("12.50\r\n", "latin1"),
    ]);
    expect(readTable(bytes)).toEqual([
      ["Name", "Rate"],
      ["Renée", "£12.50"],
    ]);
  });

  // Windows-1252's own letters at 0x80–0x9F, where it isn't Latin-1: Excel's curly apostrophe in
  // "O’Brien" (0x92), the euro sign, dashes. Expected values from Python's cp1252 codec, not from
  // TextDecoder (Node 22.22 decodes these bytes as control characters).
  it("reads a Windows Excel CSV: curly quotes, the euro sign and every other 0x80–0x9F letter", () => {
    const defined = Array.from({ length: 32 }, (_, i) => 0x80 + i).filter(
      (b) => ![0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(b),
    );
    const bytes = new Uint8Array([
      ...Buffer.from("Name,Notes\r\nO", "latin1"),
      0x92, // ’
      ...Buffer.from("Brien,", "latin1"),
      ...defined,
      ...Buffer.from("\r\n", "latin1"),
    ]);
    expect(readTable(bytes)).toEqual([
      ["Name", "Notes"],
      ["O’Brien", "€‚ƒ„…†‡ˆ‰Š‹ŒŽ" + "‘’“”•–—˜™š›œžŸ"],
    ]);
  });

  it.each([
    ["an empty file", utf8(""), "empty"],
    ["a header with no rows", utf8("Name,Mobile\n"), "empty"],
    ["a file over the size limit", new Uint8Array(MAX_FILE_BYTES + 1).fill(65), "too_big"],
    ["too many rows", utf8(`Name\n${"x\n".repeat(MAX_ROWS + 1)}`), "too_many_rows"],
    ["too many columns", utf8(`${Array(51).fill("h").join(",")}\n1`), "too_many_columns"],
    [
      "an old binary .xls",
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      "old_excel",
    ],
    // Neither UTF-8 nor Windows-1252 (0x81 is undefined there), and a UTF-16 file (its NULs).
    // Plain Windows-1252 bytes are read: see "a Windows Excel CSV" below.
    ["bytes that aren't text", new Uint8Array([0x4e, 0x81, 0x0a, 0x41]), "not_text"],
    ["a UTF-16 file", new Uint8Array([0xff, 0xfe, 0x4e, 0x00, 0x0a, 0x00, 0x41, 0x00]), "not_text"],
    // Misread if taken as Windows-1252: UTF-8 with one stray byte ("RenÃ©e"), and a Mac CSV
    // ("RenŽe": é is 0x8E there).
    [
      "a UTF-8 file with one stray byte",
      new Uint8Array([...Buffer.from("Name\nRen\u00e9e\n"), 0xa3, 0x0a]),
      "not_text",
    ],
    [
      "a Mac CSV",
      new Uint8Array([...Buffer.from("Name\nRen", "latin1"), 0x8e, 0x65, 0x0a]),
      "not_text",
    ],
    ["a zip that isn't a workbook", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "bad_xlsx"],
  ])("refuses %s", (_label, bytes, expected) => {
    expect(code(() => readTable(bytes))).toBe(expected);
  });
});

async function workbook(build: (sheet: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Staff");
  build(sheet, wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("readXlsx (files written by exceljs)", () => {
  it("reads the first sheet: text, numbers, booleans, formulas' results, gaps kept", async () => {
    const bytes = await workbook((sheet, wb) => {
      sheet.addRow(["Staff ID", "First name", "Mobile", "Needed", "Active", "Total"]);
      sheet.addRow(["N001", "Ada & <Co>", 7700900301, 2, true, { formula: "D2*2", result: 4 }]);
      sheet.getCell("A4").value = "Zoë, O'Brien";
      sheet.getCell("C4").value = "07700 900302";
      wb.addWorksheet("Ignored").addRow(["not read"]);
    });
    expect(readXlsx(bytes)).toEqual([
      ["Staff ID", "First name", "Mobile", "Needed", "Active", "Total"],
      ["N001", "Ada & <Co>", "7700900301", "2", "TRUE", "4"],
      [],
      ["Zoë, O'Brien", "", "07700 900302"],
    ]);
  });

  it("reads cells formatted as dates and times the way Excel shows them", async () => {
    const bytes = await workbook((sheet) => {
      sheet.addRow(["Date", "Start", "Both", "Plain"]);
      const row = sheet.addRow([new Date(Date.UTC(2026, 10, 7)), 0.375, 46333.9375, 0.375]);
      row.getCell(1).numFmt = "dd/mm/yyyy";
      row.getCell(2).numFmt = "hh:mm";
      row.getCell(3).numFmt = "dd/mm/yyyy hh:mm";
      const iso = sheet.addRow([new Date(Date.UTC(2027, 5, 14, 22, 30))]);
      iso.getCell(1).numFmt = "yyyy-mm-dd";
    });
    expect(readXlsx(bytes)).toEqual([
      ["Date", "Start", "Both", "Plain"],
      ["07/11/2026", "09:00", "07/11/2026 22:30", "0.375"],
      ["14/06/2027"],
    ]);
  });

  it("an expiry date of 23:59:59, shown as a date, is that day (audit M15)", async () => {
    const bytes = await workbook((sheet) => {
      sheet.addRow(["Staff ID", "Type", "Expiry date", "With time"]);
      const row = sheet.addRow([
        "S1",
        "SIA_DS",
        new Date(Date.UTC(2027, 5, 12, 23, 59, 59)),
        new Date(Date.UTC(2027, 5, 12, 23, 59, 59)),
      ]);
      row.getCell(3).numFmt = "dd/mm/yyyy";
      row.getCell(4).numFmt = "dd/mm/yyyy hh:mm";
    });
    expect(readTable(bytes)).toEqual([
      ["Staff ID", "Type", "Expiry date", "With time"],
      ["S1", "SIA_DS", "12/06/2027", "12/06/2027 23:59"],
    ]);
  });

  it("reads a workbook using the 1904 date system", async () => {
    const bytes = await workbook((sheet, wb) => {
      wb.properties.date1904 = true;
      sheet.addRow(["Date"]);
      sheet.addRow([new Date(Date.UTC(2026, 10, 7))]).getCell(1).numFmt = "dd/mm/yyyy";
    });
    expect(readXlsx(bytes)).toEqual([["Date"], ["07/11/2026"]]);
  });

  it("goes through readTable as a workbook", async () => {
    const bytes = await workbook((sheet) => {
      sheet.addRow(["Name"]);
      sheet.addRow(["Ada"]);
    });
    expect(readTable(bytes)).toEqual([["Name"], ["Ada"]]);
  });
});

describe("readXlsx guards", () => {
  // A minimal zip writer, only to build hostile files the reader must refuse.
  function zip(files: { name: string; data: Buffer; declaredSize?: number; flags?: number }[]) {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
      const deflated = deflateRawSync(f.data);
      const name = Buffer.from(f.name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(f.flags ?? 0, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(deflated.length, 18);
      local.writeUInt32LE(f.declaredSize ?? f.data.length, 22);
      local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(f.flags ?? 0, 8);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(deflated.length, 20);
      central.writeUInt32LE(f.declaredSize ?? f.data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      locals.push(local, name, deflated);
      centrals.push(central, name);
      offset += 30 + name.length + deflated.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
  }
  const workbookXml = Buffer.from(
    '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  const rels = Buffer.from(
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  const bomb = Buffer.alloc(MAX_UNPACKED_BYTES + 1024, 0x20); // squeezes to a few KB

  it("refuses a part that unpacks past the limit, even when its declared size lies", () => {
    const honest = zip([
      { name: "xl/workbook.xml", data: workbookXml },
      { name: "xl/_rels/workbook.xml.rels", data: rels },
      { name: "xl/worksheets/sheet1.xml", data: bomb },
    ]);
    expect(code(() => readXlsx(honest))).toBe("too_big");
    const lying = zip([
      { name: "xl/workbook.xml", data: workbookXml },
      { name: "xl/_rels/workbook.xml.rels", data: rels },
      { name: "xl/worksheets/sheet1.xml", data: bomb, declaredSize: 100 },
    ]);
    expect(code(() => readXlsx(lying))).toBe("too_big");
  });

  it("refuses an encrypted part and a workbook with no sheet", () => {
    const encrypted = zip([{ name: "xl/workbook.xml", data: workbookXml, flags: 1 }]);
    expect(code(() => readXlsx(encrypted))).toBe("bad_xlsx");
    const noSheet = zip([
      { name: "xl/workbook.xml", data: Buffer.from("<workbook><sheets/></workbook>") },
    ]);
    expect(code(() => readXlsx(noSheet))).toBe("bad_xlsx");
  });

  it("reads a hand-made workbook with prefixed tags, inline strings and escaped text", () => {
    const sheet = Buffer.from(
      `<x:worksheet><x:sheetData>
        <x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Name</x:t></x:is></x:c><x:c r="C1" t="str"><x:v>Note</x:v></x:c></x:row>
        <x:row r="3"><x:c r="A3" t="inlineStr"><x:is><x:r><x:t>Fish &amp; </x:t></x:r><x:r><x:t>Chips &#233;</x:t></x:r></x:is></x:c><x:c r="B3" t="e"><x:v>#N/A</x:v></x:c></x:row>
      </x:sheetData></x:worksheet>`,
    );
    const file = zip([
      { name: "xl/workbook.xml", data: workbookXml },
      { name: "xl/_rels/workbook.xml.rels", data: rels },
      { name: "xl/worksheets/sheet1.xml", data: sheet },
    ]);
    // The error cell (#N/A) reads as empty, and empty cells don't pad a row.
    expect(readXlsx(file)).toEqual([["Name", "", "Note"], [], ["Fish & Chips é"]]);
  });
});

describe("readXlsx: hostile workbooks fail fast (review findings)", () => {
  function tinyZip(sheetXml: string) {
    // One-part-at-a-time zip, stored (no compression) is enough here.
    const files: [string, string][] = [
      [
        "xl/workbook.xml",
        '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ],
      [
        "xl/_rels/workbook.xml.rels",
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ],
      ["xl/worksheets/sheet1.xml", sheetXml],
    ];
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [n, text] of files) {
      const data = deflateRawSync(Buffer.from(text));
      const name = Buffer.from(n);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(Buffer.byteLength(text), 22);
      local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(Buffer.byteLength(text), 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      locals.push(local, name, data);
      centrals.push(central, name);
      offset += 30 + name.length + data.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
  }
  const cellAt = (ref: string) => `<c r="${ref}" t="inlineStr"><is><t>x</t></is></c>`;

  it("refuses a cell far to the right before building the row", () => {
    const rows = Array.from(
      { length: 8000 },
      (_, i) => `<row r="${i + 1}">${cellAt(`XFD${i + 1}`)}</row>`,
    );
    expect(
      code(() =>
        readXlsx(tinyZip(`<worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`)),
      ),
    ).toBe("too_many_columns");
  });

  it("refuses a row past the row limit, but ignores empty formatted rows", () => {
    const far = `<worksheet><sheetData><row r="1">${cellAt("A1")}</row><row r="${MAX_ROWS + 2}">${cellAt(`A${MAX_ROWS + 2}`)}</row></sheetData></worksheet>`;
    expect(code(() => readXlsx(tinyZip(far)))).toBe("too_many_rows");
    const formatted = `<worksheet><sheetData><row r="1">${cellAt("A1")}</row><row r="900000"><c r="A900000" s="1"/></row></sheetData></worksheet>`;
    expect(readXlsx(tinyZip(formatted))).toEqual([["x"]]);
  });

  it("refuses unclosed tags at once, however many (no slow scanning)", () => {
    const unclosedPhonetic = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is>${"<rPh>".repeat(200_000)}</is></c></row></sheetData></worksheet>`;
    expect(code(() => readXlsx(tinyZip(unclosedPhonetic)))).toBe("bad_xlsx");
    // "<c " with no ">" anywhere near: the scan reaches the row's own ">" and refuses the huge
    // attribute text; "<c<c<c" isn't a cell tag at all and simply yields no cells. Both at once.
    const noCloseBracket = `<worksheet><sheetData><row r="1">${"<c ".repeat(500_000)}</row></sheetData></worksheet>`;
    expect(code(() => readXlsx(tinyZip(noCloseBracket)))).toBe("bad_xlsx");
    const glued = `<worksheet><sheetData><row r="1">${"<c".repeat(500_000)}</row></sheetData></worksheet>`;
    expect(readXlsx(tinyZip(glued))).toEqual([]);
  });

  it("refuses a character code outside Unicode, and drops control characters like NUL", () => {
    const outside = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&#99999999;</t></is></c></row></sheetData></worksheet>`;
    expect(code(() => readXlsx(tinyZip(outside)))).toBe("bad_xlsx");
    const nul = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Ad&#0;a&#9;B</t></is></c></row></sheetData></worksheet>`;
    expect(readXlsx(tinyZip(nul))).toEqual([["Ada\tB"]]);
  });
});

describe("date formats", () => {
  it.each([
    [14, undefined, "date"],
    [20, undefined, "time"],
    [22, undefined, "datetime"],
    [0, undefined, null],
    [164, "dd/mm/yyyy", "date"],
    [164, "d mmm yy", "date"],
    [164, "hh:mm", "time"],
    [164, "[h]:mm", "time"],
    [164, 'dd/mm/yyyy "at" hh:mm', "datetime"],
    [164, "mmm", "date"],
    [164, "0.00", null],
    [164, '"days" 0', null],
    [164, "[Red]0.00", null],
  ])("format %i %j is %s", (id, formatCode, kind) => {
    expect(dateKindOf(id, formatCode)).toBe(kind);
  });

  it("serials to text, in both date systems", () => {
    expect(formatSerial(46333, "date", false)).toBe("07/11/2026");
    expect(formatSerial(0.3333333, "time", false)).toBe("08:00");
    expect(formatSerial(44871, "date", true)).toBe("07/11/2026");
  });

  // Audit M15: a date with a time near midnight keeps its day (the audit's own probe).
  it("a time near midnight never moves the day", () => {
    const lastSecond = 46550 + 86399 / 86400; // 12/06/2027 23:59:59
    expect(formatSerial(lastSecond, "date", false)).toBe("12/06/2027");
    expect(formatSerial(lastSecond, "datetime", false)).toBe("12/06/2027 23:59");
    expect(formatSerial(46550 + 86370 / 86400, "datetime", false)).toBe("12/06/2027 23:59");
    expect(formatSerial(46550 + 86340 / 86400, "datetime", false)).toBe("12/06/2027 23:59");
    expect(formatSerial(46550 + 0.5, "datetime", false)).toBe("12/06/2027 12:00");
    // Float noise just under midnight is midnight, as Excel shows it; seconds don't round up a
    // minute (10:00:40 is 10:00, as Excel shows it).
    expect(formatSerial(45000.99999999999, "datetime", false)).toBe("16/03/2023 00:00");
    expect(formatSerial(45000 + (10 * 3600 + 40) / 86400, "time", false)).toBe("10:00");
  });
});

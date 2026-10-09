import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

// A record as a PDF (docs/office-v2.md 3.4; 12C.3): a title, the firm, each field as a label and its
// value (wrapped), and on every page "Produced by ShiftDesk from {firm}'s data on {when}." Built on
// the server with pdf-lib and fontkit. The text is in Noto Sans, embedded, so names such as Łukasz,
// Ştefan or Gülşen print: pdf-lib's built-in fonts cover only Western European letters and throw
// on anything else. The fonts are embedded whole: fontkit's own subsetting drops most glyphs of
// these fonts when drawn (the text still extracts, but the letters don't show), so the font files
// are cut down beforehand instead (Latin, Greek and Cyrillic; about 200 KB each). Noto Sans has no "✓" or "✗": those two come
// from a font cut down to just them (src/lib/pdf/fonts/README.md). A field whose value is "Yes" is
// printed "✓ Yes". The fonts are read from the repo once per process. Black text only (pdf-lib's
// default; labels in bold): a printed record, and no colour values outside the app's tokens.

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
const MARKS = new Set(["✓", "✗"]);

type FontFiles = { regular: Uint8Array; bold: Uint8Array; marks: Uint8Array };
let fontFiles: Promise<FontFiles> | null = null;
function loadFonts(): Promise<FontFiles> {
  fontFiles ??= Promise.all(
    ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "NotoSansSymbols2-Marks.ttf"].map((f) =>
      readFile(path.join(FONT_DIR, f)),
    ),
  ).then(([regular, bold, marks]) => ({
    regular: new Uint8Array(regular as Buffer),
    bold: new Uint8Array(bold as Buffer),
    marks: new Uint8Array(marks as Buffer),
  }));
  return fontFiles;
}

export interface PdfField {
  label: string;
  value: string;
}

export interface RecordPdfInput {
  title: string; // "Cancellation record 4F2A9C1B"
  firmName: string;
  fields: PdfField[];
  generatedAt: string; // "09:14 on Mon 2 Nov 2026", the firm's local time
  note?: string; // a line under the firm's name
}

// A4, in points.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 50;
const LABEL_WIDTH = 150;
const SIZE = 10;
const LINE = 14;

// Text as runs, each in the font that has its characters.
type Run = { text: string; font: PDFFont };
function runsOf(text: string, font: PDFFont, marks: PDFFont): Run[] {
  const runs: Run[] = [];
  for (const ch of text) {
    const f = MARKS.has(ch) ? marks : font;
    const last = runs.at(-1);
    if (last && last.font === f) last.text += ch;
    else runs.push({ text: ch, font: f });
  }
  return runs;
}
const widthOf = (text: string, font: PDFFont, marks: PDFFont, size: number) =>
  runsOf(text, font, marks).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);

function drawRuns(
  page: PDFPage,
  text: string,
  o: { x: number; y: number; size: number; font: PDFFont; marks: PDFFont },
) {
  let x = o.x;
  for (const r of runsOf(text, o.font, o.marks)) {
    page.drawText(r.text, { x, y: o.y, size: o.size, font: r.font });
    x += r.font.widthOfTextAtSize(r.text, o.size);
  }
}

// Words onto lines no wider than `width` (a word longer than a line is split).
function wrap(text: string, width: number, font: PDFFont, marks: PDFFont, size: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (widthOf(next, font, marks, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (widthOf(rest, font, marks, size) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && widthOf(rest.slice(0, cut), font, marks, size) > width) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

export async function recordPdf(input: RecordPdfInput): Promise<Uint8Array> {
  const files = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(input.title);
  doc.setProducer("ShiftDesk");
  doc.setCreator("ShiftDesk");
  const regular = await doc.embedFont(files.regular, { subset: false });
  const bold = await doc.embedFont(files.bold, { subset: false });
  const marks = await doc.embedFont(files.marks, { subset: false });
  const footer = `Produced by ShiftDesk from ${input.firmName}'s data on ${input.generatedAt}.`;
  const valueWidth = PAGE.width - MARGIN * 2 - LABEL_WIDTH;

  let page = doc.addPage([PAGE.width, PAGE.height]);
  const pages = [page];
  let y = PAGE.height - MARGIN - 18;
  drawRuns(page, input.title, { x: MARGIN, y, size: 18, font: bold, marks });
  y -= 22;
  drawRuns(page, input.firmName, { x: MARGIN, y, size: 12, font: regular, marks });
  if (input.note) {
    for (const text of wrap(input.note, PAGE.width - MARGIN * 2, regular, marks, SIZE)) {
      y -= LINE + 2;
      drawRuns(page, text, { x: MARGIN, y, size: SIZE, font: regular, marks });
    }
  }
  y -= 28;

  for (const field of input.fields) {
    const value = field.value === "Yes" ? "✓ Yes" : field.value;
    const label = wrap(field.label, LABEL_WIDTH - 10, bold, marks, SIZE);
    const lines = wrap(value, valueWidth, regular, marks, SIZE);
    const height = Math.max(label.length, lines.length) * LINE + 6;
    if (y - height < MARGIN + 30) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      pages.push(page);
      y = PAGE.height - MARGIN - SIZE;
    }
    label.forEach((text, i) =>
      drawRuns(page, text, {
        x: MARGIN,
        y: y - i * LINE,
        size: SIZE,
        font: bold,
        marks,
      }),
    );
    lines.forEach((text, i) =>
      drawRuns(page, text, {
        x: MARGIN + LABEL_WIDTH,
        y: y - i * LINE,
        size: SIZE,
        font: regular,
        marks,
      }),
    );
    y -= height;
  }

  for (const p of pages) {
    wrap(footer, PAGE.width - MARGIN * 2, regular, marks, 8).forEach((text, i) =>
      drawRuns(p, text, {
        x: MARGIN,
        y: MARGIN - i * 10,
        size: 8,
        font: regular,
        marks,
      }),
    );
  }
  return doc.save();
}

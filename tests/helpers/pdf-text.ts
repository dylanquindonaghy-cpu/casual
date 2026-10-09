import { readFileSync } from "node:fs";
import path from "node:path";
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

// Reading a PDF back in tests: its text, as a reader would extract it (pdfjs-dist), and the sizes
// of the fonts embedded in it.

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  await task.destroy();
  return pages.join("\n").replace(/\s+/g, " ");
}

// The size of each TrueType font file embedded in the PDF, decoded.
export async function embeddedFontSizes(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  const sizes: number[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const file = object.get(PDFName.of("FontFile2"));
    if (!file) continue;
    const stream = doc.context.lookup(file);
    if (stream instanceof PDFRawStream) sizes.push(decodePDFRawStream(stream).decode().length);
  }
  return sizes.sort((a, b) => a - b);
}

export const fontFileSizes = (): number[] =>
  ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "NotoSansSymbols2-Marks.ttf"]
    .map((f) => readFileSync(path.join(process.cwd(), "src", "lib", "pdf", "fonts", f)).length)
    .sort((a, b) => a - b);

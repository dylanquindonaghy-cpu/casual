import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { RECORD_TITLE } from "@/lib/portal/record-copy";
import { ATTENDANCE_TITLE } from "@/lib/portal/request-kinds";
import { SHIFT_NOT_AVAILABLE_TITLE } from "@/lib/portal/tab-titles";
import { TRAVEL_TITLE } from "@/lib/portal/travel-copy";

// Every page outside the office (and the client app and the /start chooser) names itself in the
// browser tab (Phase 37.6, w1-09; WCAG 2.4.2): the root layout turns `title: "Home"` into
// "Home · Acme Events shifts". This holds each page and the not-found page to the casual line in
// docs/screens.md ("Browser tab titles (Phase 11; Phase 37) read …"), so a page can't lose its
// title or gain one the doc doesn't name.

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");
const OUTSIDE = ["office", "client", "start", "e2e", "api"].map((d) => join(APP, d));

function pages(dir: string): string[] {
  if (OUTSIDE.includes(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" || name === "not-found.tsx" ? [path] : [];
  });
}

// Titles kept in a constant, by the constant's name.
const CONSTANTS: Record<string, string> = {
  TRAVEL_TITLE,
  RECORD_TITLE,
  ATTENDANCE_TITLE,
};

// The titles a page's metadata gives: quoted ones (a capital first), its constants', and a shift
// page's "Shift not available" (its formatter's other words are the shift's own role and day).
function titlesOf(source: string): string[] {
  const at = source.search(/export (const metadata|async function generateMetadata)/);
  if (at === -1) return [];
  const block = source.slice(at, source.indexOf("\n}\n", at) + 3);
  const lines = [...block.matchAll(/title:[^\n]*/g)].map((m) => m[0]).join("\n");
  const literal = [...lines.matchAll(/"([A-Z][^"]*)"/g)].map((m) => m[1]!);
  const constants = [...lines.matchAll(/\b([A-Z_]+_TITLE)\b/g)].map(
    (m) => CONSTANTS[m[1]!] ?? `unknown constant ${m[1]}`,
  );
  const shift = /\bshiftTabTitle\(/.test(block) ? [SHIFT_NOT_AVAILABLE_TITLE] : [];
  return [...new Set([...literal, ...constants, ...shift])];
}

// docs/screens.md, the casual line: "Browser tab titles (Phase 11; Phase 37) read "{page} · {firm}
// shifts": "Home", "Open shifts", … "(`tests/unit/casual.titles.test.ts` …".
function documented(): string[] {
  const doc = readFileSync(join(ROOT, "docs/screens.md"), "utf8");
  const lead = '- Browser tab titles (Phase 11; Phase 37) read "{page} · {firm} shifts": ';
  const at = doc.indexOf(lead);
  expect(at, "the casual tab-title line in docs/screens.md").toBeGreaterThan(-1);
  const end = doc.indexOf("casual.titles.test.ts", at);
  expect(end).toBeGreaterThan(at);
  return [...doc.slice(at + lead.length, end).matchAll(/"([^"]+)"/g)]
    .map((m) => m[1]!.replace(/\s+/g, " "))
    .filter((t) => !t.includes("{")); // a shift's own role and day: checked in tab-titles.test.ts
}

describe("casual tab titles", () => {
  const byPage = new Map(
    pages(APP).map((path) => [relative(ROOT, path), titlesOf(readFileSync(path, "utf8"))]),
  );

  it("finds the casual pages (a broken scan fails)", () => {
    for (const page of [
      "src/app/page.tsx",
      "src/app/shifts/[id]/page.tsx",
      "src/app/not-found.tsx",
    ])
      expect([...byPage.keys()]).toContain(page);
  });

  it("every page and the not-found page has a title of its own", () => {
    const untitled = [...byPage].filter(([, t]) => t.length === 0).map(([p]) => p);
    expect(untitled).toEqual([]);
  });

  it("every title a page uses is one docs/screens.md lists, and every listed one is used", () => {
    const used = new Set([...byPage.values()].flat());
    // The platform's own home keeps the root layout's "ShiftDesk" (no title of Home's there).
    const listed = new Set(documented().filter((t) => t !== "ShiftDesk"));
    expect([...used].sort()).toEqual([...listed].sort());
  });
});

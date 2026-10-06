import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Each office page names itself in the browser tab, first: the root layout's template turns
// `title: "Shifts"` into "Shifts · Acme Events shifts" (checked in the browser by
// tests/e2e/office.shifts.spec.ts). This holds every office page's own title to the list in
// docs/screens.md ("Browser tab titles read …"), so a page can't lose its title or gain one the
// doc doesn't name.

const ROOT = process.cwd();
const OFFICE = join(ROOT, "src/app/office");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

// The quoted titles a page's metadata gives ("Today" and "Home" from one generateMetadata). A
// title starts with a capital; an access area it checks ("today") doesn't.
function titlesOf(source: string): string[] {
  const at = source.search(/export (const metadata|async function generateMetadata)/);
  if (at === -1) return [];
  const block = source.slice(at, source.indexOf("\n}", at) + 2);
  const titles = block.match(/title:[^\n]*/)?.[0] ?? "";
  return [...titles.matchAll(/"([A-Z][^"]*)"/g)].map((m) => m[1]!);
}

// docs/screens.md, the office section's line: "Browser tab titles read "{page} · {firm} shifts":
// "Today" (payroll: "Home"), "Shifts", … "How-to guide". A shift's, … keep "{firm} shifts"."
function documentedTitles(): string[] {
  const doc = readFileSync(join(ROOT, "docs/screens.md"), "utf8");
  const lead = '- Browser tab titles read "{page} · {firm} shifts": ';
  const at = doc.indexOf(`${lead}"Today"`);
  expect(at, "the office tab-title line in docs/screens.md").toBeGreaterThan(-1);
  const list = doc.slice(at + lead.length, doc.indexOf("A shift's", at));
  // A title can wrap onto the next line in the doc ("New\n  shift").
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]!.replace(/\s+/g, " "));
}

describe("office tab titles", () => {
  const byPage = new Map(
    pages(OFFICE).map((path) => [relative(ROOT, path), titlesOf(readFileSync(path, "utf8"))]),
  );

  it("every office page's own title is one docs/screens.md lists, and every listed one is used", () => {
    const used = [...byPage.values()].flat().sort();
    expect(used).toEqual([...documentedTitles()].sort());
  });

  it("only the pages the doc says keep the firm's title have none of their own", () => {
    const untitled = [...byPage].filter(([, titles]) => titles.length === 0).map(([p]) => p);
    expect(untitled.sort()).toEqual(
      [
        // Outside the shell: logging in, and the link's landing page.
        "src/app/office/l/page.tsx",
        "src/app/office/login/page.tsx",
        // "A shift's, a worker's and a worker's data page keep "{firm} shifts"."
        "src/app/office/data/workers/[id]/page.tsx",
        "src/app/office/shifts/[id]/page.tsx",
        "src/app/office/workers/[id]/page.tsx",
        // Only sends you on to /office.
        "src/app/office/today/page.tsx",
      ].sort(),
    );
  });
});

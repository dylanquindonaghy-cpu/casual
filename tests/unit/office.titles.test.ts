import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cancellationTabTitle,
  casualTabTitle,
  eventTabTitle,
  sessionTabTitle,
  workerDataTabTitle,
} from "@/lib/office/tab-titles";

// Each office page names itself in the browser tab, first: the root layout's template turns
// `title: "Shifts"` into "Shifts · Acme Events shifts" (checked in the browser by
// tests/e2e/office.shifts.spec.ts). This holds every office page's own title, and the office's
// not-found page's, to the list in docs/screens.md ("Browser tab titles read …"), so a page can't
// lose its title or gain one the doc doesn't name. Since Phase 37.6 (w1-08, w1-09):
// - a detail page names what it shows through a formatter in src/lib/office/tab-titles.ts, each
//   one a pattern the doc's "Detail pages name what they show: …" sentence lists;
// - a gated page with a title of its own gives it through areaMetadata(area, …) with the same area
//   its page checks, so a role that can't open it sees "Page not found", never its name.

const ROOT = process.cwd();
const OFFICE = join(ROOT, "src/app/office");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}
// The office's not-found page has a title of its own too ("Page not found").
const files = [...pages(OFFICE), join(OFFICE, "not-found.tsx")];

// What each formatter writes, as the doc gives it (placeholders in braces), and a call with the
// doc's own example values: the two must agree.
const FORMATTERS: Record<string, { pattern: string; example: string }> = {
  casualTabTitle: { pattern: "{Aled Adeyemi} · Casuals", example: casualTabTitle("Aled Adeyemi") },
  workerDataTabTitle: {
    pattern: "{Aled Adeyemi} · Data requests",
    example: workerDataTabTitle("Aled Adeyemi"),
  },
  eventTabTitle: {
    pattern: "{Northern Lights Live} · {Staffing}",
    example: eventTabTitle("Northern Lights Live", "staffing"),
  },
  sessionTabTitle: {
    pattern: "{Door supervisor}, {Thu 12 Nov} · {Northern Lights Live}",
    example: sessionTabTitle({
      role: "door_supervisor",
      startsAt: new Date("2026-11-12T18:00:00Z"),
      timeZone: "Europe/London",
      eventName: "Northern Lights Live",
    }),
  },
  cancellationTabTitle: {
    pattern: "Cancellation {8CE76FA4} · {Ben Carter}",
    example: cancellationTabTitle("8CE76FA4", "Ben Carter"),
  },
};
const plain = (pattern: string) => pattern.replace(/[{}]/g, "");

// The metadata block of a page: its `export const metadata` or its generateMetadata.
function metadataBlock(source: string): string {
  const at = source.search(/export (const metadata|async function generateMetadata)/);
  if (at === -1) return "";
  return source.slice(at, source.indexOf("\n}\n", at) + 3);
}

// The quoted titles a page's metadata gives (each of a generateMetadata's too), and the doc
// pattern of each tab-title formatter it calls. A title starts with a capital; an access area it
// checks ("today") doesn't.
function titlesOf(source: string): string[] {
  const block = metadataBlock(source);
  const titles = block.match(/title:[^\n]*/)?.[0] ?? "";
  const literal = [...titles.matchAll(/"([A-Z][^"]*)"/g)].map((m) => m[1]!);
  const formatted = [...block.matchAll(/\b(\w+TabTitle)\(/g)].map(
    (m) => FORMATTERS[m[1]!]?.pattern ?? `unknown formatter ${m[1]}`,
  );
  return [...new Set([...literal, ...formatted])];
}

// docs/screens.md, the office section's line: "Browser tab titles read "{page} · {firm} shifts":
// "Dashboard" (payroll: "Home"), "Shifts", … "Page not found" (Phase 37). Detail pages name what
// they show: a casual "{Aled Adeyemi} · Casuals", … Each title runs …".
function documented(): { literal: string[]; patterns: string[] } {
  const doc = readFileSync(join(ROOT, "docs/screens.md"), "utf8");
  const lead = '- Browser tab titles read "{page} · {firm} shifts": ';
  const at = doc.indexOf(`${lead}"Dashboard"`);
  expect(at, "the office tab-title line in docs/screens.md").toBeGreaterThan(-1);
  const found = (re: RegExp, from: number) => {
    const m = re.exec(doc.slice(from));
    return m ? from + m.index : -1;
  };
  const detail = found(/Detail pages name what they\s+show:/, at);
  const end = found(/Each title\s+runs/, detail);
  expect(detail, "the detail pages' sentence").toBeGreaterThan(at);
  expect(end, "the end of the detail pages' sentence").toBeGreaterThan(detail);
  // A title can wrap onto the next line in the doc ("New\n  shift").
  const quoted = (text: string) =>
    [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!.replace(/\s+/g, " "));
  return {
    literal: quoted(doc.slice(at + lead.length, detail)),
    // The detail pages' patterns, without the one for two records sharing a reference (a
    // cancellationTabTitle with no casual: checked in tests/unit/tab-titles.test.ts).
    patterns: quoted(doc.slice(detail, end)).filter((p) => p !== "Cancellation {8CE76FA4}"),
  };
}

describe("office tab titles", () => {
  const sources = new Map(files.map((path) => [relative(ROOT, path), readFileSync(path, "utf8")]));
  const byPage = new Map([...sources].map(([p, s]) => [p, titlesOf(s)]));

  it("every office page's own title is one docs/screens.md lists, and every listed one is used", () => {
    const used = new Set([...byPage.values()].flat());
    const { literal, patterns } = documented();
    expect([...used].sort()).toEqual([...new Set([...literal, ...patterns])].sort());
  });

  it("each detail page's formatter writes the doc's pattern", () => {
    for (const [name, f] of Object.entries(FORMATTERS)) {
      expect(f.example, name).toBe(plain(f.pattern));
    }
  });

  it("only the pages that send you on have no title of their own", () => {
    const untitled = [...byPage].filter(([, titles]) => titles.length === 0).map(([p]) => p);
    expect(untitled.sort()).toEqual(
      [
        // Only send you on: to /office, from Workers to Casuals (12F.1), and from Requests to
        // Enquiries' "Requests from the app" (12D.1).
        "src/app/office/requests/page.tsx",
        "src/app/office/today/page.tsx",
        "src/app/office/workers/page.tsx",
        "src/app/office/workers/[id]/page.tsx",
        // For the browser tests only (Phase 37.6): it says "It worked this time".
        "src/app/office/e2e/fails-once/page.tsx",
      ].sort(),
    );
  });

  it("a gated page's own title gives way to 'Page not found' for a role that can't open it", () => {
    for (const [path, source] of sources) {
      const areas = [
        ...new Set([...source.matchAll(/requireOfficeArea\("([a-z_]+)"\)/g)].map((m) => m[1])),
      ];
      const titles = byPage.get(path) ?? [];
      if (areas.length === 0 || titles.length === 0) continue;
      const block = metadataBlock(source);
      // Never a static title on a page whose body refuses some roles.
      expect(source, path).not.toMatch(/export const metadata: Metadata = \{[^}]*title/);
      expect(block, path).toMatch(/^export async function generateMetadata/);
      if (/\w+TabTitle\(/.test(block)) {
        // A detail page: its record is read after the page's own check (requireOfficeArea throws
        // "not found" for a role without the area, so the tab is the not-found page's).
        expect(areas, path).toHaveLength(1);
      } else {
        expect(block, path).toContain(`areaMetadata("${areas[0]}", { title: "${titles[0]}" })`);
        expect(areas, path).toHaveLength(1);
      }
    }
  });
});

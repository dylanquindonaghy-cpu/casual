import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The office pages follow docs/ui-design.md: each opens with the shared PageHeader (its one <h1>),
// and every list whose bullets are styled away keeps role="list" (Safari stops announcing it as a
// list otherwise; only lists with real bullets, `list-disc` or `list-[square]`, don't need it).
// Read from the source, so every page and form is covered, shown in a browser test or not.

const ROOT = process.cwd();
const OFFICE = join(ROOT, "src/app/office");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

const all = files(OFFICE);
const rel = (path: string) => relative(ROOT, path);
const usesPageHeader = (path: string) => /<PageHeader\b/.test(readFileSync(path, "utf8"));

describe("office pages", () => {
  it("each page opens with the shared PageHeader, itself or through its folder's view", () => {
    const pages = all.filter((p) => p.endsWith("/page.tsx"));
    const without = pages.filter((page) => {
      if (usesPageHeader(page)) return false;
      // A page that hands its content to a view in its own folder (offer-view.tsx, guide-view.tsx).
      const views = all.filter((p) => dirname(p) === dirname(page) && p.endsWith("-view.tsx"));
      return !views.some(usesPageHeader);
    });
    expect(without.map(rel).sort()).toEqual(
      [
        // Outside the shell, with the login card's own title (docs/ui-design.md, `loginTitle`).
        "src/app/office/login/page.tsx",
        "src/app/office/l/page.tsx",
        // Only send you on: to /office, from Workers to Casuals (12F.1), and from Requests to
        // Enquiries' "Requests from the app" (12D.1).
        "src/app/office/requests/page.tsx",
        "src/app/office/today/page.tsx",
        "src/app/office/workers/page.tsx",
        "src/app/office/workers/[id]/page.tsx",
      ].sort(),
    );
  });

  it('a list whose bullets are styled away keeps role="list"', () => {
    const missing: string[] = [];
    let lists = 0;
    for (const path of all) {
      for (const m of readFileSync(path, "utf8").matchAll(/<(?:ul|ol)\b[^>]*>/g)) {
        lists++;
        const tag = m[0];
        if (/list-(disc|decimal|\[square\])/.test(tag)) continue;
        if (!tag.includes('role="list"')) missing.push(`${rel(path)}: ${tag.replace(/\s+/g, " ")}`);
      }
    }
    expect(lists).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});

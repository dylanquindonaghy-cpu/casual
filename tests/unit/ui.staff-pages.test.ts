import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The staff pages follow docs/ui-design.md, like the office's (tests/unit/ui.office-pages.test.ts):
// each opens with the shared PageHeader (the login pages with the login card's one <h1>, the
// error pages with their one <h1>), and every list whose bullets are styled away keeps
// role="list" (Safari stops announcing it as a list otherwise). Read from the source.

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");
// Not staff pages: the office (its own test), the shared pieces, the API and the test-only page.
const NOT_STAFF = ["office", "ui", "api", "e2e"].map((d) => join(APP, d));

function files(dir: string): string[] {
  if (NOT_STAFF.includes(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

const all = files(APP);
const rel = (path: string) => relative(ROOT, path);
const read = (path: string) => readFileSync(path, "utf8");

// The page and the files it imports from its own folder ("./my-shifts-view" and so on).
function pageAndViews(page: string): string[] {
  const own = [...read(page).matchAll(/from "\.\/([^"]+)"/g)].map((m) => m[1]!);
  return [
    page,
    ...own.map((name) => join(dirname(page), `${name}.tsx`)).filter((p) => all.includes(p)),
  ];
}

describe("staff pages", () => {
  it("each page opens with the shared PageHeader, itself or through a view in its folder", () => {
    const pages = all.filter((p) => p.endsWith("/page.tsx"));
    expect(pages.length).toBeGreaterThan(10);
    const without = pages.filter(
      (page) => !pageAndViews(page).some((f) => /<PageHeader\b/.test(read(f))),
    );
    expect(without.map(rel).sort()).toEqual([
      // The strikes team's confirmation link (12B.7): the login link's layout.
      "src/app/confirm-email/page.tsx",
      "src/app/l/page.tsx",
      "src/app/login/page.tsx",
      // Phase 18: Home's heading is the greeting with "Updated …" beside it (home-view.tsx), its
      // one <h1> (below).
      "src/app/page.tsx",
    ]);
    expect(read(join(ROOT, "src/app/home-view.tsx")).match(/<h1\b/g)).toHaveLength(1);
  });

  it("the login pages and the error pages open with their one <h1>", () => {
    for (const page of [
      "src/app/l/page.tsx",
      "src/app/login/page.tsx",
      "src/app/confirm-email/page.tsx",
    ]) {
      expect(read(join(ROOT, page)).match(/<h1 className=\{loginTitle\}>/g), page).toHaveLength(1);
    }
    for (const page of [
      "src/app/error-body.tsx",
      "src/app/not-found.tsx",
      "src/app/global-error.tsx",
    ]) {
      expect(read(join(ROOT, page)).match(/<h1\b/g), page).toHaveLength(1);
    }
  });

  it('a list whose bullets are styled away keeps role="list"', () => {
    const missing: string[] = [];
    let lists = 0;
    for (const path of all) {
      for (const m of read(path).matchAll(/<(?:ul|ol)\b[^>]*>/g)) {
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

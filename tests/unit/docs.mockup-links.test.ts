import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The mock-ups docs/screens.md points to (CLAUDE.md "How to work each task": anything that changes
// how a screen looks has a mock-up, before and after, at a phone's width and a laptop's). Every
// mock-up the words name is on disk, and 28.5's section names its own: its guardrails review found
// "Mock-up: none for this task" where the task's done-when said "the mock-up is published".

const ROOT = process.cwd();
const SCREENS = readFileSync(join(ROOT, "docs/screens.md"), "utf8");

// One "### …" section of screens.md, up to the next heading of that level or above.
function section(heading: string): string {
  const start = SCREENS.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const rest = SCREENS.slice(start + heading.length + 2);
  const end = rest.search(/\n#{1,3} /);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("the mock-ups screens.md names", () => {
  it("every docs/mockups path it names is on disk", () => {
    const paths = [...SCREENS.matchAll(/docs\/mockups\/[A-Za-z0-9._/-]*[A-Za-z0-9/]/g)].map(
      (m) => m[0],
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });

  it("28.5 names its before-and-after mock-up, at 390px and 1,280px, with its pictures beside it", () => {
    const words = section("### 28.5");
    expect(words).toContain("**A shift's page**");
    expect(words).toContain("`docs/mockups/phase-28/28.5/index.html`");
    expect(words).not.toContain("none for this task");
    const dir = join(ROOT, "docs/mockups/phase-28/28.5");
    const html = readFileSync(join(dir, "index.html"), "utf8");
    expect(html).toContain("Before 28.5");
    expect(html).toContain("After 28.5");
    expect(html).toContain("390px");
    expect(html).toContain("1,280px at 150%");
    const pictures = [...html.matchAll(/\bsrc="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(pictures.length).toBeGreaterThan(0);
    for (const src of pictures) expect(existsSync(join(dir, src)), src).toBe(true);
  });
});

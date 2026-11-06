import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REASONS } from "@/lib/rules/reasons";
import { OFFICE_REASON_CODES } from "@/lib/portal/shift-page-copy";
import { removeTravelText, saveTravelText } from "@/lib/portal/travel-copy";

// Phase 28's dead-end guard (28.16; docs/screens.md "### 28.16"; the review's major 1, "Contact the
// office … and 12 other places"): a logged-in casual is never told to "contact the office" with
// nothing to tap. Each way to the office is a "Message the office" link to her Messages. This scans
// the casual-facing source (src/app outside the office, src/lib/portal and src/lib/travel), and the
// rules' reasons (src/lib/rules/reasons.ts) the casual's shift page shows, comments left out.
//
// The named allow-list, each with its reason:
//   - pages for someone logged out, who has no Messages to go to: the login page
//     (login-form.tsx), and the error pages (global-error.tsx, error-body.tsx), which show when the
//     app itself has failed and may have no session to show;
//   - the rules' not_active, credential_suspended and blocked_site (src/lib/rules/reasons.ts):
//     the office reads the same words, so they stay, and the casual's shift page puts a "Message
//     the office" link with them (28.5: OFFICE_REASON_CODES).
// The spec's travel-copy.ts:72 and 90 ("Your account isn't active … Contact the office.") aren't
// on it: 28.16 words them "… Message the office." with the link (/profile/travel), as the hand-off
// asked, since an inactive casual can still send a message.

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}

const FILES = [
  ...walk("src/app").filter((p) => !p.split("\\").join("/").startsWith("src/app/office/")),
  ...walk("src/lib/portal"),
  ...walk("src/lib/travel"),
  "src/lib/rules/reasons.ts",
]
  .map((p) => relative(ROOT, join(ROOT, p)).split("\\").join("/"))
  .filter((p) => /\.tsx?$/.test(p))
  .sort();

// Comments are notes for builders, not words she reads.
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const DEAD_END = /contact\s+the\s+office/i;

const ALLOWED: { file: string; line: string; reason: string }[] = [
  {
    file: "src/app/login/login-form.tsx",
    line: "Please contact the office the way you usually do.",
    reason: "logged out: login links aren't switched on, and there's no Messages without a login",
  },
  {
    file: "src/app/login/login-form.tsx",
    line: "No text after 2 minutes? Check the number and try again, or contact the office.",
    reason: "logged out: the login link hasn't come, and there's no Messages without a login",
  },
  {
    file: "src/app/global-error.tsx",
    line: "If it keeps happening, contact the office.",
    reason: "the app itself failed: the page may have no session, and Messages may not open",
  },
  {
    file: "src/app/error-body.tsx",
    line: "If it keeps happening, contact the office.",
    reason: "the app itself failed: the page may have no session, and Messages may not open",
  },
  {
    file: "src/lib/rules/reasons.ts",
    line: "not_active:",
    reason: "shared with the office; the casual's shift page adds a Message the office link (28.5)",
  },
  {
    file: "src/lib/rules/reasons.ts",
    line: "credential_suspended:",
    reason: "shared with the office; the casual's shift page adds a Message the office link (28.5)",
  },
  {
    file: "src/lib/rules/reasons.ts",
    line: "blocked_site:",
    reason: "shared with the office; the casual's shift page adds a Message the office link (28.5)",
  },
];

interface Hit {
  file: string;
  line: string;
}

function hitsIn(file: string, source: string): Hit[] {
  return code(source)
    .split("\n")
    .filter((line) => DEAD_END.test(line))
    .map((line) => ({ file, line }));
}

const allowedBy = (hit: Hit) =>
  ALLOWED.find((a) => a.file === hit.file && hit.line.includes(a.line));

const ALL_HITS = FILES.flatMap((file) => hitsIn(file, readFileSync(join(ROOT, file), "utf8")));

describe("no 'Contact the office' dead end for a logged-in casual (Phase 28, 28.16)", () => {
  it("scans the casual-facing source and not the office's", () => {
    expect(FILES.length).toBeGreaterThan(150);
    expect(FILES).toEqual(
      expect.arrayContaining([
        "src/app/login/login-form.tsx",
        "src/app/profile/travel/travel-form.tsx",
        "src/lib/portal/travel-copy.ts",
        "src/lib/portal/shift-page-copy.ts",
        "src/lib/rules/reasons.ts",
      ]),
    );
    expect(FILES.some((f) => f.startsWith("src/lib/travel/"))).toBe(true);
    expect(FILES.filter((f) => f.startsWith("src/app/office/"))).toEqual([]);
  });

  it("sees what it checks: the words in code, across a line break or in capitals, not in a comment", () => {
    const sample = [
      'const a = "Contact the office.";',
      "const b = `If it keeps happening, contact  the office`;",
      '// "Contact the office" here is a note',
      "/* contact the office */",
    ].join("\n");
    expect(hitsIn("sample.ts", sample).map((h) => h.line.trim())).toEqual([
      'const a = "Contact the office.";',
      "const b = `If it keeps happening, contact  the office`;",
    ]);
  });

  it("finds none outside the named allow-list", () => {
    const stray = ALL_HITS.filter((h) => !allowedBy(h)).map((h) => `${h.file}: ${h.line.trim()}`);
    expect(stray).toEqual([]);
  });

  it("every allow-list entry is still needed, and says why", () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(20);
      expect(
        ALL_HITS.some((h) => allowedBy(h) === entry),
        `${entry.file} "${entry.line}": not needed any more`,
      ).toBe(true);
    }
  });

  it("the rules' three office reasons are ones the shift page puts a Message the office link with", () => {
    for (const code of ["not_active", "credential_suspended", "blocked_site"] as const) {
      expect(OFFICE_REASON_CODES).toContain(code);
    }
    expect(REASONS.not_active()).toMatch(DEAD_END);
    expect(REASONS.blocked_site()).toMatch(DEAD_END);
    expect(REASONS.credential_suspended("SIA licence")).toMatch(DEAD_END);
  });

  it("/profile/travel's inactive account: 'Message the office', not a dead end", () => {
    const saved = saveTravelText({ status: "not_active" });
    const removed = removeTravelText({ status: "not_active" });
    expect(saved).toBe("Your account isn't active, so nothing was saved. Message the office.");
    expect(removed).toBe("Your account isn't active. Message the office.");
    for (const words of [saved, removed]) expect(words).not.toMatch(DEAD_END);
  });
});

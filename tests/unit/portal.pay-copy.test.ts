import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MESSAGE_OFFICE, NO_CODE_SENDER, PAY_CODE, SIX_DIGIT } from "@/lib/portal/pay-copy";
import { PROBLEM_LINKS, PROBLEM_WORDS } from "@/lib/portal/pay-query-kinds";

// Phase 28.10 (docs/screens.md "### 28.10"): the pay pages' words. "6‑digit" with a non-breaking
// hyphen (U+2011) in every code string, so it never splits across two lines on a phone; the pay day
// card shows with no code and no pay figure; and every way out of Pay is a link to Messages, never
// "contact the office" with nothing to tap.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/pay",
}));

const { CodeGate } = await import("@/app/pay/code-gate");
const { PayDayCard, PayQueries } = await import("@/app/pay/pay-view");

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const html = (el: ReactElement) => renderToStaticMarkup(el);

const NB = "‑";
const WAYS = ["message", "email"] as const;

describe("'6‑digit' never splits", () => {
  it("is the non-breaking hyphen", () => {
    expect(SIX_DIGIT).toBe(`6${NB}digit`);
    expect(SIX_DIGIT).not.toContain("-");
  });

  it("in every code string, both ways", () => {
    const strings = WAYS.flatMap((way) =>
      Object.values(PAY_CODE).map((v) => (typeof v === "function" ? v(way) : v)),
    );
    const naming = strings.filter((s) => /digit/.test(s));
    expect(naming.length).toBeGreaterThanOrEqual(7);
    for (const s of naming) {
      expect(s).toContain(SIX_DIGIT);
      expect(s).not.toMatch(/6-digit/);
    }
    expect(PAY_CODE.queryIntro).toBe(
      `Enter your 6${NB}digit code first. Then you'll come straight back here.`,
    );
  });

  it("on every code card, on Pay and on the pay query", () => {
    for (const way of WAYS)
      for (const codeWaiting of [false, true])
        for (const purpose of ["pay", "query"] as const) {
          const page = html(createElement(CodeGate, { way, codeWaiting, purpose }));
          expect(page).toContain(SIX_DIGIT);
          expect(page).not.toMatch(/6-digit/);
        }
  });

  it("in no string of the pay pages' code", () => {
    const files = [
      ...readdirSync(join(process.cwd(), "src/app/pay"), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
        .map((e) => join(e.parentPath, e.name)),
      ...["pay-copy.ts", "pay-query-kinds.ts", "pay-queries.ts"].map((f) =>
        join(process.cwd(), "src/lib/portal", f),
      ),
    ];
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) expect(readFileSync(file, "utf8")).not.toMatch(/6-digit/);
  });
});

describe("the pay day card, before the code", () => {
  const card = (pay: Parameters<typeof PayDayCard>[0]["pay"]) =>
    html(createElement(PayDayCard, { pay }));

  it("a week: the same words as Home's pay row, and nothing of her pay", () => {
    const page = card({ payDay: "2026-11-13", days: 7, start: "2026-11-02", end: "2026-11-08" });
    expect(strip(page)).toBe("Fri 13 Pay day: Fri 13 Nov For shifts Mon 2 to Sun 8 Nov");
    expect(page).toMatch(/<h2 id="pay-day"[^>]*>Pay day: Fri 13 Nov<\/h2>/);
    expect(page).toContain('aria-labelledby="pay-day"');
    // A day and dates only: no amount, rate or hours (golden rule 9).
    expect(page).not.toMatch(/£|hour|Pay before tax/);
  });

  it("a fortnight names its first and last days", () => {
    const page = card({ payDay: "2026-11-13", days: 14, start: "2026-10-26", end: "2026-11-08" });
    expect(strip(page)).toContain("For shifts from Mon 26 Oct to Sun 8 Nov");
  });

  it("is drawn before the code: the page renders it outside the code's branch", () => {
    // src/app/pay/page.tsx: the card is loaded for everyone, and shown above the code gate.
    const page = readFileSync(join(process.cwd(), "src/app/pay/page.tsx"), "utf8");
    expect(page).toMatch(/const payDay = <PayDayCard pay=\{await myPayDay\(/);
    expect(page.indexOf("{payDay}")).toBeGreaterThan(-1);
    expect(page.indexOf("{payDay}")).toBeLessThan(page.indexOf("<CodeGate"));
  });
});

describe("no dead end on Pay", () => {
  it("no code sender: 'Message the office', on Pay and on the pay query", () => {
    expect(MESSAGE_OFFICE).toEqual({ href: "/messages", label: "Message the office" });
    for (const purpose of ["pay", "query"] as const)
      for (const codeWaiting of [false, true]) {
        const page = html(createElement(CodeGate, { way: "off", codeWaiting, purpose }));
        expect(page).toContain('href="/messages"');
        expect(page).not.toContain("<button");
        expect(page).not.toContain("<input");
        expect(strip(page)).toBe(
          `${NO_CODE_SENDER[purpose].title} ${NO_CODE_SENDER[purpose].body} Message the office`,
        );
        expect(strip(page)).not.toMatch(/contact the office/i);
      }
  });

  it("too old: 'message the office' is a link to Messages", () => {
    expect(PROBLEM_WORDS.too_old).toBe(
      "Pay queries can go back 90 days. For anything older, message the office.",
    );
    expect(PROBLEM_LINKS.too_old?.href).toBe("/messages");
  });

  it("no 'contact the office' in any of the pay pages' files", () => {
    for (const file of [
      "src/app/pay/code-gate.tsx",
      "src/app/pay/pay-view.tsx",
      "src/app/pay/page.tsx",
      "src/app/pay/query/page.tsx",
      "src/app/pay/query/pay-query-form.tsx",
      "src/lib/portal/pay-copy.ts",
      "src/lib/portal/pay-query-kinds.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(source, file).not.toMatch(/contact the office/i);
    }
  });
});

describe("payroll's answers on Pay", () => {
  const sorted = {
    ref: "0F0F0F0F",
    issue: "wrong_rate" as const,
    day: "2026-10-29",
    status: "resolved",
    sortedOn: "2026-11-03",
    note: "Paid on Friday.",
  };
  const waiting = {
    ref: "3F2A9C1B",
    issue: "late_pay" as const,
    day: "2026-10-31",
    status: "open",
  };

  it("with a new answer, its row is watched to mark it seen (once on screen)", () => {
    const page = html(
      createElement(PayQueries, {
        queries: [waiting, sorted],
        newAnswers: true,
        shownAt: "2026-11-04T09:00:00.000Z",
      }),
    );
    expect(page.match(/data-pay-answer=""/g)).toHaveLength(1);
    // The watched row is the sorted one.
    const at = page.indexOf('data-pay-answer=""');
    expect(page.slice(at)).toContain("Answered by payroll on Tue 3 Nov");
    expect(page.slice(at, page.indexOf("</li>", at))).not.toContain("With payroll");
  });

  it("nothing new, or nothing sorted: nothing is watched", () => {
    for (const props of [
      { queries: [waiting, sorted], newAnswers: false, shownAt: "2026-11-04T09:00:00.000Z" },
      { queries: [waiting], newAnswers: true, shownAt: "2026-11-04T09:00:00.000Z" },
      { queries: [waiting, sorted] },
    ]) {
      expect(html(createElement(PayQueries, props))).not.toContain("data-pay-answer");
    }
  });
});

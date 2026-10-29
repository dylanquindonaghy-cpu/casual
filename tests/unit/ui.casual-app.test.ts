import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PayLine } from "@/lib/portal/pay-format";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import type { ShiftFacts } from "@/lib/portal/shift-facts";

// The casual app as round 7 of the canvas has it (Phase 24, 24.6; docs/mockups/phase-24/README.md
// "The casual app (390px)"): the firm's bar and the tab bar as you scroll, with JavaScript and
// without; Pay's weeks and the total rule; "You're booked." over the whole screen; a shift's page
// in its other states; and Home's kept copy (no signal). Rendered to HTML, or read from the source.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {}, push() {} }),
  usePathname: () => "/",
}));
const { chromeAfterScroll } = await import("@/lib/portal/chrome");
const { payWeeks } = await import("@/lib/portal/pay-format");
const { TabBar } = await import("@/app/tab-bar");
const { BrandBar } = await import("@/app/brand-bar");
const { PayView } = await import("@/app/pay/pay-view");
const { TakeShiftResult } = await import("@/app/shifts/open/take-shift-result");
const { ShiftView } = await import("@/app/shifts/[id]/shift-view");
const { HomeView } = await import("@/app/home-view");

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}
const SOURCE = files("src");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("the chrome as you scroll (src/lib/portal/chrome.ts)", () => {
  const top = { scrolled: false, mini: false, last: 0 };

  it("at the top: open, nothing under the bar", () => {
    expect(chromeAfterScroll(0, top)).toEqual({ scrolled: false, mini: false, last: 0 });
  });

  it("scrolling down shrinks the tab bar to its icons, the page under the firm's bar", () => {
    expect(chromeAfterScroll(200, top)).toEqual({ scrolled: true, mini: true, last: 200 });
  });

  it("a finger's wobble (6px or less either way) changes nothing", () => {
    const down = { scrolled: true, mini: true, last: 200 };
    expect(chromeAfterScroll(206, down)).toEqual(down);
    expect(chromeAfterScroll(194, down)).toEqual(down);
    const up = { scrolled: true, mini: false, last: 200 };
    expect(chromeAfterScroll(205, up)).toEqual(up);
  });

  it("scrolling up opens it again; near the top (under 24px) it's always open", () => {
    const down = { scrolled: true, mini: true, last: 400 };
    expect(chromeAfterScroll(390, down)).toEqual({ scrolled: true, mini: false, last: 390 });
    expect(chromeAfterScroll(20, { ...down, last: 18 })).toEqual({
      scrolled: true,
      mini: false,
      last: 20,
    });
    expect(chromeAfterScroll(0, down)).toEqual({ scrolled: false, mini: false, last: 0 });
  });
});

describe("the firm's bar and the tab bar, with JavaScript and without", () => {
  it("only ChromeWatch sets the chrome's marks on <html>, and only outside the office", () => {
    // On <html> (`root`): only ChromeWatch. The office's top bar marks only itself (`el`).
    const onRoot = SOURCE.filter((f) =>
      /\broot\.dataset\.(?:js|scrolled|tabsMini)\s*=|documentElement\.dataset\.(?:js|scrolled|tabsMini)\s*=/.test(
        read(f),
      ),
    );
    expect(onRoot).toEqual(["src/app/chrome-watch.tsx"]);
    const others = SOURCE.filter(
      (f) => f !== "src/app/chrome-watch.tsx" && /dataset\.(?:js|tabsMini)\s*=/.test(read(f)),
    );
    expect(others).toEqual([]);
    expect(read("src/app/office/office-frame.tsx")).toMatch(/\bel\.dataset\.scrolled = "";/);
    const watch = read("src/app/chrome-watch.tsx");
    expect(watch).toMatch(/^"use client";/);
    expect(watch).toContain('if (document.querySelector("[data-shell=office]")) return;');
    // A tap on the tab bar opens it again.
    expect(watch).toContain('e.target.closest("[data-tab-bar]")');
    expect(watch).toContain('window.addEventListener("scroll", onScroll, { passive: true });');
  });

  it("the firm's bar: in the page without JavaScript; with it, at the top, frosting once scrolled under", () => {
    const html = renderToStaticMarkup(
      createElement(BrandBar, {
        brand: { name: "Acme Events", logoUrl: null } as Parameters<typeof BrandBar>[0]["brand"],
      }),
    );
    expect(html).toMatch(
      /^<header data-testid="brand-bar" class="scroll-edge relative z-20 text-ink \[body:has\(\[data-own-bar\]\)_&amp;\]:hidden \[body:has\(\[data-shell=office\]\)_&amp;\]:hidden \[html\[data-js\]_&amp;\]:sticky \[html\[data-js\]_&amp;\]:top-0">/,
    );
    // No sticky of its own: only under html[data-js].
    const classes = /class="([^"]*)"/.exec(html.slice(0, html.indexOf(">")))?.[1]?.split(" ") ?? [];
    expect(classes).not.toContain("sticky");
    expect(classes).toContain("[html[data-js]_&amp;]:sticky");
    expect(read("src/app/brand-bar.tsx")).toMatch(/<header[\s\S]*?>\s*<ChromeWatch \/>/);
    // The frosted edge shows only while the page is under it.
    expect(read("src/app/globals.css")).toMatch(
      /:where\(\[data-scrolled\]\) &::before,\s*&:where\(\[data-scrolled\]\)::before \{\s*opacity: 1;/,
    );
  });

  it("the tab bar: plain links, server-rendered, whole without JavaScript; shrunk only by the mark JavaScript sets", () => {
    const source = read("src/app/tab-bar.tsx");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/\bon[A-Z][a-zA-Z]*=/);
    const html = renderToStaticMarkup(createElement(TabBar, { current: "shifts" }));
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["/", "/shifts", "/pay", "/profile"]);
    expect(html).not.toMatch(/<button|onclick/i);
    // Every shrinking rule hangs off html[data-tabs-mini]; without it (no JavaScript) the capsule
    // is 68px tall with every word shown.
    const mini = [...html.matchAll(/\[html\[data-tabs-mini\]_&amp;\]:([\w.-]+)/g)].map((m) => m[1]);
    expect(mini).toEqual([
      "h-13.5",
      "max-w-72.5",
      "p-1.25",
      "sr-only",
      "sr-only",
      "sr-only",
      "sr-only",
    ]);
    expect(html).toMatch(/class="glass-float pointer-events-auto mx-auto grid h-17 max-w-md /);
  });

  it("the page leaves room for the floating tab bar, and a shift's own page has none", () => {
    expect(read("src/app/tab-bar.tsx")).toMatch(
      /export function TabBarSpace\(\) \{\s*return <div aria-hidden="true" className="h-28" \/>;/,
    );
    expect(read("src/app/shifts/[id]/page.tsx")).not.toMatch(/TabBar/);
  });
});

describe("Pay: each week, and its total only when payroll gave every gross", () => {
  const line = (o: Partial<PayLine>): PayLine => ({
    periodStart: "2026-10-19",
    periodEnd: "2026-10-25",
    hours: 16,
    ratePence: 1250,
    grossPence: 20000,
    payDate: "2026-10-30",
    ...o,
  });
  const zoe = [
    line({ hours: 8, ratePence: 1550, grossPence: 12400 }),
    line({}),
    line({ periodStart: "2026-10-12", periodEnd: "2026-10-18", payDate: "2026-10-23" }),
  ];

  it("groups the lines by period, newest first, lowest rate first; the total is the sum of payroll's grosses", () => {
    expect(payWeeks(zoe)).toEqual([
      {
        periodStart: "2026-10-19",
        periodEnd: "2026-10-25",
        lines: [zoe[1], zoe[0]],
        totalPence: 32400,
        payDates: ["2026-10-30"],
      },
      {
        periodStart: "2026-10-12",
        periodEnd: "2026-10-18",
        lines: [zoe[2]],
        totalPence: 20000,
        payDates: ["2026-10-23"],
      },
    ]);
  });

  it("no total when a line has no gross; never worked out from hours and rate", () => {
    const [week] = payWeeks([line({}), line({ hours: 4, ratePence: 1550, grossPence: null })]);
    expect(week?.totalPence).toBeNull();
    // A zero gross is a gross payroll gave.
    expect(payWeeks([line({ grossPence: 0 })])[0]?.totalPence).toBe(0);
    // Two pay days, each once, soonest first; none given, none.
    expect(
      payWeeks([
        line({ payDate: "2026-11-06" }),
        line({ ratePence: 1550, payDate: "2026-10-30" }),
      ])[0]?.payDates,
    ).toEqual(["2026-10-30", "2026-11-06"]);
    expect(payWeeks([line({ payDate: null })])[0]?.payDates).toEqual([]);
    expect(payWeeks([])).toEqual([]);
  });

  const render = (lines: PayLine[]) =>
    renderToStaticMarkup(createElement(PayView, { lines, firmName: "Acme Events" }));
  const section = (html: string, id: string) => {
    const at = html.indexOf(`aria-labelledby="${id}"`);
    return at < 0 ? "" : html.slice(at, html.indexOf("</section>", at));
  };

  it("the newest week: its dates, Gross pay and the total large, a glass row per rate, the pay date on a warm chip", () => {
    const html = render(zoe);
    const top = section(html, "latest-pay");
    expect(top).toMatch(
      /^aria-labelledby="latest-pay" data-pay-week="2026-10-19" class="mt-5 glass /,
    );
    expect(text(top.slice(top.indexOf(">") + 1))).toBe(
      "Mon 19 Oct to Sun 25 Oct Gross pay Gross pay: £324.00 16 hours at £12.50 an hour 8 hours at £15.50 an hour Pay date: Fri 30 Oct",
    );
    expect(top).toMatch(
      /<span data-pay-total="" class="font-stat text-4xl text-ink"><span class="sr-only">Gross pay: <\/span>£324\.00<\/span>/,
    );
    expect(top.match(/data-pay-line="" class="glass-tile /g)).toHaveLength(2);
    // With a total, no line repeats a gross.
    expect(top.match(/Gross pay: /g)).toHaveLength(1);
    expect(top).toMatch(/<p class="glass-band glass-rim w-fit [^"]*">Pay date: Fri 30 Oct<\/p>/);
    expect(text(html)).toContain("The last 8 weeks, from Acme Events' payroll.");
  });

  it("a newest week with a line payroll gave no gross for: no total, each other line's own gross", () => {
    const top = section(
      render([line({}), line({ hours: 4, ratePence: 1550, grossPence: null })]),
      "latest-pay",
    );
    expect(top).not.toContain("data-pay-total");
    expect(text(top)).toContain(
      "16 hours at £12.50 an hour Gross pay: £200.00 4 hours at £15.50 an hour Pay date: Fri 30 Oct",
    );
    expect(top).not.toContain("£62.00");
    expect(top.match(/Gross pay: /g)).toHaveLength(1);
  });

  it("earlier weeks, one row a week: the total and pay date at the right, or each line's gross", () => {
    const html = render([
      ...zoe,
      line({
        periodStart: "2026-10-05",
        periodEnd: "2026-10-11",
        hours: 24,
        grossPence: 30000,
        payDate: "2026-10-16",
      }),
      line({
        periodStart: "2026-10-05",
        periodEnd: "2026-10-11",
        hours: 2,
        ratePence: 1550,
        grossPence: null,
        payDate: "2026-10-16",
      }),
    ]);
    const earlier = section(html, "earlier-pay");
    const rows = [...earlier.matchAll(/<li data-pay-week="([\d-]+)"[^>]*>(.*?)<\/li>/g)].map(
      (m) => [m[1], text(m[2] ?? "")],
    );
    expect(rows).toEqual([
      [
        "2026-10-12",
        "Mon 12 Oct to Sun 18 Oct Gross pay: £200.00 16 hours at £12.50 an hour Pay date: Fri 23 Oct",
      ],
      [
        "2026-10-05",
        "Mon 5 Oct to Sun 11 Oct 24 hours at £12.50 an hour Gross pay: £300.00 2 hours at £15.50 an hour Pay date: Fri 16 Oct",
      ],
    ]);
    expect(earlier).toMatch(
      /<h2 id="earlier-pay" class="text-2xl font-medium [^"]*">Earlier weeks<\/h2>/,
    );
    expect(earlier).toMatch(
      /<span data-pay-total="" class="shrink-0 text-lg font-semibold text-ink"><span class="sr-only">Gross pay: <\/span>£200\.00<\/span>/,
    );
    // The week with a missing gross has no total of its own.
    const without = earlier.slice(earlier.indexOf('data-pay-week="2026-10-05"'));
    expect(without).not.toContain("data-pay-total");
  });

  it("nothing from payroll yet: says so", () => {
    expect(text(render([]))).toBe("No pay data yet for this period.");
  });
});

describe("You're booked. over the whole screen", () => {
  it("the confirmation covers the screen as what floats does, its tick and the shift, reference and sign-off", () => {
    const html = renderToStaticMarkup(
      createElement(TakeShiftResult, {
        outcome: {
          status: "booked",
          ref: "7Q4K2M9X",
          when: "Tue 27 Oct, 08:00 to 16:00",
          role: "Door supervisor",
          siteName: "Acme Demo Arena",
          signOff: "Acme Events Shift Team",
        } as Parameters<typeof TakeShiftResult>[0]["outcome"],
        shiftId: "s1",
      }),
    );
    expect(html).toMatch(
      /^<div role="status" data-booked="" class="glass-float fixed inset-0 z-50 flex animate-fade flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-10 text-center">/,
    );
    expect(text(html)).toBe(
      "You're booked. Tue 27 Oct, 08:00 to 16:00 Door supervisor at Acme Demo Arena Reference: 7Q4K2M9X — Acme Events Shift Team See my shifts",
    );
    expect(html).toContain('href="/shifts?new=s1"');
    // The button puts it in <body>, so the floating bar it's in doesn't hold it.
    expect(read("src/app/shifts/open/take-shift-button.tsx")).toMatch(
      /if \(outcome\.status === "booked"\) \{\s*return createPortal\(<TakeShiftResult outcome=\{outcome\} shiftId=\{shiftId\} \/>, document\.body\);/,
    );
  });
});

describe("a shift's page in its other states", () => {
  const summary = {
    shiftId: "11111111-1111-4111-8111-111111111111",
    role: "door_supervisor",
    startsAt: new Date("2026-11-07T14:00:00Z"),
    endsAt: new Date("2026-11-07T22:00:00Z"),
    site: {
      name: "Demo Arena",
      addressLine1: null,
      addressLine2: null,
      town: null,
      postcode: null,
    },
    placesLeft: 1,
  } as unknown as ShiftSummary;
  const render = (page: ShiftPage) =>
    renderToStaticMarkup(
      createElement(ShiftView, {
        page,
        timeZone: "Europe/London",
        now: new Date("2026-11-02T09:00:00Z"),
      }),
    );

  it("missing, filled, started and cancelled: its own bar back to Open shifts, and what happened", () => {
    for (const [page, words] of [
      [{ state: "missing" }, "This shift isn't available."],
      [{ state: "filled", shift: summary }, "This shift has been filled."],
      [{ state: "started", shift: summary }, "This shift has already started."],
      [{ state: "cancelled", shift: summary }, "This shift was cancelled."],
    ] as [ShiftPage, string][]) {
      const html = render(page);
      expect(html, words).toMatch(
        /^<div data-own-bar="" class="scroll-edge [^"]*"><a class="[^"]*" href="\/shifts\/open"><svg[\s\S]*?<\/svg>Open shifts<\/a><\/div>/,
      );
      expect(text(html), words).toContain(words);
      expect(text(html), words).toContain("See open shifts");
    }
  });

  it("booked: back to her shifts, You're booked on this shift in the card, no Take shift", () => {
    const facts = {
      isUrgent: false,
      headcount: 1,
      requirements: [],
      noticeHours: 48,
      lastDay: null,
      travel: null,
      eventName: null,
      post: null,
      meetingPoint: null,
      uniform: null,
      payRatePence: null,
    } as unknown as ShiftFacts;
    const html = render({
      state: "booked",
      facts,
      shift: {
        ...summary,
        assignmentId: "a1",
        status: "confirmed",
        instructions: "Ask for the steward lead.",
      },
    } as unknown as ShiftPage);
    expect(html).toMatch(
      /^<div data-own-bar=""[^>]*><a class="[^"]*" href="\/shifts"><svg[\s\S]*?<\/svg>Your shifts<\/a>/,
    );
    expect(text(html)).toContain("You're booked on this shift");
    expect(text(html)).toContain("Instructions Ask for the steward lead.");
    expect(html).not.toContain(">Take shift<");
    expect(html).not.toContain("data-action-bar");
  });
});

describe("Home's kept copy (no signal)", () => {
  const list: OpenShiftsList = {
    shifts: [],
    truncated: false,
    offerAlerts: true,
    travelOn: true,
    area: { maxMinutes: 45 },
    further: { count: 0, atLeast: false },
    choices: { days: [], sites: [], roles: [] },
  };

  it("hides what needs signal (when it was updated, the shifts to take), keeps what's true offline", () => {
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        firstName: "Zoe",
        lastName: "Adeyemi",
        firmName: "Acme Events",
        payDay: "2026-11-13",
        timeZone: "Europe/London",
        now: new Date("2026-11-02T09:00:00Z"),
        next: null,
        needs: [],
        photo: {
          status: "due_soon",
          current: { id: "p1", uploadedOn: "2023-11-15", renewBy: "2026-11-15" },
          waiting: null,
        },
        open: list,
      }),
    );
    // "Updated 09:00" online only; offline, the notice says when the copy was saved.
    expect(html).toMatch(/<p data-online-only="" [^>]*>Updated 09:00<\/p>/);
    expect(html).toMatch(/<div data-offline-notice="" hidden="" role="status"/);
    expect(text(html)).toContain("This is your saved copy from 09:00 on Mon 2 Nov.");
    // Shown in both: Do this (her initials), Pay; offline only: that open shifts need signal.
    const rows = [...html.matchAll(/<li ([^>]*)data-for-you="([a-z]+)"/g)].map((m) => [
      m[2],
      /data-online-only/.test(m[1] ?? "")
        ? "online"
        : /data-offline-only/.test(m[1] ?? "")
          ? "offline"
          : "both",
    ]);
    expect(rows).toEqual([
      ["needs", "both"],
      ["offline", "offline"],
      ["apply", "online"],
      ["pay", "both"],
    ]);
    expect(html).toMatch(/rounded-full text-lg font-medium text-ink">ZA<\/span>/);
    // The kept copy shows [data-offline-only] and hides [data-online-only] (globals.css).
    const css = read("src/app/globals.css");
    expect(css).toMatch(/\[data-offline-only\]/);
    expect(css).toMatch(/\[data-online-only\]/);
  });
});

it("this file's own SOURCE list sees the app", () => {
  expect(SOURCE.length).toBeGreaterThan(200);
  expect(SOURCE.map((f) => relative(ROOT, join(ROOT, f)))).toContain("src/app/chrome-watch.tsx");
});

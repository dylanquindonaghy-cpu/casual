import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HelpFacts } from "@/lib/portal/help-facts";
import { payDayRowText } from "@/lib/portal/home-copy";
import type { ShiftPage, ShiftSummary } from "@/lib/portal/shift-detail";
import type { ShiftFacts } from "@/lib/portal/shift-facts";
import { orList, REASONS } from "@/lib/rules/reasons";

// The firm's model on the casual's screens (P3; Phase 25.2; docs/screens.md "The firm's model on
// the casual's screens", the mock-up approved by Dylan on 2026-10-30): Home's pay row on a
// fortnight's cycle, a shift that takes either of two licences, and the strike lines when the firm
// switches strikes off.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));
const { ShiftView } = await import("@/app/shifts/[id]/shift-view");
const { HelpView } = await import("@/app/help/help-view");

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("Home's pay row", () => {
  it("a week reads as before; a fortnight gives its dates", () => {
    expect(
      payDayRowText("2026-11-06", { days: 7, start: "2026-10-26", end: "2026-11-01" }),
    ).toEqual({ title: "Pay day: Fri 6 Nov", sub: "For this week's shifts" });
    expect(
      payDayRowText("2026-11-13", { days: 14, start: "2026-10-26", end: "2026-11-08" }),
    ).toEqual({ title: "Pay day: Fri 13 Nov", sub: "For shifts from Mon 26 Oct to Sun 8 Nov" });
  });
});

describe("either licence", () => {
  it("lists two or three as 'A or B', 'A, B or C'", () => {
    expect(orList(["SIA SG"])).toBe("SIA SG");
    expect(orList(["SIA SG", "SIA DS"])).toBe("SIA SG or SIA DS");
    expect(orList(["A", "B", "C"])).toBe("A, B or C");
  });

  it("the reason names them all, and says to send one", () => {
    expect(
      REASONS.credential_missing_any(["SIA security guard licence", "SIA door supervisor licence"]),
    ).toBe(
      "This shift needs a valid SIA security guard licence or SIA door supervisor licence. Send one to the office to be checked.",
    );
    expect(REASONS.credential_missing_any(["A", "B", "C"])).toBe(
      "This shift needs a valid A, B or C. Send one to the office to be checked.",
    );
  });
});

const summary: ShiftSummary = {
  shiftId: "11111111-1111-4111-8111-111111111111",
  role: "security_officer",
  startsAt: new Date("2026-11-07T09:00:00Z"),
  endsAt: new Date("2026-11-07T19:00:00Z"),
  placesLeft: 1,
  site: null,
};
const either = {
  code: "SIA_SG",
  name: "SIA security guard licence or SIA door supervisor licence",
  chip: "SIA SG or SIA DS",
  status: { status: "missing" as const, expiresOn: null, renewing: false },
  uploadable: true,
  anyOf: [
    { code: "SIA_SG", name: "SIA security guard licence", chip: "SIA SG", uploadable: true },
    { code: "SIA_DS", name: "SIA door supervisor licence", chip: "SIA DS", uploadable: true },
  ],
};
const facts = (o: Partial<ShiftFacts> = {}): ShiftFacts => ({
  eventName: null,
  payRatePence: null,
  post: null,
  meetingPoint: null,
  uniform: null,
  isUrgent: false,
  headcount: 1,
  requirements: [either],
  noticeHours: 48,
  strikesOn: true,
  lastDay: "2026-11-07",
  ...o,
});
const render = (page: ShiftPage) =>
  renderToStaticMarkup(
    createElement(ShiftView, {
      page,
      timeZone: "Europe/London",
      now: new Date("2026-11-02T09:00:00Z"),
    }),
  );

describe("the shift page", () => {
  it("a group she holds none of: the chip, 'You need' with an upload link for each, and the reason", () => {
    const html = render({
      state: "blocked",
      shift: summary,
      facts: facts(),
      reasons: [
        REASONS.credential_missing_any([
          "SIA security guard licence",
          "SIA door supervisor licence",
        ]),
      ],
      review: null,
    });
    const words = text(html);
    expect(words).toContain("Needs: SIA SG or SIA DS");
    expect(words).toContain(
      "SIA security guard licence or SIA door supervisor licence Missing: upload SIA SG or SIA DS",
    );
    expect(html).toContain('href="/profile/upload/SIA_SG"');
    expect(html).toContain('href="/profile/upload/SIA_DS"');
    expect(html).not.toContain(">upload it<");
    expect(words).toContain(
      "This shift needs a valid SIA security guard licence or SIA door supervisor licence. Send one to the office to be checked.",
    );
  });

  it("a link only for the ones she may send herself", () => {
    const officeOnly = {
      ...either,
      anyOf: [either.anyOf[0], { ...either.anyOf[1], uploadable: false }].filter(
        (a): a is (typeof either.anyOf)[number] => a !== undefined,
      ),
    };
    const html = render({
      state: "blocked",
      shift: summary,
      facts: facts({ requirements: [officeOnly] }),
      reasons: [],
      review: null,
    });
    expect(text(html)).toContain("Missing: upload SIA SG");
    expect(html).toContain('href="/profile/upload/SIA_SG"');
    expect(html).not.toContain('href="/profile/upload/SIA_DS"');
  });

  it("the strike note under Take shift only while the firm gives strikes", () => {
    const note = "Cancelling less than 48 hours before the start gives you a strike.";
    const holder = {
      ...either,
      anyOf: undefined,
      name: "SIA security guard licence",
      chip: "SIA SG",
    };
    const on = render({ state: "open", shift: summary, facts: facts({ requirements: [holder] }) });
    expect(text(on)).toContain(note);
    const off = render({
      state: "open",
      shift: summary,
      facts: facts({ requirements: [holder], strikesOn: false }),
    });
    expect(text(off)).toContain("Take shift");
    expect(text(off)).not.toContain("strike");
  });
});

describe("Help", () => {
  const help = (strikesOn: boolean) =>
    text(
      renderToStaticMarkup(
        createElement(HelpView, {
          firmName: "Acme Events",
          facts: {
            noticeHours: 48,
            liveDays: 90,
            photoRenewalMonths: 36,
            strikesOn,
            travelOn: false,
            loginWay: "message",
          } satisfies HelpFacts,
          year: 2026,
        }),
      ),
    );
  it("leaves out its strikes section and topic when the firm switches strikes off", () => {
    expect(help(true)).toContain("Cancelling and strikes");
    expect(help(true)).toContain("you get a strike");
    expect(help(false)).not.toContain("Cancelling and strikes");
    expect(help(false)).not.toMatch(/strike/i);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";
import { need } from "../helpers/qualifications";

// Home's open shifts (docs/office-v2.md 4.2 item 3; 12H.1; Phases 18 and 24): in "Shifts you can
// take", the urgent shifts she can take as one row (how many, which days, the best pay) to the
// urgent board, and the others as one row to Open shifts, each with the soonest one's day as its
// tile; pay day under "Pay". No shift is listed on Home, so nothing here says what a shift needs: that's on
// the shift's own page ("You need", with her status for each: tests/unit/portal.shift-detail.test.ts).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/",
}));
const { HomeView } = await import("@/app/home-view");

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z");
const site = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Demo Arena",
  addressLine1: "1 Test Road",
  addressLine2: null,
  town: "Leeds",
  postcode: "ZZ1 1AA",
};

const shift = (i: number, o: Partial<OpenShift>): OpenShift => ({
  shiftId: `4444444${i}-4444-4444-8444-444444444444`,
  role: "door_supervisor",
  startsAt: new Date("2026-11-07T14:00:00Z"),
  endsAt: new Date("2026-11-07T22:00:00Z"),
  placesLeft: 1,
  opensAt: null,
  travel: { kind: "unknown" },
  isUrgent: false,
  site,
  casualEvent: "Raceday",
  ...o,
});

const home = (shifts: OpenShift[]) => {
  const open: OpenShiftsList = {
    shifts,
    truncated: false,
    offerAlerts: true,
    travelOn: true,
    area: { maxMinutes: 45 },
    further: { count: 0, atLeast: false },
    choices: { days: [], sites: [], roles: [] },
  };
  return renderToStaticMarkup(
    createElement(HomeView, {
      firmName: "Acme Events",
      pay: { payDay: "2026-11-13", days: 7, start: "2026-11-02", end: "2026-11-08" },
      firstName: "Zoe",
      lastName: "Adeyemi",
      timeZone: TZ,
      now: NOW,
      next: null,
      needs: [],
      photo: { status: "up_to_date", current: null, waiting: null },
      open,
    }),
  );
};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
// What a screen reader hears: without the decorative tiles (a date tile, an icon), which say again
// what the words say.
const spoken = (html: string) =>
  text(
    html.replace(
      /<span aria-hidden="true"[^>]*>(?:<span[^>]*>[^<]*<\/span>|<svg[\s\S]*?<\/svg>)*<\/span>/g,
      "",
    ),
  );
// A row's tile: the day in a date tile (pale red when urgent), hidden from screen readers.
const tileOf = (row: string) =>
  /<a class="[^"]*"[^>]*><span aria-hidden="true" class="([^"]*)"><span[^>]*>([A-Z][a-z]{2})<\/span><span[^>]*>(\d+)<\/span><\/span>/.exec(
    row,
  );

describe("Home's open shifts, in Shifts you can take", () => {
  it("the urgent ones as one row to the urgent board, the others as one row to Open shifts; no shift's requirements", () => {
    const html = home([
      shift(1, {
        isUrgent: true,
        requirements: [
          { code: "SIA_DS", name: "SIA door supervisor licence" },
          { code: "CSAS", name: "CSAS accreditation" },
        ],
      }),
      shift(2, { requirements: [] }),
    ]);
    const row = (key: string) =>
      html.match(new RegExp(`<li[^>]*data-for-you="${key}"[^>]*>.*?</li>`))?.[0] ?? "";
    // Round 7's sections (Phase 24), each a heading over one glass card of rows; "For you" went.
    expect(html).toMatch(
      /<section aria-labelledby="can-take-heading"[^>]*><h2 id="can-take-heading" class="[^"]*">Shifts you can take<\/h2><ul role="list" class="glass [^"]*">/,
    );
    expect(html).toMatch(/<h2 id="pay-heading" class="[^"]*">Pay<\/h2>/);
    expect(text(html)).not.toContain("For you");
    expect(row("urgent")).toContain('href="/urgent"');
    expect(row("urgent")).toContain("data-online-only");
    // Near you: her home area chose them (round 7's words: how many, its days; a chevron).
    expect(spoken(row("urgent"))).toBe("1 urgent near you Sat 7 Nov");
    expect(tileOf(row("urgent"))?.slice(1)).toEqual([
      expect.stringContaining("bg-urgent-tile text-urgent-ink"),
      "Sat",
      "7",
    ]);
    expect(row("urgent")).toMatch(
      /<\/span><\/span><svg aria-hidden="true"[^>]*class="shrink-0 text-ink-muted"/,
    );
    expect(row("apply")).toContain('href="/shifts/open"');
    expect(spoken(row("apply"))).toBe("1 more to apply for Sat 7 Nov");
    expect(tileOf(row("apply"))?.slice(1)).toEqual([
      expect.stringContaining("glass-tile text-ink"),
      "Sat",
      "7",
    ]);
    // The kept copy says they need signal instead (shown only there), with the day it was saved.
    expect(row("offline")).toContain("data-offline-only");
    expect(spoken(row("offline"))).toBe(
      "Open shifts need signal 1 was urgent at 09:00 on Mon 2 Nov. We&#x27;ll check again when you&#x27;re online.",
    );
    expect(row("offline")).not.toContain("<a ");
    // Pay day (Phase 20): the pay week's Friday, to the Pay tab, online and offline, its day the tile.
    expect(row("pay")).toContain('href="/pay"');
    expect(row("pay")).not.toMatch(/data-o(n|ff)line-only/);
    expect(spoken(row("pay"))).toBe("Pay day: Fri 13 Nov For this week&#x27;s shifts");
    expect(tileOf(row("pay"))?.slice(2)).toEqual(["Fri", "13"]);
    expect(html).not.toContain("data-requirements");
    expect(text(html)).not.toMatch(/SIA DS|CSAS/);
    // Nothing urgent: no urgent row, and the others are "shifts to apply for".
    const calm = home([shift(2, {})]);
    expect(calm).not.toContain('data-for-you="urgent"');
    expect(spoken(calm)).toContain("1 shift to apply for Sat 7 Nov");
    // Nothing needs doing: no "Do this".
    expect(calm).not.toContain("do-this-heading");
  });
});

describe("Home with travel areas switched off for the firm (13.4)", () => {
  it("no 'up to N minutes' line, no prompt for an area and no travel lines", () => {
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        firmName: "Acme Events",
        pay: { payDay: "2026-11-13", days: 7, start: "2026-11-02", end: "2026-11-08" },
        firstName: "Zoe",
        lastName: "Adeyemi",
        timeZone: TZ,
        now: NOW,
        next: null,
        needs: [],
        photo: { status: "up_to_date", current: null, waiting: null },
        open: {
          shifts: [
            shift(1, { isUrgent: true, travel: undefined }),
            shift(2, { travel: undefined }),
          ],
          truncated: false,
          offerAlerts: true,
          travelOn: false,
          area: null,
          further: { count: 0, atLeast: false },
          choices: { days: [], sites: [], roles: [] },
        },
      }),
    );
    const words = text(html);
    expect(words).not.toMatch(/minutes from your home area|home area|miles|min by car/);
    expect(html).not.toContain("data-travel-line");
    expect(html).not.toContain('href="/profile/travel"');
    expect(html).not.toContain('data-for-you="area"');
    // The open shifts still show, without how far (and not "near you": there's no area).
    expect(spoken(html)).toContain("1 urgent Sat 7 Nov");
    expect(words).not.toContain("near you");
    expect(spoken(html)).toContain("1 more to apply for Sat 7 Nov");
  });
});

describe("Home's rows, at most five", () => {
  it("with everything at once: needs doing, urgent, her home area, the rest, pay day; offline, one row instead of the urgent one", () => {
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        firmName: "Acme Events",
        pay: { payDay: "2026-11-13", days: 7, start: "2026-11-02", end: "2026-11-08" },
        firstName: "Zoe",
        lastName: "Adeyemi",
        timeZone: TZ,
        now: NOW,
        next: null,
        needs: [need(2, { status: "expired", expiresOn: "2026-10-01" })],
        photo: { status: "up_to_date", current: null, waiting: null },
        open: {
          shifts: [shift(1, { isUrgent: true }), shift(2, {})],
          truncated: false,
          offerAlerts: true,
          travelOn: true,
          area: null,
          further: { count: 0, atLeast: false },
          choices: { days: [], sites: [], roles: [] },
        },
      }),
    );
    const rows = [...html.matchAll(/<li ([^>]*)data-for-you="([a-z]+)"/g)].map((m) => ({
      kind: m[2],
      online: (m[1] ?? "").includes("data-online-only"),
      offline: (m[1] ?? "").includes("data-offline-only"),
    }));
    // Online (the offline row hidden): five, in this order: "Do this", then "Shifts you can take",
    // then "Pay" (round 7).
    expect(rows.filter((r) => !r.offline).map((r) => r.kind)).toEqual([
      "needs",
      "urgent",
      "area",
      "apply",
      "pay",
    ]);
    // In the kept copy (online rows hidden): what needs doing, the offline row and pay day.
    expect(rows.filter((r) => !r.online).map((r) => r.kind)).toEqual(["needs", "offline", "pay"]);
    const headings = [...html.matchAll(/<h2 id="([a-z-]+)-heading"[^>]*>([^<]+)<\/h2>/g)].map(
      (m) => m[2],
    );
    expect(headings).toEqual(["No shifts booked", "Do this", "Shifts you can take", "Pay"]);
  });
});

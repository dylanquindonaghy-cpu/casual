import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";

// Home's open shifts (docs/office-v2.md 4.2 item 3; 12H.1; Phase 18): in "For you", the urgent
// shifts she can take as one row (how many, which days) to the urgent board, and the others as one
// row to Open shifts. No shift is listed on Home, so nothing here says what a shift needs: that's on
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
      firstName: "Zoe",
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

describe("Home's open shifts, in For you", () => {
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
    expect(row("urgent")).toContain('href="/urgent"');
    expect(row("urgent")).toContain("data-online-only");
    expect(text(row("urgent"))).toBe("Urgent 1 shift you can take Sat 7 Nov");
    expect(row("apply")).toContain('href="/shifts/open"');
    expect(text(row("apply"))).toBe("1 more shift you can apply for Sat 7 Nov");
    // The kept copy says they need signal instead (shown only there), with the day it was saved.
    expect(row("offline")).toContain("data-offline-only");
    expect(text(row("offline"))).toBe(
      "Open shifts need signal 1 was urgent at 09:00 on Mon 2 Nov. We&#x27;ll check again when you&#x27;re online.",
    );
    expect(html).not.toContain("data-requirements");
    expect(text(html)).not.toMatch(/SIA DS|CSAS/);
    // Nothing urgent: no urgent row, and the others are "shifts you can apply for".
    const calm = home([shift(2, {})]);
    expect(calm).not.toContain('data-for-you="urgent"');
    expect(text(calm)).toContain("1 shift you can apply for Sat 7 Nov");
  });
});

describe("Home with travel areas switched off for the firm (13.4)", () => {
  it("no 'up to N minutes' line, no prompt for an area and no travel lines", () => {
    const html = renderToStaticMarkup(
      createElement(HomeView, {
        firstName: "Zoe",
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
    // The open shifts still show, without how far.
    expect(words).toContain("1 shift you can take Sat 7 Nov");
    expect(words).toContain("1 more shift you can apply for Sat 7 Nov");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OpenShift, OpenShiftsList } from "@/lib/portal/open-shifts";

// Home's shift cards (docs/office-v2.md 4.2 item 3; 12H.1 audit): an urgent shift's card shows
// what the session needs as chips, the same chips as the shifts list (12H.2), read out as
// "Needs: …". The urgent cards and the shifts to apply for use the one card.

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

describe("Home's shift cards", () => {
  it("an urgent shift's card shows what it needs as chips; one that needs nothing shows none", () => {
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
    const urgent = html.slice(0, html.indexOf("44444442-"));
    expect(text(urgent)).toContain("Urgent Door supervisor · Raceday Demo Arena");
    expect(text(urgent)).toContain("Needs: SIA DS , CSAS");
    expect(urgent.match(/data-requirements=""/g)).toHaveLength(1);
    expect(html.match(/data-requirements=""/g)).toHaveLength(1);
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
    expect(words).toContain("Demo Arena");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OfferPage } from "@/lib/office/offer-page";

// "Offer this shift" (src/app/office/offer/[shiftId]/offer-view.tsx): a shift hidden from casuals
// (12B.4) lists nobody to offer it to and says why; a showing one lists who can take it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { OfferView } = await import("@/app/office/offer/[shiftId]/offer-view");

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const page = (hidden: boolean): OfferPage => ({
  timeZone: "Europe/London",
  shift: {
    shiftId: "11111111-1111-4111-8111-111111111111",
    role: "door_supervisor",
    site: "Demo Arena",
    startsAt: new Date("2026-11-07T14:00:00Z"),
    endsAt: new Date("2026-11-07T22:00:00Z"),
    placesLeft: 1,
    isUrgent: false,
    open: true,
    hidden,
  },
  candidates: hidden
    ? []
    : [
        {
          workerId: "22222222-2222-4222-8222-222222222222",
          name: "Ann Booker",
          mobile: "+447700900123",
          channel: "whatsapp",
          smsAllowed: true,
          hoursThisWeek: 0,
          lastOfferedAt: null,
        },
      ],
  offered: [],
});

const render = (hidden: boolean) =>
  text(renderToStaticMarkup(createElement(OfferView, { page: page(hidden) })));

describe("the offer page and the casuals' switches", () => {
  it("a hidden shift: nobody listed, and why", () => {
    const words = render(true);
    expect(words).toContain(
      "This shift is hidden from casuals, so it can't be offered. Show it to casuals first, or assign someone from the shift's page.",
    );
    expect(words).not.toContain("Who can take it");
    expect(words).not.toContain("Send offer");
  });

  it("a shift that's showing: who can take it", () => {
    const words = render(false);
    expect(words).toContain("Who can take it");
    expect(words).toContain("Ann Booker");
    expect(words).not.toContain("hidden from casuals");
  });
});

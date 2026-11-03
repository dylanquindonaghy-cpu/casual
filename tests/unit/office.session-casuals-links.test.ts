import { describe, expect, it } from "vitest";
import {
  casualsHref,
  casualsQueryOf,
  type CasualsQuery,
} from "@/app/office/shifts/[id]/casuals-card";
import { CASUALS_TABS } from "@/lib/office/session-casuals";

// A session's "Casuals for this session" list's links (Phase 26.6, ses-2 and ses-3; the
// claims-auditor's round 2): each tab and filter a link (they work before the page is ready), read
// back by the page as written. Every tab is named in its link: the page's own first tab is "Asked
// for it" while the event asks (or someone has) and "Booked" otherwise, so "Asked for it" must say
// so or it would open Booked.

const SHIFT = "8d3e8f4b-6b2a-4f0c-9b0e-2a7d1c9e5f10";
const none = { reliable: false, near: false, here: false };
const read = (href: string, fallback: CasualsQuery["show"]) =>
  casualsQueryOf(Object.fromEntries(new URL(href, "http://x").searchParams), fallback);

describe("the session list's links", () => {
  it("every tab is named, Asked for it too, and read back as itself whatever the page's first tab", () => {
    for (const show of CASUALS_TABS) {
      const href = casualsHref(SHIFT, { show: "booked", filters: none }, { show });
      expect(href).toBe(`/office/shifts/${SHIFT}?show=${show}`);
      expect(read(href, "booked")).toEqual({ show, filters: none });
      expect(read(href, "asked")).toEqual({ show, filters: none });
    }
  });

  it("each filter on and off, kept across tabs, and read back", () => {
    const start: CasualsQuery = { show: "asked", filters: none };
    const reliable = casualsHref(SHIFT, start, { filters: { ...none, reliable: true } });
    expect(reliable).toBe(`/office/shifts/${SHIFT}?show=asked&rel=80`);
    const all = casualsHref(SHIFT, start, { filters: { reliable: true, near: true, here: true } });
    expect(all).toBe(`/office/shifts/${SHIFT}?show=asked&rel=80&near=45&here=1`);
    expect(read(all, "booked")).toEqual({
      show: "asked",
      filters: { reliable: true, near: true, here: true },
    });
    // Another tab keeps the filters; turning one off drops it.
    const onCould = casualsHref(SHIFT, read(all, "asked"), { show: "could" });
    expect(onCould).toBe(`/office/shifts/${SHIFT}?show=could&rel=80&near=45&here=1`);
    const nearOff = casualsHref(SHIFT, read(all, "asked"), {
      filters: { reliable: true, near: false, here: true },
    });
    expect(read(nearOff, "asked").filters).toEqual({ reliable: true, near: false, here: true });
  });

  it("no tab named: the page's own first; anything else ignored", () => {
    expect(read(`/office/shifts/${SHIFT}`, "booked")).toEqual({ show: "booked", filters: none });
    expect(read(`/office/shifts/${SHIFT}`, "asked")).toEqual({ show: "asked", filters: none });
    expect(read(`/office/shifts/${SHIFT}?show=nonsense&rel=79&near=1&here=yes`, "booked")).toEqual({
      show: "booked",
      filters: none,
    });
  });
});

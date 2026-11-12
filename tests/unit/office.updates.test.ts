import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isNew, needsAction, type NewCancellation, type PageUpdate } from "@/lib/office/updates";
import {
  bellLabel,
  overnight,
  popupLines,
  summaryLine,
  updateRow,
  updatesLine,
  LAST_7_DAYS,
  newTodayWords,
} from "@/lib/office/updates-copy";
import { DEVICE_WORDS, tellMeLine } from "@/lib/office/tell-me-copy";

let pathname = "/office";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => pathname,
}));
const { UpdatesBellLink, CancellationPopup } = await import("@/app/office/updates-bell");

// Updates (Phase 26.4; the spec page's upd-1 to upd-3 and sys-8's bell): each update's lines and
// button, what needs action, the bell and the pop-up. NOW is Monday 2 November 2026, 09:00 London.

const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:00:00Z");
const at = (iso: string) => new Date(iso);
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const openSoon: PageUpdate = {
  kind: "open-soon",
  at: at("2026-11-02T14:00:00Z"),
  shiftId: "s1",
  role: "steward",
  site: "Acme Demo Arena",
  startsAt: at("2026-11-02T14:00:00Z"),
  placesFree: 2,
  urgent: true,
  offers: 0,
};
const cancelled = (reopened: boolean): PageUpdate => ({
  kind: "cancelled",
  at: at("2026-11-02T08:10:00Z"),
  shiftId: "s2",
  ref: "a2",
  worker: "Mo Rahman",
  role: "door_supervisor",
  site: "Acme Demo Arena",
  startsAt: at("2026-11-02T18:00:00Z"),
  noticeHours: 9.8,
  strike: "live",
  reopened,
});
const took = (when: string): PageUpdate => ({
  kind: "took",
  at: at(when),
  shiftId: "s3",
  worker: "Ben Fraser",
  role: "steward",
  site: null,
  startsAt: at("2026-11-07T10:00:00Z"),
  placesFree: 0,
});
const upload: PageUpdate = {
  kind: "upload",
  at: at("2026-11-01T19:03:00Z"),
  workerId: "w1",
  worker: "Zoe Adeyemi",
  what: "photo",
};

describe("each update's lines, button and whether it needs action", () => {
  it("a place still open near its start: needs action, Offer the place", () => {
    expect(needsAction(openSoon)).toBe(true);
    expect(updateRow(openSoon, NOW, TZ)).toEqual({
      title: "2 places still to fill, starts in 5 h",
      line: "Steward, Acme Demo Arena, Mon 2 Nov 14:00 · offered to nobody yet · urgent",
      tone: "urgent",
      href: "/office/shifts/s1",
      action: { label: "Offer the place", href: "/office/offer/s1" },
    });
    const offered = { ...openSoon, placesFree: 1, urgent: false, offers: 3 };
    expect(updateRow(offered, NOW, TZ)).toMatchObject({
      title: "1 place still to fill, starts in 5 h",
      line: "Steward, Acme Demo Arena, Mon 2 Nov 14:00 · offered to 3 people",
    });
    // 40 minutes before its start.
    expect(updateRow(openSoon, at("2026-11-02T13:20:00Z"), TZ).title).toBe(
      "2 places still to fill, starts in 40 min",
    );
  });

  it("a cancellation: Offer the place while its place is open again (needs action), else Open", () => {
    expect(needsAction(cancelled(true))).toBe(true);
    expect(updateRow(cancelled(true), NOW, TZ).action).toEqual({
      label: "Offer the place",
      href: "/office/offer/s2",
    });
    expect(updateRow(cancelled(true), NOW, TZ).title).toBe("Mo Rahman cancelled · 9 hours' notice");
    expect(needsAction(cancelled(false))).toBe(false);
    expect(updateRow(cancelled(false), NOW, TZ).action).toEqual({
      label: "Open",
      href: "/office/cancellations/a2",
    });
  });

  it("a place taken: overnight ones marked (18:00 to 08:00 London); an upload: Check", () => {
    expect(overnight(at("2026-11-01T23:12:00Z"), TZ)).toBe(true);
    expect(overnight(at("2026-11-02T07:59:00Z"), TZ)).toBe(true);
    expect(overnight(at("2026-11-02T08:00:00Z"), TZ)).toBe(false);
    expect(updateRow(took("2026-11-01T23:12:00Z"), NOW, TZ).line).toMatch(/ · overnight$/);
    expect(updateRow(took("2026-11-02T10:30:00Z"), NOW, TZ).line).not.toContain("overnight");
    expect(needsAction(took("2026-11-02T08:30:00Z"))).toBe(false);
    expect(needsAction(upload)).toBe(true);
    expect(updateRow(upload, NOW, TZ).action).toEqual({
      label: "Check",
      href: "/office/casuals/w1",
    });
    // Phase 36.2: the period is chosen now (today, 3, 7 or 30 days), so the page's line no longer
    // says "in the last 7 days": it says what can be chosen; the list's heading says the period.
    expect(updatesLine(true)).toBe(
      "What's happened on your contracts, newest first. Choose how far back, which event and what kind.",
    );
    expect(updatesLine(false)).toBe(
      "What's happened, newest first. Choose how far back, which event and what kind.",
    );
  });

  it("new since Mark all as seen: places taken, cancellations, and uploads when asked for (never seen: all)", () => {
    const seen = at("2026-11-02T08:00:00Z");
    expect(isNew(took("2026-11-02T08:30:00Z"), seen, false)).toBe(true);
    expect(isNew(took("2026-11-02T08:00:00Z"), seen, false)).toBe(false);
    expect(isNew(cancelled(false), seen, false)).toBe(true);
    // Uploads only when "Uploads to check" is on.
    expect(isNew(upload, null, true)).toBe(true);
    expect(isNew(upload, null, false)).toBe(false);
    expect(isNew(upload, seen, true)).toBe(false);
    // States, not news: never "new".
    expect(isNew(openSoon, null, true)).toBe(false);
  });
});

describe("the 08:00 summary's lines (Phase 26.4)", () => {
  it("say what needs action with no casual's name, for every kind", () => {
    const noReply: PageUpdate = {
      kind: "no-reply",
      at: at("2026-11-02T08:00:00Z"),
      oldest: at("2026-11-02T07:00:00Z"),
      offers: 3,
      sessions: 2,
    };
    const lines = [
      openSoon,
      cancelled(true),
      cancelled(false),
      took("2026-11-02T08:30:00Z"),
      upload,
      noReply,
    ].map((u) => summaryLine(u, NOW, TZ));
    expect(lines).toEqual([
      "2 places still to fill, starts in 5 h: Steward, Acme Demo Arena, Mon 2 Nov 14:00",
      "A cancellation · 9 hours' notice: Door supervisor, Acme Demo Arena, Mon 2 Nov 18:00 (the place is open again)",
      "A cancellation · 9 hours' notice: Door supervisor, Acme Demo Arena, Mon 2 Nov 18:00",
      "A place taken: Steward, Sat 7 Nov 10:00",
      "A staff photo to check",
      "3 offers with no reply yet",
    ]);
    for (const name of ["Mo Rahman", "Ben Fraser", "Zoe Adeyemi"])
      expect(lines.join(" ")).not.toContain(name);
  });
});

describe("the bell and the pop-up", () => {
  const bell = (newCount: number, cancellations: NewCancellation[] = []) => ({
    newCount,
    cancellations,
    today: "2026-11-02",
    timeZone: TZ,
    now: NOW,
  });

  it("the bell: Updates, with how many are new (none: no number)", () => {
    expect(bellLabel(0)).toBe("Updates");
    expect(bellLabel(3)).toBe("Updates, 3 new");
    expect(bellLabel(120)).toBe("Updates, 99+ new");
    const none = renderToStaticMarkup(createElement(UpdatesBellLink, { bell: bell(0) }));
    const link = none.match(/<a [^>]*>/)?.[0] ?? "";
    expect(link).toContain('href="/office/updates"');
    expect(link).toContain('aria-label="Updates"');
    expect(words(none)).toBe("");
    const some = renderToStaticMarkup(createElement(UpdatesBellLink, { bell: bell(3) }));
    expect(some).toContain('aria-label="Updates, 3 new"');
    expect(some).toMatch(/<span aria-hidden="true"[^>]*>3<\/span>/);
    // On Updates itself: still its number (until "Mark all as seen"), and it's the page open.
    pathname = "/office/updates";
    const here = renderToStaticMarkup(createElement(UpdatesBellLink, { bell: bell(3) }));
    pathname = "/office";
    expect(here).toContain('aria-label="Updates, 3 new"');
    expect(here).toContain('aria-current="page"');
    expect(some).not.toContain("aria-current");
  });

  it("the pop-up's words: who, how much notice, what and when; Offer the place while it's open", () => {
    const c: NewCancellation = {
      ref: "a2",
      at: at("2026-11-02T08:50:00Z"),
      shiftId: "s2",
      worker: "Mo Rahman",
      role: "door_supervisor",
      site: "Acme Demo Arena",
      startsAt: at("2026-11-02T18:00:00Z"),
      noticeHours: 9.8,
      reopened: true,
    };
    expect(popupLines(c, TZ)).toEqual({
      title: "Mo Rahman cancelled · 9 hours' notice",
      line: "Door supervisor, Acme Demo Arena, Mon 2 Nov 18:00",
      offer: { label: "Offer the place", href: "/office/offer/s2" },
    });
    expect(popupLines({ ...c, reopened: false }, TZ).offer).toBeNull();
    // Nothing shows before the page is running (it appears from the office's own refresh).
    expect(renderToStaticMarkup(createElement(CancellationPopup, { bell: bell(1, [c]) }))).toBe("");
  });
});

// The launch review (3 Nov 2026): the list's heading says what it holds; "Tell me about" says the
// switches are the person's own; with no web push on the server, the two notification switches
// say they do nothing yet (O8).
describe("Updates' clearer words", () => {
  it("the list's heading: the last 7 days, and how many came in today", () => {
    expect(LAST_7_DAYS).toBe("Last 7 days");
    expect(newTodayWords(2)).toBe("2 new today");
    expect(newTodayWords(1)).toBe("1 new today");
  });

  it("Tell me about: only you get these, for your contracts or every venue", () => {
    expect(tellMeLine(true)).toBe("Only you get these, for your contracts.");
    expect(tellMeLine(false)).toBe(
      "Only you get these. You don't look after any contracts, so they cover every venue.",
    );
  });

  it("no web push on the server: the two switches do nothing for now (O8)", () => {
    expect(DEVICE_WORDS.no_key).toBe(
      "Phone and computer notifications aren't turned on for your firm yet, so these two switches do nothing for now.",
    );
  });
});

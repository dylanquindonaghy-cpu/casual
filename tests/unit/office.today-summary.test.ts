import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TodayView, UrgentShift } from "@/lib/office/today";

// Today's layout (src/app/office/today-view.tsx; docs/ui-design.md "Today"): the summary at the
// top (one tile per section, each a link to its heading with the count and the heading's words,
// "50+" when its list stops at 50, and coloured by what it needs: red, amber, plain, or calm with a
// check at 0, as docs/screens.md `/office/today` says), the sections in the order things need
// doing, and the rules the browser tests rely on: no link repeats a menu link's name, one link per
// "Who worked?" row, each gap an article with its own "Offer to someone". The words themselves are
// pinned in office.today-view.test.ts.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/today-actions", () => ({
  setUrgentAction: vi.fn(),
  closeShiftAction: vi.fn(),
  reopenShiftAction: vi.fn(),
  offerShiftAction: vi.fn(),
  keepBookingAction: vi.fn(),
}));

const { TodayContent } = await import("@/app/office/today-view");

type View = Omit<TodayView, "officeUser">;
const at = (iso: string) => new Date(iso);
const shift = (shiftId: string) => ({
  shiftId,
  role: "steward",
  site: "Acme Demo Arena",
  startsAt: at("2026-11-07T08:00:00Z"),
  endsAt: at("2026-11-07T16:00:00Z"),
  headcount: 1,
  placesLeft: 1,
  isUrgent: false,
  fromSheet: false,
});
const urgent: UrgentShift = {
  ...shift("u1"),
  isUrgent: true,
  wave: 1,
  offered: 3,
  byOffice: 0,
  accepted: 0,
  failed: 0,
  stopped: null,
  escalated: false,
};

const empty: View = {
  timeZone: "Europe/London",
  urgent: [],
  gaps: [],
  gapsMore: false,
  cancellations: [],
  toCheck: [],
  toCheckMore: false,
  fromSheet: [],
  fromSheetMore: false,
  toMark: [],
  toMarkMore: false,
  requests: { total: 0, byType: {} },
  expiring: [],
  unknownMessages: [],
  unknownMore: false,
};

const full: View = {
  ...empty,
  urgent: [urgent],
  gaps: [
    ...Array.from({ length: 49 }, (_, i) => shift(`g${i}`)),
    { ...shift("sheet"), fromSheet: true },
  ],
  gapsMore: true,
  toCheck: [
    {
      shiftId: "t1",
      workerId: "w1",
      worker: "Lena Leaver",
      role: "steward",
      site: "Acme Demo Arena",
      startsAt: at("2026-11-08T08:00:00Z"),
      endsAt: at("2026-11-08T16:00:00Z"),
      cause: "inactive",
    },
  ],
  fromSheet: [
    {
      shiftId: "f1",
      role: "track_operative",
      site: "Demo Junction",
      startsAt: at("2026-11-07T22:00:00Z"),
      endsAt: at("2026-11-08T06:00:00Z"),
      change: null,
      names: [{ name: "Ben Example", codes: ["credential_missing"], dropped: false }],
    },
  ],
  toMark: [
    { ...shift("m1"), startsAt: at("2026-10-31T10:00:00Z"), unmarked: 3 },
    { ...shift("m2"), startsAt: at("2026-10-30T10:00:00Z"), unmarked: 1 },
  ],
  requests: { total: 3, byType: { time_change: 2, swap: 1 } },
  cancellations: [
    {
      assignmentId: "c1",
      worker: "Ben Carter",
      shiftId: "s",
      role: "steward",
      site: "Acme Demo Arena",
      startsAt: at("2026-11-07T08:00:00Z"),
      endsAt: at("2026-11-07T16:00:00Z"),
      cancelledAt: at("2026-11-07T06:00:00Z"),
      noticeHours: 2,
      byFirm: false,
      reason: null,
    },
  ],
  unknownMessages: [
    {
      messageId: "x1",
      channel: "whatsapp",
      from: "+447700900998",
      text: "Hi",
      receivedAt: at("2026-11-02T09:14:00Z"),
      formerWorker: null,
      formerWorkerActive: false,
    },
  ],
  expiring: [
    { worker: "Dee Patel", credential: "SIA door supervisor licence", expiresOn: "2026-11-05" },
  ],
};

const render = (view: View) => renderToStaticMarkup(createElement(TodayContent, { view }));
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
// The summary's links, as [the section id it goes to, its words].
const tiles = (html: string) => {
  const summary = /<nav aria-label="Summary">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
  return [...summary.matchAll(/<a href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [
    m[1],
    words(m[2] ?? ""),
  ]);
};
// The summary's tiles with their looks: the section id, the tile's classes, and the classes of
// its number.
const tileLooks = (html: string) => {
  const summary = /<nav aria-label="Summary">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
  return [...summary.matchAll(/<a href="#([^"]+)" class="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => ({
      id: m[1] ?? "",
      tile: (m[2] ?? "").split(/\s+/),
      number: (/<span class="([^"]*tabular-nums[^"]*)"/.exec(m[3] ?? "")?.[1] ?? "").split(/\s+/),
      inner: m[3] ?? "",
    }),
  );
};
// Each tone's look (today-view.tsx TILE_TONE and TONE_PATHS): the tile's border and background,
// the number's colour, and the icon's drawing (a warning sign, a clock, a dash, a check).
const LOOKS = {
  urgent: {
    tile: ["border-urgent", "bg-urgent-soft"],
    number: "text-urgent",
    icon: 'd="M12 3.5 2.5 20h19L12 3.5Z"',
  },
  attention: {
    tile: ["border-attention", "bg-attention-soft"],
    number: "text-attention-ink",
    icon: 'r="8.5"',
  },
  quiet: { tile: ["border-line-strong", "bg-card"], number: "text-ink", icon: 'd="M6 12h12"' },
  calm: {
    tile: ["border-line", "bg-card"],
    number: "text-ink-muted",
    icon: 'd="m5 12.5 4.5 4.5L19 7.5"',
  },
} as const;
type Look = keyof typeof LOOKS;
// Which one look a tile has (classes are compared whole, so "border-line" isn't
// "border-line-strong" and "text-ink" isn't "text-ink-muted").
const lookOf = (t: ReturnType<typeof tileLooks>[number]): string => {
  const found = (Object.keys(LOOKS) as Look[]).filter((look) => {
    const l = LOOKS[look];
    return (
      l.tile.every((c) => t.tile.includes(c)) &&
      t.number.includes(l.number) &&
      t.inner.includes(l.icon)
    );
  });
  return found.length === 1 ? (found[0] ?? "") : `unclear (${found.join(", ") || "none"})`;
};
const looks = (view: View) => tileLooks(render(view)).map((t) => [t.id, lookOf(t)]);

// The section headings, as [id, words], in page order.
const headings = (html: string) =>
  [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => [
    m[1],
    words(m[2] ?? ""),
  ]);
const section = (html: string, id: string) =>
  new RegExp(`<section[^>]*aria-labelledby="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] ??
  "";

describe("Today's summary", () => {
  it("has a tile for each section, in the page's order, with its count and heading words", () => {
    const html = render(full);
    expect(tiles(html)).toEqual([
      ["urgent", "1 Urgent shifts"],
      ["to-check", "1 Bookings to check"],
      ["from-sheet", "1 From your rota sheet"],
      ["requests", "3 Requests"],
      ["gaps", "50+ Gaps in the next 7 days"],
      ["to-mark", "2 Who worked?"],
      ["cancelled", "1 Cancelled in the last 24 hours"],
      ["unknown", "1 Messages from numbers we don't know"],
      ["expiring", "1 Credentials expiring this week"],
    ]);
  });

  it("each tile goes to its section's heading, and says the heading's words", () => {
    const html = render(full);
    expect(tiles(html).map(([id, text]) => [id, text?.replace(/^\d+\+? /, "")])).toEqual(
      headings(html),
    );
    for (const [id] of headings(html)) {
      expect(html).toContain(`aria-labelledby="${id}"`);
    }
  });

  it("with nothing to do, every tile says 0, and the lists that only show when needed have none", () => {
    const html = render(empty);
    expect(tiles(html)).toEqual([
      ["urgent", "0 Urgent shifts"],
      ["requests", "0 Requests"],
      ["gaps", "0 Gaps in the next 7 days"],
      ["to-mark", "0 Who worked?"],
      ["cancelled", "0 Cancelled in the last 24 hours"],
      ["unknown", "0 Messages from numbers we don't know"],
      ["expiring", "0 Credentials expiring this week"],
    ]);
    expect(headings(html).map(([id]) => id)).toEqual(tiles(html).map(([id]) => id));
  });

  it("a tile is red while urgent things wait, amber while someone needs to act, plain for cancellations", () => {
    expect(looks(full)).toEqual([
      ["urgent", "urgent"],
      ["to-check", "urgent"],
      ["from-sheet", "attention"],
      ["requests", "attention"],
      ["gaps", "attention"],
      ["to-mark", "attention"],
      ["cancelled", "quiet"],
      ["unknown", "attention"],
      ["expiring", "attention"],
    ]);
  });

  it("a tile at 0 is calm, with a check, and nothing on it is red, amber or plain", () => {
    expect(looks(empty)).toEqual(tileLooks(render(empty)).map((t) => [t.id, "calm"]));
    for (const t of tileLooks(render(empty))) {
      for (const loud of ["border-urgent", "border-attention", "border-line-strong"]) {
        expect(t.tile).not.toContain(loud);
      }
    }
  });

  it("a tile at 0 is calm while the others keep their colour", () => {
    expect(
      looks({ ...full, urgent: [], requests: { total: 0, byType: {} }, cancellations: [] }),
    ).toEqual([
      ["urgent", "calm"],
      ["to-check", "urgent"],
      ["from-sheet", "attention"],
      ["requests", "calm"],
      ["gaps", "attention"],
      ["to-mark", "attention"],
      ["cancelled", "calm"],
      ["unknown", "attention"],
      ["expiring", "attention"],
    ]);
  });

  it("every list that stops at 50 says so on its own tile with a +, and only there", () => {
    const html = render({
      ...full,
      gapsMore: false,
      toCheckMore: true,
      fromSheetMore: true,
      toMarkMore: true,
      unknownMore: true,
    });
    expect(tiles(html)).toEqual([
      ["urgent", "1 Urgent shifts"],
      ["to-check", "1+ Bookings to check"],
      ["from-sheet", "1+ From your rota sheet"],
      ["requests", "3 Requests"],
      ["gaps", "50 Gaps in the next 7 days"],
      ["to-mark", "2+ Who worked?"],
      ["cancelled", "1 Cancelled in the last 24 hours"],
      ["unknown", "1+ Messages from numbers we don't know"],
      ["expiring", "1 Credentials expiring this week"],
    ]);
  });
});

describe("Today's sections", () => {
  it("come in the order things need doing", () => {
    expect(headings(render(full)).map(([, text]) => text)).toEqual([
      "Urgent shifts",
      "Bookings to check",
      "From your rota sheet",
      "Requests",
      "Gaps in the next 7 days",
      "Who worked?",
      "Cancelled in the last 24 hours",
      "Messages from numbers we don't know",
      "Credentials expiring this week",
    ]);
  });

  it("an urgent shift says Urgent and its places first, then the shift", () => {
    const card = /<article[^>]*>([\s\S]*?)<\/article>/.exec(section(render(full), "urgent"))?.[1];
    expect(words(card ?? "")).toMatch(
      /^Urgent 1 place free Steward at Acme Demo Arena Sat 7 Nov, 08:00 to 16:00 Wave 1 · 3 offered · 0 accepted /,
    );
  });

  it("each gap is an article with its own Offer to someone; a sheet's shift says so", () => {
    const gaps = section(render(full), "gaps");
    const articles = [...gaps.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)].map((m) => m[1]);
    expect(articles).toHaveLength(50);
    for (const a of articles) {
      expect(a?.match(/>Offer to someone<\/a>/g)).toHaveLength(1);
    }
    const sheet = articles.at(-1) ?? "";
    expect(words(sheet)).toContain("From your Google Sheet");
    expect(sheet).not.toContain("Mark as filled");
    expect(words(gaps)).toContain("Showing the first 50.");
  });

  it("each Who worked? row has exactly one link: the shift", () => {
    const rows = [...section(render(full), "to-mark").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
    expect(rows).toHaveLength(2);
    for (const [, row] of rows) {
      expect(row?.match(/<a /g)).toHaveLength(1);
      expect(row).toMatch(/href="\/office\/shifts\/m[12]"/);
    }
  });

  it("no link repeats a menu link's name or a link the browser tests click elsewhere", () => {
    const links = [...render(full).matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
      words(m[1] ?? ""),
    );
    for (const exact of ["Today", "Home", "Events & sessions", "Shifts", "Requests"]) {
      expect(links).not.toContain(exact);
    }
    for (const part of [
      "workers",
      "action log",
      "notice report",
      "pilot metrics",
      "pay queries",
      "import pay records",
      "office team",
      "data requests",
      "how-to guide",
      "back to today",
    ]) {
      expect(links.filter((l) => l.toLowerCase().includes(part))).toEqual([]);
    }
    expect(links.filter((l) => l.toLowerCase().includes("see requests"))).toEqual(["See requests"]);
  });
});

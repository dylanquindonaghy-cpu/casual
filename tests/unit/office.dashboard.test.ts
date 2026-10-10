import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { officeMenu } from "@/app/office/office-menu";
import type { Dashboard, NeedsAttention } from "@/lib/office/dashboard";
import { needsCount } from "@/lib/office/dashboard";
import {
  bellLabel,
  cancelledByText,
  countLine,
  COUNTS,
  expiredText,
  SECTION_ERROR,
  SECTIONS,
  uploadsText,
  urgentLine,
} from "@/lib/office/dashboard-copy";
import { appTodayText } from "@/lib/office/enquiries-copy";
import type { EventCardData, SessionRow } from "@/lib/office/events";
import {
  closeResultText,
  offerResultText,
  placesText,
  stoppedText,
  toMarkText,
  urgentResultText,
} from "@/lib/office/today-copy";

// The office dashboard (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office`; 12E.1): its words
// (src/lib/office/dashboard-copy.ts, today-copy.ts) and the rendered page
// (src/app/office/dashboard-view.tsx), from made-up data: the four counts (their exact labels,
// links and small lines), the sections in order with their hints, empty and error words, each
// urgent card's line from its data, the hidden event's warning, Needs attention's items each
// linking to where it's dealt with, and no link repeating a menu link's name.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/today-actions", () => ({
  setUrgentAction: vi.fn(),
  closeShiftAction: vi.fn(),
  reopenShiftAction: vi.fn(),
  offerShiftAction: vi.fn(),
  keepBookingAction: vi.fn(),
}));
vi.mock("@/app/office/shifts/actions", () => ({
  setShowingAction: vi.fn(),
  cancelBookingAction: vi.fn(),
  cancelShiftAction: vi.fn(),
  moveShiftAction: vi.fn(),
}));

const { DashboardContent } = await import("@/app/office/dashboard-view");

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
const ok = <T>(data: T) => ({ ok: true as const, data });
const failed = { ok: false as const };

const noNeeds: NeedsAttention = {
  toCheck: [],
  toCheckMore: false,
  fromSheet: [],
  fromSheetMore: false,
  toMark: [],
  toMarkMore: false,
  expired: [],
  expiredMore: false,
  uploads: 0,
  evidence: { addressConfirmed: true, waiting: 0, failed: [], failedMore: false },
};

const empty: Dashboard = {
  timeZone: TZ,
  today: "2026-11-02",
  counts: {
    urgent: ok({ sessions: 0, places: 0, firstStartsAt: null }),
    showing: ok({ events: 0, sessions: 0, places: 0 }),
    cancellations: ok({ total: 0, underNotice: 0, strikes: 0, threshold: 48 }),
    enquiries: ok({ total: 0, automatic: 0, needPerson: 0 }),
  },
  urgent: ok({ events: [], more: false }),
  showing: ok({ events: [], more: 0 }),
  cancellations: ok({ rows: [], threshold: 48 }),
  enquiries: ok({ rows: [], replies: {} }),
  needs: ok(noNeeds),
};

const session = (o: Partial<SessionRow> = {}): SessionRow => ({
  shiftId: "s1",
  role: "steward",
  startsAt: at("2026-11-07T10:00:00Z"),
  endsAt: at("2026-11-07T18:00:00Z"),
  status: "open",
  headcount: 2,
  booked: 1,
  isUrgent: false,
  urgentGap: false,
  showing: true,
  payRatePence: null,
  post: null,
  meetingPoint: null,
  uniform: null,
  requirements: [],
  fromSheet: false,
  started: false,
  ended: false,
  ...o,
});
const showingEvent: EventCardData = {
  eventId: "e2",
  name: "Riverside Food Festival",
  place: "Riverside Park",
  firstStartsAt: at("2026-11-07T10:00:00Z"),
  lastStartsAt: at("2026-11-07T14:00:00Z"),
  showing: true,
  sessions: [session(), session({ shiftId: "s2", startsAt: at("2026-11-07T14:00:00Z") })],
  moreSessions: 3,
  sessionCount: 5,
  placesFree: 6,
  full: false,
  urgentGap: false,
};

const full: Dashboard = {
  ...empty,
  counts: {
    urgent: ok({ sessions: 2, places: 3, firstStartsAt: at("2026-11-04T10:30:00Z") }),
    showing: ok({ events: 8, sessions: 12, places: 26 }),
    cancellations: ok({ total: 2, underNotice: 1, strikes: 1, threshold: 48 }),
    enquiries: ok({ total: 18, automatic: 16, needPerson: 2 }),
  },
  urgent: ok({
    more: false,
    events: [
      {
        eventId: "e1",
        name: "Northern Lights Live",
        place: "Acme Demo Arena",
        showing: true,
        sessions: [
          {
            shiftId: "u1",
            role: "door_supervisor",
            startsAt: at("2026-11-07T06:00:00Z"),
            endsAt: at("2026-11-07T14:00:00Z"),
            headcount: 3,
            placesLeft: 2,
            fromSheet: false,
            showing: true,
            offered: 4,
            stopped: null,
            escalated: false,
          },
        ],
      },
      {
        eventId: "e3",
        name: "Night patrols",
        place: null,
        showing: false,
        sessions: [
          {
            shiftId: "u2",
            role: "steward",
            startsAt: at("2026-11-08T18:00:00Z"),
            endsAt: at("2026-11-08T23:00:00Z"),
            headcount: 1,
            placesLeft: 1,
            fromSheet: false,
            showing: true,
            offered: 0,
            stopped: "no_candidates",
            escalated: true,
          },
        ],
      },
    ],
  }),
  showing: ok({ events: [showingEvent], more: 2 }),
  cancellations: ok({
    threshold: 48,
    rows: [
      {
        assignmentId: "a1",
        ref: "A1B2C3D4",
        workerId: "w1",
        casual: "Ben Carter",
        staffId: null,
        eventName: "Northern Lights Live",
        role: "steward",
        startsAt: at("2026-11-07T08:00:00Z"),
        endsAt: at("2026-11-07T16:00:00Z"),
        siteName: "Acme Demo Arena",
        sitePostcode: null,
        post: null,
        payRatePence: null,
        meetingPoint: null,
        uniform: null,
        requirements: [],
        bookedAt: null,
        cancelledAt: at("2026-11-02T06:00:00Z"),
        by: "casual",
        via: "app",
        officeName: null,
        reason: "Unwell",
        noticeHours: 20,
        strikeCode: "issued",
        strike: {
          status: "live",
          expiresAt: at("2027-01-31T00:00:00Z"),
          reviewNeeded: false,
          evidence: { status: "sent", to: null, sentAt: null },
        },
        warning: null,
        then: { place: "reopened", markedUrgent: false, offeredTo: 0, replacement: null },
      },
      {
        assignmentId: "a2",
        ref: "E5F6A7B8",
        workerId: "w2",
        casual: "Dee Patel",
        staffId: null,
        eventName: null,
        role: "door_supervisor",
        startsAt: at("2026-11-12T08:00:00Z"),
        endsAt: at("2026-11-12T16:00:00Z"),
        siteName: null,
        sitePostcode: null,
        post: null,
        payRatePence: null,
        meetingPoint: null,
        uniform: null,
        requirements: [],
        bookedAt: null,
        cancelledAt: at("2026-11-02T07:00:00Z"),
        by: "office",
        via: "office",
        officeName: "Sam Rota",
        reason: "Event moved",
        noticeHours: 240,
        strikeCode: "by_firm",
        strike: null,
        warning: null,
        then: { place: "reopened", markedUrgent: false, offeredTo: 0, replacement: null },
      },
    ],
  }),
  enquiries: ok({
    rows: [
      {
        messageId: "m1",
        at: at("2026-11-02T07:30:00Z"),
        channel: "whatsapp",
        text: "Any shifts this weekend?",
        who: { kind: "casual", workerId: "w3", name: "Zoe Usman", firstName: "Zoe", active: true },
        outcome: "keyword",
      },
      {
        messageId: "m2",
        at: at("2026-11-02T08:00:00Z"),
        channel: "sms",
        text: "Can I talk to someone",
        who: { kind: "unknown", from: "+447700900998" },
        outcome: "person_waiting",
      },
    ],
    replies: { m1: "Hi Zoe, for the weekend you can take:", m2: null },
  }),
  needs: ok({
    ...noNeeds,
    toCheck: [
      {
        shiftId: "t1",
        workerId: "w4",
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
      {
        shiftId: "m1",
        role: "steward",
        site: "Acme Demo Racecourse",
        startsAt: at("2026-10-31T10:00:00Z"),
        endsAt: at("2026-10-31T18:00:00Z"),
        unmarked: 3,
      },
    ],
    expired: [
      {
        assignmentId: "x1",
        workerId: "w5",
        worker: "Ben Example",
        shiftId: "x-shift",
        role: "door_supervisor",
        startsAt: at("2026-11-07T10:00:00Z"),
        type: "SIA_DS",
        credential: "SIA door supervisor licence",
        expiresOn: "2026-11-01",
      },
    ],
    uploads: 2,
    evidence: {
      addressConfirmed: false,
      waiting: 1,
      failed: [
        {
          assignmentId: "ev1",
          casual: "Ann Booker",
          cancelledAt: at("2026-11-02T10:00:00Z"),
          stuck: false,
          nothingSent: true,
        },
      ],
      failedMore: false,
    },
  }),
};

const render = (d: Dashboard, isAdmin = false) =>
  renderToStaticMarkup(createElement(DashboardContent, { d, isAdmin }));
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
// The HTML of the section labelled by this heading id.
const section = (html: string, id: string) =>
  new RegExp(`<section[^>]*aria-labelledby="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] ??
  "";
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1] ?? "",
    name: words(m[2] ?? ""),
  }));

describe("the words", () => {
  it("places free; why offers stopped; people not marked yet", () => {
    expect(placesText(1, 1)).toBe("1 place free");
    expect(placesText(2, 3)).toBe("2 of 3 places free");
    expect(stoppedText({ stopped: "no_candidates" })).toBe(
      "Offers stopped: nobody else can take it.",
    );
    expect(stoppedText({ stopped: "hidden" })).toBe("Offers stopped: it's hidden from casuals.");
    expect(stoppedText({ stopped: null })).toBeNull();
    expect(toMarkText(1)).toBe("1 person not marked yet.");
    expect(toMarkText(4)).toBe("4 people not marked yet.");
  });

  it("each urgent session's line, written from its offers", () => {
    expect(urgentLine({ offered: 4, stopped: null })).toBe("Offered to 4 casuals");
    expect(urgentLine({ offered: 1, stopped: null })).toBe("Offered to 1 casual");
    expect(urgentLine({ offered: 0, stopped: null })).toBe("Offered to 0 casuals");
    expect(urgentLine({ offered: 6, stopped: "no_candidates" })).toBe(
      "Offers stopped: nobody else can take it.",
    );
  });

  it("each quick action says what happened", () => {
    expect(urgentResultText({ status: "marked" })).toBe("Marked urgent. Offers are going out.");
    expect(urgentResultText({ status: "not_allowed" })).toBe("You can't change shifts.");
    expect(closeResultText({ status: "closed", placesLeft: 1 })).toBe(
      "Marked as filled. Nobody else will be offered it.",
    );
    expect(closeResultText({ status: "sheet" })).toBe(
      "This shift comes from your Google Sheet. Change it there.",
    );
    expect(offerResultText({ status: "queued" }, "Ann Booker")).toBe(
      "Offer on its way to Ann Booker.",
    );
    expect(offerResultText({ status: "not_candidate" }, "Ann Booker")).toBe(
      "Ann Booker can't be offered this shift now.",
    );
    expect(offerResultText({ status: "logged_out" }, "Ann Booker")).toBe(
      "Your session has ended. Log in again.",
    );
    expect(urgentResultText({ status: "marked_hidden" })).toBe(
      "Marked urgent. It's hidden from casuals, so no offers go out while it's hidden.",
    );
    expect(offerResultText({ status: "hidden" }, "Ann Booker")).toBe(
      "This shift is hidden from casuals, so it can't be offered. Show it to casuals first.",
    );
  });

  it("each count's small line, at zero, with figures, and when it couldn't be read", () => {
    expect(COUNTS.map((c) => countLine(c.key, empty.counts, TZ))).toEqual([
      "Every urgent shift is filled",
      "Nothing is showing",
      "None since midnight",
      "None since midnight",
    ]);
    expect(COUNTS.map((c) => countLine(c.key, full.counts, TZ))).toEqual([
      "3 places · first starts Wed 10:30",
      "26 open places across 12 sessions",
      "1 under 48 hours · 1 strike issued",
      "16 answered automatically · 2 need a person",
    ]);
    const one = {
      ...empty.counts,
      urgent: ok({ sessions: 1, places: 1, firstStartsAt: at("2026-07-01T09:00:00Z") }),
      enquiries: ok({ total: 1, automatic: 0, needPerson: 1 }),
    };
    // Summer: the firm's clock (BST).
    expect(countLine("urgent", one, TZ)).toBe("1 place · first starts Wed 10:00");
    expect(countLine("enquiries", one, TZ)).toBe("0 answered automatically · 1 needs a person");
    const broken = { ...empty.counts, urgent: failed, enquiries: failed };
    expect(countLine("urgent", broken, TZ)).toBe("Couldn't load");
    expect(countLine("enquiries", broken, TZ)).toBe("Couldn't load");
  });

  it("who cancelled; a qualification out of date; uploads; the bell", () => {
    expect(cancelledByText({ by: "casual", casual: "Ben Carter" })).toBe("Ben Carter cancelled");
    expect(cancelledByText({ by: "office", casual: "Ben Carter" })).toBe(
      "The office cancelled Ben Carter",
    );
    const e = full.needs.ok ? full.needs.data.expired[0] : undefined;
    if (!e) throw new Error("fixture");
    expect(expiredText(e, "2026-11-02", TZ)).toBe(
      "Ben Example's SIA door supervisor licence expired on Sun 1 Nov, before their door supervisor shift on Sat 7 Nov.",
    );
    expect(expiredText({ ...e, expiresOn: "2026-11-05" }, "2026-11-02", TZ)).toBe(
      "Ben Example's SIA door supervisor licence runs out on Thu 5 Nov, before their door supervisor shift on Sat 7 Nov.",
    );
    expect(expiredText({ ...e, expiresOn: null }, "2026-11-02", TZ)).toBe(
      "Ben Example's SIA door supervisor licence is marked as expired, and they're booked on a door supervisor shift on Sat 7 Nov.",
    );
    // Runs out on the day a night shift starts: during it, not before it.
    expect(
      expiredText(
        { ...e, expiresOn: "2026-11-07", startsAt: new Date("2026-11-07T22:00:00Z") },
        "2026-11-02",
        TZ,
      ),
    ).toBe(
      "Ben Example's SIA door supervisor licence runs out on Sat 7 Nov, during their door supervisor shift on Sat 7 Nov.",
    );
    // Enquiries today's list points to the requests from the app its count includes.
    expect(appTodayText(1)).toBe("Plus 1 request made in the app today.");
    expect(appTodayText(2)).toBe("Plus 2 requests made in the app today.");
    expect(uploadsText(1)).toBe("1 upload waits for a check.");
    expect(uploadsText(3)).toBe("3 uploads wait for a check.");
    expect(bellLabel(3, false)).toBe("Needs attention, 3");
    expect(bellLabel(50, true)).toBe("Needs attention, 50+");
    expect(bellLabel(null, false)).toBe("Needs attention");
  });
});

describe("the page", () => {
  it("the four counts, labelled exactly, each a link to its list; the first tinted and larger", () => {
    const nav = /<nav aria-label="Counts">([\s\S]*?)<\/nav>/.exec(render(full))?.[1] ?? "";
    const tiles = links(nav);
    expect(tiles.map((t) => t.href)).toEqual([
      "/office/events?view=urgent",
      "/office/events?view=showing",
      "/office/cancellations?day=today",
      "/office/enquiries?day=today",
    ]);
    expect(tiles.map((t) => t.name)).toEqual([
      "2 Urgent shifts not filled 3 places · first starts Wed 10:30",
      "8 Events showing to casuals 26 open places across 12 sessions",
      "2 Cancellations today 1 under 48 hours · 1 strike issued",
      "18 Enquiries today 16 answered automatically · 2 need a person",
    ]);
    const anchors = [...nav.matchAll(/<a [^>]*class="([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(anchors[0]).toContain("bg-urgent-soft");
    for (const other of anchors.slice(1)) {
      expect(other).not.toContain("bg-urgent-soft");
      expect(other).toContain("bg-card");
    }
    expect(nav).toMatch(/text-3xl text-urgent/);
    expect(nav.match(/text-2xl text-ink-muted/g)).toHaveLength(3);
  });

  it("the sections in order, each with its hint", () => {
    const html = render(full);
    const headings = [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([^<]*)<\/h2>/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(headings).toEqual([
      ["urgent", "Urgent shifts not filled"],
      ["showing", "Showing to casuals"],
      ["cancellations", "Cancellations"],
      ["enquiries", "Enquiries"],
      ["needs-attention", "Needs attention"],
    ]);
    for (const s of Object.values(SECTIONS)) expect(words(html)).toContain(s.hint);
    expect(words(html)).toContain("Recorded automatically, never approved or declined");
  });

  it("says so when each section is empty", () => {
    const text = words(render(empty));
    for (const s of Object.values(SECTIONS)) expect(text).toContain(s.empty);
    expect(text).toContain("Every urgent shift is filled.");
    expect(text).toContain("Nothing needs attention.");
    // The links to the full lists stay.
    expect(links(render(empty)).map((l) => l.name)).toEqual(
      expect.arrayContaining(["All records", "All enquiries"]),
    );
  });

  it("a part that couldn't be read shows its error words, and the rest still shows", () => {
    const broken: Dashboard = {
      ...full,
      counts: { ...full.counts, showing: failed },
      urgent: failed,
      enquiries: failed,
      needs: failed,
    };
    const html = render(broken);
    for (const id of ["urgent", "enquiries", "needs-attention"]) {
      expect(words(section(html, id))).toContain(SECTION_ERROR);
    }
    expect(words(section(html, "cancellations"))).toContain("Ben Carter cancelled");
    expect(words(section(html, "cancellations"))).not.toContain(SECTION_ERROR);
    const nav = /<nav aria-label="Counts">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    expect(links(nav)[1]?.name).toBe("– Events showing to casuals Couldn't load");
  });

  it("each urgent card: only its urgent gaps, each with its line; a hidden event warns", () => {
    const urgent = section(render(full), "urgent");
    const cards = [...urgent.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)].map((m) =>
      words(m[1] ?? ""),
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("Northern Lights Live");
    expect(cards[0]).toContain("Urgent 2 of 3 places free");
    expect(cards[0]).toContain("Door supervisor, Sat 7 Nov, 06:00 to 14:00");
    expect(cards[0]).toContain("Offered to 4 casuals");
    expect(cards[0]).not.toContain("Hidden from casuals");
    expect(cards[1]).toContain("Hidden from casuals: nobody can see this gap.");
    expect(cards[1]).toContain("Offers stopped: nobody else can take it.");
    expect(cards[1]).toContain("The office was emailed about it.");
    expect(urgent).toMatch(/href="\/office\/events\/e1"/);
    expect(urgent).toMatch(/href="\/office\/shifts\/u1"/);
    expect(urgent).toContain(">Offer to someone</a>");
  });

  it("a session hidden on its own, in an event casuals can see, warns on that session", () => {
    if (!full.urgent.ok) throw new Error("fixture");
    const shown = full.urgent.data.events[0];
    const session = shown?.sessions[0];
    if (!shown || !session) throw new Error("fixture");
    const d: Dashboard = {
      ...full,
      urgent: ok({
        more: false,
        events: [
          {
            ...shown,
            sessions: [session, { ...session, shiftId: "u3", showing: false, offered: 0 }],
          },
        ],
      }),
    };
    const urgent = section(render(d), "urgent");
    const items = [...urgent.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1] ?? "");
    const hidden = items.find((i) => i.includes('href="/office/shifts/u3"')) ?? "";
    const other = items.find((i) => i.includes('href="/office/shifts/u1"')) ?? "";
    expect(words(hidden)).toContain("Hidden from casuals: nobody can see this gap.");
    expect(words(other)).not.toContain("Hidden from casuals");
    expect(words(urgent).match(/Hidden from casuals/g)).toHaveLength(1);
  });

  it("showing: two sessions, then how many more; the event's switch; more events", () => {
    const showing = words(section(render(full), "showing"));
    expect(showing).toContain("Riverside Food Festival");
    expect(showing).toContain("Steward 10:00–18:00 · 1/2 filled");
    expect(showing).toContain("Steward 14:00–18:00 · 1/2 filled");
    expect(showing).toContain("+ 3 more");
    expect(showing).toContain("5 sessions · 6 places free");
    expect(section(render(full), "showing")).toContain(
      'aria-label="Show Riverside Food Festival to casuals"',
    );
    expect(showing).toContain("And 2 more. All events showing");
  });

  it("cancellations: who, the session, a red chip under the notice, the strike, and All records", () => {
    const html = section(render(full), "cancellations");
    const text = words(html);
    expect(text).toContain("Ben Carter cancelled");
    expect(text).toContain(
      "Steward · Northern Lights Live, Acme Demo Arena · Sat 7 Nov, 08:00 to 16:00",
    );
    expect(text).toContain("20 hours' notice");
    expect(text).toContain("Strike issued");
    expect(text).toContain("The office cancelled Dee Patel");
    expect(text).toContain("10 days' notice");
    expect(html).toMatch(/href="\/office\/cancellations\/A1B2C3D4"/);
    expect(links(html).at(-1)).toEqual({ href: "/office/cancellations", name: "All records" });
    // Red (urgent) under 48 hours only.
    expect(html.match(/border-urgent|bg-urgent-soft/g)?.length ?? 0).toBeGreaterThan(0);
    expect(words(html.split("Dee Patel")[1] ?? "")).not.toContain("Strike");
    expect(html).not.toMatch(/>(Approve|Decline|Deny)</);
  });

  it("enquiries: their words, the outcome, the reply's first line, and All enquiries", () => {
    const html = section(render(full), "enquiries");
    const text = words(html);
    expect(text).toContain("Zoe Usman");
    expect(text).toContain("“Any shifts this weekend?”");
    expect(text).toContain("Answered by keyword");
    expect(text).toContain("Reply: Hi Zoe, for the weekend you can take:");
    expect(text).toContain("Passed to a person, waiting");
    expect(text).toContain("No reply yet.");
    expect(links(html).at(-1)).toEqual({ href: "/office/enquiries", name: "All enquiries" });
  });

  it("Needs attention: each item, with a link to where it's dealt with", () => {
    const html = render(full, true);
    // Its parts are sections inside it (each id is the page's only one).
    const needs = html.slice(html.indexOf('aria-labelledby="needs-attention"'));
    const part = (id: string) => section(html, id);
    expect(words(part("to-check"))).toContain("Lena Leaver is booked, but is no longer active.");
    expect(part("to-check")).toMatch(/href="\/office\/casuals\/w4"/);
    expect(words(part("to-check"))).toContain("Cancel Lena Leaver's booking");
    expect(words(part("from-sheet"))).toContain("Track operative at Demo Junction");
    expect(part("from-sheet")).toMatch(/href="\/office\/shifts\/f1"/);
    // Who worked?: one link per row, the shift.
    const marks = [...part("to-mark").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.[1]?.match(/<a /g)).toHaveLength(1);
    expect(marks[0]?.[1]).toMatch(/href="\/office\/shifts\/m1"/);
    expect(words(part("to-mark"))).toContain("3 people not marked yet.");
    expect(words(part("expired"))).toContain(
      "Ben Example's SIA door supervisor licence expired on Sun 1 Nov",
    );
    expect(part("expired")).toMatch(/href="\/office\/casuals\/w5"/);
    expect(part("expired")).toMatch(/href="\/office\/shifts\/x-shift"/);
    expect(words(part("uploads"))).toContain("2 uploads wait for a check.");
    expect(part("uploads")).toMatch(/href="\/office\/casuals\?view=uploads"/);
    expect(words(part("evidence"))).toContain(
      "The strikes team's email isn't set and confirmed, so strike records can't be emailed to them. 1 record waits for it.",
    );
    expect(part("evidence")).toMatch(/href="\/office\/settings"/);
    expect(part("evidence")).toMatch(/href="\/office\/cancellations\/ev1"/);
    // Each part's heading, with its count.
    expect(
      [...needs.matchAll(/<h3 id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => [
        m[1],
        words(m[2] ?? ""),
      ]),
    ).toEqual([
      ["to-check", "Bookings to check 1"],
      ["from-sheet", "From your rota sheet 1"],
      ["to-mark", "Who worked? 1"],
      ["expired", "Qualifications out of date on a booking 1"],
      ["uploads", "Uploads to check 2"],
      ["evidence", "Strike evidence 2"],
    ]);
    // The bell counts them all.
    expect(full.needs.ok && needsCount(full.needs.data)).toEqual({ count: 8, more: false });
  });

  it("no dashboard link repeats a menu link's name", () => {
    const menu = officeMenu("admin").flatMap((g) => g.links.map((l) => l.label));
    expect(menu).toContain("Dashboard");
    const names = links(render(full, true)).map((l) => l.name);
    for (const label of menu) expect(names).not.toContain(label);
  });
});

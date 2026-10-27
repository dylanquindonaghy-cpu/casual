import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NeedsAttention } from "@/lib/office/dashboard";
import { attentionCount, attentionOf, needsCount } from "@/lib/office/dashboard";
import {
  COUNT_ERROR,
  expiredText,
  plannerRefusedText,
  SECTIONS,
  uploadsText,
} from "@/lib/office/dashboard-copy";
import { appTodayText } from "@/lib/office/enquiries-copy";
import { toMarkGroups } from "@/lib/office/to-mark";
import {
  closeResultText,
  offerResultText,
  placesText,
  stoppedText,
  toMarkText,
  urgentResultText,
} from "@/lib/office/today-copy";

// Needs attention (docs/office-v2.md 3.2, 3.9; docs/screens.md `/office/needs-attention`; 12E.1;
// Phases 18 and 20): its words (src/lib/office/dashboard-copy.ts, today-copy.ts), its count (the
// top bar's "To check" and the menu's), and its page (src/app/office/needs-items.tsx) from
// made-up data: each item linking to where it's dealt with, and "Also needs you" with the urgent
// places. Until Phase 24 these were the old dashboard's tests too; its new words and parts are
// tests/unit/office.board.test.ts's.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/today-actions", () => ({
  setUrgentAction: vi.fn(),
  closeShiftAction: vi.fn(),
  reopenShiftAction: vi.fn(),
  offerShiftAction: vi.fn(),
  offerPanelAction: vi.fn(),
  keepBookingAction: vi.fn(),
}));
vi.mock("@/app/office/shifts/actions", () => ({
  setShowingAction: vi.fn(),
  cancelBookingAction: vi.fn(),
  cancelShiftAction: vi.fn(),
  moveShiftAction: vi.fn(),
}));

const { AlsoNeedsYou, NeedsItems, needsPageLine } = await import("@/app/office/needs-items");

const TZ = "Europe/London";
const TODAY = "2026-11-02";
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
  uploadList: [],
  evidence: { addressConfirmed: true, waiting: 0, failed: [], failedMore: false },
  plannerRefused: [],
  plannerRefusedMore: false,
  webhookFailing: null,
};

// Every kind of item Needs attention holds, one or two of each.
const needsFull: NeedsAttention = {
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
  uploadList: [
    {
      id: "up1",
      workerId: "w6",
      name: "Ben Fraser",
      kind: "photo",
      qualificationType: null,
      qualificationName: null,
      sentAt: at("2026-11-02T01:29:00Z"),
    },
    {
      id: "up2",
      workerId: "w7",
      name: "Leah Ward",
      kind: "certificate",
      qualificationType: "SIA_DS",
      qualificationName: "SIA door supervisor licence",
      sentAt: at("2026-10-31T15:29:00Z"),
    },
  ],
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
  plannerRefused: [
    {
      shiftId: "p1",
      role: "steward",
      site: "Acme Demo Racecourse",
      startsAt: at("2026-11-07T10:00:00Z"),
      endsAt: at("2026-11-07T18:00:00Z"),
      refusedAt: at("2026-11-02T08:30:00Z"),
      why: "move",
      casuals: 2,
    },
  ],
};

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

  it("a qualification out of date; uploads; the bell", () => {
    const e = needsFull.expired[0];
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
    // Your planner's refused change: a move the rules refused, then what a booking blocks.
    const p = needsFull.plannerRefused[0];
    if (!p) throw new Error("fixture");
    const refused = "Your planner's change to the steward session on Sat 7 Nov was refused:";
    expect(plannerRefusedText(p, TZ)).toBe(
      `${refused} 2 booked casuals can't work it. Cancel their bookings, then ask your planner to send it again.`,
    );
    expect(plannerRefusedText({ ...p, casuals: 1 }, TZ)).toBe(
      `${refused} 1 booked casual can't work it. Cancel their booking, then ask your planner to send it again.`,
    );
    expect(plannerRefusedText({ ...p, why: "session_has_bookings", casuals: 0 }, TZ)).toBe(
      `${refused} it changes the role or the qualifications needed, and casuals are booked. Cancel their bookings, then ask your planner to send it again.`,
    );
    expect(plannerRefusedText({ ...p, why: "places_below_booked", casuals: 0 }, TZ)).toBe(
      `${refused} it takes away places casuals are booked in. Cancel those bookings, then ask your planner to send it again.`,
    );
    expect(plannerRefusedText({ ...p, why: "change_reason_required", casuals: 0 }, TZ)).toBe(
      `${refused} it moves or cancels a session casuals are booked on, and gave no reason. Ask your planner to send it again with a reason.`,
    );
    // The day is the firm's: 23:30 on Saturday in British Summer Time is still Saturday.
    expect(
      plannerRefusedText(
        { ...p, role: "door_supervisor", startsAt: at("2026-06-06T22:30:00Z") },
        TZ,
      ),
    ).toContain("the door supervisor session on Sat 6 Jun was refused");
    // Each refused session is one of Needs attention's items; a list stopped at 50 shows "50+".
    expect(needsCount({ ...noNeeds, plannerRefused: [p, p], plannerRefusedMore: true })).toEqual({
      count: 2,
      more: true,
    });
    // The one count (Phase 20): those items and the enquiries that need a person, as the menu shows.
    expect(
      attentionCount({ ...noNeeds, plannerRefused: [p, p], plannerRefusedMore: true }, 3),
    ).toEqual({ count: 5, more: true });
    expect(attentionCount(noNeeds, 0)).toEqual({ count: 0, more: false });
    // Needs attention's page: unread items give no count; unread enquiries make it "at least".
    expect(attentionOf(ok(noNeeds), ok(3))).toEqual({ count: 3, more: false });
    expect(attentionOf(ok(noNeeds), failed)).toEqual({ count: 0, more: true });
    expect(attentionOf(failed, ok(3))).toBeNull();
  });
});

describe("its count line, and Also needs you", () => {
  it("Needs attention's page: its count line, and Also needs you with the urgent places (Phase 20)", () => {
    expect(needsPageLine({ count: 6, more: false })).toBe(
      "6 things for you. Each item links to where it's dealt with.",
    );
    expect(needsPageLine({ count: 1, more: false })).toBe(
      "1 thing for you. Each item links to where it's dealt with.",
    );
    expect(needsPageLine({ count: 50, more: true })).toBe(
      "50+ things for you. Each item links to where it's dealt with.",
    );
    expect(needsPageLine(null)).toBe("Each item links to where it's dealt with.");
    const also = (urgent: { places: number; firstStartsAt: Date | null } | null) =>
      renderToStaticMarkup(createElement(AlsoNeedsYou, { urgent, timeZone: TZ }));
    // Urgent places: how many and the day of the first, with the way to the dashboard.
    const some = also({ places: 3, firstStartsAt: at("2026-11-05T07:00:00Z") });
    expect(some).toMatch(/^<section aria-labelledby="also-needs-you"/);
    expect(words(some)).toBe(
      "Also needs you 3 urgent places to fill, the first on Thu 5 Nov. Go to the Dashboard",
    );
    expect(some).toMatch(/<a class="[^"]*" href="\/office">Go to the Dashboard<\/a>/);
    expect(words(also({ places: 1, firstStartsAt: null }))).toBe(
      "Also needs you 1 urgent place to fill. Go to the Dashboard",
    );
    // None: said so, with no link.
    const none = also({ places: 0, firstStartsAt: null });
    expect(words(none)).toBe("Also needs you No urgent places to fill.");
    expect(none).not.toContain("<a ");
    // Their count unread: said so.
    expect(words(also(null))).toBe(`Also needs you ${COUNT_ERROR}`);
    expect(also(null)).not.toContain("<a ");
  });
});

describe("Needs attention's page (Phase 18: the top bar's To check opens it since Phase 24)", () => {
  const page = (isAdmin = true) =>
    renderToStaticMarkup(
      createElement(NeedsItems, {
        n: needsFull,
        timeZone: TZ,
        today: TODAY,
        isAdmin,
      }),
    );

  it("each item, with a link to where it's dealt with", () => {
    const html = page();
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
    expect(words(part("planner-refused"))).toContain(
      "Your planner's change to the steward session on Sat 7 Nov was refused: 2 booked casuals can't work it.",
    );
    expect(words(part("planner-refused"))).toContain(
      "Steward at Acme Demo Racecourse , Sat 7 Nov, 10:00 to 18:00",
    );
    expect(words(part("planner-refused"))).toContain("Refused 08:30 on Mon 2 Nov");
    expect(part("planner-refused")).toMatch(/href="\/office\/shifts\/p1"/);
    // Each part's heading, with its count (the ids the dashboard's rows link to).
    expect(
      [...html.matchAll(/<h3 id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => [
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
      ["planner-refused", "Your planner's change was refused 1"],
    ]);
  });

  it("your planner's webhook failing: since when, what to do, Integrations for an admin", () => {
    const failing = (isAdmin: boolean) =>
      renderToStaticMarkup(
        createElement(NeedsItems, {
          n: { ...noNeeds, webhookFailing: { since: at("2026-11-02T03:10:00Z") } },
          timeZone: TZ,
          today: "2026-11-02",
          isAdmin,
        }),
      );
    const admin = failing(true);
    expect(admin).toContain('<h3 id="webhook"');
    expect(words(section(admin, "webhook"))).toContain(
      "Since 03:10 on Mon 2 Nov, bookings and cancellations haven't reached your planner by webhook.",
    );
    expect(
      [...admin.matchAll(/<h3 id="([^"]+)"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => words(m[2] ?? "")),
    ).toEqual(["Your planner's webhook is failing 1"]);
    expect(section(admin, "webhook")).toMatch(
      /<a [^>]*href="\/office\/settings\/integrations"[^>]*>Open Integrations<\/a>/,
    );
    // A resourcer can't open Integrations: told who can.
    const resourcer = failing(false);
    expect(resourcer).not.toContain('href="/office/settings/integrations"');
    expect(words(resourcer)).toContain("An admin can check it in Integrations.");
  });

  it("Phase 20: each upload by name and time with its own Check; alike sessions to mark in one row; the enquiries that need a person", () => {
    const html = page();
    // Each upload: whose and what (mid-sentence), when, and its own Check to their page.
    const uploads = [...section(html, "uploads").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(uploads.map((u) => words(u))).toEqual([
      "Ben Fraser's staff photo Uploaded at 01:29 on Mon 2 Nov Check",
      "Leah Ward's SIA door supervisor licence Uploaded at 15:29 on Sat 31 Oct Check",
    ]);
    expect(uploads[0]).toMatch(
      /<a aria-label="Check Ben Fraser&#x27;s upload" class="[^"]*" href="\/office\/casuals\/w6#uploads">Check<\/a>/,
    );
    expect(uploads[1]).toMatch(/href="\/office\/casuals\/w7#uploads"/);
    // More than the first 50: said so.
    const lots = renderToStaticMarkup(
      createElement(NeedsItems, {
        n: { ...needsFull, uploads: 60 },
        timeZone: TZ,
        today: TODAY,
        isAdmin: true,
      }),
    );
    expect(words(section(lots, "uploads"))).toContain("Showing the first 2.");
    // Sessions alike (role, place, times): one row, how many sessions, the people summed, and
    // each session's way in.
    const m1 = needsFull.toMark[0]!;
    const alike = [
      m1,
      { ...m1, shiftId: "m2", unmarked: 1 },
      { ...m1, shiftId: "m3", unmarked: 2 },
    ];
    expect(
      toMarkGroups([...alike, { ...m1, shiftId: "m4", site: "Elsewhere" }]).map((g) => [
        g.sessions.map((t) => t.shiftId),
        g.unmarked,
      ]),
    ).toEqual([
      [["m1", "m2", "m3"], 6],
      [["m4"], m1.unmarked],
    ]);
    const grouped = section(
      renderToStaticMarkup(
        createElement(NeedsItems, {
          n: { ...noNeeds, toMark: alike },
          timeZone: TZ,
          today: TODAY,
          isAdmin: true,
        }),
      ),
      "to-mark",
    );
    const row = [...grouped.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
    expect(row).toHaveLength(1);
    expect(words(row[0]?.[1] ?? "")).toContain(
      "· 3 sessions 6 people not marked yet. Mark who worked: Session 1 Session 2 Session 3",
    );
    expect([...grouped.matchAll(/href="\/office\/shifts\/(m\d)"/g)].map((m) => m[1])).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    // The enquiries that need a person: a part of their own, counted, to Enquiries.
    const asked = renderToStaticMarkup(
      createElement(NeedsItems, {
        n: noNeeds,
        timeZone: TZ,
        today: TODAY,
        isAdmin: true,
        needPerson: 2,
      }),
    );
    expect(words(section(asked, "enquiries"))).toBe(
      "Enquiries that need a person 2 2 messages and requests the shifts line couldn't answer. Open Enquiries",
    );
    expect(section(asked, "enquiries")).toMatch(/href="\/office\/enquiries"/);
    expect(words(asked)).not.toContain(SECTIONS.needs.empty);
  });

  it("nothing: says so", () => {
    const calm = renderToStaticMarkup(
      createElement(NeedsItems, { n: noNeeds, timeZone: TZ, today: TODAY, isAdmin: true }),
    );
    expect(words(calm)).toContain(SECTIONS.needs.empty);
  });
});

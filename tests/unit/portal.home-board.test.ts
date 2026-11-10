import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { inDays } from "@/lib/portal/sign-copy";
import {
  barFill,
  countdownFill,
  countPills,
  nextShiftLine,
  qualificationRows,
  QUAL_BAR_FULL_DAYS,
  recordFigures,
  toDoCount,
  updateRows,
} from "@/lib/portal/home-board";
import * as copy from "@/lib/portal/home-copy";
import { homeWeek } from "@/lib/portal/home-week";
import type { MyRecordRow } from "@/lib/portal/my-record";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { OpenShiftsList } from "@/lib/portal/open-shifts";
import { page } from "@/app/ui/classes";
import { HomeQualifications } from "@/app/home/home-qualifications";
import { HomeUpdates } from "@/app/home/home-updates";
import { elementsWhere, keptCopy, onlineCopy, wordsOf } from "../helpers/kept-copy";
import { qual } from "../helpers/qualifications";

// Home as the casual's dashboard (Phase 30.1; docs/screens.md "### 30.1"): every figure its new
// parts show, worked out by code (src/lib/portal/home-board.ts), its words (home-copy.ts), and the
// page they make (src/app/home-view.tsx with its `board`).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/",
}));
const { HomeView } = await import("@/app/home-view");

const TZ = "Europe/London";
const NOW = new Date("2026-11-06T15:38:00Z"); // Friday 6 November 2026, 15:38
const TODAY = "2026-11-06";
const HOUR = 3_600_000;

describe("the counts under 'Hi Zoe'", () => {
  it("Booked, Open to you and Messages always; Urgent and To do only when there are any", () => {
    const all = countPills({ booked: 1, open: 10, urgent: 3, todo: 1, messages: 0 });
    expect(all.map((p) => [p.label, p.count, p.href, p.tone, p.onlineOnly])).toEqual([
      ["Booked", 1, "/shifts", "plain", false],
      ["Open to you", 10, "/shifts/open", "plain", true],
      ["Urgent", 3, "/urgent", "urgent", true],
      ["To do", 1, "#do-this-heading", "todo", true],
      ["Messages", 0, "/messages", "plain", true],
    ]);
    const quiet = countPills({ booked: 0, open: 0, urgent: 0, todo: 0, messages: 2 });
    expect(quiet.map((p) => p.key)).toEqual(["booked", "open", "messages"]);
  });
});

describe("the next shift's line", () => {
  const at = (h: number) => new Date(NOW.getTime() + h * HOUR);
  // Phase 32 (Dylan, on the live demo: one wording): counted exactly as the badge beside it
  // (inDays: "Today", "Tomorrow", "In 3 days"), never in hours (it said "Starts in 71 hours" beside
  // "In 3 days" until then).
  const said = (h: number) => {
    const shift = { startsAt: at(h), endsAt: at(h + 8) };
    return [inDays(shift.startsAt, shift.endsAt, NOW, TZ), copy.startsInText(shift, NOW, TZ)];
  };
  it("says how soon as the badge does: today, tomorrow, in so many days", () => {
    // Friday 15:38: 71 hours on is Monday 14:38, three days on the calendar.
    expect(said(71)).toEqual(["In 3 days", "Starts in 3 days"]);
    expect(said(70.9)).toEqual(["In 3 days", "Starts in 3 days"]);
    expect(said(72)).toEqual(["In 3 days", "Starts in 3 days"]);
    expect(said(1)).toEqual(["Today", "Starts today"]);
    expect(said(0.5)).toEqual(["Today", "Starts today"]);
    expect(said(20)).toEqual(["Tomorrow", "Starts tomorrow"]);
    expect(said(24 * 9 + 5)).toEqual(["In 9 days", "Starts in 9 days"]);
    expect(said(-1)).toEqual(["On now", null]);
    expect(copy.startsInText({ startsAt: at(-10), endsAt: at(-2) }, NOW, TZ)).toBeNull();
  });
  it("the badge and the line agree for every hour of the next two weeks", () => {
    for (let h = 0.25; h < 24 * 14; h += 0.25) {
      const [badge, line] = said(h);
      const expected =
        badge === "Today"
          ? "Starts today"
          : badge === "Tomorrow"
            ? "Starts tomorrow"
            : `Starts ${badge!.charAt(0).toLowerCase()}${badge!.slice(1)}`;
      expect(line, `${h} hours on`).toBe(expected);
    }
  });

  it("the bar fills over the last 7 days", () => {
    expect(countdownFill(at(24 * 7), NOW)).toBe(0);
    expect(countdownFill(at(24 * 30), NOW)).toBe(0);
    expect(countdownFill(at(24 * 3.5), NOW)).toBeCloseTo(0.5);
    expect(countdownFill(at(0), NOW)).toBe(1);
    expect(countdownFill(at(-2), NOW)).toBe(1);
  });

  it("how long, and the booked shift page's own estimate (left out with no rate)", () => {
    const shift = { startsAt: at(70), endsAt: at(78), payRatePence: 1350 };
    expect(nextShiftLine(shift, NOW, TZ)).toEqual({
      startsIn: "Starts in 3 days",
      facts: "8 hours · about £108.00 before tax",
      fill: expect.closeTo(1 - 70 / 168, 5),
    });
    expect(nextShiftLine({ ...shift, payRatePence: null }, NOW, TZ).facts).toBe("8 hours");
    // 7.5 hours at £12.60: £94.50, as the shift's own page says.
    expect(
      nextShiftLine({ startsAt: at(1), endsAt: at(8.5), payRatePence: 1260 }, NOW, TZ).facts,
    ).toBe("7.5 hours · about £94.50 before tax");
  });
});

describe("Your qualifications", () => {
  it("the bar: time left, full at two years or more, empty on its last day", () => {
    expect(QUAL_BAR_FULL_DAYS).toBe(730);
    expect(barFill(730)).toBe(1);
    expect(barFill(1000)).toBe(1);
    expect(barFill(365)).toBe(0.5);
    expect(barFill(0)).toBe(0);
    expect(barFill(-3)).toBe(0);
  });

  const photo = (status: "up_to_date" | "due_soon" | "overdue" | "missing" | "waiting") => ({
    status,
    current:
      status === "missing"
        ? null
        : {
            id: "p1",
            uploadedOn: "2023-11-26",
            renewBy: status === "overdue" ? "2026-11-01" : "2026-11-26",
          },
    waiting: status === "waiting" ? { id: "p2", uploadedOn: "2026-11-05" } : null,
  });
  const unchecked = { checked: false, checkedOn: null, expired: false };

  it("worst first, then the soonest expiry; photo and right to work as rows (the mock-up's Zoe)", () => {
    const rows = qualificationRows({
      qualifications: [
        qual({
          type: "STEWARD_L2",
          name: "Level 2 spectator safety qualification",
          expiresOn: null,
        }),
        qual({
          type: "CSAS",
          name: "CSAS accreditation",
          expiresOn: "2028-03-30",
          uploadable: false,
        }),
        qual({ type: "SIA_DS", name: "SIA door supervisor licence", expiresOn: "2027-12-31" }),
      ],
      photo: photo("due_soon"),
      rightToWork: unchecked,
      today: TODAY,
    });
    expect(rows.map((r) => [r.title, r.pill.words, r.pill.tone])).toEqual([
      ["Staff photo", "20 days left", "attention"],
      ["Right to work", "Not recorded", "quiet"],
      ["SIA door supervisor licence", "Valid · 420 days", "done"],
      ["CSAS accreditation", "Valid · 510 days", "done"],
      ["Level 2 spectator safety qualification", "No expiry", "done"],
    ]);
    const [ph, rtw, sia, , l2] = rows;
    expect(ph).toMatchObject({
      line: "Renew by 26 Nov",
      action: "Take a new photo",
      href: "/profile#photo-heading",
    });
    expect(ph!.bar).toBeCloseTo(20 / 730);
    expect(rtw).toMatchObject({ line: "The office will ask if they need it.", bar: null });
    expect(sia!.bar).toBeCloseTo(420 / 730);
    expect(sia!.href).toBe("/profile#qualifications-heading");
    expect(l2).toMatchObject({ bar: null, line: null });
  });

  it("every status in its words; a lapsed one never reads valid; upload page only with something to send", () => {
    const rows = qualificationRows({
      qualifications: [
        qual({ type: "A", name: "a licence", status: "valid", expiresOn: "2027-01-01" }),
        qual({ type: "B", name: "b licence", status: "expired", expiresOn: "2026-10-01" }),
        qual({ type: "C", name: "c licence", status: "expiring_soon", expiresOn: "2026-11-26" }),
        qual({ type: "D", name: "d licence", status: "suspended", expiresOn: null }),
        qual({ type: "E", name: "e licence", status: "missing", expiresOn: null }),
        qual({ type: "F", name: "f licence", status: "applied", expiresOn: null }),
        qual({ type: "G", name: "g licence", status: "being_checked", expiresOn: null }),
        qual({ type: "H", name: "h licence", status: "rejected", expiresOn: null }),
        qual({ type: "I", name: "i licence", status: "expiring_soon", expiresOn: TODAY }),
      ],
      photo: photo("up_to_date"),
      rightToWork: { checked: true, checkedOn: "2026-03-03", expired: false },
      today: TODAY,
    });
    expect(rows.map((r) => [r.title, r.pill.words])).toEqual([
      ["D licence", "Suspended"],
      ["B licence", "Expired"],
      ["H licence", "Not accepted"],
      ["E licence", "Missing"],
      ["G licence", "Being checked"],
      ["I licence", "Expires today"],
      ["C licence", "Expires in 20 days"],
      ["F licence", "Applied for"],
      ["Staff photo", "Valid · 20 days"],
      ["A licence", "Valid · 56 days"],
      ["Right to work", "Checked"],
    ]);
    const byTitle = (t: string) => rows.find((r) => r.title === t)!;
    expect(byTitle("B licence")).toMatchObject({
      bar: null,
      href: "/profile/upload/B",
      line: "Expired 1 Oct",
    });
    expect(byTitle("D licence").href).toBe("/profile#qualifications-heading"); // an upload can't lift it
    expect(byTitle("G licence").href).toBe("/profile#qualifications-heading"); // already sent
    expect(byTitle("A licence").href).toBe("/profile#qualifications-heading");
    expect(byTitle("Staff photo").action).toBeNull();
    expect(byTitle("Right to work").line).toBe("Checked by the office on 3 Mar");
  });

  it("the office's 'in hand' (28.11): its status stays, its line says so, it goes after hers to do", () => {
    const rows = qualificationRows({
      qualifications: [
        {
          ...qual({ type: "E", name: "e licence", status: "missing", expiresOn: null }),
          inHand: true,
        },
        qual({ type: "C", name: "c licence", status: "expiring_soon", expiresOn: "2026-11-26" }),
        qual({ type: "A", name: "a licence", status: "valid", expiresOn: "2027-01-01" }),
      ],
      photo: photo("waiting"),
      rightToWork: { checked: false, checkedOn: null, expired: true },
      today: TODAY,
    });
    expect(rows.map((r) => [r.title, r.pill.words, r.line])).toEqual([
      ["Staff photo", "Being checked", "The office will check your new one."],
      ["C licence", "Expires in 20 days", "Expires 26 Nov"],
      ["E licence", "Missing", "The office has this in hand."],
      ["Right to work", "Check has run out", "Ask the office."],
      ["A licence", "Valid · 56 days", "Valid until 1 Jan 2027"],
    ]);
    expect(rows[2]!.href).toBe("/profile#qualifications-heading");
  });

  it("others on file link to their own place on Profile; a missing photo asks for one", () => {
    const rows = qualificationRows({
      qualifications: [],
      others: [
        qual({ type: "FIRST_AID", name: "first aid at work certificate", uploadable: false }),
      ],
      photo: photo("missing"),
      rightToWork: unchecked,
      today: TODAY,
    });
    // With none on file there's nothing to replace: "Take a photo" (the review's nit).
    expect(rows.map((r) => [r.title, r.pill.words, r.line, r.action, r.href])).toEqual([
      ["Staff photo", "Missing", "No photo yet.", "Take a photo", "/profile#photo-heading"],
      [
        "Right to work",
        "Not recorded",
        "The office will ask if they need it.",
        null,
        "/profile#qualifications-heading",
      ],
      [
        "First aid at work certificate",
        "Valid · 787 days",
        "Valid until 1 Jan 2029",
        null,
        "/profile#other-qualifications-heading",
      ],
    ]);
  });
});

describe("Updates and Your record", () => {
  const row = (o: Partial<MyRecordRow>): MyRecordRow => ({
    at: new Date("2026-11-04T15:02:00Z"),
    kind: "booked",
    by: "you",
    shift: {
      id: "shift-1",
      role: "steward",
      site: "Riverside Arena",
      startsAt: new Date("2026-11-09T14:00:00Z"),
      canOpen: true,
    },
    moved: null,
    noticeHours: 100,
    reason: null,
    askedBy: null,
    ref: null,
    strike: null,
    ...o,
  });

  it("the latest five, in the record's words, each with its time and the shift's page while she can open it", () => {
    const rows = updateRows(
      [
        row({ at: new Date("2026-11-06T08:00:00Z"), kind: "offered", by: "office" }),
        row({}),
        row({ at: new Date("2026-11-05T09:14:00Z"), kind: "cancelled", by: "office", shift: null }),
        row({ at: new Date("2026-10-20T10:00:00Z"), shift: { ...row({}).shift!, canOpen: false } }),
        row({}),
        row({}),
      ],
      NOW,
      TZ,
    );
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => [r.title, r.sub, r.when, r.href])).toEqual([
      [
        "Offered to you",
        "Steward at Riverside Arena · Mon 9 Nov, 14:00",
        "Today 08:00",
        "/shifts/shift-1",
      ],
      [
        "Booked by you",
        "Steward at Riverside Arena · Mon 9 Nov, 14:00",
        "Wed 15:02",
        "/shifts/shift-1",
      ],
      ["Cancelled by the office", "A shift no longer listed", "Yesterday 09:14", null],
      ["Booked by you", "Steward at Riverside Arena · Mon 9 Nov, 14:00", "Tue 20 Oct, 11:00", null],
      [
        "Booked by you",
        "Steward at Riverside Arena · Mon 9 Nov, 14:00",
        "Wed 15:02",
        "/shifts/shift-1",
      ],
    ]);
    expect(rows[0]!.link).toBe("See the shift");
  });

  it("shifts worked, reliability or New, strikes in the firm's days (left out as Profile leaves them)", () => {
    const fresh = {
      kind: "new" as const,
      counted: 0,
      counts: { worked: 0, noShows: 0, lateCancels: 0 },
    };
    expect(recordFigures(fresh, { counting: 0, liveDays: 90, shown: true })).toEqual([
      { key: "worked", figure: "0", label: "shifts worked" },
      { key: "reliability", figure: "New", label: "score after 5 shifts" },
      { key: "strikes", figure: "0", label: "strikes in 90 days" },
    ]);
    const scored = {
      kind: "figure" as const,
      percent: 92,
      band: "green" as const,
      counts: { worked: 1, noShows: 0, lateCancels: 0 },
    };
    expect(recordFigures(scored, { counting: 1, liveDays: 60, shown: true })).toEqual([
      { key: "worked", figure: "1", label: "shift worked" },
      { key: "reliability", figure: "92%", label: "reliability" },
      { key: "strikes", figure: "1", label: "strike in 60 days" },
    ]);
    expect(recordFigures(scored, { counting: 0, liveDays: 90, shown: false })).toHaveLength(2);
  });
});

describe("Home's words (Phase 30.1)", () => {
  it("the constants, as docs/screens.md '### 30.1' has them", () => {
    expect(copy.COUNT_WORDS).toEqual({
      booked: "Booked",
      open: "Open to you",
      urgent: "Urgent",
      todo: "To do",
      messages: "Messages",
    });
    expect([copy.QUALS_TITLE, copy.QUALS_ALL, copy.WEEK_TITLE, copy.UPDATES_TITLE]).toEqual([
      "Your qualifications",
      "All on Profile",
      "Your week",
      "Updates",
    ]);
    expect([copy.UPDATES_EMPTY, copy.SEE_THE_SHIFT, copy.RECORD_CARD_TITLE]).toEqual([
      "Nothing new yet.",
      "See the shift",
      "Your record",
    ]);
    expect([copy.PHOTO_NEW, copy.RTW_NONE_LINE, copy.NO_EXPIRY]).toEqual([
      "Take a new photo",
      "The office will ask if they need it.",
      "No expiry",
    ]);
    expect(copy.dateLineText(NOW, TZ)).toBe("Friday 6 November");
    expect(copy.updatedText(NOW, TZ)).toBe("Updated 15:38");
    expect(copy.weekRangeText("2026-10-26", "2026-11-01")).toBe("26 Oct to 1 Nov");
    expect(copy.daysLeftText(1)).toBe("1 day left");
    expect(copy.validForText(1)).toBe("Valid · 1 day");
  });
});

// --- The page, with its board ---------------------------------------------------------------------

const site = {
  name: "Riverside Demo Park",
  addressLine1: "1 Test Road",
  addressLine2: null,
  town: "Exampleton",
  postcode: "ZZ7 2AB",
};
const next: MyShift = {
  assignmentId: "a1",
  shiftId: "s1",
  role: "steward",
  startsAt: new Date("2026-11-09T14:00:00Z"),
  endsAt: new Date("2026-11-09T22:00:00Z"),
  status: "confirmed",
  instructions: null,
  eventName: "Riverside Food Festival",
  post: "Gate 2",
  payRatePence: 1350,
  site,
};
const open: OpenShiftsList = {
  shifts: [
    {
      shiftId: "o1",
      role: "steward",
      startsAt: new Date("2026-11-07T10:00:00Z"),
      endsAt: new Date("2026-11-07T18:00:00Z"),
      placesLeft: 1,
      opensAt: null,
      isUrgent: true,
      site: { id: "33333333-3333-4333-8333-333333333333", ...site },
      payRatePence: 1550,
    },
  ],
  truncated: false,
  offerAlerts: true,
  travelOn: false,
  area: null,
  further: { count: 0, atLeast: false },
  choices: { days: [], sites: [], roles: [] },
};
const board = {
  pills: countPills({ booked: 1, open: 1, urgent: 1, todo: 0, messages: 2 }),
  quals: qualificationRows({
    qualifications: [qual({ expiresOn: "2027-12-31" })],
    photo: {
      status: "due_soon" as const,
      current: { id: "p1", uploadedOn: "2023-11-26", renewBy: "2026-11-26" },
      waiting: null,
    },
    rightToWork: { checked: false, checkedOn: null, expired: false },
    today: TODAY,
  }),
  weeks: homeWeek(NOW, TZ, [next], open.shifts),
  updates: [],
  record: recordFigures(
    { kind: "new", counted: 0, counts: { worked: 0, noShows: 0, lateCancels: 0 } },
    { counting: 0, liveDays: 90, shown: true },
  ),
};
const render = (o: Partial<Parameters<typeof HomeView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(HomeView, {
      firmName: "Acme Events",
      pay: { payDay: "2026-11-13", days: 7, start: "2026-11-02", end: "2026-11-08" },
      firstName: "Zoe",
      lastName: "Adeyemi",
      timeZone: TZ,
      now: NOW,
      next,
      needs: [],
      photo: { status: "up_to_date", current: null, waiting: null },
      open,
      board,
      ...o,
    }),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const weekCard = (html: string) => elementsWhere(html, /aria-labelledby="week-heading"/)[0] ?? "";

describe("Home with its board", () => {
  const html = render();

  it("the date line, then the counts, each a link to its page; stale counts online only", () => {
    // All of it online only: the kept copy would call the day it was saved today (its notice
    // gives that day).
    // Phase 32 (32.2, the approved mock-up): "Home" with "Updated 15:38" on its baseline, and the
    // day with pay day under it.
    expect(html).toContain(
      '<h1 class="text-title text-balance text-ink">Home</h1><small data-updated-slot="" data-online-only="" class="text-xs text-ink-faint tabular-nums">Updated 15:38</small>',
    );
    expect(html).toContain(
      '<p data-date-line="" data-online-only="" class="text-base text-ink-muted">Friday 6 November · Pay day Fri 13 Nov</p>',
    );
    const counts = html.match(/<ul role="list" aria-label="Your numbers"[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(text(counts)).toBe("Booked 1 Open to you 1 Urgent 1 Messages 2");
    expect([...counts.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "/shifts",
      "/shifts/open",
      "/urgent",
      "/messages",
    ]);
    expect(
      [...counts.matchAll(/<li( data-online-only="")? class="flex">/g)].map((m) => !!m[1]),
    ).toEqual([false, true, true, true]);
  });

  it("the pass's line: how soon (online only), how long, the estimate; its bar", () => {
    // Phase 32 (32.2): the card's time tile, as the office's session card: the times with how long
    // and the estimate, then (online only) the bar and how soon.
    const line = html.match(/<div data-next-line=""[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(line).toMatch(/>8 hours · about £108\.00 before tax<\/span><\/p>/);
    expect(line).toMatch(
      /<span data-online-only=""[^>]*><span aria-hidden="true"[^>]*>.*<\/span><span [^>]*>Starts in 3 days<\/span><\/span>/,
    );
  });

  it("the sections in order, each its own heading, with the counts beside theirs", () => {
    const headings = [...html.matchAll(/<h2 id="([a-z-]+)-heading"[^>]*>([^<]+)<\/h2>/g)].map(
      (m) => m[2],
    );
    expect(headings).toEqual([
      "Your next shift",
      "Your qualifications",
      "Your week",
      "Shifts you can take",
      "Updates",
      "Pay",
      "Your record",
    ]);
    expect(html).toMatch(
      />Shifts you can take<\/h2><span data-online-only="" class="[^"]*">1<\/span>/,
    );
    expect(html).toMatch(/>Your qualifications<\/h2><span class="[^"]*">3<\/span>/);
    expect(text(html)).toContain("Updates 0 Your shift record Nothing new yet.");
    expect(text(html)).toContain("shifts worked 0 score after 5 shifts New strikes in 90 days 0");
  });

  it("the week's tiles say what each day holds, in words", () => {
    // Each tile's name is its own hidden words (the kept copy's differ: below).
    const week = onlineCopy(weekCard(html));
    const tile = (day: string) => elementsWhere(week, new RegExp(`data-day="${day}"`))[0] ?? "";
    expect(wordsOf(tile("2026-11-09"))).toBe(
      "Mon 9 Monday 9 November: booked, Steward 14:00 to 22:00",
    );
    expect(tile("2026-11-09")).toContain('href="/shifts/s1"');
    expect(tile("2026-11-07")).toContain('href="/shifts/open?day=2026-11-07"');
    expect(wordsOf(tile("2026-11-06"))).toBe("Fri 6 Friday 6 November, today: nothing booked");
    // The day and date are seen, not read: the name says it all.
    expect(tile("2026-11-09")).toMatch(/<span aria-hidden="true" class="[^"]*">Mon<\/span>/);
  });

  it("the laptop grid: the map the whole width, the rest in their columns", () => {
    expect(page.staffWide).toContain("lg:max-w-[73.75rem]");
    expect(html).toContain("lg:grid lg:grid-flow-row-dense lg:grid-cols-12");
    const span = (id: string) =>
      html.match(
        new RegExp(`aria-labelledby="${id}-heading"[^>]*class="[^"]*(lg:col-span-\\d+)`),
      )?.[1];
    // Phase 32 (32.2): the map (with the card over it) the whole width; the qualifications 4.
    expect(html).toMatch(/<div class="lg:col-span-12"><div data-home-map-zone=""/);
    expect(span("quals")).toBe("lg:col-span-4");
    expect(span("week")).toBe("lg:col-span-4");
    expect(span("can-take")).toBe("lg:col-span-4");
    expect(span("updates")).toBe("lg:col-span-4");
    expect(span("pay")).toBe("lg:col-span-6");
    expect(span("record")).toBe("lg:col-span-6");
  });

  it("without a board (the older fixtures), none of the new parts", () => {
    const plain = render({ board: undefined });
    expect(plain).not.toContain("Your numbers");
    // The card's time tile (data-next-line) is the card's own since Phase 32, with a board or not;
    // its two tiles need the page's figures.
    expect(plain).not.toContain("data-card-tiles");
    expect(plain).not.toContain("Your qualifications");
  });
});

// --- The copy kept for no signal (the 30.1 review) ------------------------------------------------
// public/sw.js keeps '/' for up to 14 days; offline, globals.css hides every [data-online-only] and
// shows every [data-offline-only]. What can go stale in that time is online only, with the kept
// copy's own words where she still needs them.

describe("the kept copy never says what may have changed since", () => {
  const html = render();
  const kept = keptCopy(html);

  it("Your qualifications: never a day count or 'Valid' offline, only the date (golden rule 6)", () => {
    const rows = qualificationRows({
      qualifications: [
        qual({ type: "SIA_DS", name: "SIA door supervisor licence", expiresOn: "2027-12-31" }),
        qual({ type: "C", name: "c licence", status: "expiring_soon", expiresOn: "2026-11-26" }),
        qual({ type: "A", name: "a licence", status: "valid", expiresOn: "2028-11-22" }),
        qual({ type: "STEWARD_L2", name: "Level 2 qualification", expiresOn: null }),
        qual({ type: "B", name: "b licence", status: "expired", expiresOn: "2026-10-01" }),
      ],
      photo: {
        status: "due_soon",
        current: { id: "p1", uploadedOn: "2023-11-26", renewBy: "2026-11-26" },
        waiting: null,
      },
      rightToWork: { checked: false, checkedOn: null, expired: false },
      today: TODAY,
    });
    expect(rows.map((r) => [r.title, r.pill.words, r.offline, r.lineOnlineOnly])).toEqual([
      ["B licence", "Expired", null, false],
      ["C licence", "Expires in 20 days", "Expires 26 Nov", true],
      ["Staff photo", "20 days left", "Renew by 26 Nov", true],
      ["Right to work", "Not recorded", null, false],
      ["SIA door supervisor licence", "Valid · 420 days", "Until 31 Dec 2027", true],
      ["A licence", "Valid · 747 days", "Until 22 Nov 2028", true],
      ["Level 2 qualification", "No expiry", null, false],
    ]);
    const card = renderToStaticMarkup(createElement(HomeQualifications, { rows }));
    const offline = wordsOf(keptCopy(card));
    expect(offline).not.toMatch(/\bValid\b/);
    expect(offline).not.toMatch(/\d+ days?\b|\bleft\b|Expires in|Expires today/);
    for (const words of [
      "Expired Expired 1 Oct",
      "Staff photo Renew by 26 Nov Take a new photo",
      "C licence Expires 26 Nov",
      "SIA door supervisor licence Until 31 Dec 2027",
      "A licence Until 22 Nov 2028",
      "Level 2 qualification No expiry",
    ])
      expect(offline).toContain(words);
    // No bar offline: it measures the days left from the day it was drawn.
    expect(keptCopy(card)).not.toContain('style="width:');
    // Online, as before: the day counts, the bars and the date lines.
    const online = wordsOf(onlineCopy(card));
    expect(online).toContain("Staff photo 20 days left Renew by 26 Nov · Take a new photo");
    expect(online).toContain(
      "SIA door supervisor licence Valid · 420 days Valid until 31 Dec 2027",
    );
    expect(online).toContain("C licence Expires in 20 days Expires 26 Nov");
    expect(online).not.toContain("Until 31 Dec 2027 ");
    expect(onlineCopy(card).match(/style="width:/g)).toHaveLength(4);
  });

  it("the staff photo up to date: 'Renew by' offline, never 'Valid'", () => {
    const [photoRow] = qualificationRows({
      qualifications: [],
      photo: {
        status: "up_to_date",
        current: { id: "p1", uploadedOn: "2026-01-02", renewBy: "2029-01-02" },
        waiting: null,
      },
      rightToWork: { checked: true, checkedOn: "2026-03-03", expired: false },
      today: TODAY,
    });
    expect(photoRow).toMatchObject({
      title: "Staff photo",
      pill: { words: "Valid · 788 days" },
      offline: "Renew by 2 Jan",
    });
    const card = renderToStaticMarkup(createElement(HomeQualifications, { rows: [photoRow!] }));
    expect(wordsOf(keptCopy(card))).toBe(
      "Your qualifications 1 All on Profile Staff photo Renew by 2 Jan",
    );
  });

  it("Updates: 'Today' and 'Yesterday' online only; the kept copy gives the day and date", () => {
    const at = (iso: string): MyRecordRow => ({
      at: new Date(iso),
      kind: "booked",
      by: "you",
      shift: null,
      moved: null,
      noticeHours: null,
      reason: null,
      askedBy: null,
      ref: null,
      strike: null,
    });
    const rows = updateRows(
      [at("2026-11-06T08:00:00Z"), at("2026-11-05T09:14:00Z"), at("2026-10-20T10:00:00Z")],
      NOW,
      TZ,
    );
    expect(rows.map((r) => [r.when, r.whenOffline])).toEqual([
      ["Today 08:00", "Fri 6 Nov, 08:00"],
      ["Yesterday 09:14", "Thu 5 Nov, 09:14"],
      ["Tue 20 Oct, 11:00", "Tue 20 Oct, 11:00"],
    ]);
    const card = renderToStaticMarkup(createElement(HomeUpdates, { rows }));
    const offline = wordsOf(keptCopy(card));
    expect(offline).not.toMatch(/Today|Yesterday/);
    expect(offline).toContain("Fri 6 Nov, 08:00");
    expect(offline).toContain("Thu 5 Nov, 09:14");
    expect(offline.match(/Tue 20 Oct, 11:00/g)).toHaveLength(1);
    const online = wordsOf(onlineCopy(card));
    expect(online).toContain("Today 08:00");
    expect(online).not.toContain("Fri 6 Nov, 08:00");
    expect(online.match(/Tue 20 Oct, 11:00/g)).toHaveLength(1);
  });

  it("Your week: her booked days stay; today's ring, the amber outlines and their words don't", () => {
    const online = onlineCopy(weekCard(html));
    expect(online.match(/data-ring=""/g)).toHaveLength(1);
    expect(online.match(/data-outline=""/g)).toHaveLength(1);
    expect(online).toContain('href="/shifts/open?day=2026-11-07"');
    expect(wordsOf(online)).toContain("Filled: booked · outlined: shifts you can take");

    const offline = keptCopy(weekCard(html));
    expect(offline).not.toContain("data-ring");
    expect(offline).not.toContain("data-outline");
    expect(offline).not.toContain("/shifts/open");
    expect(offline).toContain('href="/shifts/s1"');
    const words = wordsOf(offline);
    expect(words).not.toMatch(/today|you can take|outlined/);
    expect(words).toContain("Monday 9 November: booked, Steward 14:00 to 22:00");
    expect(words).toContain("Saturday 7 November: nothing booked");
    expect(words).toContain("Friday 6 November: nothing booked");
    expect(words).toContain("Filled: booked");
    // Fourteen tiles either way: the open day is a plain tile offline, not gone.
    expect(elementsWhere(offline, /data-day="/)).toHaveLength(14);
    expect(elementsWhere(online, /data-day="/)).toHaveLength(14);
  });

  it("Home: no date line (the notice gives the saved day), and each stale part online only", () => {
    expect(html).toContain("data-date-line");
    expect(kept).not.toContain("data-date-line");
    expect(kept).not.toContain("Updated 15:38");
    expect(wordsOf(kept)).toContain("This is your saved copy from 15:38 on Fri 6 Nov.");
    // What stays: the qualifications (by date), the week (her bookings), the record and pay.
    for (const heading of ["Your qualifications", "Your week", "Updates", "Pay", "Your record"])
      expect(kept).toContain(`>${heading}</h2>`);
    expect(wordsOf(kept)).not.toMatch(/\bValid\b|\d+ days? left|Starts in/);
  });
});

describe("To do counts what 'Do this' shows", () => {
  it("each need on Profile and each 'can we reach you' row", () => {
    const photo = {
      status: "due_soon" as const,
      current: { id: "p1", uploadedOn: "2023-11-26", renewBy: "2026-11-26" },
      waiting: null,
    };
    const base = { needs: [], photo, year: 2026, sortedMark: null };
    expect(toDoCount({ ...base, reach: [] })).toBe(1);
    expect(toDoCount({ ...base, reach: ["alerts_off"] })).toBe(2);
    expect(toDoCount({ ...base, reach: ["unreachable", "alerts_off"] })).toBe(3);
    const html = render({
      photo,
      reach: ["unreachable", "alerts_off"],
      board: {
        ...board,
        pills: countPills({
          booked: 1,
          open: 1,
          urgent: 1,
          todo: toDoCount({ ...base, reach: ["unreachable", "alerts_off"] }),
          messages: 0,
        }),
      },
    });
    const doThis = elementsWhere(html, /aria-labelledby="do-this-heading"/)[0] ?? "";
    expect(doThis.match(/<li [^>]*data-for-you=/g)).toHaveLength(3);
    expect(html).toMatch(/data-count="todo"[^>]*>To do <b[^>]*>3<\/b>/);
  });
});

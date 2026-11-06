import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { chip, staffBtn } from "@/app/ui/classes";
import {
  comingChip,
  comingWords,
  NOT_ANSWERED,
  notAnsweredWords,
  type StillComingMark,
} from "@/lib/office/coming-up-copy";
import {
  reminderPush,
  shiftReminder24hEmail,
  shiftReminder24hMessage,
  shiftReminder2hEmail,
  shiftReminder2hMessage,
  STILL_COMING_LINE,
} from "@/lib/messaging/templates";
import type { MyShift } from "@/lib/portal/my-shifts";
import type { ShiftPage } from "@/lib/portal/shift-detail";
import type { ShiftFacts } from "@/lib/portal/shift-facts";
import {
  saidComingText,
  STILL_COMING_WINDOW_HOURS,
  stillComingOpen,
} from "@/lib/portal/still-coming-copy";

// "Still coming?" (Phase 28.14; docs/screens.md "The casual app, Phase 28" 28.14): the card on the
// pass and on the shift's page, rendered to HTML. Both carry data-online-only (the copy kept for no
// signal never shows it), it shows only from 24 hours before the start until the start, "Can't make
// it?" moves into it (never twice), and after an answer it reads "You said you're coming (…)". Then
// the words: the reminder pushes end "Tap to say you're coming." as the doc says, the emails add
// it, the WhatsApp and text reminders don't change, and Coming up's chips. The buttons use Next's
// router, so a stand-in is given here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));

const { NextPass } = await import("@/app/next-pass");
const { ShiftView } = await import("@/app/shifts/[id]/shift-view");
const { StillComingCard } = await import("@/app/shifts/still-coming-card");
const { ComingUpList } = await import("@/app/office/dashboard/coming-up");

const TZ = "Europe/London";
const NOW = new Date("2026-11-06T09:00:00Z"); // Friday 6 Nov, 09:00 London (GMT)
const HOUR = 3_600_000;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const doc = readFileSync("docs/messaging-templates.md", "utf8");
const screens = readFileSync("docs/screens.md", "utf8");

const site = {
  name: "Demo Arena",
  addressLine1: "1 Test Road",
  addressLine2: null,
  town: "Leeds",
  postcode: "LS1 1AA",
};
const shift = (startsAt: Date, o: Partial<MyShift> = {}): MyShift => ({
  assignmentId: "22222222-2222-4222-8222-222222222222",
  shiftId: "11111111-1111-4111-8111-111111111111",
  role: "steward",
  startsAt,
  endsAt: new Date(startsAt.getTime() + 8 * HOUR),
  status: "confirmed",
  instructions: null,
  site,
  stillComingAt: null,
  ...o,
});
const facts: ShiftFacts = {
  eventName: "Raceday",
  payRatePence: 1260,
  post: null,
  meetingPoint: null,
  uniform: null,
  isUrgent: false,
  headcount: 2,
  travel: undefined,
  requirements: [],
  noticeHours: 48,
  strikesOn: true,
  lastDay: "2026-11-06",
};

const pass = (s: MyShift, now = NOW) =>
  renderToStaticMarkup(createElement(NextPass, { shift: s, timeZone: TZ, now }));
const page = (s: MyShift, now = NOW) => {
  const p: ShiftPage = { state: "booked", shift: s, facts };
  return renderToStaticMarkup(createElement(ShiftView, { page: p, timeZone: TZ, now }));
};
// The card's own HTML (from its opening tag to its close).
const cardOf = (html: string) => {
  const start = html.indexOf('<section data-online-only="" data-still-coming=""');
  return start === -1 ? "" : html.slice(start, html.indexOf("</section>", start) + 10);
};

describe("the window", () => {
  it("is confirmStillComing's: from 24 hours before the start until the start", () => {
    // The two modules agree (still-coming.ts reaches the database, so it's read as text).
    const lib = readFileSync("src/lib/portal/still-coming.ts", "utf8");
    expect(lib).toContain(`export const STILL_COMING_HOURS = ${STILL_COMING_WINDOW_HOURS};`);
    const starts = new Date(NOW.getTime() + 10 * HOUR);
    const at = (ms: number) => new Date(starts.getTime() - ms);
    expect(stillComingOpen(shift(starts), at(24 * HOUR + 1))).toBe(false);
    expect(stillComingOpen(shift(starts), at(24 * HOUR))).toBe(true);
    expect(stillComingOpen(shift(starts), at(1))).toBe(true);
    expect(stillComingOpen(shift(starts), starts)).toBe(false);
    expect(stillComingOpen(shift(starts, { status: "completed" }), at(HOUR))).toBe(false);
  });

  it("says when she answered in the firm's time: 'You said you're coming (Fri 13:02)'", () => {
    expect(saidComingText(new Date("2026-11-06T13:02:00Z"), TZ)).toBe(
      "You said you're coming (Fri 13:02)",
    );
    // British Summer Time: 12:02 UTC is 13:02 in London.
    expect(saidComingText(new Date("2026-06-12T12:02:00Z"), TZ)).toBe(
      "You said you're coming (Fri 13:02)",
    );
  });
});

describe("the pass", () => {
  it("in the day before: the card, online only, holding 'Can't make it?' (once)", () => {
    const html = pass(shift(new Date(NOW.getTime() + 10 * HOUR)));
    const card = cardOf(html);
    expect(card).not.toBe("");
    expect(card).toMatch(
      /^<section data-online-only="" data-still-coming="" aria-labelledby="still-coming-[^"]+"/,
    );
    // Under the pass's own heading: an h3.
    expect(card).toMatch(
      /<h3 id="still-coming-[^"]+" class="text-lg font-semibold text-ink">Still coming\?<\/h3>/,
    );
    expect(text(card).trim()).toBe("Still coming? Yes, I'm coming Can't make it?");
    // Clear glass: Directions stays the pass's main button. It waits for the page.
    expect(card).toMatch(
      new RegExp(
        `<button type="button" disabled="" class="${esc(staffBtn.secondary)}"><svg[\\s\\S]*?</svg>Yes, I&#x27;m coming</button>`,
      ),
    );
    expect(card).toContain(`class="${staffBtn.danger}">Can&#x27;t make it?</button>`);
    expect(html.match(/>Can&#x27;t make it\?</g)).toHaveLength(1);
  });

  it("further off, started, or already answered", () => {
    // Two days away: no card, "Can't make it?" on its own as before.
    const far = pass(shift(new Date(NOW.getTime() + 48 * HOUR)));
    expect(far).not.toContain("data-still-coming");
    expect(far).not.toContain('data-online-only="" data-still');
    expect(far.match(/>Can&#x27;t make it\?</g)).toHaveLength(1);
    // On now: nothing to answer or cancel.
    const onNow = pass(shift(new Date(NOW.getTime() - HOUR)));
    expect(onNow).not.toContain("data-still-coming");
    expect(onNow).not.toContain("Can&#x27;t make it?");
    // She said so at 08:41: the line in place of the button, still online only.
    const said = pass(
      shift(new Date(NOW.getTime() + 10 * HOUR), {
        stillComingAt: new Date("2026-11-06T08:41:00Z"),
      }),
    );
    const card = cardOf(said);
    expect(card.startsWith('<section data-online-only=""')).toBe(true);
    expect(text(card).trim()).toBe(
      "Still coming? You said you're coming (Fri 08:41) Can't make it?",
    );
    expect(card).not.toContain("Yes, I&#x27;m coming");
  });
});

describe("the shift's page", () => {
  it("in the day before: the card under the shift's card, online only, the page's main button", () => {
    const html = page(shift(new Date(NOW.getTime() + 3 * HOUR)));
    const card = cardOf(html);
    expect(card).toMatch(/^<section data-online-only="" data-still-coming=""/);
    expect(card).toMatch(
      /<h2 id="still-coming-[^"]+" class="text-lg font-semibold text-ink">Still coming\?<\/h2>/,
    );
    expect(card).toMatch(
      new RegExp(
        `<button type="button" disabled="" class="${esc(staffBtn.primary)}"><svg[\\s\\S]*?</svg>Yes, I&#x27;m coming</button>`,
      ),
    );
    expect(html.match(/>Can&#x27;t make it\?</g)).toHaveLength(1);
    // Right after the shift's card, before "Running late?" (from 3 hours before) and the calendar.
    expect(text(html).indexOf("Still coming?")).toBeLessThan(text(html).indexOf("Running late?"));
    expect(text(html).indexOf("Still coming?")).toBeLessThan(
      text(html).indexOf("Add to my calendar"),
    );
    // At the foot, "Ask for a change" alone (full width).
    expect(html).toMatch(
      new RegExp(
        `<a class="${esc(staffBtn.secondary)} mt-3" href="/requests/new\\?shift=[^"]+">Ask for a change</a>`,
      ),
    );
    expect(html).not.toContain('<div class="mt-3 grid grid-cols-2 gap-2.5">');
  });

  it("further off: no card, the foot as before", () => {
    const html = page(shift(new Date(NOW.getTime() + 30 * HOUR)));
    expect(html).not.toContain("data-still-coming");
    expect(html).toContain('<div class="mt-3 grid grid-cols-2 gap-2.5">');
    expect(html.match(/>Can&#x27;t make it\?</g)).toHaveLength(1);
  });

  it("the card on its own: online only, whatever its state", () => {
    for (const saidAt of [null, new Date("2026-11-06T08:00:00Z")]) {
      const html = renderToStaticMarkup(
        createElement(StillComingCard, {
          shiftId: "11111111-1111-4111-8111-111111111111",
          saidAt,
          timeZone: TZ,
          main: true,
          cancel: null,
        }),
      );
      expect(html).toMatch(/^<section data-online-only="" data-still-coming=""/);
    }
  });
});

describe("the words", () => {
  it("the reminder push ends 'Tap to say you're coming.', as the doc says", () => {
    expect(STILL_COMING_LINE).toBe("Tap to say you're coming.");
    const day = reminderPush({
      kind: "24h",
      site: "Demo Arena",
      day: "tomorrow",
      start: "08:00",
      end: "16:00",
    });
    expect(day).toEqual({
      title: "Tomorrow: Demo Arena",
      body: "08:00–16:00. Tap to say you're coming.",
    });
    const soon = reminderPush({ kind: "2h", site: null, day: "today", start: "08:00", end: "" });
    expect(soon.body).toBe("Starts at 08:00. Tap to say you're coming.");
    expect(doc).toContain(`"{start}–{end}. Tap to say you're coming." (24 h)`);
    expect(doc).toContain(`"Starts at {start}. Tap to say you're coming." (2 h)`);
  });

  it("the emails add the line; the WhatsApp and text template functions are byte-identical to before", () => {
    const voice = { name: "Acme Events", signOff: "Acme Events Shift Team" };
    const s = { site: "Demo Arena", day: "tomorrow", start: "08:00", end: "16:00", link: "L" };
    expect(shiftReminder24hMessage(voice, s)).toBe(
      "Reminder: tomorrow 08:00–16:00 at Demo Arena. Details: L. Can't make it? Cancel with the link as early as you can. — Acme Events Shift Team",
    );
    expect(shiftReminder2hMessage(voice, s)).toBe(
      "Your shift at Demo Arena starts at 08:00. Meeting point and instructions: L. — Acme Events Shift Team",
    );
    expect(shiftReminder24hEmail(voice, s)).toBe(
      "Reminder: tomorrow 08:00–16:00 at Demo Arena. Details: L. Tap to say you're coming. Can't make it? Cancel with the link as early as you can. — Acme Events Shift Team",
    );
    expect(shiftReminder2hEmail(voice, s)).toBe(
      "Your shift at Demo Arena starts at 08:00. Meeting point and instructions: L. Tap to say you're coming. — Acme Events Shift Team",
    );
    // The reminder job sends the template's words by WhatsApp and text, and the email's by email.
    const send = readFileSync("src/lib/reminders/send.ts", "utf8");
    expect(send).toContain("body: { whatsapp: body, sms: body }");
    expect(send).toContain("body: emailBody,");
  });

  it("the words are in screens.md first", () => {
    const own = screens.slice(screens.indexOf("### 28.14"), screens.indexOf("### 28.15"));
    for (const words of [
      '"Still coming?"',
      '"Yes, I\'m coming"',
      '"Thanks. The office can see you\'re coming."',
      '"You said you\'re coming (Fri 13:02)"',
      '"You can say this in the 24 hours before the shift."',
      '"That didn\'t work. Try again."',
      '"Coming 13:02"',
      '"Not answered yet"',
      "`data-online-only`",
    ]) {
      expect(own).toContain(words);
    }
  });
});

describe("Coming up's chips", () => {
  const session = {
    shiftId: "33333333-3333-4333-8333-333333333333",
    role: "steward",
    site: "Demo Arena",
    eventName: "Raceday",
    startsAt: new Date(NOW.getTime() + 10 * HOUR),
    endsAt: new Date(NOW.getTime() + 18 * HOUR),
    headcount: 3,
    booked: 3,
    placesToOffer: 0,
  };
  const person = (name: string, stillComing: StillComingMark) => ({
    workerId: `w-${name}`,
    name,
    licence: null,
    asked: null,
    firstShift: false,
    watch: false,
    stillComing,
  });

  it("'Coming 13:02' in green, 'Not answered yet' in grey, nothing where the loader says none", () => {
    const html = renderToStaticMarkup(
      createElement(ComingUpList, {
        sessions: [
          {
            ...session,
            people: [
              person("Ann Udo", { kind: "coming", at: new Date("2026-11-06T08:41:00Z") }),
              person("Ben Ode", { kind: "waiting" }),
              person("Cia Ray", null),
            ],
          },
        ],
        now: NOW,
        timeZone: TZ,
        onOffer: () => {},
      }),
    );
    expect(html).toContain(
      `<span data-still-coming="coming" class="${chip.base} ${chip.done}" title="Ann Udo said they&#x27;re coming, at 08:41 on Fri 6 Nov.">`,
    );
    expect(html).toContain('<span aria-hidden="true">Coming 08:41</span>');
    expect(html).toContain(
      `<span data-still-coming="waiting" class="${chip.base} ${chip.quiet}" title="Ben Ode hasn&#x27;t said yet if they&#x27;re coming.">`,
    );
    expect(html.match(/data-still-coming=/g)).toHaveLength(2);
  });

  it("their words", () => {
    expect(comingChip(new Date("2026-11-06T13:02:00Z"), NOW, TZ)).toBe("Coming 13:02");
    expect(comingChip(new Date("2026-11-05T21:40:00Z"), NOW, TZ)).toBe("Coming Thu 21:40");
    expect(comingWords("Zoe Adeyemi", new Date("2026-11-06T13:02:00Z"), TZ)).toBe(
      "Zoe Adeyemi said they're coming, at 13:02 on Fri 6 Nov.",
    );
    expect(NOT_ANSWERED).toBe("Not answered yet");
    expect(notAnsweredWords("Zoe Adeyemi")).toBe("Zoe Adeyemi hasn't said yet if they're coming.");
  });
});

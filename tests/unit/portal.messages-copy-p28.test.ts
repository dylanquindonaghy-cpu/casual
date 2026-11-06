import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sortedStep } from "@/lib/office/enquiries-copy";
import { MESSAGE_ABOUT, readMessageOffice } from "@/lib/portal/message-office";
import {
  aboutLine,
  COMPOSER_LABEL,
  MESSAGES_EMPTY,
  MESSAGES_INTRO,
  READY_SENTENCES,
  SENT_TO_OFFICE,
  SENT_WAITING,
} from "@/lib/portal/messages-copy";

// Message the office about a shift (Phase 28.6; docs/screens.md "### 28.6";
// docs/messaging-templates.md "Messages in the app"): the ready sentence for each topic comes from
// messages-copy and is screens.md's, word for word; the About line's words in the casual's app and
// on Enquiries; Messages' new words (two-sentence intro, "Your message") and look (the empty box,
// 12px bubbles); the composer with and without a shift. Plain words: no sentence over 25 words.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/messages",
}));

const { MessagesView } = await import("@/app/messages/messages-view");
const { Composer } = await import("@/app/messages/composer");
const { aboutSessionWords } = await import("@/app/office/enquiries/enquiry-detail");

const flat = (s: string) => s.replace(/\s+/g, " ");
const screensAll = flat(readFileSync("docs/screens.md", "utf8"));
const templates = flat(readFileSync("docs/messaging-templates.md", "utf8"));
// 28.6's own subsection of "The casual app, Phase 28".
const screens28 = (() => {
  const doc = readFileSync("docs/screens.md", "utf8");
  const start = doc.indexOf("### 28.6\n");
  const end = doc.indexOf("### 28.7\n", start);
  return flat(doc.slice(start, end));
})();
const TZ = "Europe/London";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const sentences = (s: string) => s.split(/(?<=[.?!])\s+/).filter((x) => x.trim() !== "");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("the ready sentences", () => {
  it("one for each topic of the link, from messages-copy, each in screens.md's 28.6 table", () => {
    expect(Object.keys(READY_SENTENCES).sort()).toEqual([...MESSAGE_ABOUT].sort());
    expect(READY_SENTENCES).toEqual({
      pay: "What's the pay for this shift?",
      late: "I'm running late. I'll be there about …",
      started: "This shift has started and I need to talk to someone.",
      other: "",
    });
    expect(screens28).toContain(`| "${READY_SENTENCES.pay}" |`);
    expect(screens28).toContain(`| "${READY_SENTENCES.late}" |`);
    expect(screens28).toContain(`| "${READY_SENTENCES.started}" |`);
    expect(screens28).toContain("| Nothing: an empty box, with the About line |");
    // The same words in the /messages section.
    for (const s of [READY_SENTENCES.pay, READY_SENTENCES.started]) {
      expect(screensAll.split(s).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it("each topic of 28.2's link maps to its sentence; a link that isn't one maps to nothing", () => {
    const shift = "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f8091a2";
    for (const about of MESSAGE_ABOUT) {
      const q = readMessageOffice({ shift, about });
      expect(q && READY_SENTENCES[q.about]).toBe(READY_SENTENCES[about]);
    }
    expect(readMessageOffice({ shift, about: "dispute" })).toBeNull();
    expect(readMessageOffice({ shift: "not-an-id", about: "pay" })).toBeNull();
    expect(readMessageOffice({ shift: [shift, shift], about: "pay" })).toBeNull();
  });
});

describe("the About line", () => {
  it('reads "About: Steward · Sat 7 Nov, 10:30" in the firm\'s time, winter and summer', () => {
    expect(aboutLine({ role: "steward", startsAt: new Date("2026-11-07T10:30:00Z") }, TZ)).toBe(
      "About: Steward · Sat 7 Nov, 10:30",
    );
    // British Summer Time: an hour on from UTC; an acronym stays in capitals.
    expect(
      aboutLine({ role: "csas_officer", startsAt: new Date("2027-07-03T08:00:00Z") }, TZ),
    ).toBe("About: CSAS officer · Sat 3 Jul, 09:00");
    expect(screens28).toContain('"About: Steward · Sat 7 Nov, 10:30"');
  });

  it('on Enquiries: "About: Steward, Sat 7 Nov 10:30", and why it went to a person', () => {
    expect(
      aboutSessionWords({ role: "steward", startsAt: new Date("2026-11-07T10:30:00Z") }, TZ),
    ).toBe("Steward, Sat 7 Nov 10:30");
    expect(screens28).toContain('"About: Steward, Sat 7 Nov 10:30"');
    const why = sortedStep({ how: "about_shift" });
    expect(why).toBe("About a session: passed to a person, never sorted.");
    expect(screens28).toContain(`"Sorted: ${why}"`);
    expect(screensAll).toContain(`"Sorted: ${why}"`);
  });
});

describe("Messages' own words", () => {
  it("the intro is two short sentences that still send a pay dispute to payroll", () => {
    expect(sentences(MESSAGES_INTRO)).toHaveLength(2);
    for (const s of sentences(MESSAGES_INTRO)) expect(words(s)).toBeLessThanOrEqual(25);
    expect(MESSAGES_INTRO).toContain("raise a pay query on the Pay page: it goes to payroll");
    expect(screens28).toContain(MESSAGES_INTRO);
    expect(screensAll).toContain(`then (Phase 28.6: two sentences) "${MESSAGES_INTRO}"`);
  });

  it('the box is "Your message"; sent about a shift, "Sent. The office will answer here."', () => {
    expect(COMPOSER_LABEL).toBe("Your message");
    expect(SENT_TO_OFFICE).toBe("Sent. The office will answer here.");
    expect(SENT_WAITING).toBe("Sent. The answer comes here.");
    expect(screens28).toContain('"Your message"');
    expect(screens28).toContain(`"${SENT_TO_OFFICE}"`);
    expect(templates).toContain(`"${SENT_TO_OFFICE}"`);
    for (const s of [...sentences(SENT_TO_OFFICE), ...Object.values(READY_SENTENCES)])
      expect(words(s)).toBeLessThanOrEqual(25);
  });
});

const about = {
  shiftId: "3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f8091a2",
  line: "About: Steward · Sat 7 Nov, 10:30",
  sentence: READY_SENTENCES.late,
};

describe("the composer", () => {
  it("about a shift: the About line above the box, heard with it, and the ready sentence in it", () => {
    const html = renderToStaticMarkup(createElement(Composer, { answered: true, about }));
    const line = html.indexOf(about.line);
    const label = html.indexOf(`<span>${COMPOSER_LABEL}</span>`);
    expect(line).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(line);
    const id =
      /<p id="([^"]+)" class="[^"]*glass-button[^"]*rounded-full[^"]*" data-about-shift/.exec(
        html,
      )?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<textarea[^>]*aria-describedby="${id}"`));
    expect(text(html)).toContain(READY_SENTENCES.late);
  });

  it("not about a shift: no About line and an empty box, as before", () => {
    const html = renderToStaticMarkup(createElement(Composer, { answered: true }));
    expect(html).not.toContain("data-about-shift");
    expect(html).not.toContain("aria-describedby");
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
    expect(html).toContain(`<span>${COMPOSER_LABEL}</span>`);
    // "other": the About line, an empty box.
    const other = renderToStaticMarkup(
      createElement(Composer, { answered: true, about: { ...about, sentence: "" } }),
    );
    expect(other).toContain("data-about-shift");
    expect(other).toMatch(/<textarea[^>]*><\/textarea>/);
  });
});

describe("Messages' look", () => {
  const view = (items: Parameters<typeof MessagesView>[0]["thread"]["items"]) =>
    renderToStaticMarkup(
      createElement(MessagesView, {
        thread: { items, more: false, latestMineAt: null, answered: true },
        now: new Date("2026-11-02T09:14:00Z"),
        timeZone: TZ,
        linkOrigin: "https://acme.shiftdesk.test",
        composer: createElement(Composer, { answered: true }),
      }),
    );

  it('"No messages yet." sits in the empty box', () => {
    expect(view([])).toMatch(
      new RegExp(`<p class="[^"]*rounded-row glass-tile[^"]*">${MESSAGES_EMPTY}</p>`),
    );
  });

  it("the bubbles are 12px round (rounded-inner), never a corner of their own", () => {
    const at = new Date("2026-11-02T09:00:00Z");
    const html = view([
      { id: "a", mine: true, text: "Hello", at, from: null },
      { id: "b", mine: false, text: "Hi. — Acme Events Shift Team", at, from: "office" },
    ]);
    const bubbles = [...html.matchAll(/<div class="max-w-\[85%\] ([^"]+)"/g)].map((m) => m[1]);
    expect(bubbles).toHaveLength(2);
    for (const b of bubbles) expect(b).toContain("rounded-inner");
    expect(html).not.toMatch(/rounded-\[/);
  });
});

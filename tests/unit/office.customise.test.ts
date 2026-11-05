import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CARD_WORDS,
  DASHBOARD_CARDS,
  DEFAULT_CARDS,
  readCards,
} from "@/lib/office/dashboard-cards";
import {
  cancellationsSummary,
  dayLabel,
  dayMonthLabel,
  fillLine,
  fillPercent,
  nextTwoWeeksSummary,
  noShowsSummary,
  weekLabel,
} from "@/lib/office/dashboard-cards-copy";
import { lastWeeks } from "@/lib/office/dashboard-cards-data";
import {
  contractLine,
  contractResultText,
  customiseResultText,
  dateChoiceLabel,
  dayChoice,
} from "@/lib/office/customise-copy";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/customise-actions", () => ({ saveDashboardAction: vi.fn() }));
const { CustomiseForm } = await import("@/app/office/customise-panel");
const { ExtraCards } = await import("@/app/office/dashboard/extra-cards");

// Phase 26.3: each office user's own dashboard (the spec page's "Customise and contracts", cus-1 to
// cus-5, and dash-7's date choice; the pre-build audit's aud-9, aud-10 and aud-13).

const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("the cards a person sees", () => {
  it("the default four; saved ones read back in the dashboard's order, unknown ones dropped", () => {
    // Phase 27.9: Coming up in Who worked?'s place; Who worked? still a card, off until ticked.
    expect(DEFAULT_CARDS).toEqual(["map", "toOffer", "updates", "comingUp"]);
    expect(DEFAULT_CARDS).not.toContain("whoWorked");
    expect(DASHBOARD_CARDS).toContain("whoWorked");
    expect(readCards(undefined)).toEqual(DEFAULT_CARDS);
    expect(readCards(null)).toEqual(DEFAULT_CARDS);
    expect(readCards("map")).toEqual(DEFAULT_CARDS);
    // Chosen: in the dashboard's order, each once, nothing unknown; none chosen is none.
    expect(readCards(["noShows", "map", "watchList", "map", "fillRate", "nope"])).toEqual([
      "map",
      "fillRate",
      "noShows",
      "watchList",
    ]);
    expect(readCards([])).toEqual([]);
    // A choice saved before Phase 27.9 is kept as it was: Who worked? stays on, and Coming up isn't
    // added to it.
    expect(readCards(["map", "toOffer", "updates", "whoWorked"])).toEqual([
      "map",
      "toOffer",
      "updates",
      "whoWorked",
    ]);
    // Both chosen: Coming up before Who worked?, as the dashboard shows them.
    expect(readCards(["whoWorked", "comingUp"])).toEqual(["comingUp", "whoWorked"]);
  });

  it("every card has its name and line in What you see", () => {
    expect(DASHBOARD_CARDS.map((k) => CARD_WORDS[k].name)).toEqual([
      "Venue map",
      "To offer",
      "Updates",
      "Coming up",
      "Who worked?",
      "Next 2 weeks",
      "Cancellations",
      "Fill rate",
      "No-shows",
      "Watch list",
    ]);
    expect(CARD_WORDS.cancellations.line).toBe("By week, under 48 hours in red");
    // Phase 27.9: what Updates holds now, and Coming up's line.
    expect(CARD_WORDS.updates.line).toBe("Cancellations, places taken and offers with no reply");
    expect(CARD_WORDS.comingUp).toEqual({
      name: "Coming up",
      line: "Who's working on your contracts today and tomorrow",
    });
    expect(CARD_WORDS.whoWorked.line).toBe("To confirm after a session");
  });
});

describe("the words", () => {
  it("a contract's line, the date choice, and what saving says", () => {
    expect(contractLine({ sites: 1, sessions: 27 })).toBe("1 venue · 27 sessions to come");
    expect(contractLine({ sites: 2, sessions: 1 })).toBe("2 venues · 1 session to come");
    expect(dayMonthLabel("2026-11-03")).toBe("Tue 3 Nov");
    expect(dateChoiceLabel(null)).toBe("Pick a day");
    expect(dateChoiceLabel("2026-11-03")).toBe("Date: Tue 3 Nov");
    expect(dayChoice({ date: "2026-11-07", places: 4 })).toBe("Sat 7 Nov · 4 places");
    expect(dayChoice({ date: "2026-11-07", places: 1 })).toBe("Sat 7 Nov · 1 place");
    expect(customiseResultText({ status: "idle" })).toBeNull();
    expect(customiseResultText({ status: "saved" })).toBe(
      "Saved. Your dashboard shows what you chose.",
    );
    expect(contractResultText({ status: "saved" }, "Northgate Council")).toBe(
      "Saved Northgate Council.",
    );
    expect(contractResultText({ status: "removed" }, "Northgate Council")).toBe(
      "Removed Northgate Council.",
    );
    expect(contractResultText({ status: "name_taken" })).toBe(
      "There's a contract with that name already.",
    );
  });

  it("the extra cards' sentences, labels and fill rate", () => {
    expect(dayLabel("2026-11-03")).toBe("Tue 3");
    expect(weekLabel("2026-10-26")).toBe("26 Oct");
    expect(
      nextTwoWeeksSummary([
        { date: "2026-11-02", booked: 3, offered: 1, open: 2 },
        { date: "2026-11-03", booked: 4, offered: 0, open: 1 },
      ]),
    ).toBe("Next 2 weeks: 7 booked, 1 offered with no reply yet, 3 open.");
    expect(
      cancellationsSummary([
        { week: "2026-10-19", short: 1, longer: 2 },
        { week: "2026-10-26", short: 2, longer: 0 },
      ]),
    ).toBe("5 cancellations in the last 8 weeks, 3 under 48 hours' notice.");
    expect(noShowsSummary([{ week: "2026-10-26", noShows: 1 }])).toBe(
      "1 no-show in the last 8 weeks.",
    );
    const fill = { clientId: "c", name: "Northgate Council", needed: 8, booked: 6 };
    expect(fillPercent(fill)).toBe(75);
    expect(fillPercent({ needed: 0, booked: 0 })).toBe(0);
    expect(fillLine(fill)).toBe("Northgate Council: 6 of 8 booked, 75%");
    expect(fillLine({ ...fill, clientId: null, name: null })).toBe(
      "No contract: 6 of 8 booked, 75%",
    );
  });

  it("the last 8 weeks: Monday to Sunday in the firm's time, this week last", () => {
    // Sunday 1 Nov 2026, 23:30 in London (GMT): still that week, whose Monday is 26 Oct.
    const weeks = lastWeeks(new Date("2026-11-01T23:30:00Z"), "Europe/London");
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)).toBe("2026-10-26");
    expect(weeks[0]).toBe("2026-09-07");
    // Monday 2 Nov: a new week.
    expect(lastWeeks(new Date("2026-11-02T00:30:00Z"), "Europe/London").at(-1)).toBe("2026-11-02");
  });
});

describe("Customise's form", () => {
  const me = {
    cards: ["map", "toOffer", "fillRate"] as const,
    clientIds: ["c2"],
    sites: ["s2"],
    choices: [
      { clientId: "c1", name: "Acme Demo Arena", sites: 1, sessions: 27 },
      { clientId: "c2", name: "Northgate Council", sites: 2, sessions: 3 },
    ],
  };

  it("each contract a switch (theirs on), each card a tick (theirs ticked), and Save my dashboard", () => {
    const html = renderToStaticMarkup(
      createElement(CustomiseForm, { me: { ...me, cards: [...me.cards] } }),
    );
    expect(words(html)).toContain(
      "Your contracts You see these on the dashboard and in Updates. Events & sessions always shows every contract.",
    );
    expect(words(html)).toContain("Acme Demo Arena 1 venue · 27 sessions to come");
    // Each input's own attributes, whatever their order.
    const inputs = (name: string) =>
      [...html.matchAll(/<input ([^>]*)\/?>/g)]
        .map((m) => m[1] ?? "")
        .filter((a) => a.includes(`name="${name}"`))
        .map((a) => [/value="([^"]+)"/.exec(a)?.[1], / checked=""/.test(` ${a}`)]);
    expect(html).toMatch(/<input type="checkbox" role="switch"[^>]*name="contract"/);
    expect(inputs("contract")).toEqual([
      ["c1", false],
      ["c2", true],
    ]);
    expect(inputs("card")).toEqual([
      ["map", true],
      ["toOffer", true],
      ["updates", false],
      ["comingUp", false],
      ["whoWorked", false],
      ["nextTwoWeeks", false],
      ["cancellations", false],
      ["fillRate", true],
      ["noShows", false],
      ["watchList", false],
    ]);
    expect(html).toMatch(/<button type="submit"[^>]*>Save my dashboard<\/button>/);
  });

  it("with no contracts yet, says where they're added", () => {
    const html = renderToStaticMarkup(
      createElement(CustomiseForm, {
        me: { ...me, cards: [...me.cards], clientIds: [], choices: [] },
      }),
    );
    expect(words(html)).toContain(
      "No contracts yet. An admin adds them on Settings, under Contracts.",
    );
    expect(html).not.toContain('name="contract"');
  });
});

describe("the extra cards", () => {
  const ok = <T>(data: T) => ({ ok: true as const, data });
  const none = {
    nextTwoWeeks: null,
    cancelWeeks: null,
    noShowWeeks: null,
    fillRates: null,
    watchList: null,
  };

  it("only the chosen ones; each with where its figures come from, its sentence and a table", () => {
    expect(renderToStaticMarkup(createElement(ExtraCards, { board: none }))).toBe("");
    const html = renderToStaticMarkup(
      createElement(ExtraCards, {
        board: {
          ...none,
          cancelWeeks: ok([
            { week: "2026-10-19", short: 1, longer: 2 },
            { week: "2026-10-26", short: 0, longer: 1 },
          ]),
          fillRates: ok([{ clientId: "c1", name: "Acme Demo Arena", needed: 4, booked: 3 }]),
          watchList: null,
        },
      }),
    );
    expect(html).not.toContain('id="next-two-weeks"');
    const cancels = /<section id="cancellations-by-week"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(words(cancels)).toBe(
      [
        "Cancellations From the cancellation records, by the week they were made",
        "4 cancellations in the last 8 weeks, 1 under 48 hours' notice.",
        "Under 48 hours' notice 48 hours or more 19 Oct 26 Oct",
        "Show as a table Cancellations Week of Under 48 hours 48 hours or more",
        "19 Oct 1 2 26 Oct 0 1",
      ].join(" "),
    );
    // The bars are decorative: the sentence says it in words, the table holds the figures.
    expect(cancels).toMatch(/<div aria-hidden="true" class="mt-3">/);
    const fill = /<section id="fill-rate"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(words(fill)).toContain("Acme Demo Arena: 3 of 4 booked, 75%");
    expect(words(fill)).toContain("Contract Booked Needed Filled Acme Demo Arena 3 4 75%");
  });

  it("empty: what will show there (aud-10); a part that couldn't load says so", () => {
    const html = renderToStaticMarkup(
      createElement(ExtraCards, {
        board: {
          nextTwoWeeks: ok(
            Array.from({ length: 14 }, (_, i) => ({
              date: `2026-11-${String(i + 2).padStart(2, "0")}`,
              booked: 0,
              offered: 0,
              open: 0,
            })),
          ),
          cancelWeeks: ok([{ week: "2026-10-26", short: 0, longer: 0 }]),
          noShowWeeks: { ok: false },
          fillRates: ok([]),
          watchList: ok([]),
        },
      }),
    );
    expect(words(html)).toContain(
      "No sessions in the next 2 weeks. Sessions from your planner show here as they come in.",
    );
    expect(words(html)).toContain(
      "No cancellations in the last 8 weeks. Each one shows here, by week.",
    );
    expect(words(html)).toContain(
      "No sessions in the next 14 days. Each contract's places show here.",
    );
    expect(words(html)).toContain("This couldn't load. Reload the page to try again.");
    expect(html).not.toContain("Show as a table");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { atOfferLimit, offerLimit, OFFER_LIMIT_PER_PLACE } from "@/lib/offers/offer-limit";
import { showingFirst } from "@/lib/office/dashboard-copy";
import { replyStep, sortedStep } from "@/lib/office/enquiries-copy";
import { eventWords, type Names } from "@/lib/office/event-words";

// The office for a big firm (Phase 25.3; docs/screens.md "The office for a big firm"): why a
// message got no automatic reply, the hour's one email past its 5 alerts, the stop after 25 offers
// for each free place, and a long list's real count. Each line as the doc gives it.

const screens = readFileSync("docs/screens.md", "utf8").replace(/\s+/g, " ");
const section = screens.slice(
  screens.indexOf("**The office for a big firm"),
  screens.indexOf("| Route | Screen |", screens.indexOf("**The office for a big firm")),
);
// The doc's line with its {placeholders} filled as the test fills them.
const inDoc = (line: string) => expect(section.replace(/[{}]/g, "")).toContain(line);

const names: Names = {
  worker: (id) => (id === "w1" ? "Priya Shah" : "a casual"),
  office: () => "Admin",
};
const words = (action: string, data: Record<string, unknown>) =>
  eventWords({ action, actorType: "system", actorId: null, data }, names);
// A casual's own message (they're its actor).
const theirs = (data: Record<string, unknown>) =>
  eventWords({ action: "message.received", actorType: "worker", actorId: "w1", data }, names);

describe("why a message got no automatic reply", () => {
  it("the enquiry's Sorted and Reply built steps", () => {
    const keyword = sortedStep({ how: "held", by: "keyword", intent: "pay" });
    expect(keyword).toBe(
      'A keyword matched: "pay". Automatic replies are off, so it was passed to a person.',
    );
    const ai = sortedStep({ how: "held", by: "ai", intent: "shifts" });
    expect(ai).toBe(
      'AI sorted it as "shifts". Automatic replies are off, so it was passed to a person.',
    );
    const reply = replyStep({ how: "held" });
    expect(reply).toBe(
      "No automatic reply: automatic replies are off for your firm. Ask us to turn them on.",
    );
    // The doc's own.
    for (const line of [keyword, ai, reply]) inDoc(line);
    // Not held: as before.
    expect(replyStep({ how: "none" })).toBe("No automatic reply.");
  });

  it("the log: what a held message was sorted as, and that it waits", () => {
    const held = theirs({
      channel: "whatsapp",
      handledAs: "keyword",
      intent: "office",
      sortedAs: "pay",
      replyHeld: true,
      workerId: "w1",
    });
    expect(held).toBe(
      "Priya Shah sent a WhatsApp to the shifts line (pay). No automatic reply (they're off): it's waiting for a person.",
    );
    inDoc(held);
    // By AI, and a text.
    expect(
      theirs({
        channel: "sms",
        handledAs: "ai",
        intent: "office",
        sortedAs: "cancel",
        replyHeld: true,
        workerId: "w1",
      }),
    ).toBe(
      "Priya Shah sent a text to the shifts line (cancelling, sorted by AI). No automatic reply (they're off): it's waiting for a person.",
    );
    // Replies on: as before (what it asked, nothing more).
    expect(
      theirs({
        channel: "whatsapp",
        handledAs: "keyword",
        intent: "pay",
        workerId: "w1",
      }),
    ).toBe("Priya Shah sent a WhatsApp to the shifts line (pay).");
  });

  it("the log: a number we don't know past the hour's 5 emails", () => {
    const held = words("message.received", {
      channel: "whatsapp",
      handledAs: "unknown",
      repeat: false,
      formerWorker: false,
      alertHeld: true,
      alertHour: "2026-11-02T09:00:00.000Z",
    });
    expect(held).toBe(
      "A WhatsApp came to the shifts line from a number that isn't one of your staff. No email about it yet: 5 already went this hour, so it'll be in one email for the rest.",
    );
    inDoc(held);
    expect(
      words("message.received", {
        channel: "whatsapp",
        handledAs: "unknown",
        formerWorker: true,
        alertHeld: true,
      }),
    ).toBe(
      "A WhatsApp came to the shifts line from someone who isn't active any more. No email about it yet: 5 already went this hour, so it'll be in one email for the rest.",
    );
    // Its email went: nothing more said.
    expect(
      words("message.received", { channel: "whatsapp", handledAs: "unknown", formerWorker: false }),
    ).toBe("A WhatsApp came to the shifts line from a number that isn't one of your staff.");
  });

  it("the log: the hour's one email, how many, to how many, its hour in the firm's time", () => {
    const hour = { hourStart: "2026-11-02T18:00:00.000Z", from: "18:00", to: "19:00" };
    const two = words("message.office_alerts_combined", {
      ...hour,
      messages: 2,
      recipients: 2,
      failed: 0,
      skipped: 0,
    });
    expect(two).toBe(
      "The office was emailed once about 2 more messages from numbers we don't know, 18:00 to 19:00 (2 people).",
    );
    inDoc(two);
    expect(
      words("message.office_alerts_combined", { ...hour, messages: 1, recipients: 1, failed: 0 }),
    ).toBe(
      "The office was emailed once about 1 more message from numbers we don't know, 18:00 to 19:00 (1 person).",
    );
    const someFailed = words("message.office_alerts_combined", {
      ...hour,
      messages: 2,
      recipients: 2,
      failed: 1,
    });
    expect(someFailed).toBe(
      "The office was emailed once about 2 more messages from numbers we don't know, 18:00 to 19:00 (2 people; 1 couldn't be emailed).",
    );
    inDoc("(2 people; 1 couldn't be emailed)");
    const nobody = words("message.office_alerts_combined", {
      ...hour,
      messages: 2,
      recipients: 0,
      failed: 0,
    });
    expect(nobody).toBe(
      "Nobody in the office could be emailed about 2 more messages from numbers we don't know, 18:00 to 19:00 (no active admin or resourcer with an email address). They're on Enquiries.",
    );
    inDoc(nobody);
    // Its hour only as two clock times: anything else is left out, never shown.
    expect(
      words("message.office_alerts_combined", {
        messages: 2,
        recipients: 2,
        failed: 0,
        from: "<b>",
        to: "19:00",
      }),
    ).toBe(
      "The office was emailed once about 2 more messages from numbers we don't know (2 people).",
    );
  });
});

describe("the stop after 25 offers for each free place", () => {
  it("the rule: 25 a place, the office's offers counted, nothing for a filled session", () => {
    expect(OFFER_LIMIT_PER_PLACE).toBe(25);
    expect([offerLimit(0), offerLimit(1), offerLimit(2), offerLimit(-1)]).toEqual([0, 25, 50, 0]);
    expect(atOfferLimit(24, 1)).toBe(false);
    expect(atOfferLimit(25, 1)).toBe(true);
    expect(atOfferLimit(26, 1)).toBe(true);
    expect(atOfferLimit(49, 2)).toBe(false);
    expect(atOfferLimit(50, 2)).toBe(true);
    // No place free: filled, not "at the limit".
    expect(atOfferLimit(25, 0)).toBe(false);
  });

  it("the log's words, as the doc gives them", () => {
    const one = words("offer.waves_stopped", {
      reason: "offer_limit",
      wave: 4,
      offered: 25,
      places: 1,
    });
    expect(one).toBe("Offers stopped: 25 casuals were offered it, the most for 1 place.");
    inDoc(one);
    expect(
      words("offer.waves_stopped", { reason: "offer_limit", wave: 7, offered: 50, places: 2 }),
    ).toBe("Offers stopped: 50 casuals were offered it, the most for 2 places.");
    // The other stops read as before.
    expect(words("offer.waves_stopped", { reason: "hidden", wave: 2 })).toBe(
      "Offers stopped: it's hidden from casuals.",
    );
    expect(words("offer.waves_stopped", { reason: "no_candidates", wave: 2 })).toBe(
      "Offers stopped.",
    );
  });
});

describe("a long list's real count", () => {
  it("under the list: how many are shown of how many", () => {
    expect(showingFirst(50, 400)).toBe("Showing the first 50 of 400.");
    inDoc(showingFirst(50, 400));
  });
});

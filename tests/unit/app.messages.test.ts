import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { APP_MESSAGE_MAX, appMessageText, charCount } from "@/lib/inbound/app-limits";
import {
  planLine,
  receivedStep,
  replyResultText,
  sentStep,
  sortedStep,
  thenStep,
} from "@/lib/office/enquiries-copy";
import { replyPlan } from "@/lib/office/enquiry-rules";
import { APP_ECHO_LOG, APP_LIMIT_LOG, eventWords } from "@/lib/office/event-words";
import { officeReplyMessage, officeReplyPush } from "@/lib/messaging/templates";
import {
  COMPOSER_LABEL,
  FROM_WORDS,
  MESSAGES_EMPTY,
  MESSAGES_INTRO,
  SENT_WAITING,
  messagesCountWords,
  sendProblemText,
} from "@/lib/portal/messages-copy";

// Messages in the app (P8; Phase 25.6): the casual's page (every state's words, the answers' links,
// the times), the office's words for a message in the app on Enquiries and in the action log, and
// each sentence as docs/screens.md and docs/messaging-templates.md say it.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/messages",
}));

const { MessagesView, messageTime } = await import("@/app/messages/messages-view");
const { Composer } = await import("@/app/messages/composer");

const flat = (s: string) => s.replace(/\s+/g, " ");
const screens = flat(readFileSync("docs/screens.md", "utf8"));
const templates = flat(readFileSync("docs/messaging-templates.md", "utf8"));
const TZ = "Europe/London";
const NOW = new Date("2026-11-02T09:14:00Z");
const ORIGIN = "https://acme.shiftdesk.test";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const view = (items: Parameters<typeof MessagesView>[0]["thread"]["items"]) =>
  renderToStaticMarkup(
    createElement(MessagesView, {
      thread: { items, more: false, latestMineAt: null, answered: true },
      now: NOW,
      timeZone: TZ,
      linkOrigin: ORIGIN,
      composer: createElement(Composer, { answered: true }),
    }),
  );

describe("the casual's Messages", () => {
  it("says what it's for, and when there's nothing yet, what to ask", () => {
    const html = view([]);
    expect(html).toMatch(/<h1[^>]*>Messages<\/h1>/);
    expect(text(html)).toContain(MESSAGES_INTRO);
    expect(text(html)).toContain(MESSAGES_EMPTY);
    expect(html).toContain(`<span>${COMPOSER_LABEL}</span>`);
    expect(html).toMatch(/<button type="submit"[^>]*>Send<\/button>/);
    for (const words of [MESSAGES_INTRO, MESSAGES_EMPTY, COMPOSER_LABEL, SENT_WAITING]) {
      expect(screens).toContain(words);
    }
  });

  it("hers on the right in the firm's colour; answers on the left, who from and when; only links to the firm's own address are links", () => {
    const html = view([
      { id: "a", mine: true, text: `See ${ORIGIN}/pay please`, at: NOW, from: null },
      {
        id: "b",
        mine: false,
        text: `Your pay: ${ORIGIN}/pay. Not https://elsewhere.example.com/pay.`,
        at: NOW,
        from: "automatic",
      },
      {
        id: "c",
        mine: false,
        text: "Friday. — Acme Events Shift Team",
        at: new Date("2026-10-30T15:00:00Z"),
        from: "office",
      },
    ]);
    const items = [
      ...html.matchAll(/<li class="flex (justify-\w+)" data-mine="(\w+)">([\s\S]*?)<\/li>/g),
    ];
    expect(items.map((m) => [m[1], m[2]])).toEqual([
      ["justify-end", "true"],
      ["justify-start", "false"],
      ["justify-start", "false"],
    ]);
    expect(items[0]?.[3]).toContain("glass-tint");
    expect(items[1]?.[3]).toContain("glass-button");
    // Her own words: never a link, even to the firm's address.
    expect(items[0]?.[3]).not.toContain("<a ");
    // An answer: the firm's own address is a link (the full stop after it isn't part of it);
    // anyone else's stays text.
    expect(items[1]?.[3]).toContain(`<a href="${ORIGIN}/pay"`);
    expect(items[1]?.[3]).not.toContain('href="https://elsewhere');
    // A long link goes whole to the next line, breaking only if it must (never "htt / p://").
    expect(items[1]?.[3]).toMatch(/<a href="[^"]+" class="[^"]*\[overflow-wrap:anywhere\][^"]*"/);
    expect(items[1]?.[3]).not.toContain("break-all");
    expect(text(items[1]?.[3] ?? "")).toContain("Automatic reply · 09:14");
    expect(text(items[2]?.[3] ?? "")).toContain("From the office · 15:00 on Fri 30 Oct");
    // Screen readers hear who wrote each.
    expect(text(items[0]?.[3] ?? "")).toMatch(/^You wrote:/);
    expect(text(items[2]?.[3] ?? "")).toMatch(/^From the office:/);
    expect(screens).toContain(`"${FROM_WORDS.automatic}" or "${FROM_WORDS.office}"`);
  });

  it("times: today's alone, an earlier day's with its day", () => {
    expect(messageTime(NOW, NOW, TZ)).toBe("09:14");
    expect(messageTime(new Date("2026-11-01T23:30:00Z"), NOW, TZ)).toBe("23:30 on Sun 1 Nov");
  });

  it("every answer to Send, and the tab's count, as the screens doc says", () => {
    const said = [
      sendProblemText("empty"),
      sendProblemText("too_long"),
      sendProblemText("rate_limited"),
      sendProblemText("error", true),
    ];
    expect(said).toEqual([
      "Write a message first.",
      "That's too long (1,600 characters at most).",
      "You've sent a lot of messages. Wait a few minutes, then try again.",
      "Something went wrong. Try again.",
    ]);
    expect(sendProblemText("error", false)).toBe("No signal. Try again when you have signal.");
    for (const words of said) expect(screens).toContain(words);
    expect(messagesCountWords(1)).toBe("1 new reply");
    expect(messagesCountWords(2)).toBe("2 new replies");
    expect(screens).toContain('"Messages, 1 new reply" / "Messages, 2 new replies"');
  });

  it("what a message may hold: tidied, at most 1,600 characters as people count them", () => {
    expect(APP_MESSAGE_MAX).toBe(1600);
    expect(appMessageText("  a\r\nb\rc\u0000  ")).toBe("a\nb\nc");
    expect(charCount("👋👋")).toBe(2);
    expect("👋👋".length).toBe(4);
  });
});

describe("Help", () => {
  it("points to Messages for anything else, as the screens doc says", async () => {
    const { HelpView } = await import("@/app/help/help-view");
    const words = text(
      renderToStaticMarkup(
        createElement(HelpView, {
          firmName: "Acme Events",
          facts: {
            noticeHours: 48,
            liveDays: 90,
            photoRenewalMonths: 36,
            strikesOn: true,
            travelOn: true,
            loginWay: "message",
          },
          year: 2026,
        }),
      ),
    );
    const line = "For anything else, write to the office under Messages.";
    expect(words).toContain(line);
    expect(words).not.toContain("the way you usually do");
    expect(screens).toContain(`"${line}"`);
  });
});

describe("the office's words for a message in the app", () => {
  const at = () => "09:14 on Mon 2 Nov";
  const kieran = { kind: "casual", name: "Kieran Doyle", active: true } as const;

  it("on Enquiries: received, sorted when no automatic answer went, shown, the reply line and its answer", () => {
    expect(receivedStep({ channel: "app", at: NOW, who: kieran }, at)).toBe(
      "In the app at 09:14 on Mon 2 Nov, from Kieran Doyle.",
    );
    expect(receivedStep({ channel: "app", at: NOW, who: { ...kieran, active: false } }, at)).toBe(
      "In the app at 09:14 on Mon 2 Nov, from Kieran Doyle (not active).",
    );
    expect(sortedStep({ how: "person", why: "reply_limit" })).toBe(
      "5 automatic replies already went to them this hour: passed to a person.",
    );
    expect(sortedStep({ how: "person", why: "echo" })).toBe(
      "It quoted our automatic reply: passed to a person.",
    );
    expect(sentStep({ how: "sent", channel: "app", at: NOW, fellBackFrom: null }, at)).toBe(
      "Shown in the app at 09:14 on Mon 2 Nov.",
    );
    const plan = replyPlan({
      channel: "app",
      from: null,
      line: null,
      casual: null,
      strangerTextsOff: false,
      lastWhatsAppAt: null,
      now: NOW,
    });
    expect(plan).toEqual({ ok: true, channel: "app", form: "free_text" });
    expect(planLine(plan)).toBe(
      "In the app: your words go as they are, and they get a notification.",
    );
    expect(replyResultText({ status: "queued", channel: "app", form: "free_text" })).toBe(
      "Your reply is on its way: it shows in their app in a moment.",
    );
    expect(
      thenStep(
        {
          kind: "office_reply",
          by: "Sam Rota",
          at: NOW,
          channel: "app",
          form: "free_text",
          state: "sent",
          code: null,
          fellBackFrom: null,
        },
        at,
        { firstName: "Kieran", shiftWords: () => "" },
      ),
    ).toBe("Sam Rota replied at 09:14 on Mon 2 Nov (in the app, in their own words): sent.");
    for (const words of [
      '"Received: In the app at {time}, from {Kieran Doyle}."',
      '"Sent: Shown in the app at {time}."',
      '"5 automatic replies already went to them this hour: passed to a person."',
      '"It quoted our automatic reply: passed to a person."',
      '"In the app: your words go as they are, and they get a notification."',
      '"Your reply is on its way: it shows in their app in a moment."',
      '"{Sam Rota} replied at {time} (in the app, in their own words): sent."',
    ]) {
      expect(screens).toContain(words);
    }
  });

  it("in the action log", () => {
    const names = { worker: () => "Kieran Doyle", office: () => "Sam Rota" };
    const say = (action: string, data: Record<string, unknown>, actorType = "worker") =>
      eventWords({ action, actorType, actorId: "a", data }, names);
    const received = { channel: "app", workerId: "w" };
    expect(say("message.received", { ...received, handledAs: "keyword", intent: "shifts" })).toBe(
      "Kieran Doyle sent a message in the app (open shifts).",
    );
    expect(say("message.received", { ...received, handledAs: "ai", intent: "pay" })).toBe(
      "Kieran Doyle sent a message in the app (pay, sorted by AI).",
    );
    expect(
      say("message.received", {
        ...received,
        handledAs: "keyword",
        intent: "office",
        replyLimit: true,
        sortedAs: "pay",
      }),
    ).toBe(`Kieran Doyle sent a message in the app (pay). ${APP_LIMIT_LOG}`);
    expect(
      say("message.received", { ...received, handledAs: "office", intent: "office", echo: true }),
    ).toBe(`Kieran Doyle sent a message in the app (for the office). ${APP_ECHO_LOG}`);
    expect(
      say("message.received", {
        ...received,
        handledAs: "office",
        intent: "office",
        formerWorker: true,
      }),
    ).toBe(
      "Kieran Doyle sent a message in the app but isn't active any more: it's waiting for a person.",
    );
    expect(
      say("message.received", {
        ...received,
        handledAs: "office",
        intent: "office",
        answerFailed: "57P01",
      }),
    ).toBe(
      "A message in the app from Kieran Doyle couldn't be answered automatically (57P01), so it's waiting for a person.",
    );
    expect(say("message.replied", { ...received, intent: "pay" }, "system")).toBe(
      "The automatic answer showed in Kieran Doyle's app.",
    );
    expect(
      say("enquiry.answered", { ...received, form: "free_text", replyId: "r" }, "office"),
    ).toBe("Sam Rota replied to Kieran Doyle's message (in the app).");
    expect(say("enquiry.reply_sending", { ...received, replyId: "r" }, "system")).toBe(
      "Sending the office's reply to Kieran Doyle in the app.",
    );
    expect(say("enquiry.reply_sent", { ...received, replyId: "r", pushes: 1 }, "system")).toBe(
      "The office's reply to Kieran Doyle showed in their app.",
    );
    for (const words of [
      '"{Kieran Doyle} sent a message in the app ({open shifts}{, sorted by AI})."',
      `" ${APP_LIMIT_LOG}"`,
      `" ${APP_ECHO_LOG}"`,
      "\"{Kieran Doyle} sent a message in the app but isn't active any more: it's waiting for a person.\"",
      '"The automatic answer showed in {Kieran Doyle}\'s app."',
      '"{Sam Rota} replied to {Kieran Doyle}\'s message (in the app)."',
      '"Sending the office\'s reply to {Kieran Doyle} in the app."',
      '"The office\'s reply to {Kieran Doyle} showed in their app."',
    ]) {
      expect(screens).toContain(words);
    }
  });

  it("the office's reply as it shows in the app, and its push, as the messaging doc says", () => {
    expect(
      officeReplyMessage(
        { name: "Acme Events", signOff: "Acme Events Shift Team" },
        "Yes.",
        "whatsapp",
      ),
    ).toBe("Yes. — Acme Events Shift Team");
    expect(templates).toContain('("{words} — {firm} Shift Team")');
    expect(officeReplyPush()).toEqual({ title: "The office replied", body: "Tap to read it." });
  });
});

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerSwitches } from "@/lib/answers/switches";
import { BUILT_IN_SWITCHES, NO_CHANNELS_ON } from "@/lib/office/answers-copy";
import type { AnswersPage } from "@/lib/office/answers-page";

// Automatic answers' page as the server draws it (Wave 1, w1-06; docs/screens.md "## Phase 35",
// "The office's page"): the banner while App messages, Texts and Emails are all off; the save Slip
// and each answer's switch told whether an answer that's on can go out by any channel
// (answersCanGo); Built in's line. The loader is a stand-in: the switches are this test's.

const data: { current: AnswersPage } = { current: page({ app: true, texts: false, email: false }) };

function page(switches: AnswerSwitches, autoReplies = true): AnswersPage {
  return {
    timeZone: "Europe/London",
    firmName: "Acme",
    switches,
    autoReplies,
    inbox: false,
    answeredLast7Days: { app: 0, texts: 0, email: 0 },
    builtInLast7Days: { shifts: 0, cancel: 0, pay: 0 },
    answers: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Parking",
        examples: ["Is there parking?"],
        body: "Yes, in car park B.",
        isOn: true,
        starterKey: null,
        updatedAt: new Date("2026-11-02T09:00:00Z"),
        updatedByName: "Ann Admin",
        usesLast7Days: 0,
      },
    ],
    unanswered: [],
    now: new Date("2026-11-02T09:00:00Z"),
  };
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/lib/auth/current-office", () => ({
  requireOfficeArea: async () => ({
    firm: { id: "11111111-1111-4111-8111-111111111111", name: "Acme" },
    officeUser: { id: "22222222-2222-4222-8222-222222222222", role: "admin" },
  }),
}));
vi.mock("@/lib/office/answers-page", () => ({
  officeAnswersPage: async () => data.current,
}));
// The switches are client components: stand-ins that show what the page gave them.
vi.mock("@/app/office/settings/answers/answer-switches", () => ({
  AnswerSwitch: ({ name, canGo }: { name: string; canGo: boolean }) =>
    createElement("span", { "data-answer-switch": name, "data-can-go": String(canGo) }),
  ChannelSwitch: ({ channel }: { channel: string }) =>
    createElement("span", { "data-channel-switch": channel }),
}));
vi.mock("@/app/office/settings/answers/answer-words", () => ({
  AnswerWords: ({ body }: { body: string }): ReactNode => createElement("p", null, body),
}));

const { default: AnswersPageView } = await import("@/app/office/settings/answers/page");

const draw = async (saved?: string) =>
  renderToStaticMarkup(
    await AnswersPageView({ searchParams: Promise.resolve(saved ? { saved } : {}) }),
  );
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const ID = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  data.current = page({ app: true, texts: false, email: false });
});

describe("Automatic answers' page (w1-06)", () => {
  it("all three switches off: the banner, and an answer that's on doesn't go out yet", async () => {
    data.current = page({ app: false, texts: false, email: false });
    const html = await draw(ID);
    expect(html).toContain("data-no-channel");
    expect(words(html)).toContain(NO_CHANNELS_ON);
    expect(words(html)).toContain(
      "Saved “Parking”. It's on, but it doesn't go out yet. See Answer casuals automatically.",
    );
    expect(html).toContain('data-answer-switch="Parking" data-can-go="false"');
    expect(words(html)).toContain(BUILT_IN_SWITCHES);
  });

  it("Texts on but the owner's automatic replies off: no banner, and still nothing goes", async () => {
    data.current = page({ app: false, texts: true, email: false }, false);
    const html = await draw(ID);
    expect(html).not.toContain("data-no-channel");
    expect(words(html)).toContain(
      "Saved “Parking”. It's on, but it doesn't go out yet. See Answer casuals automatically.",
    );
    expect(html).toContain('data-can-go="false"');
    expect(html).toContain("data-master-off");
  });

  it("App messages on: no banner, and the answer goes now", async () => {
    const html = await draw(ID);
    expect(html).not.toContain("data-no-channel");
    expect(words(html)).not.toContain(NO_CHANNELS_ON);
    expect(words(html)).toContain("Saved “Parking”. It's on: it answers casuals now.");
    expect(html).toContain('data-answer-switch="Parking" data-can-go="true"');
    expect(words(html)).toContain(BUILT_IN_SWITCHES);
  });

  it("nothing saved: no Slip", async () => {
    const html = await draw();
    expect(words(html)).not.toContain("Saved “Parking”");
  });
});

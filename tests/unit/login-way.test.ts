import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HelpView } from "@/app/help/help-view";
import { LinkSent, LoginForm } from "@/app/login/login-form";
import { CodeGate } from "@/app/pay/code-gate";
import { NotificationForm, savedText } from "@/app/profile/notification-form";
import { ProfileView } from "@/app/profile/profile-view";
import { PushSettingView, type OtherWay } from "@/app/profile/push-setting-view";
import type { Profile } from "@/lib/portal/profile";
import { hasTextSender, loginWay, textSenderIn, type LoginWay } from "@/lib/portal/login-way";

// How login links and codes go (P2.7; docs/screens.md "How login links and codes go", the mock-up
// approved by Dylan on 2026-10-30): each page's words for each way, word for word, and with no
// text sender no casual screen names WhatsApp or texts.

const signOff = "Acme Events Shift Team";
const firmName = "Acme Events";
const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const text = (el: ReactElement) => strip(renderToStaticMarkup(el));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/",
}));

// No WhatsApp and no texts, in any case.
const NAMES_A_TEXT = /whatsapp|\btext(s| message)\b/i;

describe("whether there's a text sender", () => {
  it("only MESSAGING_TRANSPORT=none means none", () => {
    expect(textSenderIn({ MESSAGING_TRANSPORT: "none" })).toBe(false);
    expect(textSenderIn({ MESSAGING_TRANSPORT: "console" })).toBe(true);
    expect(textSenderIn({ MESSAGING_TRANSPORT: "webex" })).toBe(true);
  });
  it("the web app reads its own settings: the tests' console sender is one", () => {
    expect(hasTextSender()).toBe(true);
  });
});

describe("loginWay", () => {
  it("by message while there's a text sender, whatever the setting", () => {
    expect(loginWay(true, {})).toBe("message");
    expect(loginWay(true, { login_by_email: true })).toBe("message");
  });
  it("with no text sender, by email only with login_by_email exactly true", () => {
    expect(loginWay(false, { login_by_email: true })).toBe("email");
    expect(loginWay(false, {})).toBe("off");
    expect(loginWay(false, { login_by_email: false })).toBe("off");
    expect(loginWay(false, { login_by_email: "true" })).toBe("off");
  });
});

describe("the login page", () => {
  const form = (way: LoginWay) => text(createElement(LoginForm, { firmName, signOff, way }));
  const sent = (way: "message" | "email") =>
    text(createElement(LinkSent, { firmName, signOff, way }));

  it("by message: today's words", () => {
    expect(form("message")).toContain("Send me a link");
    expect(sent("message")).toContain(
      "Check your phone. If Acme Events has this number, we've sent a link by WhatsApp or text. It works for 15 minutes.",
    );
  });
  it("by email: the button and the answer say email", () => {
    expect(form("email")).toContain("Email me a link");
    expect(form("email")).not.toContain("Send me a link");
    expect(sent("email")).toBe(
      "Check your email. If Acme Events has this number and your email address, we've emailed you a link. It works for 15 minutes. Not there in a few minutes? Look in your junk folder. Acme Events Shift Team Use a different number",
    );
  });
  it("can't send: no form, and it says so", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { firmName, signOff, way: "off" }));
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(form("off")).toBe(
      "Login links aren't switched on yet. Please contact the office the way you usually do. Acme Events Shift Team",
    );
  });
});

describe("the Pay code step", () => {
  const gate = (way: LoginWay, codeWaiting: boolean) =>
    text(createElement(CodeGate, { way, codeWaiting }));

  it("by message: today's words", () => {
    expect(gate("message", false)).toContain("To see your pay, we'll send you a 6-digit code.");
    expect(gate("message", false)).toContain("Send me a code");
    expect(gate("message", true)).toContain(
      "We've sent a 6-digit code by WhatsApp. It works for 10 minutes.",
    );
    expect(gate("message", true)).toContain("Send me a new code");
  });
  it("by email: the first step, the code step and its button say email", () => {
    expect(gate("email", false)).toBe(
      "To see your pay, we'll email you a 6-digit code. Email me a code",
    );
    const waiting = gate("email", true);
    expect(waiting).toContain("We've emailed you a 6-digit code. It works for 10 minutes.");
    expect(waiting).toContain("Email me a new code");
    expect(waiting).not.toContain("Send me");
  });
  it("can't send: no button, and no code step even for a code sent earlier", () => {
    for (const codeWaiting of [false, true]) {
      const html = renderToStaticMarkup(createElement(CodeGate, { way: "off", codeWaiting }));
      expect(html).not.toContain("<button");
      expect(html).not.toContain("<input");
      expect(gate("off", codeWaiting)).toBe(
        "We can't send you a code yet, so your pay can't open. Please contact the office the way you usually do.",
      );
    }
  });
});

describe("Help", () => {
  const help = (loginWay: LoginWay) =>
    text(
      createElement(HelpView, {
        firmName,
        facts: {
          noticeHours: 48,
          liveDays: 90,
          photoRenewalMonths: 36,
          strikesOn: true,
          travelOn: true,
          loginWay,
        },
        year: 2026,
      }),
    );

  it("by message: today's words", () => {
    const words = help("message");
    expect(words).toContain(
      "There's no app to download. Acme Events sends you a link by WhatsApp or text message.",
    );
    expect(words).toContain("We send a 6‑digit code by WhatsApp.");
    expect(words).toContain(
      "choose WhatsApp or text message, and whether to hear about open shifts.",
    );
  });
  it("by email", () => {
    const words = help("email");
    expect(words).toContain("There's no app to download. Acme Events emails you a link.");
    expect(words).toContain("Tap the link in the email.");
    expect(words).toContain("tap Email me a link .");
    expect(words).toContain(
      "Tap Email me a code . We email you a 6‑digit code. It works for 10 minutes.",
    );
  });
  it("can't send: neutral words", () => {
    const words = help("off");
    expect(words).toContain("There's no app to download. Acme Events sends you a link.");
    expect(words).toContain("Tap the link in the message.");
    expect(words).toContain(
      "Tap Send me a code . We send you a 6‑digit code. It works for 10 minutes.",
    );
  });
  it("with no text sender, the profile line has no channel to choose", () => {
    for (const way of ["email", "off"] as const) {
      expect(help(way)).toContain(
        "How we reach you : choose whether to hear about open shifts, and turn on notifications on this phone. Then tap Save settings .",
      );
    }
  });
});

describe("Profile's How we reach you", () => {
  const form = (loginWay: LoginWay, email: string | null) =>
    renderToStaticMarkup(
      createElement(NotificationForm, {
        channel: "sms",
        offerAlerts: true,
        textsOff: false,
        loginWay,
        email,
        signOff,
      }),
    );

  it("with a text sender, the choice as today", () => {
    expect(form("message", null)).toContain('type="radio"');
    expect(strip(form("message", null))).toContain("Send shift messages by");
  });
  it("with no text sender, no choice: a push, else an email to the address shown", () => {
    const html = form("email", "sam.booker@example.com");
    expect(html).not.toContain('type="radio"');
    expect(strip(html)).toContain(
      "Shift messages come as notifications on this phone, if you turn them on below. If not, we email sam.booker@example.com .",
    );
  });
  it("with no address held, says to ask the office", () => {
    expect(strip(form("off", null))).toContain(
      "Shift messages come as notifications on this phone, if you turn them on below. We have no email address for you. To add one, ask the office.",
    );
  });
  it("promises links and codes only where they can come", () => {
    const promise = "Login links and codes always come to you when you ask for them.";
    expect(strip(form("message", null))).toContain(promise);
    expect(strip(form("email", "sam.booker@example.com"))).toContain(promise);
    expect(strip(form("off", null))).not.toContain(promise);
    expect(strip(form("off", "sam.booker@example.com"))).not.toContain(promise);
  });
  it("Save settings says only what was saved", () => {
    expect(savedText("whatsapp", true, false, false)).toBe(
      "Saved. We'll tell you about open shifts.",
    );
    expect(savedText("sms", false, true, false)).toBe(
      "Saved. We won't tell you about open shifts.",
    );
    // With a text sender, as before.
    expect(savedText("sms", true)).toBe(
      "Saved. We'll send shift messages by text message. We'll tell you about open shifts.",
    );
  });
});

describe("Notifications on this phone", () => {
  const view = (otherWay: OtherWay, o: Partial<Parameters<typeof PushSettingView>[0]> = {}) =>
    text(createElement(PushSettingView, { state: "off", firmName, otherWay, ...o }));

  it("by text, as today", () => {
    expect(view("text")).toContain("Get urgent shift alerts on this phone, as well as by message.");
    expect(view("text", { state: "no_key" })).toContain(
      "Phone notifications aren't switched on for Acme Events yet. You'll get messages by WhatsApp or text.",
    );
  });
  it("by email", () => {
    expect(view("email")).toContain("Get urgent shift alerts on this phone, as well as by email.");
    expect(view("email", { state: "no_key" })).toContain(
      "Phone notifications aren't switched on for Acme Events yet. You'll get messages by email.",
    );
    expect(view("email", { state: "unsupported" })).toContain(
      "This browser can't show notifications. You'll still get messages by email.",
    );
    expect(view("email", { justTurnedOff: true })).toContain(
      "Notifications are off for this phone. You'll still get messages by email.",
    );
  });
  it("no other way: the email part left out", () => {
    expect(view("none")).toContain("Get urgent shift alerts on this phone.");
    expect(view("none", { state: "no_key" })).toContain(
      "Phone notifications aren't switched on for Acme Events yet.",
    );
    for (const o of [
      {},
      { state: "no_key" as const },
      { state: "unsupported" as const },
      { justTurnedOff: true },
    ]) {
      expect(view("none", o)).not.toMatch(/You'll (still )?get messages/);
    }
  });
});

describe("with no text sender, no casual screen names WhatsApp or texts", () => {
  const profile = (email: string | null): Profile => ({
    firstName: "Sam",
    lastName: "Booker",
    mobile: "+447700900123",
    email,
    notifyChannel: "sms",
    offerAlerts: true,
    textsOff: true, // replied STOP once: the note is about texts, so it goes too
    today: "2026-11-02",
    unavailable: [],
    qualifications: [],
    rightToWork: { checked: false, checkedOn: null, expired: false },
    rolesWithoutRule: [],
    photo: { status: "missing", current: null, waiting: null },
  });

  it.each(["email", "off"] as const)("the %s way", (way) => {
    const screens = [
      createElement(LoginForm, { firmName, signOff, way }),
      // The answer to a request: there's no form to ask with when nothing can be sent.
      ...(way === "email" ? [createElement(LinkSent, { firmName, signOff, way })] : []),
      createElement(CodeGate, { way, codeWaiting: false }),
      createElement(CodeGate, { way, codeWaiting: true }),
      createElement(HelpView, {
        firmName,
        facts: {
          noticeHours: 48,
          liveDays: 90,
          photoRenewalMonths: 36,
          strikesOn: true,
          travelOn: true,
          loginWay: way,
        },
        year: 2026,
      }),
      ...[null, "sam.booker@example.com"].map((email) =>
        createElement(ProfileView, {
          profile: profile(email),
          signOff,
          loginWay: way,
          push: { publicKey: null, firmName },
        }),
      ),
      ...(["email", "none"] as const).flatMap((otherWay) =>
        (["no_key", "unsupported", "off", "on", "blocked", "add_to_home_screen"] as const).map(
          (state) => createElement(PushSettingView, { state, firmName, otherWay }),
        ),
      ),
    ];
    for (const screen of screens) expect(text(screen)).not.toMatch(NAMES_A_TEXT);
    expect(savedText("sms", true, true, false)).not.toMatch(NAMES_A_TEXT);
  });

  it("the check itself catches what it's meant to", () => {
    expect("by WhatsApp").toMatch(NAMES_A_TEXT);
    expect("Texts are off").toMatch(NAMES_A_TEXT);
    expect("by text message").toMatch(NAMES_A_TEXT);
    expect("Tap the link in the email.").not.toMatch(NAMES_A_TEXT);
    // ...and a profile with a text sender does name them (the STOP note), so the check is live.
    expect(
      text(createElement(ProfileView, { profile: profile(null), signOff, loginWay: "message" })),
    ).toMatch(NAMES_A_TEXT);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoBar } from "@/app/demo-bar";
import { DemoPhoneView, displayNumber, withLinks } from "@/app/demo/demo-phone-view";
import type { DemoPhoneMessage } from "@/lib/demo/phone";

// The Demo phone's words and links (16.1; docs/screens.md `/demo`).

const origin = "https://acme.demo.example.co.uk";
const text: DemoPhoneMessage = {
  at: new Date("2026-10-20T08:14:00.000Z"),
  channel: "sms",
  toName: "Zoe Usman",
  to: "+447700900122",
  body: `Here's your Acme Events shifts link. It works for 15 minutes and only for you: ${origin}/l#abc123. - Acme Events Shift Team`,
  attachments: [],
};
const email: DemoPhoneMessage = {
  at: new Date("2026-10-20T08:20:00.000Z"),
  channel: "email",
  toName: "Payroll (demo)",
  to: "acme.payroll@example.com",
  subject: "Acme Events: 11 new pay queries",
  body: "11 new pay queries since the last digest.",
  attachments: ["pay-queries.csv"],
};

const render = (messages: DemoPhoneMessage[]) =>
  renderToStaticMarkup(
    createElement(DemoPhoneView, { firmName: "Acme Events", messages, linkOrigin: origin }),
  );

describe("the Demo phone", () => {
  it("says what it is, and that nothing has come yet", () => {
    const html = render([]);
    expect(html).toContain("<h1");
    expect(html).toContain("Demo phone");
    expect(html).toContain("This demo sends no real texts or emails.");
    expect(html).toContain("No messages yet. Ask for a login link and it shows here.");
  });

  it("shows each message as a phone would: who it went to, when, the words, a tappable link", () => {
    const html = render([email, text]);
    expect(html).toContain("Text to Zoe Usman");
    expect(html).toContain("07700 900122");
    // 08:14 UTC is 09:14 in London in October (BST).
    expect(html).toContain("Tue 20 Oct, 09:14");
    expect(html).toContain(`<a href="${origin}/l#abc123"`);
    expect(html).toContain("Email to Payroll (demo)");
    expect(html).toContain("acme.payroll@example.com");
    expect(html).toContain("Acme Events: 11 new pay queries");
    expect(html).toContain("Attached: pay-queries.csv");
    // Newest first, as given.
    expect(html.indexOf("Email to Payroll")).toBeLessThan(html.indexOf("Text to Zoe"));
  });

  it("only links back to the firm's own address; a sentence's full stop isn't part of the link", () => {
    const parts = renderToStaticMarkup(
      createElement(
        "p",
        null,
        ...withLinks(
          `Open ${origin}/shifts/open. Or https://evil.example/x, or ${origin}.attacker.example/y`,
          origin,
        ),
      ),
    );
    expect(parts).toContain(`<a href="${origin}/shifts/open"`);
    expect(parts).toContain(`/shifts/open</a>. Or`);
    expect(parts).not.toContain('href="https://evil.example');
    expect(parts).not.toContain(`href="${origin}.attacker.example`);
    expect(parts).toContain("https://evil.example/x");
  });

  it("a link dressed up as the firm's (a user name before an @, a scheme other than https) stays words", () => {
    const parts = renderToStaticMarkup(
      createElement(
        "p",
        null,
        ...withLinks(
          `Go to ${origin}@evil.example/l#x or https://acme.demo.example.co.uk:8443/l or javascript:alert(1)`,
          origin,
        ),
      ),
    );
    expect(parts).not.toContain("<a");
    expect(parts).toContain(`${origin}@evil.example/l#x`);
  });

  it("writes UK mobiles as people do; anything else as it is", () => {
    expect(displayNumber("+447700900122")).toBe("07700 900122");
    expect(displayNumber("+353861234567")).toBe("+353861234567");
  });

  it("the demo bar says it's a demo and links to the Demo phone", () => {
    const html = renderToStaticMarkup(createElement(DemoBar));
    expect(html).toContain("A demo with made-up people.");
    expect(html).toContain('href="/demo"');
    expect(html).toContain("Demo phone");
  });
});

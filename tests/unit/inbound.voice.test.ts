import { describe, expect, it } from "vitest";
import { callTwiml, VOICEMAIL_MAX_SECONDS } from "@/lib/inbound/voice";
import { CALL_GOODBYE, CALL_NOT_IN_USE, callGreeting } from "@/lib/messaging/templates";

// What a caller hears (src/lib/inbound/voice.ts, docs/messaging-templates.md "Call-to-text
// recording (voice)"): the spoken message, then a voicemail, as TwiML.

const firm = { name: "Acme Events", signOff: "Acme Events Shift Team" };
const urls = {
  transcriptionUrl: "https://shiftdesk.test/api/webhooks/twilio/voice/transcription",
  doneUrl: "https://shiftdesk.test/api/webhooks/twilio/voice/done",
};

describe("call-to-text TwiML", () => {
  it("the spoken message in British English, then a transcribed voicemail of 2 minutes at most, then hang up", () => {
    expect(callTwiml(firm, { link: "sent", ...urls })).toBe(
      `<Say language="en-GB">Thanks for calling Acme Events. We&apos;ve just sent a link to your phone where you can see your shifts, take open shifts or cancel straight away. To leave a message for the office, speak after the tone.</Say>` +
        `<Record maxLength="${VOICEMAIL_MAX_SECONDS}" playBeep="true" timeout="5" transcribe="true" transcribeCallback="${urls.transcriptionUrl}" action="${urls.doneUrl}"/>` +
        "<Hangup/>",
    );
    expect(VOICEMAIL_MAX_SECONDS).toBe(120);
  });

  it("a withheld number isn't promised a link", () => {
    expect(callGreeting(firm, "withheld")).toBe(
      "Thanks for calling Acme Events. We can't see your number, so we can't send you a link. To leave a message for the office, speak after the tone.",
    );
    expect(callTwiml(firm, { link: "withheld", ...urls })).toContain(
      "We can&apos;t see your number",
    );
  });

  it("a number the login limits stopped (or a failed request) isn't promised a link either", () => {
    expect(callGreeting(firm, "not_now")).toBe(
      "Thanks for calling Acme Events. We can't send you a link just now. To leave a message for the office, speak after the tone.",
    );
    expect(callTwiml(firm, { link: "not_now", ...urls })).toContain(
      "We can&apos;t send you a link just now.",
    );
  });

  it("a firm's name or an address can't break the TwiML (escaped)", () => {
    const twiml = callTwiml(
      { name: "Smith & Sons <Security>", signOff: "x" },
      { link: "sent", transcriptionUrl: 'https://x.test/a?b=1&c="2"', doneUrl: urls.doneUrl },
    );
    expect(twiml).toContain("Thanks for calling Smith &amp; Sons &lt;Security&gt;.");
    expect(twiml).toContain('transcribeCallback="https://x.test/a?b=1&amp;c=&quot;2&quot;"');
    expect(twiml).not.toContain("<Security>");
  });

  it("the other things a caller may hear", () => {
    expect(CALL_GOODBYE).toBe("Thank you. Goodbye.");
    expect(CALL_NOT_IN_USE).toBe("Sorry, this number isn't in use.");
  });
});

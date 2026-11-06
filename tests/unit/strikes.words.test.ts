import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CancelShiftResult } from "@/app/shifts/cancel-shift-result";
import type { CancelShiftOutcome } from "@/lib/portal/cancel-reasons";
import {
  ALREADY_STARTED,
  CANCEL_FOOTER,
  offersWhatHappened,
  STRIKE_WARNING_VERSION,
  STRIKE_WARNING_WORDS,
  WHAT_HAPPENED_PROMPT,
} from "@/lib/strikes/words";

// The cancel sheet's words and look (Phase 28.12; docs/screens.md "### 28.12"): the footer names
// the button, "tell us what happened" follows only a recorded strike, a started shift links to
// Messages about it (28.2's contract), the warning and its stored version are unchanged, and the
// sheet uses the shared parts (slip, staffChoice) with token corners only.

const SHIFT = "11111111-1111-4111-8111-111111111111";
type Shown = Exclude<
  CancelShiftOutcome,
  { status: "logged_out" | "invalid_reason" | "warning_changed" }
>;
const html = (outcome: Shown) =>
  renderToStaticMarkup(createElement(CancelShiftResult, { outcome, shiftId: SHIFT }));
const cancelled = (strike: { until: string } | null): Shown => ({
  status: "cancelled",
  ref: "3F2A9C1B",
  noticeHours: strike ? 20 : 50,
  recordedAt: "09:14 on Thu 5 Nov",
  when: "Sat 7 Nov, 14:00 to 22:00",
  role: "Steward",
  siteName: "Demo Arena",
  signOff: "Acme Events Shift Team",
  strike,
});

describe("the cancel sheet's words", () => {
  it("the footer names the button, word for word", () => {
    expect(CANCEL_FOOTER).toBe(
      "Your cancellation is recorded the moment you tap Cancel this shift. Nobody needs to approve it.",
    );
    const sheet = readFileSync("src/app/shifts/cancel-shift.tsx", "utf8");
    expect(sheet).toContain('"Cancel this shift"');
    expect(sheet).toContain("Keep my shift");
  });

  it("the warning's words and its stored version are unchanged (S3)", () => {
    expect(STRIKE_WARNING_VERSION).toBe("v2");
    expect(Object.keys(STRIKE_WARNING_WORDS)).toEqual(["v1", "v2"]);
  });

  it("'tell us what happened' only with a recorded strike", () => {
    expect(offersWhatHappened(null)).toBe(false);
    expect(offersWhatHappened({ until: "Wed 3 Feb" })).toBe(true);
    const none = html(cancelled(null));
    expect(none).toContain("No strike.");
    expect(none).not.toContain(WHAT_HAPPENED_PROMPT);
    expect(none).not.toContain("<textarea");
    const struck = html(cancelled({ until: "Wed 3 Feb" }));
    expect(struck).toContain("A strike has been recorded. It counts until Wed 3 Feb.");
    expect(struck).toContain(WHAT_HAPPENED_PROMPT);
    expect(struck).toContain("<textarea");
  });

  it("a started shift: no dead end, 'Message the office' about this shift", () => {
    const started = html({ status: "started" });
    expect(ALREADY_STARTED).toBe("This shift has already started.");
    expect(started).toContain(ALREADY_STARTED);
    expect(started).not.toMatch(/contact the office/i);
    expect(started).toContain(`href="/messages?shift=${SHIFT}&amp;about=started"`);
    expect(started).toMatch(/>Message the office<\/a>/);
  });
});

describe("the cancel sheet's look (28.1's parts)", () => {
  it("the result and the warning are slips: green with no strike, amber with one", () => {
    expect(html(cancelled(null))).toContain('data-slip="done"');
    expect(html(cancelled({ until: "Wed 3 Feb" }))).toContain('data-slip="attention"');
    expect(html({ status: "started" })).toContain('data-slip="attention"');
    const sheet = readFileSync("src/app/shifts/cancel-shift.tsx", "utf8");
    expect(sheet).toContain('<Slip tone={strike ? "urgent" : "done"} role="note">');
  });

  it("the reasons are choice cards, and no corner is outside the tokens", () => {
    const sheet = readFileSync("src/app/shifts/cancel-shift.tsx", "utf8");
    expect(sheet).toContain("${staffChoice} relative");
    for (const file of [
      "src/app/shifts/cancel-shift.tsx",
      "src/app/shifts/cancel-shift-result.tsx",
      "src/app/shifts/sheet.tsx",
      "src/app/help/help-view.tsx",
      "src/app/login/login-form.tsx",
      "src/app/login/page.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /\brounded(?:-[trbl]{1,2})?-(?:xl|2xl|3xl|lg|\[[^\]]+\])/,
      );
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  shiftConfirmedMessage,
  shiftNotBookedMessage,
  shiftOfferMessage,
  shiftUrgentMessage,
  shiftUrgentSms,
} from "@/lib/messaging/templates";
import { roleLabel } from "@/lib/portal/format";
import { REASONS } from "@/lib/rules/reasons";
import { roleWords } from "@/lib/text/role";

// Role names in their proper case everywhere, mid-sentence too (Phase 26.10, fix-7; docs/screens.md
// "Fixes and words"): "a CSAS officer", "CSAS officer needed", never "csas officer" or "Csas
// officer". One helper (src/lib/text/role.ts) for the texts, the emails, the rules' reasons and the
// replies.

const firm = { name: "Acme Events", signOff: "Acme Events Shift Team" };
const shift = {
  role: "csas_officer",
  site: "Northgate Demo Town Centre",
  date: "Wed 4 Nov",
  day: "Wed 4 Nov",
  start: "19:00",
  end: "01:00",
  link: "https://acme.example.test/shifts/abc",
};

describe("role words", () => {
  it("mid-sentence: lower case, acronyms in capitals", () => {
    expect(roleWords("csas_officer")).toBe("CSAS officer");
    expect(roleWords("cctv_operator")).toBe("CCTV operator");
    expect(roleWords("sia_door_supervisor")).toBe("SIA door supervisor");
    expect(roleWords("door_supervisor")).toBe("door supervisor");
    expect(roleWords("pts_lookout")).toBe("PTS lookout");
    // At the start of a line: a capital first, the acronym kept.
    expect(roleLabel("csas_officer")).toBe("CSAS officer");
    expect(roleLabel("door_supervisor")).toBe("Door supervisor");
  });

  it("the rules' reason, with its article", () => {
    expect(REASONS.wrong_role("csas_officer")).toBe("This shift needs a CSAS officer.");
    expect(REASONS.wrong_role("door_supervisor")).toBe("This shift needs a door supervisor.");
  });

  it("the offer, urgent, confirmation and not-booked messages", () => {
    expect(shiftOfferMessage(firm, shift)).toContain("(CSAS officer)");
    expect(shiftUrgentMessage(firm, shift)).toContain("URGENT: we need a CSAS officer at ");
    expect(shiftUrgentSms(firm, shift)).toContain("Acme Events URGENT: CSAS officer needed ");
    expect(shiftConfirmedMessage(firm, shift)).toContain("(CSAS officer)");
    expect(shiftNotBookedMessage(firm, shift)).toContain("(CSAS officer)");
    for (const text of [
      shiftOfferMessage(firm, shift),
      shiftUrgentMessage(firm, shift),
      shiftUrgentSms(firm, shift),
      shiftConfirmedMessage(firm, shift),
      shiftNotBookedMessage(firm, shift),
    ]) {
      expect(text).not.toMatch(/csas|Csas/);
    }
  });
});

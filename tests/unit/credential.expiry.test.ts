import { describe, expect, it } from "vitest";
import {
  daysUntil,
  expiryAction,
  isWeeklyListDay,
  WARNING_DAYS,
  type ScannedCredential,
} from "@/lib/credentials/expiry";
import {
  credentialExpiredMessage,
  credentialExpiringMessage,
  credentialWeeklyListEmail,
  WEEKLY_LIST_MAX_LINES,
} from "@/lib/messaging/templates";
import { addDays, localDateOf } from "@/lib/time/zoned";

// What the daily scan does with one credential (docs/rules-and-credentials.md, "Expiry
// warnings"): warn at 30, 14 and 7 days, mark expired the day after the expiry date, else nothing.

const TODAY = "2026-10-01";
const cred = (over: Partial<ScannedCredential> = {}): ScannedCredential => ({
  status: "valid",
  expiresOn: null,
  warnedFor: null,
  warnedDays: null,
  ...over,
});
const expiringIn = (days: number, over: Partial<ScannedCredential> = {}) =>
  cred({ expiresOn: addDays(TODAY, days), ...over });

describe("expiryAction", () => {
  it("warns at exactly 30, 14 and 7 days", () => {
    for (const days of WARNING_DAYS) {
      expect(expiryAction(expiringIn(days), TODAY)).toEqual({ kind: "warn", days, daysLeft: days });
    }
    expect(WARNING_DAYS).toEqual([30, 14, 7]);
  });

  it("does nothing more than 30 days out, or for a credential with no expiry", () => {
    expect(expiryAction(expiringIn(31), TODAY)).toEqual({ kind: "none" });
    expect(expiryAction(expiringIn(365), TODAY)).toEqual({ kind: "none" });
    expect(expiryAction(cred({ expiresOn: null }), TODAY)).toEqual({ kind: "none" });
  });

  it("sends each threshold once for an expiry date", () => {
    const at = (days: number, warnedDays: number | null) =>
      expiryAction(
        expiringIn(days, {
          warnedFor: warnedDays === null ? null : addDays(TODAY, days),
          warnedDays,
        }),
        TODAY,
      );
    expect(at(30, 30)).toEqual({ kind: "none" }); // the 30-day warning already went
    expect(at(20, 30)).toEqual({ kind: "none" }); // between thresholds
    expect(at(14, 30)).toEqual({ kind: "warn", days: 14, daysLeft: 14 });
    expect(at(10, 14)).toEqual({ kind: "none" });
    expect(at(7, 14)).toEqual({ kind: "warn", days: 7, daysLeft: 7 });
    expect(at(3, 7)).toEqual({ kind: "none" });
    expect(at(0, 7)).toEqual({ kind: "none" }); // the expiry day: in date, all warnings sent
  });

  it("sends one warning, for the nearest threshold, when several were crossed at once", () => {
    // A late import, or a day the scan didn't run: never a burst of three.
    expect(expiryAction(expiringIn(5), TODAY)).toEqual({ kind: "warn", days: 7, daysLeft: 5 });
    expect(expiryAction(expiringIn(12), TODAY)).toEqual({ kind: "warn", days: 14, daysLeft: 12 });
    expect(expiryAction(expiringIn(29), TODAY)).toEqual({ kind: "warn", days: 30, daysLeft: 29 });
    // Last sent the 30-day one, then missed the 14: the next scan sends the 7-day one only.
    expect(
      expiryAction(expiringIn(6, { warnedFor: addDays(TODAY, 6), warnedDays: 30 }), TODAY),
    ).toEqual({ kind: "warn", days: 7, daysLeft: 6 });
  });

  it("starts again for a renewal: warnings sent for the old expiry date don't count", () => {
    const renewed = expiringIn(30, { warnedFor: addDays(TODAY, -300), warnedDays: 7 });
    expect(expiryAction(renewed, TODAY)).toEqual({ kind: "warn", days: 30, daysLeft: 30 });
  });

  it("is in date on its expiry day and marked expired the day after", () => {
    expect(expiryAction(expiringIn(0), TODAY)).toEqual({ kind: "warn", days: 7, daysLeft: 0 });
    expect(expiryAction(expiringIn(-1), TODAY)).toEqual({ kind: "expire" });
    // Long past (the scan wasn't running, or an old import): still marked expired.
    expect(expiryAction(expiringIn(-90), TODAY)).toEqual({ kind: "expire" });
    // Expired even if every warning had been sent.
    expect(
      expiryAction(expiringIn(-1, { warnedFor: addDays(TODAY, -1), warnedDays: 7 }), TODAY),
    ).toEqual({ kind: "expire" });
  });

  it("leaves applied, suspended and already expired credentials alone", () => {
    for (const status of ["applied", "suspended", "expired"] as const) {
      expect(expiryAction(expiringIn(7, { status }), TODAY)).toEqual({ kind: "none" });
      expect(expiryAction(expiringIn(-1, { status }), TODAY)).toEqual({ kind: "none" });
    }
  });

  it("counts calendar days across month ends, leap days and clock changes", () => {
    expect(daysUntil("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysUntil("2028-02-01", "2028-03-02")).toBe(30); // 2028 is a leap year
    expect(daysUntil("2026-10-20", "2026-11-03")).toBe(14); // over the October clock change
    expect(daysUntil("2026-12-25", "2027-01-01")).toBe(7);
    expect(daysUntil("2026-10-02", "2026-10-01")).toBe(-1);
  });
});

describe("the scan's dates", () => {
  it("uses the firm's local date, not UTC's", () => {
    // 23:30 UTC on 31 Aug is 00:30 on 1 Sep in London (BST).
    expect(localDateOf(new Date("2026-08-31T23:30:00Z"), "Europe/London")).toBe("2026-09-01");
    expect(localDateOf(new Date("2026-12-31T23:30:00Z"), "Europe/London")).toBe("2026-12-31");
  });

  it("moves dates by whole days", () => {
    expect(addDays("2026-10-01", 30)).toBe("2026-10-31");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("sends the office list on Mondays only", () => {
    expect(isWeeklyListDay("2026-09-28")).toBe(true); // a Monday
    for (const day of ["2026-09-27", "2026-09-29", "2026-10-03", "2026-10-04"]) {
      expect(isWeeklyListDay(day)).toBe(false);
    }
    expect(isWeeklyListDay("2026-10-05")).toBe(true);
  });
});

describe("expiry message copy (docs/messaging-templates.md)", () => {
  const voice = { name: "Acme Events", signOff: "Acme Events Shift Team" };

  it("warns in the firm's voice, signed by the Shift Team", () => {
    expect(credentialExpiringMessage(voice, "SIA door supervisor licence", "3 Oct")).toBe(
      "Your SIA door supervisor licence expires on 3 Oct. Renew it and send the new details to the office so you can keep taking shifts. — Acme Events Shift Team",
    );
  });

  it("says what expiry means and what to do", () => {
    expect(credentialExpiredMessage(voice, "PTS card", "30 Sep")).toBe(
      "Your PTS card expired on 30 Sep. You can't take shifts that need it until you renew it and send the new details to the office. — Acme Events Shift Team",
    );
  });

  it("lists the office's week in two sections, leaving out an empty one", () => {
    const both = credentialWeeklyListEmail(
      voice,
      ["Sam Carter: SIA door supervisor licence, expires 3 Oct"],
      ["Jo Patel: first aid at work certificate, expired 27 Sep"],
    );
    expect(both.subject).toBe("Acme Events: credentials expiring soon");
    expect(both.body).toBe(
      [
        "Expiring in the next 30 days:",
        "- Sam Carter: SIA door supervisor licence, expires 3 Oct",
        "",
        "Expired in the last week (these people can't take shifts that need them):",
        "- Jo Patel: first aid at work certificate, expired 27 Sep",
        "",
        "When someone sends you their new details, record the new expiry date so they can take shifts again.",
        "",
        "— Acme Events Shift Team",
      ].join("\n"),
    );
    const onlyExpiring = credentialWeeklyListEmail(
      voice,
      ["Sam Carter: PTS card, expires 3 Oct"],
      [],
    );
    expect(onlyExpiring.body).not.toContain("Expired in the last week");
    expect(onlyExpiring.body.endsWith("— Acme Events Shift Team")).toBe(true);
  });

  it("shows at most 40 lines a section, then says how many more", () => {
    expect(WEEKLY_LIST_MAX_LINES).toBe(40);
    const many = (n: number, verb: string) =>
      Array.from({ length: n }, (_, i) => `Worker ${i + 1}: PTS card, ${verb} 3 Oct`);
    const { body } = credentialWeeklyListEmail(voice, many(41, "expires"), many(40, "expired"));
    const lines = body.split("\n");
    expect(lines.filter((l) => l.includes(", expires "))).toHaveLength(40);
    expect(lines.filter((l) => l.includes(", expired "))).toHaveLength(40);
    expect(lines.filter((l) => l.startsWith("- and "))).toEqual(["- and 1 more"]);
    expect(lines.indexOf("- and 1 more")).toBe(
      lines.indexOf("- Worker 40: PTS card, expires 3 Oct") + 1,
    );
  });
});

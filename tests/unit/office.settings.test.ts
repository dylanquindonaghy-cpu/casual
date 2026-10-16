import { describe, expect, it } from "vitest";
import { eventWords } from "@/lib/office/event-words";
import {
  confirmResultText,
  sitePostcodeResultText,
  strikesEmailResultText,
  strikesEmailStatus,
} from "@/lib/office/settings-copy";
import {
  checkStrikesEmailLink,
  confirmedStrikesEmail,
  parseStrikesEmailLink,
  signStrikesEmailLink,
  strikesEmailOf,
} from "@/lib/office/strikes-email";

// Settings (12B.7): the strikes team's email as stored and read, its signed link, and the page's
// words. Pure.

const SECRET = "a-test-secret-for-signing-links-0123456789";
const FIRM = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-02T09:00:00Z");
const in7 = new Date(NOW.getTime() + 7 * 86_400_000);

describe("the address as stored", () => {
  it("reads the address and its confirmed time, and gives evidence an address only once confirmed", () => {
    expect(strikesEmailOf({})).toEqual({ address: null, confirmedAt: null });
    expect(strikesEmailOf({ strikes: "nonsense" })).toEqual({ address: null, confirmedAt: null });
    const unconfirmed = { strikes: { email: "strikes.team@example.com" } };
    expect(strikesEmailOf(unconfirmed)).toEqual({
      address: "strikes.team@example.com",
      confirmedAt: null,
    });
    expect(confirmedStrikesEmail(unconfirmed)).toBeNull();
    const confirmed = {
      strikes: { email: "strikes.team@example.com", email_verified_at: "2026-11-02T09:00:00.000Z" },
    };
    expect(confirmedStrikesEmail(confirmed)).toBe("strikes.team@example.com");
    // A confirmed time without an address, or one that isn't a time, counts for nothing.
    expect(strikesEmailOf({ strikes: { email_verified_at: "2026-11-02T09:00:00Z" } })).toEqual({
      address: null,
      confirmedAt: null,
    });
    expect(
      confirmedStrikesEmail({ strikes: { email: "a@example.com", email_verified_at: "soon" } }),
    ).toBeNull();
  });
});

describe("the signed link", () => {
  const SAVED = 4021;
  const link = signStrikesEmailLink(SECRET, {
    firmId: FIRM,
    address: "Strikes.Team@example.com",
    saved: SAVED,
    expiresAt: in7,
  });
  const check = (token: string, address: string | null, now = NOW, firmId = FIRM, saved = SAVED) =>
    checkStrikesEmailLink(SECRET, token, { firmId, address, saved, now });

  it("packs the firm and the expiry, never the address, and no run of digits", () => {
    expect(link).toMatch(/^[A-Za-z0-9_-]{28}\.[A-Za-z0-9_-]{43}$/);
    expect(link.toLowerCase()).not.toContain("strikes");
    const packed = Buffer.from(link.split(".")[0] ?? "", "base64url");
    expect(packed.subarray(0, 16).toString("hex")).toBe(FIRM.replace(/-/g, ""));
    expect(packed.readUIntBE(16, 5)).toBe(Math.floor(in7.getTime() / 1000));
  });

  it("is good for the address it was sent for (any case), until it expires", () => {
    expect(check(link, "strikes.team@example.com")).toBe("ok");
    expect(check(link, "strikes.team@example.com", new Date(in7.getTime() - 1000))).toBe("ok");
    expect(check(link, "strikes.team@example.com", new Date(in7.getTime() + 1000))).toBe("expired");
  });

  it("is refused for another address, a later save of the same one, another firm, a changed part, another key, or no address", () => {
    expect(check(link, "new.team@example.com")).toBe("invalid");
    // The address saved again (cleared and added back, or changed and changed back).
    expect(check(link, "strikes.team@example.com", NOW, FIRM, SAVED + 3)).toBe("invalid");
    expect(
      check(link, "strikes.team@example.com", NOW, "22222222-2222-4222-8222-222222222222"),
    ).toBe("invalid");
    const [packedText = "", mac = ""] = link.split(".");
    // A later expiry, with the same signature.
    const later = Buffer.from(packedText, "base64url");
    later.writeUIntBE(later.readUIntBE(16, 5) + 86_400, 16, 5);
    expect(check(`${later.toString("base64url")}.${mac}`, "strikes.team@example.com")).toBe(
      "invalid",
    );
    // A changed signature.
    expect(
      check(
        `${packedText}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`,
        "strikes.team@example.com",
      ),
    ).toBe("invalid");
    expect(
      checkStrikesEmailLink("another-secret-entirely-0123456789abcdef", link, {
        firmId: FIRM,
        address: "strikes.team@example.com",
        saved: SAVED,
        now: NOW,
      }),
    ).toBe("invalid");
    expect(check(link, null)).toBe("invalid");
    expect(check("v1.x.y.z", "strikes.team@example.com")).toBe("invalid");
  });

  it("is read for its shape and firm before anything else (refused there: no database work)", () => {
    expect(parseStrikesEmailLink(link, FIRM)).toEqual({
      expires: Math.floor(in7.getTime() / 1000),
      given: link.split(".")[1],
    });
    expect(parseStrikesEmailLink(link, FIRM.toUpperCase())).not.toBeNull();
    expect(parseStrikesEmailLink(link, "22222222-2222-4222-8222-222222222222")).toBeNull();
    for (const junk of [
      "",
      "v1.not-a-link",
      `${link}x`,
      `${link}.${link}`,
      link.replace(".", ""),
    ]) {
      expect(parseStrikesEmailLink(junk, FIRM)).toBeNull();
    }
  });
});

describe("the words", () => {
  it("say what state the address is in", () => {
    const tz = "Europe/London";
    expect(strikesEmailStatus({ address: null, confirmedAt: null, linkSentAt: null }, tz)).toBe(
      "Strike evidence isn't sent anywhere.",
    );
    expect(
      strikesEmailStatus({ address: "a@example.com", confirmedAt: NOW, linkSentAt: null }, tz),
    ).toBe("Strike evidence goes to this address (confirmed at 09:00 on Mon 2 Nov).");
    expect(
      strikesEmailStatus({ address: "a@example.com", confirmedAt: null, linkSentAt: NOW }, tz),
    ).toBe(
      "We sent a link at 09:00 on Mon 2 Nov. It works for 7 days. Strike evidence only goes there once it's confirmed.",
    );
  });

  it("answer each action", () => {
    expect(strikesEmailResultText({ status: "saved" })).toBe(
      "Saved. We've sent a link to that address to confirm it: it works for 7 days.",
    );
    expect(strikesEmailResultText({ status: "not_allowed" })).toBe(
      "Only admins can change settings.",
    );
    expect(strikesEmailResultText({ status: "too_many", retryAfterMinutes: 12 })).toBe(
      "Too many links sent. Nothing changed: try again in 12 minutes.",
    );
    expect(strikesEmailResultText({ status: "too_many", retryAfterMinutes: 600 })).toBe(
      "Too many links sent. Nothing changed: try again in 10 hours.",
    );
    expect(confirmResultText({ status: "rate_limited", retryAfterMinutes: 1 }, "Acme Events")).toBe(
      "Too many tries. Try again in 1 minute.",
    );
    expect(sitePostcodeResultText({ status: "in_use", sessions: 3 })).toBe(
      "3 booked sessions use this site: move them first.",
    );
    expect(sitePostcodeResultText({ status: "in_use", sessions: 1 })).toBe(
      "1 booked session uses this site: move it first.",
    );
    expect(confirmResultText({ status: "confirmed" }, "Acme Events")).toBe(
      "Confirmed. Acme Events can now send records of late cancellations to this address.",
    );
    expect(confirmResultText({ status: "invalid" }, "Acme Events")).toBe(
      "This link doesn't work. It may be for an older address. Ask Acme Events to send a new one.",
    );
  });

  it("log the changes in plain words, never the address", () => {
    const names = {
      worker: () => "Ann Booker",
      office: () => "Sam Rota",
      site: () => "Riverside Arena",
    };
    const say = (action: string, data: Record<string, unknown>, actorType = "office") =>
      eventWords({ action, actorType, actorId: "o", data }, names);
    expect(say("firm.settings_changed", { by: "firm", keys: ["strikes.email"] })).toBe(
      "Sam Rota changed the strikes team's email.",
    );
    expect(
      say("firm.settings_changed", { by: "link", keys: ["strikes.email_verified_at"] }, "system"),
    ).toBe("The strikes team's email was confirmed, by its link.");
    expect(say("firm.settings_changed", { keys: ["wave_size", "wave_minutes"] }, "system")).toBe(
      "The firm's settings changed (2 settings).",
    );
    expect(say("site.changed", { siteId: "s", fields: ["postcode"] })).toBe(
      "Sam Rota changed the postcode of Riverside Arena.",
    );
    expect(say("auth.rate_limited", { limit: "strikes_link:firm" }, "system")).toBe(
      "Too many links to confirm the strikes team's email: sending them was paused for a while.",
    );
    expect(say("auth.rate_limited", { limit: "link_fail:ip" }, "system")).toBe(
      "Too many tries: logging in was paused for a while.",
    );
    // A casual's own limits (13.3, 13.5): not "logging in".
    expect(say("auth.rate_limited", { limit: "take:worker" }, "system")).toBe(
      "Too many taps on Take shift: taking shifts was paused for a while.",
    );
    expect(say("auth.rate_limited", { limit: "push:worker" }, "system")).toBe(
      "Too many changes to phone notifications: saving them was paused for a while.",
    );
  });
});

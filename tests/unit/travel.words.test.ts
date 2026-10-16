import { describe, expect, it } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import { applySetting, effectiveSettings } from "@/lib/onboarding/settings";
import { eventWords } from "@/lib/office/event-words";
import { LOG_TYPES } from "@/lib/office/log-types";
import { siteLocationText, sitePostcodeResultText } from "@/lib/office/settings-copy";
import {
  removeTravelText,
  saveTravelText,
  travelPrivacyText,
  travelSummaryText,
} from "@/lib/portal/travel-copy";
import { officeTravelText } from "@/lib/travel/copy";
import { travelSettings } from "@/lib/travel/settings";

// The travel area and site locations in words (12G.1; docs/office-v2.md 3.7, 3.10, 4.6, 6.1): what
// the casual, the office and the log say. tests/integration/travel.test.ts runs them on the
// database.

describe("the casual's words", () => {
  it("the privacy line names their district, never more", () => {
    expect(travelPrivacyText("ZZ1 1AA")).toBe(
      "The office only sees your postcode district (ZZ1), never your full postcode.",
    );
    expect(travelPrivacyText(null)).toBe(
      "The office only sees your postcode district (the first part, like ZZ1), never your full postcode.",
    );
  });

  it("Profile's summary", () => {
    expect(
      travelSummaryText({ set: true, postcode: "ZZ1 1AA", modes: "both", maxMinutes: 45 }),
    ).toBe("From ZZ1 1AA · up to 45 minutes by car or public transport");
    expect(
      travelSummaryText({ set: true, postcode: "ZZ1 1AA", modes: "car", maxMinutes: 90 }),
    ).toBe("From ZZ1 1AA · up to 90 minutes by car");
    expect(travelSummaryText({ set: false, postcode: null, modes: "both", maxMinutes: 45 })).toBe(
      "Not set yet.",
    );
  });

  it("every answer is a plain sentence", () => {
    for (const status of [
      "saved",
      "unchanged",
      "invalid",
      "unknown_postcode",
      "lookup_failed",
      "lookups_off",
      "try_again",
      "not_active",
      "logged_out",
      "error",
    ] as const) {
      expect(saveTravelText({ status }), status).toMatch(/^[A-Z].*\.$/);
    }
    for (const status of ["removed", "not_set", "not_active", "logged_out", "error"] as const) {
      expect(removeTravelText({ status }), status).toMatch(/^[A-Z].*\.$/);
    }
    expect(saveTravelText({ status: "unknown_postcode" })).toBe(
      "We couldn't find that postcode, so nothing was saved. Check it and try again.",
    );
  });
});

describe("the office's words", () => {
  it("a casual's travel area: the district, the limit and how they travel", () => {
    expect(officeTravelText({ district: "ZZ1", maxMinutes: 45, modes: "both" })).toBe(
      "ZZ1 · 45 min, car or public transport",
    );
    expect(officeTravelText({ district: "ZZ10", maxMinutes: 30, modes: "public_transport" })).toBe(
      "ZZ10 · 30 min, public transport",
    );
    expect(officeTravelText(null)).toBe("Not set");
  });

  it("a site's location status and the save's answers", () => {
    expect(siteLocationText({ postcode: null, located: false })).toBe(
      "No postcode yet, so distances to this site can't be worked out.",
    );
    expect(siteLocationText({ postcode: "ZZ1 1AA", located: true })).toBe("Location found.");
    expect(siteLocationText({ postcode: "ZZ1 1AA", located: false })).toBe(
      "Location not looked up yet: save the postcode again to look it up.",
    );
    for (const status of [
      "saved",
      "saved_unlocated",
      "located",
      "lookups_off",
      "unknown_postcode",
      "lookup_failed",
    ] as const) {
      expect(sitePostcodeResultText({ status }), status).toMatch(/\.$/);
    }
    expect(sitePostcodeResultText({ status: "unknown_postcode" })).toMatch(/nothing changed/);
  });
});

describe("the log", () => {
  const say = (action: string, data: Record<string, unknown>) =>
    eventWords(
      { action, actorType: "worker", actorId: "w", data },
      { worker: () => "Ann Booker", office: () => "Sam Rota" },
    );

  it("names what changed and the limit, never the postcode or its point", () => {
    const changed = { changed: ["postcode", "modes", "maxMinutes"], maxMinutes: 45 };
    expect(passesLogCheck(changed)).toBe(true);
    expect(passesLogCheck({})).toBe(true); // travel.profile_removed
    expect(passesLogCheck({ workerId: "w", reason: "left", travelAreaRemoved: true })).toBe(true);
    // A postcode as a key would be refused (why the entry names fields as values).
    expect(passesLogCheck({ postcode: "ZZ1 1AA" })).toBe(false);
    expect(say("travel.profile_changed", changed)).toBe(
      "Ann Booker changed their travel area (where they start from, how they travel, how long they'll travel). Up to 45 minutes.",
    );
    expect(say("travel.profile_changed", { changed: ["modes"], maxMinutes: 60 })).toBe(
      "Ann Booker changed their travel area (how they travel). Up to 60 minutes.",
    );
    expect(say("travel.profile_removed", {})).toBe("Ann Booker removed their travel area.");
    expect(LOG_TYPES.workers.actions).toEqual(
      expect.arrayContaining(["travel.profile_changed", "travel.profile_removed"]),
    );
  });

  it("a site's location found says so; a changed postcode says that", () => {
    const site = (fields: string[]) =>
      eventWords(
        {
          action: "site.changed",
          actorType: "office",
          actorId: "o",
          data: { siteId: "s", fields },
        },
        { worker: () => "Ann Booker", office: () => "Sam Rota", site: () => "Riverside Arena" },
      );
    expect(site(["location"])).toBe("Sam Rota looked up the location of Riverside Arena.");
    expect(site(["postcode"])).toBe("Sam Rota changed the postcode of Riverside Arena.");
  });

  it('"They\'ve left" says the travel area went', () => {
    expect(
      eventWords(
        {
          action: "worker.deactivated",
          actorType: "office",
          actorId: "o",
          data: { workerId: "w", reason: "left", travelAreaRemoved: true },
        },
        { worker: () => "Ann Booker", office: () => "Sam Rota" },
      ),
    ).toMatch(/ Their travel area was deleted\.$/);
  });
});

describe("the firm's default time limit (travel.default_max_minutes)", () => {
  it("30, 45, 60 or 90; 45 otherwise; set by the owner", () => {
    expect(travelSettings({})).toEqual({ enabled: false, defaultMaxMinutes: 45 });
    expect(travelSettings({ travel: { default_max_minutes: 60 } })).toEqual({
      enabled: false,
      defaultMaxMinutes: 60,
    });
    for (const odd of [50, "60", null, 0]) {
      expect(travelSettings({ travel: { default_max_minutes: odd } })).toEqual({
        enabled: false,
        defaultMaxMinutes: 45,
      });
    }
    expect(applySetting({ strikes: { email: "x" } }, "travel.default_max_minutes", "60")).toEqual({
      strikes: { email: "x" },
      travel: { default_max_minutes: 60 },
    });
    expect(applySetting({}, "travel.default_max_minutes", "50")).toBeNull();
    expect(effectiveSettings({}).find((s) => s.key === "travel.default_max_minutes")).toEqual({
      key: "travel.default_max_minutes",
      value: 45,
      source: "default",
    });
  });
});

describe("travel areas on or off per firm (travel.enabled, 13.4)", () => {
  it("off unless set to exactly true; set by the owner as true or false", () => {
    expect(travelSettings({}).enabled).toBe(false);
    expect(travelSettings({ travel: {} }).enabled).toBe(false);
    expect(travelSettings({ travel: { enabled: true } }).enabled).toBe(true);
    for (const odd of ["true", 1, "yes", null, false]) {
      expect(travelSettings({ travel: { enabled: odd } }).enabled).toBe(false);
    }
    // Beside the default limit, which stays as it is.
    expect(applySetting({ travel: { default_max_minutes: 60 } }, "travel.enabled", "true")).toEqual(
      { travel: { default_max_minutes: 60, enabled: true } },
    );
    expect(applySetting({ travel: { enabled: true } }, "travel.enabled", "false")).toEqual({
      travel: { enabled: false },
    });
    for (const odd of ["yes", "on", "1", ""]) {
      expect(applySetting({}, "travel.enabled", odd)).toBeNull();
    }
    expect(effectiveSettings({}).find((s) => s.key === "travel.enabled")).toEqual({
      key: "travel.enabled",
      value: false,
      source: "default",
    });
    expect(
      effectiveSettings({ travel: { enabled: true } }).find((s) => s.key === "travel.enabled"),
    ).toEqual({ key: "travel.enabled", value: true, source: "set" });
  });
});

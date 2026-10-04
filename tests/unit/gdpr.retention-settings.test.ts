import { describe, expect, it } from "vitest";
import { onHold, RETENTION_DEFAULTS, retentionSettings } from "@/lib/gdpr/retention-settings";
import { applySetting, effectiveSettings } from "@/lib/onboarding/settings";

// A firm's retention settings (audit M24): the spec's defaults, set per firm by the owner, a hold
// for a dispute; the same reading the database's messages purge uses.

describe("retentionSettings", () => {
  it("the spec's defaults when nothing is set: messages 90 days, a closed request's words 12 months", () => {
    expect(retentionSettings({})).toEqual({
      messageDays: 90,
      requestNoteDays: 365,
      holdUntil: null,
    });
    expect(RETENTION_DEFAULTS).toEqual({ messageDays: 90, requestNoteDays: 365 });
  });

  it("a firm's own days and hold; anything it can't use is the default", () => {
    expect(
      retentionSettings({
        retention: { message_days: 45, request_note_days: 730, hold_until: "2027-03-01" },
      }),
    ).toEqual({ messageDays: 45, requestNoteDays: 730, holdUntil: "2027-03-01" });
    for (const junk of [29, 2191, 45.5, "45", null, -1]) {
      expect(retentionSettings({ retention: { message_days: junk } }).messageDays).toBe(90);
    }
    for (const junk of ["2027-02-30", "1/3/2027", 20270301, ""]) {
      expect(retentionSettings({ retention: { hold_until: junk } }).holdUntil).toBeNull();
    }
  });

  it("a hold is on up to and including its day", () => {
    const r = retentionSettings({ retention: { hold_until: "2027-03-01" } });
    expect(onHold(r, "2027-02-28")).toBe(true);
    expect(onHold(r, "2027-03-01")).toBe(true);
    expect(onHold(r, "2027-03-02")).toBe(false);
    expect(onHold(retentionSettings({}), "2027-03-01")).toBe(false);
  });
});

describe("npm run firm:settings with retention", () => {
  it("sets the days and the hold, refuses what the purge wouldn't use, and 'none' ends a hold", () => {
    const withDays = applySetting({}, "retention.message_days", "60");
    expect(withDays).toEqual({ retention: { message_days: 60 } });
    const held = applySetting(withDays ?? {}, "retention.hold_until", "2027-03-01");
    expect(held).toEqual({ retention: { message_days: 60, hold_until: "2027-03-01" } });
    expect(applySetting(held ?? {}, "retention.hold_until", "none")).toEqual({
      retention: { message_days: 60 },
    });
    expect(applySetting({}, "retention.message_days", "10")).toBeNull();
    expect(applySetting({}, "retention.request_note_days", "9999")).toBeNull();
    expect(applySetting({}, "retention.hold_until", "2027-02-30")).toBeNull();
    const shown = effectiveSettings(held ?? {}).filter((s) => s.key.startsWith("retention."));
    expect(shown).toEqual([
      { key: "retention.message_days", value: 60, source: "set" },
      { key: "retention.request_note_days", value: 365, source: "default" },
      { key: "retention.hold_until", value: "2027-03-01", source: "set" },
    ]);
  });
});

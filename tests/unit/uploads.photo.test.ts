import { describe, expect, it } from "vitest";
import { EXPIRING_SOON_DAYS } from "@/lib/credentials/expiry";
import { addDays } from "@/lib/time/zoned";
import { addMonths, PHOTO_RENEWAL_MONTHS, staffPhoto, type PhotoUpload } from "@/lib/uploads/photo";

// The staff photo's status (12F.2; docs/office-v2.md 4.6, 5.5; D3): from the latest approved
// photo, renewed every 36 months, "Due soon" 30 days before; a waiting one never replaces it.

const photo = (
  id: string,
  uploadedOn: string,
  status: PhotoUpload["status"] = "approved",
): PhotoUpload => ({ id, status, uploadedOn, uploadedAt: new Date(`${uploadedOn}T12:00:00Z`) });

// Uploaded 3 Aug 2024: renew by 3 Aug 2027.
const AUG = photo("p1", "2024-08-03");
const RENEW_BY = "2027-08-03";
const on = (today: string) => staffPhoto([AUG], today);

describe("renewal", () => {
  it("every 36 months, from the day the current photo was uploaded", () => {
    expect(PHOTO_RENEWAL_MONTHS).toBe(36);
    expect(on("2026-01-01").current).toEqual({
      id: "p1",
      uploadedOn: "2024-08-03",
      renewBy: RENEW_BY,
    });
    expect(staffPhoto([AUG], "2026-01-01", 24).current?.renewBy).toBe("2026-08-03");
  });

  it("months without the day end on their last", () => {
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2024-02-29", 48)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 2)).toBe("2027-01-30");
    expect(addMonths("2026-12-15", 36)).toBe("2029-12-15");
  });
});

describe("the status at each boundary date", () => {
  it.each([
    ["31 days before: up to date", addDays(RENEW_BY, -31), "up_to_date"],
    ["30 days before: due soon", addDays(RENEW_BY, -EXPIRING_SOON_DAYS), "due_soon"],
    ["the day before", addDays(RENEW_BY, -1), "due_soon"],
    ["on the renew-by day itself: still due soon", RENEW_BY, "due_soon"],
    ["the day after: overdue", addDays(RENEW_BY, 1), "overdue"],
    ["a year after", addDays(RENEW_BY, 365), "overdue"],
  ] as const)("%s", (_name, today, expected) => {
    expect(on(today).status).toBe(expected);
  });

  it("none approved: missing (a turned-down one doesn't count)", () => {
    expect(staffPhoto([], "2026-01-01")).toEqual({
      status: "missing",
      current: null,
      waiting: null,
    });
    expect(staffPhoto([photo("r", "2025-12-01", "rejected")], "2026-01-01").status).toBe("missing");
  });
});

describe("a waiting photo never replaces the approved one", () => {
  it("the approved one stays the photo, with its dates; the status says the office has one to check", () => {
    const now = staffPhoto([AUG, photo("p2", "2027-07-20", "waiting")], "2027-07-21");
    expect(now.current).toEqual({ id: "p1", uploadedOn: "2024-08-03", renewBy: RENEW_BY });
    expect(now.waiting).toEqual({ id: "p2", uploadedOn: "2027-07-20" });
    expect(now.status).toBe("waiting");
  });

  it("waiting with none approved yet", () => {
    expect(staffPhoto([photo("p2", "2026-01-01", "waiting")], "2026-01-02")).toEqual({
      status: "waiting",
      current: null,
      waiting: { id: "p2", uploadedOn: "2026-01-01" },
    });
  });

  it("once approved, the newest approved one is the photo; a newer turned-down one changes nothing", () => {
    const later = staffPhoto(
      [AUG, photo("p2", "2027-07-20"), photo("p3", "2027-07-25", "rejected")],
      "2027-07-26",
    );
    expect(later.current).toEqual({ id: "p2", uploadedOn: "2027-07-20", renewBy: "2030-07-20" });
    expect(later.status).toBe("up_to_date");
  });

  it("two on the same day: the later one", () => {
    const first = { ...photo("a", "2026-03-01"), uploadedAt: new Date("2026-03-01T09:00:00Z") };
    const second = { ...photo("b", "2026-03-01"), uploadedAt: new Date("2026-03-01T17:00:00Z") };
    expect(staffPhoto([second, first], "2026-03-02").current?.id).toBe("b");
  });
});

describe("the firm's renewal setting (photo.renewal_months)", () => {
  it("36 unless the owner set a whole number of months from 12 to 60", async () => {
    const { photoSettings } = await import("@/lib/uploads/settings");
    const { applySetting, effectiveSettings } = await import("@/lib/onboarding/settings");
    expect(photoSettings({})).toEqual({ renewalMonths: 36 });
    expect(photoSettings({ photo: { renewal_months: 24 } })).toEqual({ renewalMonths: 24 });
    for (const odd of [11, 61, 24.5, "24", null]) {
      expect(photoSettings({ photo: { renewal_months: odd } })).toEqual({ renewalMonths: 36 });
    }
    expect(
      applySetting({ travel: { default_max_minutes: 60 } }, "photo.renewal_months", "24"),
    ).toEqual({ travel: { default_max_minutes: 60 }, photo: { renewal_months: 24 } });
    expect(applySetting({}, "photo.renewal_months", "6")).toBeNull();
    expect(effectiveSettings({}).find((s) => s.key === "photo.renewal_months")).toEqual({
      key: "photo.renewal_months",
      value: 36,
      source: "default",
    });
  });
});

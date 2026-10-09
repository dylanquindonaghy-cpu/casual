import { describe, expect, it } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import { DETAIL_FIELDS } from "@/lib/office/shift-editor";

// Phase 12's new log entries pass the same check recordEvent() uses (it refuses anything the log
// masker would change; docs/office-v2.md 6.1). Added to as each task adds entries.

describe("shift.changed for a session's details (12B.1)", () => {
  const names = Object.values(DETAIL_FIELDS);

  it("passes the log check for every new field, one at a time and together", () => {
    for (const field of names) {
      expect(passesLogCheck({ by: "firm", fields: [field] })).toBe(true);
    }
    expect(passesLogCheck({ by: "firm", fields: names })).toBe(true);
    // With the editor's own fields alongside, as one entry can hold both.
    expect(passesLogCheck({ by: "firm", fields: ["role", "instructions", ...names] })).toBe(true);
  });

  it('names the requirements "requirements": never a name holding "credential"', () => {
    expect(names).toContain("requirements");
    for (const field of names) expect(field.toLowerCase()).not.toContain("credential");
  });

  it("would be refused with the column's own name as a key (why the editor maps names)", () => {
    expect(passesLogCheck({ by: "firm", requiredCredentials: ["FIRST_AID"] })).toBe(false);
  });
});

describe("the event and session switches (12B.4)", () => {
  it("passes the log check for each switch entry and each new stop reason", () => {
    for (const data of [
      { by: "firm" }, // event.hidden, session.hidden, and shown with no offers started
      { by: "firm", offersStarted: 3 }, // event.shown, session.shown
      { reason: "hidden", wave: 2 }, // offer.waves_stopped
      { workerId: "00000000-0000-4000-8000-000000000001", reason: "hidden" }, // offer.office_not_sent
    ]) {
      expect(passesLogCheck(data)).toBe(true);
    }
  });
});

describe("Settings (12B.7)", () => {
  it("passes the log check for each new entry: keys only, never the address or the postcode", () => {
    for (const data of [
      { by: "firm", keys: ["strikes.email"] }, // firm.settings_changed (saved)
      { by: "firm", keys: ["strikes.email", "strikes.email_verified_at"] },
      { by: "link", keys: ["strikes.email_verified_at"] }, // confirmed by its link
      {
        request: "strikes-email-link:00000000-0000-4000-8000-000000000001",
        expiresAt: "2026-11-09T09:00:00.000Z",
      }, // firm.strikes_email_link
      { request: "strikes-email-link:00000000-0000-4000-8000-000000000001" }, // _sent
      { request: "strikes-email-link:00000000-0000-4000-8000-000000000001", code: "Error" }, // _failed
      { siteId: "00000000-0000-4000-8000-000000000002", fields: ["postcode"] }, // site.changed
    ]) {
      expect(passesLogCheck(data)).toBe(true);
    }
  });

  it("would be refused with the address or the postcode in it (why only keys are logged)", () => {
    expect(passesLogCheck({ keys: ["strikes.email"], to: "strikes.team@example.com" })).toBe(false);
    expect(passesLogCheck({ siteId: "x", postcode: "ZZ1 1AA" })).toBe(false);
  });
});

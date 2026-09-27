import { describe, expect, it } from "vitest";
import { normaliseEmail } from "@/lib/auth/office-login";
import { canAccess, OFFICE_AREAS } from "@/lib/auth/roles";
import { officeLoginLinkEmail } from "@/lib/messaging/templates";

describe("office roles", () => {
  it.each([
    ["admin", "dashboard", true],
    ["resourcer", "dashboard", true],
    ["payroll", "dashboard", true],
    ["admin", "team", true],
    ["resourcer", "team", false],
    ["payroll", "team", false],
  ] as const)("%s may use %s: %s", (role, area, allowed) => {
    expect(canAccess(role, area)).toBe(allowed);
  });

  it("every area names at least one role, and only real roles", () => {
    for (const roles of Object.values(OFFICE_AREAS)) {
      expect(roles.length).toBeGreaterThan(0);
      for (const r of roles) expect(["admin", "resourcer", "payroll"]).toContain(r);
    }
  });
});

describe("office email addresses", () => {
  it("are trimmed and lowercased; anything else is refused", () => {
    expect(normaliseEmail("  Jo.Bloggs@Example.COM ")).toBe("jo.bloggs@example.com");
    for (const junk of ["", "jo", "jo@", "@example.com", "jo bloggs@example.com"]) {
      expect(normaliseEmail(junk)).toBeNull();
    }
  });
});

describe("the office login email", () => {
  it("says what the link is for and ends with the firm's sign-off", () => {
    const email = officeLoginLinkEmail(
      { name: "Acme Events", signOff: "Acme Events Shift Team" },
      "https://acme.shiftdesk.co.uk/office/l#abc",
    );
    expect(email.subject).toBe("Your Acme Events office login link");
    expect(email.body).toContain("https://acme.shiftdesk.co.uk/office/l#abc");
    expect(email.body).toContain("15 minutes");
    expect(email.body.endsWith("— Acme Events Shift Team")).toBe(true);
  });
});

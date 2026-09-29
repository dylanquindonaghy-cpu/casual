import { describe, expect, it } from "vitest";
import { canAccess, OFFICE_AREAS } from "@/lib/auth/roles";
import { OFFICE_ROLES_THAT_PLACE } from "@/lib/roster/book";

// Who sees Today (src/lib/auth/roles.ts) and who may change shifts from it (booking, urgent,
// mark as filled, offers: officeCanPlace in src/lib/roster/book.ts) are two lists. They must stay
// the same, or Today would show buttons that always answer "You can't change shifts" (or hide
// them from someone allowed to use them).

describe("office roles", () => {
  it("Today's roles are exactly the roles that may place staff", () => {
    expect([...OFFICE_AREAS.today].sort()).toEqual([...OFFICE_ROLES_THAT_PLACE].sort());
  });

  it("payroll sees the dashboard but not Today", () => {
    expect(canAccess("payroll", "dashboard")).toBe(true);
    expect(canAccess("payroll", "today")).toBe(false);
    expect(canAccess("resourcer", "today")).toBe(true);
    expect(canAccess("admin", "today")).toBe(true);
  });
});

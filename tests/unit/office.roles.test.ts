import { describe, expect, it } from "vitest";
import { MENU_AREAS, officeMenu } from "@/app/office/office-menu";
import { canAccess, OFFICE_AREAS, ROLE_LABELS, type OfficeRole } from "@/lib/auth/roles";
import { OFFICE_ROLES_THAT_PLACE } from "@/lib/roster/book";

// Who sees Today (src/lib/auth/roles.ts) and who may change shifts from it (booking, urgent,
// mark as filled, offers: officeCanPlace in src/lib/roster/book.ts) are two lists. They must stay
// the same, or Today would show buttons that always answer "You can't change shifts" (or hide
// them from someone allowed to use them).

describe("office roles", () => {
  it("Today's and the shift screens' roles are exactly the roles that may place staff", () => {
    expect([...OFFICE_AREAS.today].sort()).toEqual([...OFFICE_ROLES_THAT_PLACE].sort());
    expect([...OFFICE_AREAS.shifts].sort()).toEqual([...OFFICE_ROLES_THAT_PLACE].sort());
    // Answering requests checks the same roles again inside its transaction.
    expect([...OFFICE_AREAS.requests].sort()).toEqual([...OFFICE_ROLES_THAT_PLACE].sort());
  });

  it("payroll sees the dashboard but not Today", () => {
    expect(canAccess("payroll", "dashboard")).toBe(true);
    expect(canAccess("payroll", "today")).toBe(false);
    expect(canAccess("resourcer", "today")).toBe(true);
    expect(canAccess("admin", "today")).toBe(true);
  });

  it("the action log and the notice report are for admins and resourcers", () => {
    expect(canAccess("admin", "log")).toBe(true);
    expect(canAccess("resourcer", "log")).toBe(true);
    expect(canAccess("payroll", "log")).toBe(false);
    expect(canAccess("admin", "reports")).toBe(true);
    expect(canAccess("resourcer", "reports")).toBe(true);
    expect(canAccess("payroll", "reports")).toBe(false);
  });

  it("pay queries are for payroll and admins", () => {
    expect(canAccess("payroll", "pay")).toBe(true);
    expect(canAccess("admin", "pay")).toBe(true);
    expect(canAccess("resourcer", "pay")).toBe(false);
  });

  it("the office menu (12A.2) links only to real areas, and offers each role only what it can open", () => {
    for (const area of MENU_AREAS) expect(Object.keys(OFFICE_AREAS)).toContain(area);
    const AREA_OF_HREF: Record<string, readonly string[]> = {
      "/office": ["today"],
      "/office/pay": ["pay"],
      "/office/shifts": ["shifts"],
      "/office/requests": ["requests"],
      "/office/workers": ["workers"],
      "/office/log": ["log"],
      "/office/reports/notice": ["reports"],
      "/office/reports/pilot": ["pilot"],
      "/office/pay-queries": ["pay"],
      "/office/pay/import": ["pay"],
      "/office/team": ["team"],
      "/office/data": ["data"],
      "/office/guide": ["guide"],
    };
    for (const role of Object.keys(ROLE_LABELS) as OfficeRole[]) {
      for (const link of officeMenu(role).flatMap((g) => g.links)) {
        const areas = AREA_OF_HREF[link.href];
        expect(areas, link.href).toBeDefined();
        expect(
          areas?.some((a) => canAccess(role, a as keyof typeof OFFICE_AREAS)),
          `${role}: ${link.href}`,
        ).toBe(true);
      }
    }
  });
});

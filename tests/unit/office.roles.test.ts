import { describe, expect, it } from "vitest";
import { barCounts, MENU_AREAS, menuBadges, officeMenu } from "@/app/office/office-menu";
import { canAccess, OFFICE_AREAS, ROLE_LABELS, type OfficeRole } from "@/lib/auth/roles";
import { OFFICE_ROLES_THAT_PLACE } from "@/lib/roster/book";

// Who sees the dashboard's to-dos (the `today` area, src/lib/auth/roles.ts; "Today" until 12E.1)
// and who may change shifts from it (booking, urgent, mark as filled, offers: officeCanPlace in
// src/lib/roster/book.ts) are two lists. They must stay the same, or the dashboard would show
// buttons that always answer "You can't change shifts" (or hide them from someone allowed to use
// them).

describe("office roles", () => {
  it("the dashboard's and the shift screens' roles are exactly the roles that may place staff", () => {
    expect([...OFFICE_AREAS.today].sort()).toEqual([...OFFICE_ROLES_THAT_PLACE].sort());
    expect([...OFFICE_AREAS.shifts].sort()).toEqual([...OFFICE_ROLES_THAT_PLACE].sort());
    // Answering requests and enquiries checks the same roles again inside its transaction.
    expect([...OFFICE_AREAS.enquiries].sort()).toEqual([...OFFICE_ROLES_THAT_PLACE].sort());
  });

  it("Needs attention's page shows enquiries and casuals' uploads only to roles that may see those too", () => {
    // It's gated by "today" (Phase 20: it lists each upload by the casual's name and counts the
    // enquiries that need a person), so every "today" role must also have "casuals" and
    // "enquiries"; if they ever differ, the page has to check those areas itself.
    for (const role of OFFICE_AREAS.today) {
      expect(canAccess(role, "casuals")).toBe(true);
      expect(canAccess(role, "enquiries")).toBe(true);
    }
  });

  it("payroll may open /office (sent on to the pay dashboard) but not the dashboard's to-dos", () => {
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

  it("Integrations (the planner's API keys, 12J.1) is for admins only", () => {
    expect(canAccess("admin", "integrations")).toBe(true);
    expect(canAccess("resourcer", "integrations")).toBe(false);
    expect(canAccess("payroll", "integrations")).toBe(false);
    expect(officeMenu("admin").flatMap((g) => g.links.map((l) => l.href))).toContain(
      "/office/settings/integrations",
    );
    for (const role of ["resourcer", "payroll"] as const) {
      expect(officeMenu(role).flatMap((g) => g.links.map((l) => l.href))).not.toContain(
        "/office/settings/integrations",
      );
    }
  });

  it("Automatic answers (the answer library, Phase 35.3) is for admins only", () => {
    expect(canAccess("admin", "answers")).toBe(true);
    expect(canAccess("resourcer", "answers")).toBe(false);
    expect(canAccess("payroll", "answers")).toBe(false);
    expect(officeMenu("admin").flatMap((g) => g.links.map((l) => l.href))).toContain(
      "/office/settings/answers",
    );
    for (const role of ["resourcer", "payroll"] as const) {
      expect(officeMenu(role).flatMap((g) => g.links.map((l) => l.href))).not.toContain(
        "/office/settings/answers",
      );
    }
  });

  it("client logins (36.3) are for admins; client requests (36.4) for the roles that place staff", () => {
    expect(canAccess("admin", "client_logins")).toBe(true);
    expect(canAccess("resourcer", "client_logins")).toBe(false);
    expect(canAccess("payroll", "client_logins")).toBe(false);
    // Accepting a request changes sessions, so it's exactly the roles that may place staff.
    expect([...OFFICE_AREAS.client_requests].sort()).toEqual([...OFFICE_ROLES_THAT_PLACE].sort());
    expect(canAccess("payroll", "client_requests")).toBe(false);
  });

  it("Client requests (36.4) is in the menu, its count and the top bar's chip, for the roles that may answer them", () => {
    const hrefs = (role: OfficeRole) => officeMenu(role).flatMap((g) => g.links.map((l) => l.href));
    expect(hrefs("admin")).toContain("/office/client-requests");
    expect(hrefs("resourcer")).toContain("/office/client-requests");
    expect(hrefs("payroll")).not.toContain("/office/client-requests");
    // Right after Enquiries, in Today.
    const today = officeMenu("resourcer").find((g) => g.label === "Today");
    expect(today?.links.map((l) => l.label)).toEqual([
      "Events & sessions",
      "Enquiries",
      "Client requests",
      "Cancellations",
    ]);
    const counts = { payQueries: 0, needPerson: 0, uploads: 0 };
    expect(
      menuBadges("resourcer", { ...counts, clientRequests: 2 })["/office/client-requests"],
    ).toEqual({ count: 2, words: "2 waiting", needs: true });
    expect(menuBadges("resourcer", { ...counts, clientRequests: 0 })).toEqual({});
    // The menu shows the badge on its link.
    const link = officeMenu("admin", menuBadges("admin", { ...counts, clientRequests: 3 }))
      .flatMap((g) => g.links)
      .find((l) => l.href === "/office/client-requests");
    expect(link?.badge?.count).toBe(3);
    // The top bar's chip: only while there are any, and only for roles that may open the page.
    const bar = (role: OfficeRole, clientRequests: number | null) =>
      barCounts(role, { shell: null, attention: null, payQueries: null, clientRequests }).find(
        (c) => c.key === "clientRequests",
      );
    expect(bar("resourcer", 4)).toEqual({
      key: "clientRequests",
      label: "Client requests",
      href: "/office/client-requests",
      icon: "list",
      count: 4,
    });
    expect(bar("admin", 1)?.count).toBe(1);
    expect(bar("admin", 0)).toBeUndefined();
    expect(bar("admin", null)).toBeUndefined();
    expect(bar("payroll", 4)).toBeUndefined();
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
      "/office/updates": ["today"],
      "/office/needs-attention": ["today"],
      "/office/pay": ["pay"],
      "/office/events": ["shifts"],
      "/office/enquiries": ["enquiries"],
      "/office/client-requests": ["client_requests"],
      "/office/cancellations": ["cancellations"],
      "/office/strikes": ["strikes"],
      "/office/casuals": ["casuals"],
      "/office/log": ["log"],
      "/office/reports/notice": ["reports"],
      "/office/reports/pilot": ["pilot"],
      "/office/pay-queries": ["pay"],
      "/office/pay/import": ["pay"],
      "/office/team": ["team"],
      "/office/settings": ["settings"],
      "/office/settings/integrations": ["integrations"],
      "/office/settings/answers": ["answers"],
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

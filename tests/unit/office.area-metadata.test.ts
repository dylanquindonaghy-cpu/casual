import { beforeEach, describe, expect, it, vi } from "vitest";

// A refused office page's tab (Phase 37.6, w1-08): areaMetadata gives "Page not found" to a role
// that can't open the page, the page's own title otherwise, and never throws (display only: the
// page's own requireOfficeArea decides what happens).

const auth = vi.hoisted(() => ({
  session: null as null | { officeUser: { role: string } },
  fails: false,
}));
vi.mock("@/lib/auth/current-office", () => ({
  getOfficeSession: async () => {
    if (auth.fails) throw new Error("the database is down");
    return auth.session;
  },
}));

const { areaMetadata, PAGE_NOT_FOUND_TITLE } = await import("@/app/office/area-metadata");

const as = (role: string) => {
  auth.session = { officeUser: { role } };
};

beforeEach(() => {
  auth.session = null;
  auth.fails = false;
});

describe("areaMetadata", () => {
  it("a role that can't open the page: 'Page not found', never the page's name", async () => {
    expect(PAGE_NOT_FOUND_TITLE).toBe("Page not found");
    as("payroll");
    expect(await areaMetadata("shifts", { title: "Events & sessions" })).toEqual({
      title: "Page not found",
    });
    as("resourcer");
    expect(await areaMetadata("pay", { title: "Pay dashboard" })).toEqual({
      title: "Page not found",
    });
    expect(await areaMetadata("settings", { title: "Settings" })).toEqual({
      title: "Page not found",
    });
  });

  it("a role that can open it: the page's own title", async () => {
    as("admin");
    expect(await areaMetadata("pay", { title: "Pay dashboard" })).toEqual({
      title: "Pay dashboard",
    });
    as("payroll");
    expect(await areaMetadata("pay", { title: "Pay queries" })).toEqual({ title: "Pay queries" });
  });

  it("no session: the page's own title (the page sends you to log in)", async () => {
    expect(await areaMetadata("pay", { title: "Pay dashboard" })).toEqual({
      title: "Pay dashboard",
    });
  });

  it("the session can't be read: the page's own title, and no error", async () => {
    auth.fails = true;
    await expect(areaMetadata("pay", { title: "Pay dashboard" })).resolves.toEqual({
      title: "Pay dashboard",
    });
  });
});

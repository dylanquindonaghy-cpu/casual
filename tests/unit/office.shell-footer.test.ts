import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The office shell holds the session keeper, which replaces the office login's token once a day
// while the office is in use (src/app/session-keeper.tsx), on every office page. The keeper draws
// nothing, so here it stands in as a marker that shows where it sits and what it was given. (It
// sat in the footer until 12A.2; "Log out" is in the account menu now.)

vi.mock("next/navigation", () => ({
  usePathname: () => "/office",
  useRouter: () => ({ refresh: () => undefined }),
}));
const refreshOfficeSessionAction = vi.hoisted(() => async () => undefined);
vi.mock("@/app/office/session-actions", () => ({ refreshOfficeSessionAction }));
vi.mock("@/app/session-keeper", () => ({
  SessionKeeper: ({ rotationDue, refresh }: { rotationDue: boolean; refresh: unknown }) =>
    createElement("i", {
      "data-session-keeper": String(rotationDue),
      "data-office-refresh": String(refresh === refreshOfficeSessionAction),
    }),
}));

const { OfficeShell, officeMenu } = await import("@/app/office/office-shell");

const shell = (rotationDue: boolean) =>
  renderToStaticMarkup(
    OfficeShell({
      name: "Sam Admin",
      roleLabel: "Admin",
      firmName: "Acme Events",
      menu: officeMenu("admin"),
      theme: undefined,
      rotationDue,
      children: createElement("main", null, "The page"),
    }),
  );

describe("the office shell's session keeper", () => {
  it("is there once, outside the page, after Log out, with the office's refresh", () => {
    for (const rotationDue of [true, false]) {
      const html = shell(rotationDue);
      expect(html.match(/data-session-keeper=/g)).toHaveLength(1);
      expect(html).toContain(
        `<i data-session-keeper="${rotationDue}" data-office-refresh="true"></i>`,
      );
      const keeperAt = html.indexOf("data-session-keeper");
      expect(keeperAt).toBeGreaterThan(html.indexOf(">Log out<"));
      expect(keeperAt).toBeGreaterThan(html.indexOf("</main>"));
    }
  });
});

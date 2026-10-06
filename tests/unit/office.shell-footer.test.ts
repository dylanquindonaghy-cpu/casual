import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The office shell's footer holds the session keeper, which replaces the office login's token
// once a day while the office is in use (src/app/session-keeper.tsx). The keeper draws nothing,
// so here it stands in as a marker that shows where it sits and what it was given.

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
      menu: officeMenu("admin"),
      rotationDue,
      children: createElement("main", null, "The page"),
    }),
  );

describe("the office shell's footer", () => {
  it("holds the session keeper once, after Log out, with the office's refresh", () => {
    for (const rotationDue of [true, false]) {
      const html = shell(rotationDue);
      const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
      expect(html.match(/data-session-keeper=/g)).toHaveLength(1);
      expect(footer).toContain(
        `<i data-session-keeper="${rotationDue}" data-office-refresh="true"></i>`,
      );
      expect(footer.indexOf("data-session-keeper")).toBeGreaterThan(footer.indexOf(">Log out<"));
    }
  });
});

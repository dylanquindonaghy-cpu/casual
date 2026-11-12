import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OFFICE_ROLES } from "@/lib/db/schema";
import {
  CASUAL_PAGES,
  CHOOSER_COPY,
  GUIDE_COPY,
  LOGIN_COPY,
  OFFICE_PAGE_LINES,
  PHONE_COPY,
} from "@/lib/demo/start-copy";

// The staffing demo's pages (Phase 31): their words are the screens doc's ("## Phase 31"), the
// guide lists only pages that exist (the office's from the real menu, the casual app's from its
// route files), and each page shows what docs/screens.md says it does.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
  usePathname: () => "/start",
}));

const { officeMenu } = await import("@/app/office/office-menu");
const { GuideView, officePages } = await import("@/app/start/guide/guide-view");
const { ChooserView } = await import("@/app/start/chooser-view");
const { StaffLoginForm, loginProblem } = await import("@/app/start/login/staff-login-form");
const { casualViewProblem } = await import("@/app/start/casual-view-button");
const { clientViewProblem } = await import("@/app/start/client-view-button");
const { StaffDemoLink } = await import("@/app/start/staff-demo-link");

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const screens = readFileSync("docs/screens.md", "utf8");
const phase31 = squash(screens.slice(screens.indexOf("\n## Phase 31\n")));

// Every sentence the pages show, from the copy (addresses and anchors left out).
function strings(value: unknown, key = ""): string[] {
  if (typeof value === "string") return ["href", "id"].includes(key) ? [] : [value.trim()];
  if (Array.isArray(value)) return value.flatMap((v) => strings(v));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => strings(v, k));
  return [];
}

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (markup: string) =>
  squash(
    markup
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, "&"),
  );

describe("the words are the screens doc's", () => {
  it("docs/screens.md has a Phase 31 section with 31.1, 31.2 and 31.3", () => {
    expect(screens).toContain("\n## Phase 31\n");
    for (const h of ["### 31.1", "### 31.2", "### 31.3"]) expect(phase31).toContain(h);
  });

  it.each([
    ["the login", LOGIN_COPY],
    ["Choose a view", CHOOSER_COPY],
    ["the phone frame", PHONE_COPY],
    ["the guide", GUIDE_COPY],
    ["the office's pages", OFFICE_PAGE_LINES],
    ["the casual app's pages", CASUAL_PAGES],
  ])("every sentence of %s is in the doc", (_name, copy) => {
    const all = strings(copy);
    expect(all.length).toBeGreaterThan(2);
    expect(all.filter((s) => !phase31.includes(squash(s)))).toEqual([]);
  });
});

describe("the guide lists only pages that exist", () => {
  it("one line for each page the office menu links to, and none more", () => {
    const everyHref = new Set(
      OFFICE_ROLES.flatMap((role) => officeMenu(role).flatMap((g) => g.links.map((l) => l.href))),
    );
    expect([...everyHref].sort()).toEqual(Object.keys(OFFICE_PAGE_LINES).sort());
  });

  it("each role sees only the pages its menu has", () => {
    for (const role of OFFICE_ROLES) {
      const menu = officeMenu(role);
      expect(officePages(menu).map((p) => p.href)).toEqual(
        menu.flatMap((g) => g.links.map((l) => l.href)),
      );
    }
    const payroll = officePages(officeMenu("payroll")).map((p) => p.href);
    expect(payroll).toContain("/office/pay-queries");
    expect(payroll).not.toContain("/office/team");
  });

  it("each casual page is a real route", () => {
    for (const { href } of CASUAL_PAGES) {
      const file = join("src/app", href, "page.tsx");
      expect(existsSync(file), href).toBe(true);
    }
  });
});

describe("the guide's page", () => {
  const render = (role: (typeof OFFICE_ROLES)[number]) =>
    html(
      createElement(GuideView, {
        menu: officeMenu(role),
        back: { href: "/start", label: GUIDE_COPY.back },
      }),
    );

  it("has its five sections in order, each a heading of its own", () => {
    const markup = render("admin");
    const headings = [...markup.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => text(m[1] ?? ""));
    expect(headings).toEqual([
      "What ShiftDesk is",
      "It isn't a CRM",
      "How it works with the API",
      "Where everything lives",
      "Golden rules, in short",
    ]);
    expect(markup).toContain('aria-label="How the planner, ShiftDesk and casuals connect"');
    expect(markup).toContain('href="/start"');
    expect(markup).toContain('href="/office/settings/integrations"');
    expect(markup).toContain('href="/office/guide"');
    for (const { href } of CASUAL_PAGES) expect(markup).toContain(`href="${href}"`);
  });

  it("a payroll user's lists only their own office pages", () => {
    const markup = render("payroll");
    expect(markup).toContain('href="/office/pay-queries"');
    expect(markup).not.toContain('href="/office/settings/integrations"');
    expect(markup).not.toContain('href="/office/events"');
  });
});

describe("Choose a view, the login and the demo link", () => {
  it("three big cards: the office, the casual's phone and the client's view (36.5); and the guide's link", () => {
    const markup = html(createElement(ChooserView, { name: "Staffing (demo)" }));
    const words = text(markup);
    expect(markup).toMatch(/<h1[^>]*>Choose a view<\/h1>/);
    expect(words).toContain(CHOOSER_COPY.office.title);
    expect(words).toContain(CHOOSER_COPY.casual.title);
    expect(words).toContain(CHOOSER_COPY.client.title);
    expect(words).toContain(CHOOSER_COPY.client.body);
    expect(words).toContain("Logged in as Staffing (demo).");
    expect(markup).toContain('href="/office"');
    expect(markup).toContain('href="/start/guide"');
    // The casual's and the client's: each a button (it logs this browser in first).
    expect(markup.match(/<button type="button"[^>]*>/g)).toHaveLength(2);
    expect(markup.match(/<li>/g)).toHaveLength(3);
  });

  it("the client view's problems, in plain words", () => {
    expect(clientViewProblem({ status: "logged_out" })).toBe(CHOOSER_COPY.client.loggedOut);
    expect(clientViewProblem({ status: "no_client" })).toBe(CHOOSER_COPY.client.noClient);
    expect(clientViewProblem({ status: "off" })).toBe("Something went wrong. Try again.");
    expect(clientViewProblem({ status: "error" })).toBe("Something went wrong. Try again.");
    expect(clientViewProblem({ status: "idle" })).toBeNull();
    expect(clientViewProblem({ status: "ok" })).toBeNull();
  });

  it("the login form: email, password, one button", () => {
    const markup = html(createElement(StaffLoginForm));
    expect(markup).toMatch(/<input[^>]*type="email"[^>]*autocomplete="username"/i);
    expect(markup).toMatch(/<input[^>]*type="password"[^>]*autocomplete="current-password"/i);
    expect(markup).toMatch(/<label[^>]*for="email"[^>]*>Email<\/label>/);
    expect(markup).toMatch(/<label[^>]*for="password"[^>]*>Password<\/label>/);
    expect(text(markup)).toContain("Log in");
  });

  it("says the same words whichever part is wrong, and how long to wait", () => {
    expect(loginProblem({ status: "wrong" })).toBe("That email and password don't match.");
    expect(loginProblem({ status: "rate_limited", retryAfterMinutes: 3 })).toBe(
      "Too many tries. Wait 15 minutes, then try again.",
    );
    expect(loginProblem({ status: "off" })).toBe("Something went wrong. Try again.");
    expect(loginProblem({ status: "idle" })).toBeNull();
    expect(loginProblem({ status: "ok" })).toBeNull();
    expect(casualViewProblem({ status: "logged_out" })).toBe(CHOOSER_COPY.casual.loggedOut);
    expect(casualViewProblem({ status: "no_casual" })).toBe(CHOOSER_COPY.casual.noCasual);
    expect(casualViewProblem({ status: "idle" })).toBeNull();
  });

  it("the demo link opens the staffing login", () => {
    const markup = html(createElement(StaffDemoLink));
    expect(markup).toContain('href="/start/login"');
    expect(text(markup)).toBe(LOGIN_COPY.linkLine);
  });
});

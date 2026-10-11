import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The two how-to guides (docs/ui-design.md "Guides"): the office's /office/guide shows each role
// only the parts it can open, and the workers' /help page is open without logging in and keeps
// back what isn't ready for workers. Both: every contents link lands on a section and has its
// arrow (no menu pills), one <h1>, bullet-free lists keep role="list", and short sentences. The
// office guide's facts that once overstated the screens are pinned too. (/help's plain words are
// also checked in copy.plain-language.test.ts.)

vi.mock("next/navigation", () => ({
  usePathname: () => "/office/guide",
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined }),
}));
vi.mock("@/app/office/session-actions", () => ({ refreshOfficeSessionAction: vi.fn() }));

const { officeMenu } = await import("@/app/office/office-shell");
const { GuideView, guideSections } = await import("@/app/office/guide/guide-view");
const { HelpView } = await import("@/app/help/help-view");

type Role = "admin" | "resourcer" | "payroll";

const guide = (role: Role) =>
  renderToStaticMarkup(
    createElement(GuideView, { firmName: "Acme Events", role, menu: officeMenu(role) }),
  );
const help = () => renderToStaticMarkup(createElement(HelpView, { firmName: "Acme Events" }));

const words = (html: string) =>
  html
    .replace(/<\/(p|h1|h2|h3|li|button|a|label|span|div)>/g, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const longSentences = (html: string) =>
  words(html)
    .split(/(?<=[.!?:])\s+/)
    .filter((s) => s.split(/\s+/).filter((w) => /[a-z0-9£]/i.test(w)).length > 25);

// Every in-page link ("#id") has its target, and no id is used twice.
function anchorsLand(html: string) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(targets.length).toBeGreaterThan(0);
  for (const t of targets) expect(ids).toContain(t);
}

// The contents (the page's one <nav>): one link per section, in order, each with its arrow (a
// drawing hidden from screen readers), like /help's. Never pills (they'd look like buttons to
// switch between, not a list of topics).
function contents(html: string) {
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  expect(nav).not.toContain("rounded-full");
  const links = [...nav.matchAll(/<a [^>]*href="#([^"]+)"[^>]*>(.*?)<\/a>/gs)];
  for (const [, , inner] of links) expect(inner).toMatch(/<svg [^>]*aria-hidden="true"/);
  return links.map((m) => m[1]);
}

// Lists whose bullets are styled away keep role="list": Safari stops announcing them otherwise.
// Only the square-bulleted points keep their bullets.
function bareListsKeepTheirRole(html: string) {
  const lists = [...html.matchAll(/<(?:ul|ol)\b[^>]*>/g)].map((m) => m[0]);
  expect(lists.length).toBeGreaterThan(0);
  for (const tag of lists) {
    if (!tag.includes("list-[square]")) expect(tag).toContain('role="list"');
  }
}

describe("the office how-to guide", () => {
  it("admins get every part, in the order of a working day", () => {
    expect(guideSections("admin").map((s) => s.title)).toEqual([
      "Getting around",
      "Start your day on the dashboard",
      "Fill a gap",
      "Add shifts",
      "Change or cancel a shift",
      "After a shift",
      "Enquiries",
      "Casuals",
      "Records",
      "Pay",
      "Admin",
      "Connect your planner",
      "What workers see",
    ]);
  });

  it("resourcers get every part except pay and admin, in the same order", () => {
    expect(guideSections("resourcer").map((s) => s.title)).toEqual([
      "Getting around",
      "Start your day on the dashboard",
      "Fill a gap",
      "Add shifts",
      "Change or cancel a shift",
      "After a shift",
      "Enquiries",
      "Casuals",
      "Records",
      "What workers see",
    ]);
    const text = words(guide("resourcer"));
    expect(text).not.toContain("Mark as sorted and tell them");
    expect(text).not.toContain("Change role");
  });

  it("payroll gets getting around, pay and what workers see, nothing about shifts", () => {
    expect(guideSections("payroll").map((s) => s.title)).toEqual([
      "Getting around",
      "Pay",
      "What workers see",
    ]);
    const html = guide("payroll");
    expect(html).not.toContain("Assign anyway");
    expect(html).not.toContain('href="/office/shifts"');
    expect(html).toContain('href="/office/pay-queries"');
    // The menu map is the role's own menu: the pay dashboard (their home, 12A.3), not the dashboard.
    expect(words(html)).toContain("Pay dashboard");
    expect(words(html)).not.toContain("Urgent gaps, what casuals can see");
    expect(words(html)).not.toContain("Casuals. Their qualifications");
  });

  it.each(["admin", "resourcer", "payroll"] as const)(
    "for %s: one heading 1, contents links that land, short sentences",
    (role) => {
      const html = guide(role);
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain(">How-to guide</h1>");
      anchorsLand(html);
      expect(contents(html)).toEqual(guideSections(role).map((s) => s.id));
      bareListsKeepTheirRole(html);
      expect(longSentences(html)).toEqual([]);
    },
  );

  it("says only what the screens allow", () => {
    const text = words(guide("admin"));
    // "Open it again" only shows right after marking a shift as filled.
    expect(text).toContain("Select Open it again straight away.");
    // A started shift's page has no "Assign someone", so the override note doesn't offer it.
    expect(text).not.toContain("only when the shift has started");
    expect(text).toContain("Once a shift has started, nobody can be assigned to it here.");
    // Moving is for a shift with people booked. With nobody booked, it's "Edit this shift".
    expect(text).toContain(
      "With nobody booked, change the date, times or site under Edit this shift instead.",
    );
    // The worker search matches part of a name, or a whole mobile number.
    expect(text).toContain("Type part of their name, or their whole mobile number, in");
    // A sheet or staff file can't undo "Make inactive" or a site block: its warning goes only
    // with "Make active again".
    expect(text).not.toContain("changes it back");
    expect(text).toContain("can't make them active again: only you can.");
    // A lost laptop or phone: log out everywhere, and turn off access if their email is open on it.
    expect(text).toContain("also turn off their access until it's secure.");
    expect(text).toContain("Yes, make them an admin");
    // Deleting waits until their booked shifts have ended or are cancelled.
    expect(text).toContain("you can't delete them yet.");
  });

  it("Connect your planner (12J.1) is for admins, and is where Integrations' link lands", async () => {
    const { PLANNER_GUIDE_HREF } = await import("@/lib/office/integrations-copy");
    const [path, id] = PLANNER_GUIDE_HREF.split("#");
    expect(path).toBe("/office/guide");
    expect(guide("admin")).toContain(`id="${id}"`);
    for (const role of ["resourcer", "payroll"] as const) {
      expect(guide(role)).not.toContain(`id="${id}"`);
      expect(words(guide(role))).not.toContain("API key");
    }
    const text = words(guide("admin"));
    // The words of the page, as they read on it.
    for (const name of [
      "Create a key",
      "Copy the key",
      "Codes your planner can use",
      "Yes, revoke it",
    ]) {
      expect(text).toContain(name);
    }
    expect(guide("admin")).toContain('href="/office/settings/integrations"');
  });

  it("is opened through its own area, which every office role has", () => {
    const page = readFileSync("src/app/office/guide/page.tsx", "utf8");
    expect(page).toContain('requireOfficeArea("guide")');
    expect(page).toContain('title: "How-to guide"');
  });
});

describe("the workers' help page", () => {
  it("has one heading 1, contents links that land, and short sentences", () => {
    const html = help();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(">Help</h1>");
    anchorsLand(html);
    expect(contents(html)).toHaveLength(11);
    bareListsKeepTheirRole(html);
    expect(longSentences(html)).toEqual([]);
  });

  it("opens with the shared page header: the firm's name, then Help, then one line", () => {
    const html = help();
    expect(html.match(/<header[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<header[^>]*><p[^>]*>Acme Events<\/p><h1[^>]*>Help<\/h1>/);
    expect(words(html)).toContain("Help. How your shifts pages work, step by step.");
    // The contents come after the header, not inside it.
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<nav"));
  });

  it("ends with the usual way back to My shifts", () => {
    expect(help()).toMatch(/<a [^>]*href="\/"[^>]*>Back to my shifts<\/a>/);
  });

  it("keeps back the shifts line number and invents no buttons", () => {
    const text = words(help());
    // PLAN.md's Parking lot: the line isn't shown to workers until incoming messages are answered.
    expect(text).not.toMatch(/\+44|07\d{3}|shifts line/i);
    // There's no privacy notice link or general question form to point at: it says so in words.
    expect(help()).not.toMatch(/href="[^"#]*privacy/i);
    expect(help()).not.toMatch(/<(button|form|input)[\s>]/);
    expect(text).toContain("Ask the office for a copy.");
  });

  it("opens without logging in: the page only needs the firm from the address", () => {
    const page = readFileSync("src/app/help/page.tsx", "utf8");
    expect(page).toContain("getCurrentFirm()");
    expect(page).not.toMatch(/requireWorker|getWorkerSession|readSessionToken/);
    expect(page).toContain('title: "Help"');
  });
});

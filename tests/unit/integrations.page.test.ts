import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KEY_LABEL_MAX, MAX_LIVE_KEYS } from "@/lib/integrations/keys";
import { eventWords } from "@/lib/office/event-words";
import { apiKeyLabelSchema, revokeApiKeySchema, type ApiKeyRow } from "@/lib/office/integrations";
import {
  createKeyResultText,
  KEY_SHOWN_ONCE,
  keyCreatedText,
  keyHintText,
  keyLastUsedText,
  NOT_CONNECTED,
  PLANNER_GUIDE_HREF,
  plannerLine,
  revokeKeyResultText,
  revokeQuestion,
} from "@/lib/office/integrations-copy";
import { logTypeLabel } from "@/lib/office/log-types";

// Integrations (12J.1; docs/office-v2.md 5.3.4; docs/screens.md `/office/settings/integrations`):
// the page's words and states, the key forms as the server draws them (before the page is ready),
// what a key's name may be, and that the page and its actions are for admins only. Pure. The
// database side (a key shown once, its hash stored, the 11th refused, Gate B, revoking, isolation)
// is tests/integration/office.integrations.test.ts; the browser, tests/e2e/office.integrations.spec.ts.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/settings/integrations/actions", () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}));
const { ApiKeyTable, CreateKeyForm } = await import("@/app/office/settings/integrations/key-forms");

const TZ = "Europe/London";
// Monday 2 November 2026, 09:00 London (GMT).
const NOW = new Date("2026-11-02T09:00:00Z");
const key = (o: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  label: "Event planner",
  hint: "k3F9",
  createdBy: "Sam Rota",
  createdAt: new Date("2026-10-30T14:05:00Z"),
  lastUsedAt: null,
  ...o,
});

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("Your planner", () => {
  it("connected by API: the time of the planner's latest change (today: the time only)", () => {
    const at = new Date("2026-11-02T08:41:00Z");
    expect(plannerLine({ kind: "api", lastChangeAt: at }, NOW, TZ)).toBe(
      "Connected by API · last change from your planner 08:41",
    );
    const earlier = new Date("2026-10-31T09:41:00Z");
    expect(plannerLine({ kind: "api", lastChangeAt: earlier }, NOW, TZ)).toBe(
      "Connected by API · last change from your planner Sat 31 Oct, 09:41",
    );
  });

  it("a Google Sheet: when it last synced, or that it hasn't yet", () => {
    const at = new Date("2026-11-02T08:40:00Z");
    expect(plannerLine({ kind: "sheet", syncedAt: at }, NOW, TZ)).toBe(
      "Google Sheet · synced 08:40",
    );
    expect(plannerLine({ kind: "sheet", syncedAt: null }, NOW, TZ)).toBe(
      "Google Sheet · not synced yet",
    );
  });

  it("not connected: says what a planner can do, and the page links to the guide's part", () => {
    expect(plannerLine({ kind: "none" }, NOW, TZ)).toBe(NOT_CONNECTED);
    expect(NOT_CONNECTED).toBe(
      "Not connected. Your planner can send sessions with an API key and hear about bookings and cancellations by webhook.",
    );
    expect(PLANNER_GUIDE_HREF).toBe("/office/guide#connect-your-planner");
    const page = readFileSync("src/app/office/settings/integrations/page.tsx", "utf8");
    expect(page).toContain("How to connect your planner");
    expect(page).toContain("PLANNER_GUIDE_HREF");
  });
});

describe("API keys", () => {
  it("a key shows as its last 4 characters, who made it and when, and when it was last used", () => {
    expect(keyHintText("k3F9")).toBe("…k3F9");
    expect(keyCreatedText(key(), TZ)).toBe("Sam Rota, 14:05 on Fri 30 Oct");
    expect(keyLastUsedText(key(), NOW, TZ)).toBe("Never");
    expect(keyLastUsedText(key({ lastUsedAt: new Date("2026-11-02T08:59:00Z") }), NOW, TZ)).toBe(
      "08:59",
    );
  });

  it("creating: the key is shown once, with the warning; every other answer in plain words", () => {
    const created = { status: "created", keyId: "k", key: "shiftdesk_x", label: "P", hint: "x" };
    expect(createKeyResultText(created as never)).toBe(KEY_SHOWN_ONCE);
    expect(KEY_SHOWN_ONCE).toBe("Copy this key now. You won't see it again.");
    expect(createKeyResultText({ status: "invalid" })).toBe(
      "Give the key a name (60 characters at most).",
    );
    expect(createKeyResultText({ status: "too_many" })).toBe(
      "You have 10 keys, the most a firm can have. Revoke one you don't use, then create a new one.",
    );
    expect(createKeyResultText({ status: "agreement_needed" })).toMatch(
      /^No key was made\. .*agreement and data processing agreement/,
    );
    expect(createKeyResultText({ status: "not_allowed" })).toBe("Only admins can create API keys.");
    expect(createKeyResultText({ status: "logged_out" })).toBe(
      "Your session has ended. Log in again.",
    );
    expect(createKeyResultText({ status: "error" })).toMatch(/Nothing was changed/);
    // The request failed: a key may have been made that nobody saw.
    expect(createKeyResultText({ status: "unknown" })).toMatch(/revoke it and create another/);
  });

  it("the limits the words give are the real ones (written out: the copy runs in the browser)", () => {
    expect(KEY_LABEL_MAX).toBe(60);
    expect(MAX_LIVE_KEYS).toBe(10);
    expect(createKeyResultText({ status: "invalid" })).toContain(`${KEY_LABEL_MAX} characters`);
    expect(createKeyResultText({ status: "too_many" })).toContain(`${MAX_LIVE_KEYS} keys`);
    const form = readFileSync("src/app/office/settings/integrations/key-forms.tsx", "utf8");
    expect(form).toContain(`maxLength={${KEY_LABEL_MAX}}`);
  });

  it("revoking asks first, and says what happened", () => {
    expect(revokeQuestion("Event planner")).toBe(
      "Revoke Event planner? Your planner stops reaching ShiftDesk at once.",
    );
    expect(revokeKeyResultText({ status: "revoked" })).toBe(
      "Revoked. That key stopped working at once.",
    );
    expect(revokeKeyResultText({ status: "already_revoked" })).toBe(
      "That key was already revoked.",
    );
    expect(revokeKeyResultText({ status: "not_found" })).toBe("We can't find that key.");
    expect(revokeKeyResultText({ status: "not_allowed" })).toBe("Only admins can revoke API keys.");
    expect(revokeKeyResultText({ status: "unknown" })).toMatch(/^Something went wrong\./);
  });

  it("a key's name: 1 to 60 characters once trimmed, no control characters, nothing else", () => {
    const ok = (label: unknown) => apiKeyLabelSchema.safeParse({ label });
    expect(ok("  Event planner  ").data).toEqual({ label: "Event planner" });
    expect(ok("x".repeat(60)).success).toBe(true);
    expect(ok(` ${"x".repeat(60)} `).success).toBe(true);
    expect(ok("x".repeat(61)).success).toBe(false);
    expect(ok("").success).toBe(false);
    expect(ok("   ").success).toBe(false);
    expect(ok("Event\nplanner").success).toBe(false);
    expect(ok("Event\u0007planner").success).toBe(false);
    expect(ok(42).success).toBe(false);
    expect(apiKeyLabelSchema.safeParse({ label: "P", firmId: "x" }).success).toBe(false);
    expect(revokeApiKeySchema.safeParse({ keyId: "not-a-uuid" }).success).toBe(false);
    expect(revokeApiKeySchema.safeParse({ keyId: key().id }).success).toBe(true);
  });
});

describe("the key forms, as the server draws them", () => {
  it("Create a key: a Name field and the button, both waiting for the page", () => {
    const html = renderToStaticMarkup(createElement(CreateKeyForm));
    expect(text(html)).toContain("Name");
    expect(html).toMatch(/<input[^>]*maxLength="60"[^>]*disabled=""/);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Create a key<\/button>/);
    // No key is ever drawn by the server: it's only in the create answer.
    expect(html).not.toContain("shiftdesk_");
  });

  it("the live keys: a table from 768px, stacked cards on a phone, Revoke named by the key", () => {
    const keys = [
      {
        id: "a",
        label: "Event planner",
        key: "…k3F9",
        created: "Sam Rota, 14:05 on Fri 30 Oct",
        lastUsed: "Never",
      },
      {
        id: "b",
        label: "Zapier",
        key: "…Q7_x",
        created: "Sam Rota, 09:00 on Mon 2 Nov",
        lastUsed: "08:59",
      },
    ];
    const html = renderToStaticMarkup(createElement(ApiKeyTable, { keys }));
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect([...table.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1] ?? ""))).toEqual([
      "Name",
      "Key",
      "Created",
      "Last used",
      "Revoke",
    ]);
    expect(html).toMatch(/class="[^"]*hidden md:block[^"]*"/);
    const cards = html.slice(html.indexOf("<ul"), html.indexOf("</ul>"));
    expect(cards).toContain("md:hidden");
    expect(text(cards)).toContain("Event planner Key …k3F9 Created Sam Rota, 14:05 on Fri 30 Oct");
    expect(html.match(/aria-label="Revoke Zapier"/g)).toHaveLength(2);
    // Nothing asks until Revoke is selected.
    expect(html).not.toContain("Yes, revoke it");
  });

  it("no keys: says so", () => {
    const html = renderToStaticMarkup(createElement(ApiKeyTable, { keys: [] }));
    expect(text(html)).toBe("No keys yet.");
  });
});

describe("admins only", () => {
  it("the page asks for the integrations area, the actions check it, the loader checks it again", () => {
    const page = readFileSync("src/app/office/settings/integrations/page.tsx", "utf8");
    expect(page).toContain('requireOfficeArea("integrations")');
    expect(page).toContain('title: "Integrations"');
    expect(page).toContain("notFound()");
    const actions = readFileSync("src/app/office/settings/integrations/actions.ts", "utf8");
    expect(actions).toMatch(/^"use server";/);
    expect(actions).toContain('canAccess(session.officeUser.role, "integrations")');
    const lib = readFileSync("src/lib/office/integrations.ts", "utf8");
    // The page loader, creating and revoking: each checks the office user inside the transaction.
    expect(lib.match(/officeUserMay\(tx, ctx\.officeUserId, "integrations"\)/g)).toHaveLength(3);
  });
});

describe("the action log", () => {
  it("names who created or revoked a key, never the key or its name", () => {
    const names = { worker: () => "Ann Booker", office: () => "Sam Rota" };
    const say = (action: string) =>
      eventWords({ action, actorType: "office", actorId: "o", data: { keyId: "k" } }, names);
    expect(say("api_key.created")).toBe("Sam Rota created an API key for your planner.");
    expect(say("api_key.revoked")).toBe("Sam Rota revoked an API key. It stopped working at once.");
    expect(logTypeLabel("api_key.created")).toBe("Firm settings and office team");
    expect(logTypeLabel("api_key.revoked")).toBe("Firm settings and office team");
  });
});

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KEY_LABEL_MAX, MAX_LIVE_KEYS } from "@/lib/integrations/keys";
import { eventWords } from "@/lib/office/event-words";
import {
  apiKeyLabelSchema,
  revokeApiKeySchema,
  type ApiKeyRow,
  type PlannerLink,
} from "@/lib/office/integrations";
import { headLine } from "@/lib/office/board-copy";
import { ConnectorCard } from "@/app/office/settings/integrations/connector-card";
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
  CONNECTOR_CADENCE,
  CONNECTOR_HIDDEN,
  CONNECTOR_HIDDEN_LINK,
  connectorErrorWords,
  connectorFailingText,
  connectorLines,
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

// Phase 25.4 (P5's card; docs/screens.md "Your firm's portal as its planner").
describe("your firm's portal as its planner", () => {
  const screens = readFileSync("docs/screens.md", "utf8").replace(/\s+/g, " ");
  const part = screens.slice(
    screens.indexOf("**Your firm's portal as its planner"),
    screens.indexOf("| Route | Screen |", screens.indexOf("**Your firm's portal as its planner")),
  );
  const inDoc = (line: string) => expect(part.replace(/[{}]/g, "")).toContain(line);
  const portal = (o: Partial<Extract<PlannerLink, { kind: "connector" }>> = {}) =>
    ({
      kind: "connector",
      connector: "demo_portal",
      nearReadAt: new Date("2026-11-02T08:31:00Z"),
      fullReadAt: new Date("2026-10-29T04:17:00Z"),
      failing: null,
      ...o,
    }) as const;

  it("names the portal; the card gives each read's time (today: the time only)", () => {
    expect(plannerLine(portal(), NOW, TZ)).toBe("Connected to the demo portal");
    inDoc("Connected to the demo portal");
    expect(connectorLines(portal(), NOW, TZ)).toEqual([
      "The next 48 hours' sessions: read 08:31.",
      "Everything: read Thu 29 Oct, 04:17.",
    ]);
    expect(connectorLines(portal({ nearReadAt: null, fullReadAt: null }), NOW, TZ)).toEqual([
      "The next 48 hours' sessions: not read yet.",
      "Everything: not read yet.",
    ]);
    inDoc("The next 48 hours' sessions: read 09:31.");
    inDoc("Everything: read Thu 29 Oct, 04:17.");
    inDoc(CONNECTOR_CADENCE);
    inDoc(CONNECTOR_HIDDEN);
    inDoc(CONNECTOR_HIDDEN_LINK.text);
    expect(CONNECTOR_HIDDEN_LINK.href).toBe("/office/events?view=hidden");
    // Working: no failed read said.
    expect(connectorFailingText(portal())).toBeNull();
  });

  it("a failed read: why, in plain words, and when it tries again", () => {
    expect(connectorFailingText(portal({ failing: "unreachable" }))).toBe(
      "The last read failed: your portal didn't answer. It tries again every 30 minutes until it works.",
    );
    inDoc(
      "The last read failed: your portal didn't answer. It tries again every 30 minutes until it works.",
    );
    // Every code a pull can leave (src/lib/connector/pull.ts) has its own words, in the doc.
    const codes = [
      "unreachable",
      "unauthorised",
      "no_api_key",
      "secrets_off",
      "secret_unreadable",
      "read_failed",
      "agreement_not_recorded",
      "not_allowed",
      "out_of_time",
      "records_failed",
      "off",
    ];
    const unknown = connectorErrorWords("something_new");
    expect(unknown).toBe("an error we don't have words for yet");
    inDoc(unknown);
    for (const code of codes) {
      const words = connectorErrorWords(code);
      expect(words, code).not.toBe(unknown);
      inDoc(words);
    }
    // A fault of ours: "error_" and its kind (pull.ts's sourceCode and unexpectedCode).
    for (const code of ["error_database", "error_unexpected", "error_typeerror"]) {
      expect(connectorErrorWords(code), code).toBe("something went wrong on our side");
    }
    inDoc("something went wrong on our side");
    // And a failed pull saves no other code (src/lib/connector/pull.ts): its failed() calls, the
    // read's codes (readSource, readFailureCode), the lease let go as off, and the transport's.
    const pull = readFileSync("src/lib/connector/pull.ts", "utf8");
    const transport = readFileSync("src/lib/connector/transport.ts", "utf8");
    const left = [
      ...[...pull.matchAll(/failed\("([a-z_]+)"\)/g)].map((m) => m[1] ?? ""),
      ...[...pull.matchAll(/\? "([a-z_]+)"\s*:/g)].map((m) => m[1] ?? ""),
      ...[...pull.matchAll(/: "([a-z_]+)";\n\}/g)].map((m) => m[1] ?? ""),
      ...[...pull.matchAll(/return \{ code: "([a-z_]+)" \}/g)].map((m) => m[1] ?? ""),
      ...[...pull.matchAll(/release\(\{ ok: false, code: "([a-z_]+)" \}\)/g)].map(
        (m) => m[1] ?? "",
      ),
      ...(/ConnectorFetchCode = ([^;]+);/.exec(transport)?.[1]?.match(/[a-z_]+/g) ?? []),
    ];
    for (const code of ["agreement_not_recorded", "no_api_key", "secrets_off", "read_failed"]) {
      expect(left).toContain(code);
    }
    expect(left).toContain("error_database");
    for (const code of left) {
      if (code.startsWith("error_"))
        expect(connectorErrorWords(code)).toBe(connectorErrorWords("error_x"));
      else expect(codes, `pull.ts saves "${code}"`).toContain(code);
    }
    // Never the raw code.
    expect(connectorErrorWords("__proto__")).toBe(unknown);
  });

  it("the card: the reads, a failing read's notice, how often it reads, and the hidden sessions' link", () => {
    const html = (p: ReturnType<typeof portal>) =>
      renderToStaticMarkup(createElement(ConnectorCard, { planner: p, now: NOW, timeZone: TZ }))
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&");
    const working = html(portal());
    const text = working.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("The next 48 hours' sessions: read 08:31.");
    expect(text).toContain("Everything: read Thu 29 Oct, 04:17.");
    expect(text).toContain(CONNECTOR_CADENCE);
    expect(text).toContain(CONNECTOR_HIDDEN);
    expect(working).toContain(`href="${CONNECTOR_HIDDEN_LINK.href}"`);
    expect(working).toContain(`>${CONNECTOR_HIDDEN_LINK.text}</a>`);
    expect(working).not.toContain('role="status"');
    expect(working).not.toContain("The last read failed");
    // Failing: said at once to a screen reader, between the reads and how often it reads.
    const failing = html(portal({ failing: "unreachable" }));
    const status = /<p role="status"[^>]*>([^<]*)<\/p>/.exec(failing);
    expect(status?.[1]).toBe(connectorFailingText(portal({ failing: "unreachable" })));
    expect(failing.indexOf("Everything:")).toBeLessThan(failing.indexOf('role="status"'));
    expect(failing.indexOf('role="status"')).toBeLessThan(failing.indexOf("It reads the next"));
    // The page shows the card for a connector only.
    const page = readFileSync("src/app/office/settings/integrations/page.tsx", "utf8");
    expect(page).toMatch(/data\.planner\.kind === "connector" && \(\s*<ConnectorCard/);
  });

  it("the dashboard: when it was last read, from your planner", () => {
    expect(headLine("2026-11-02", portal(), NOW, TZ)).toBe(
      "Monday 2 November · Week 45 · Pay Fri 13 Nov · Updated 08:31 from your planner",
    );
    expect(headLine("2026-11-02", portal({ nearReadAt: null }), NOW, TZ)).toBe(
      "Monday 2 November · Week 45 · Pay Fri 13 Nov",
    );
    inDoc(" · Updated 09:31 from your planner");
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

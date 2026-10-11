import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { passesLogCheck } from "@/lib/events/record";
import { EVIDENCE_SUBJECT_MAX, strikeEvidenceEmail } from "@/lib/messaging/templates";
import {
  evidenceSessionText,
  evidenceText,
  resendNote,
  thenText,
} from "@/lib/office/cancellations-copy";
import { eventWords } from "@/lib/office/event-words";
import { resendEvidenceText } from "@/lib/office/evidence-copy";
import { LOG_TYPES } from "@/lib/office/log-types";
import { needsCount, type Dashboard, type NeedsAttention } from "@/lib/office/dashboard";
import { EVIDENCE_RETRY_AFTER_MS } from "@/lib/strikes/evidence";
import { EVIDENCE_MAX_ATTEMPTS, strikeEvidencePayload } from "@/lib/strikes/evidence-queue";

// The evidence email to the strikes team (12C.4; docs/office-v2.md 5.6): its words (§5.6's own
// example, word for word), the job's payload and retries, its log entries, and the Needs attention
// item on the dashboard. tests/integration/strikes.evidence.test.ts runs the job on the database.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/office/today-actions", () => ({
  setUrgentAction: vi.fn(),
  closeShiftAction: vi.fn(),
  reopenShiftAction: vi.fn(),
  offerShiftAction: vi.fn(),
  keepBookingAction: vi.fn(),
}));
vi.mock("@/app/office/shifts/actions", () => ({
  setShowingAction: vi.fn(),
  cancelBookingAction: vi.fn(),
  cancelShiftAction: vi.fn(),
  moveShiftAction: vi.fn(),
}));
const { DashboardContent } = await import("@/app/office/dashboard-view");

const ACME = { name: "Acme Events", signOff: "Acme Events Shift Team" };
const facts = {
  casual: "Kieran Doyle",
  staffId: "N042",
  role: "Steward",
  site: "Acme Demo Racecourse",
  notice: "15 hours' notice",
  ref: "B71E0C42",
  session: "Steward · Raceday · Wed 7 Oct 10:30–18:30",
  cancelledAt: "19:05 on Tue 6 Oct",
  beforeStart: "15 hours",
  thresholdHours: "48",
  strikeNumber: "2",
  liveDays: "90",
  link: "https://acme.example/office/cancellations/4f2a9c1b-0000-4000-8000-000000000001",
};

describe("the email's words (§5.6)", () => {
  it("§5.6's example: the subject exactly, the body's sentences, the link, the sign-off", () => {
    const email = strikeEvidenceEmail(ACME, facts);
    expect(email.subject).toBe(
      "Strike: Kieran Doyle cancelled Steward at Acme Demo Racecourse with 15 hours' notice (ref B71E0C42)",
    );
    expect(email.body).toBe(
      [
        "Kieran Doyle (staff id N042) cancelled Steward · Raceday · Wed 7 Oct 10:30–18:30 at 19:05 on Tue 6 Oct, 15 hours before the start. That is under your 48-hour rule, so a strike was recorded automatically. It is their strike 2 in the last 90 days.",
        "",
        "The record is attached (PDF) and is also here:",
        "",
        facts.link,
        "",
        "— Acme Events Shift Team",
      ].join("\n"),
    );
    // Nothing straight after the link (a full stop can end up in it: audit L10).
    expect(email.body).toMatch(/\/[0-9a-f-]{36}\n/);
  });

  it("leaves out the staff id and the site when there are none", () => {
    const email = strikeEvidenceEmail(ACME, { ...facts, staffId: null, site: null });
    expect(email.subject).toBe(
      "Strike: Kieran Doyle cancelled Steward with 15 hours' notice (ref B71E0C42)",
    );
    expect(email.body.startsWith("Kieran Doyle cancelled Steward · Raceday")).toBe(true);
  });

  it("keeps the subject to 200 characters, shortening the name and the site, never the reference", () => {
    const long = strikeEvidenceEmail(ACME, {
      ...facts,
      casual: "Aleksandra ".repeat(15).trim(),
      site: "The Very Long Name Of A Racecourse ".repeat(5).trim(),
    });
    expect(long.subject.length).toBeLessThanOrEqual(EVIDENCE_SUBJECT_MAX);
    expect(long.subject.startsWith("Strike: Aleksandra")).toBe(true);
    expect(long.subject).toContain("…");
    expect(long.subject.endsWith("with 15 hours' notice (ref B71E0C42)")).toBe(true);
  });

  it("a very long role or notice still leaves the reference, and no character is cut in half", () => {
    const long = strikeEvidenceEmail(ACME, {
      ...facts,
      role: "Event steward ".repeat(20).trim(),
      casual: "Zoë 🙂 Ünal".repeat(30),
    });
    expect(long.subject.length).toBeLessThanOrEqual(EVIDENCE_SUBJECT_MAX);
    expect(long.subject.endsWith(" (ref B71E0C42)")).toBe(true);
    // No lone half of a surrogate pair.
    expect(long.subject).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });

  it("the session line: role, event, day and times in the firm's zone", () => {
    expect(
      evidenceSessionText(
        {
          role: "steward",
          eventName: "Raceday",
          // 09:30 and 17:30 UTC are 10:30 and 18:30 in London in October (BST).
          startsAt: new Date("2026-10-07T09:30:00Z"),
          endsAt: new Date("2026-10-07T17:30:00Z"),
        },
        "Europe/London",
      ),
    ).toBe("Steward · Raceday · Wed 7 Oct 10:30–18:30");
  });
});

describe("the job's payload and retries", () => {
  const ok = {
    firmId: "00000000-0000-4000-8000-0000000000aa",
    // The series in base 36 (42 is "16").
    idempotencyKey: "strike-evidence:00000000-0000-4000-8000-000000000001:16:1",
    strikeId: "00000000-0000-4000-8000-000000000001",
    series: 42,
    attempt: 1,
  };

  it("ids and numbers only, its key naming the strike, the series and the attempt", () => {
    expect(strikeEvidencePayload.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, idempotencyKey: "strike-evidence:00000000-0000-4000-8000-000000000001:16:2" },
      { ...ok, idempotencyKey: "strike-evidence:00000000-0000-4000-8000-000000000001:42:1" },
      { ...ok, series: 43 },
      {
        ...ok,
        attempt: EVIDENCE_MAX_ATTEMPTS + 1,
        idempotencyKey: `${ok.idempotencyKey.slice(0, -1)}5`,
      },
      { ...ok, attempt: 0 },
      { ...ok, strikeId: "not-a-uuid" },
    ]) {
      expect(strikeEvidencePayload.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("a series past a billion still passes the log check (no run of 10 digits in the key)", () => {
    const series = 1_234_567_890;
    const key = `strike-evidence:00000000-0000-4000-8000-000000000001:${series.toString(36)}:1`;
    expect(strikeEvidencePayload.safeParse({ ...ok, idempotencyKey: key, series }).success).toBe(
      true,
    );
    expect(passesLogCheck({ request: key, attempt: 1 })).toBe(true);
  });

  it("at most 4 attempts, waiting 5 minutes, 30 minutes and 2 hours", () => {
    expect(EVIDENCE_MAX_ATTEMPTS).toBe(4);
    expect(EVIDENCE_RETRY_AFTER_MS).toEqual([5 * 60_000, 30 * 60_000, 2 * 3_600_000]);
  });
});

describe("the log", () => {
  const request = "strike-evidence:00000000-0000-4000-8000-000000000001:42:1";
  const say = (action: string, data: Record<string, unknown>) =>
    eventWords(
      {
        action,
        actorType: action === "strike.evidence_resend" ? "office" : "system",
        actorId: "o",
        data,
      },
      { worker: () => "Ann Booker", office: () => "Sam Rota" },
    );

  it("each entry passes the log check (ids, codes and numbers: never the address)", () => {
    for (const data of [
      { request, attempt: 1 }, // _sending, _sent
      { request, attempt: 1, code: "EmailNotSentError", retry: true }, // _failed
      { request, attempt: 4, code: "not_set_up", retry: false },
      {}, // _resend
    ]) {
      expect(passesLogCheck(data)).toBe(true);
    }
    expect(passesLogCheck({ request, to: "strikes.team@example.com" })).toBe(false);
  });

  it("in the Strikes group, in plain words", () => {
    expect(LOG_TYPES.strikes.actions).toEqual(
      expect.arrayContaining([
        "strike.evidence_queued",
        "strike.evidence_sending",
        "strike.evidence_sent",
        "strike.evidence_failed",
        "strike.evidence_resend",
      ]),
    );
    expect(say("strike.evidence_sending", { request, attempt: 1 })).toBe(
      "Emailing a strike record to the strikes team.",
    );
    expect(say("strike.evidence_sent", { request, attempt: 1 })).toBe(
      "A strike record was emailed to the strikes team.",
    );
    expect(say("strike.evidence_failed", { code: "not_set_up", retry: false })).toBe(
      "A strike record wasn't emailed: the strikes team's email isn't confirmed. It goes when it is.",
    );
    expect(say("strike.evidence_failed", { code: "EmailNotSentError", retry: true })).toBe(
      "Emailing a strike record didn't reach the email server. Trying again.",
    );
    expect(say("strike.evidence_failed", { code: "EmailMayHaveArrivedError", retry: false })).toBe(
      "Emailing a strike record failed, and it may have arrived. Check with the strikes team, or resend it from the record.",
    );
    expect(say("strike.evidence_failed", { code: "EmailNotSentError", retry: false })).toBe(
      "Emailing a strike record didn't reach the email server after 4 tries, so nothing was sent. Resend it from the record.",
    );
    expect(say("strike.evidence_failed", { code: "not_built", retry: false })).toBe(
      "A strike record's email couldn't be put together, so nothing was sent. Resend it from the record.",
    );
    expect(say("strike.evidence_failed", { code: "withdrawn", retry: false })).toBe(
      "A strike record wasn't emailed: the strike was withdrawn.",
    );
    expect(say("strike.evidence_queued", {})).toBe(
      "A strike record that waited for the strikes team's email is being sent, now it's confirmed.",
    );
    expect(say("strike.evidence_resend", {})).toBe(
      "Sam Rota asked for a strike record to be emailed to the strikes team again.",
    );
  });

  it("the record's evidence line and its resend note say only what's known", () => {
    const strike = (status: "live" | "withdrawn", evidence: object) => ({
      strike: {
        status,
        expiresAt: new Date("2027-02-04T18:00:00Z"),
        reviewNeeded: false,
        evidence: { status: null, to: null, sentAt: null, ...evidence },
      },
    });
    const TZ = "Europe/London";
    expect(evidenceText(strike("live", { status: "failed" }), TZ)).toBe("Couldn't be sent");
    expect(evidenceText(strike("live", { status: "failed", nothingSent: true }), TZ)).toBe(
      "Couldn't be sent: nothing was sent",
    );
    expect(evidenceText(strike("live", { status: "pending" }), TZ)).toBe("Sending");
    expect(evidenceText(strike("live", { status: "pending", stuck: true }), TZ)).toBe(
      "Held up: not sent yet",
    );
    expect(evidenceText(strike("withdrawn", { status: "pending" }), TZ)).toBe(
      "Not sent: the strike was withdrawn",
    );
    // Withdrawn after a failure: "not sent" only when nothing can have gone (12C.5 review).
    expect(evidenceText(strike("withdrawn", { status: "failed", nothingSent: true }), TZ)).toBe(
      "Not sent: the strike was withdrawn",
    );
    expect(evidenceText(strike("withdrawn", { status: "failed" }), TZ)).toBe("Couldn't be sent");
    expect(
      evidenceText(
        strike("withdrawn", { status: "sent", sentAt: new Date("2026-11-06T18:01:00Z") }),
        TZ,
      ),
    ).toBe("Sent to the strikes team at 18:01 on Fri 6 Nov");
    expect(resendNote({ status: "failed" })?.text).toBe(
      "It may have arrived anyway: check with the strikes team before sending it again.",
    );
    expect(resendNote({ status: "failed", nothingSent: true })?.text).toBe(
      "It didn't reach the email server, so nothing was sent.",
    );
    expect(resendNote({ status: "pending", stuck: true })?.heading).toBe(
      "The evidence email is held up",
    );
    for (const status of ["pending", "sent", "not_set_up", null]) {
      expect(resendNote({ status })).toBeNull();
    }
  });

  it("the emailed PDF's Then line leaves out who took the place", () => {
    const t = {
      place: "reopened" as const,
      markedUrgent: false,
      offeredTo: 0,
      replacement: { name: "Jo Booker", at: new Date("2026-11-02T11:00:00Z") },
    };
    const when = new Date("2026-11-02T10:00:00Z");
    expect(thenText(t, when, "Europe/London")).toBe(
      "Place reopened · filled again by Jo Booker at 11:00",
    );
    expect(thenText(t, when, "Europe/London", false)).toBe(
      "Place reopened · filled again at 11:00",
    );
  });

  it("Resend evidence's answers", () => {
    expect(resendEvidenceText({ status: "queued" })).toBe(
      "Sending it again. This record shows when it has gone.",
    );
    expect(resendEvidenceText({ status: "not_failed" })).toContain("Nothing to resend");
    expect(resendEvidenceText({ status: "not_allowed" })).toBe(
      "Only admins and resourcers can resend evidence.",
    );
  });
});

describe("the Needs attention item on the dashboard (12E.1)", () => {
  const needs = (evidence: NeedsAttention["evidence"]): NeedsAttention => ({
    toCheck: [],
    toCheckMore: false,
    fromSheet: [],
    fromSheetMore: false,
    toMark: [],
    toMarkMore: false,
    expired: [],
    expiredMore: false,
    uploads: 0,
    evidence,
    plannerRefused: [],
    plannerRefusedMore: false,
  });
  const view = (evidence: NeedsAttention["evidence"]): Dashboard => ({
    timeZone: "Europe/London",
    today: "2026-11-02",
    counts: {
      urgent: { ok: true, data: { sessions: 0, places: 0, firstStartsAt: null } },
      showing: { ok: true, data: { events: 0, sessions: 0, places: 0 } },
      cancellations: { ok: true, data: { total: 0, underNotice: 0, strikes: 0, threshold: 48 } },
      enquiries: { ok: true, data: { total: 0, automatic: 0, needPerson: 0 } },
    },
    urgent: { ok: true, data: { events: [], more: false } },
    showing: { ok: true, data: { events: [], more: 0 } },
    cancellations: { ok: true, data: { rows: [], threshold: 48 } },
    enquiries: { ok: true, data: { rows: [], replies: {} } },
    needs: { ok: true, data: needs(evidence) },
  });
  const render = (v: Dashboard, isAdmin: boolean) =>
    renderToStaticMarkup(createElement(DashboardContent, { d: v, isAdmin }));
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .replace(/ ([).,])/g, "$1")
      .replace(/\( /g, "(");
  const failed = {
    assignmentId: "4f2a9c1b-0000-4000-8000-000000000001",
    casual: "Ann Booker",
    cancelledAt: new Date("2026-11-02T10:00:00Z"),
    stuck: false,
    nothingSent: false,
  };

  it("none while the address is confirmed and nothing failed", () => {
    const html = render(
      view({ addressConfirmed: true, waiting: 0, failed: [], failedMore: false }),
      true,
    );
    expect(html).not.toContain("Strike evidence");
  });

  it("an unconfirmed address and a failed email: its part, its count (the bell's too), each linking where it's dealt with", () => {
    const evidence = { addressConfirmed: false, waiting: 2, failed: [failed], failedMore: false };
    const v = view(evidence);
    const admin = render(v, true);
    expect(admin).toContain('<h3 id="evidence"');
    expect(text(admin)).toContain("Strike evidence 2");
    expect(needsCount(needs(evidence))).toEqual({ count: 2, more: false });
    expect(text(admin)).toContain(
      "The strikes team's email isn't set and confirmed, so strike records can't be emailed to them. 2 records wait for it.",
    );
    expect(admin).toMatch(/<a[^>]*href="\/office\/settings"[^>]*>Set it in Settings<\/a>/);
    expect(text(admin)).toContain(
      "Ann Booker's strike record couldn't be emailed to the strikes team (cancelled 10:00 on Mon 2 Nov). It may have arrived anyway.",
    );
    expect(admin).toMatch(
      new RegExp(
        `<a[^>]*href="/office/cancellations/${failed.assignmentId}"[^>]*>Open the record to resend it</a>`,
      ),
    );
    // Held up, or provably not sent: said so.
    const other = render(
      view({
        addressConfirmed: true,
        waiting: 0,
        failed: [
          { ...failed, stuck: true },
          { ...failed, assignmentId: "4f2a9c1b-0000-4000-8000-000000000002", nothingSent: true },
        ],
        failedMore: false,
      }),
      true,
    );
    expect(text(other)).toContain(
      "Ann Booker's strike record hasn't been emailed to the strikes team (cancelled 10:00 on Mon 2 Nov). It's held up.",
    );
    expect(text(other)).toContain(
      "Ann Booker's strike record couldn't be emailed to the strikes team (cancelled 10:00 on Mon 2 Nov). Nothing was sent.",
    );
    // A resourcer can't open Settings: told who can, no link.
    const resourcer = render(v, false);
    expect(resourcer).not.toContain('href="/office/settings"');
    expect(text(resourcer)).toContain("An admin can set it in Settings.");
  });
});

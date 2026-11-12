import { describe, expect, it } from "vitest";
import {
  acceptButton,
  acceptLines,
  acceptResultText,
  addContactText,
  answerResultText,
  lastInText,
  plannerDoneText,
  sendLinkText,
  switchContactText,
} from "@/lib/client/office-copy";
import {
  bookedOf,
  coverChipTone,
  coverTone,
  eventWhenLine,
  sentWhen,
  sessionChoiceLabel,
  timesText,
} from "@/lib/client/page-copy";
import type { AcceptPreview, OfficeClientRequest } from "@/lib/client/queue";
import { clientRequestsNeedText } from "@/lib/office/dashboard-copy";

// The words of the client's pages and the office's Client requests page (Phase 36.3, 36.4;
// src/lib/client/page-copy.ts and office-copy.ts; docs/screens.md "## Phase 36", "36.3 and 36.4 screens"). London,
// November (GMT).

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-12T14:52:00Z");

const request = (o: Partial<OfficeClientRequest> = {}): OfficeClientRequest => ({
  id: "r1",
  kind: "more_places",
  status: "waiting",
  contractId: "c1",
  contractName: "Demo Stadium Ltd",
  contactId: "p1",
  contactName: "Priya Shah",
  title: "+4 places · Steward · North Gate · Sat 14 Nov 12:30",
  payload: { places: 4 },
  note: null,
  officeAnswer: null,
  answeredAt: null,
  answeredBy: null,
  plannerDoneAt: null,
  createdAt: at("2026-11-12T14:40:00Z"),
  updatedAt: at("2026-11-12T14:40:00Z"),
  urgent: "starts_soon",
  session: {
    shiftId: "s1",
    eventId: "e1",
    eventName: "Demo Rovers v Visitors FC",
    role: "steward",
    post: "North Gate",
    site: "Demo Stadium",
    siteId: "v1",
    startsAt: at("2026-11-14T12:30:00Z"),
    endsAt: at("2026-11-14T19:30:00Z"),
    headcount: 12,
    booked: 9,
    status: "open",
    source: "native",
    isUrgent: false,
  },
  eventId: "e1",
  ...o,
});

describe("the client's pages' words", () => {
  it("an event's line, its cover and its sessions in numbers", () => {
    const e = {
      startsAt: at("2026-11-14T12:30:00Z"),
      site: "Demo Stadium",
      sessions: [
        { startsAt: at("2026-11-14T12:30:00Z") },
        { startsAt: at("2026-11-14T14:00:00Z") },
      ],
    };
    expect(eventWhenLine(e, TZ)).toBe("Sat 14 Nov · from 12:30 · Demo Stadium");
    expect(
      eventWhenLine(
        { ...e, sessions: [...e.sessions, { startsAt: at("2026-11-15T10:00:00Z") }] },
        TZ,
      ),
    ).toBe("Sat 14 Nov to Sun 15 Nov · from 12:30 · Demo Stadium");
    expect(bookedOf(71, 86)).toBe("71 of 86 booked");
    expect(coverTone(40, 86)).toBe("urgent");
    expect(coverTone(71, 86)).toBe("attention");
    expect(coverTone(6, 6)).toBe("done");
    expect(coverChipTone({ toFill: 0, offering: false, cancelled: false })).toBe("done");
    expect(coverChipTone({ toFill: 3, offering: true, cancelled: false })).toBe("wait");
    expect(coverChipTone({ toFill: 3, offering: false, cancelled: false })).toBe("attention");
    expect(coverChipTone({ toFill: 0, offering: false, cancelled: true })).toBe("quiet");
    expect(timesText(at("2026-11-14T12:30:00Z"), at("2026-11-14T19:30:00Z"), TZ)).toBe(
      "12:30–19:30",
    );
    expect(
      sessionChoiceLabel(
        {
          post: "North Gate",
          role: "steward",
          startsAt: at("2026-11-14T12:30:00Z"),
          endsAt: at("2026-11-14T19:30:00Z"),
        },
        TZ,
      ),
    ).toBe("North Gate · Steward · Sat 14 Nov 12:30–19:30");
    expect(sentWhen(at("2026-11-12T14:40:00Z"), NOW, TZ)).toBe("Sent 14:40");
    expect(sentWhen(at("2026-11-10T09:05:00Z"), NOW, TZ)).toBe("Sent Tue 10 Nov 09:05");
  });
});

describe("What accepting does", () => {
  it("more places, offered now (the mock-up's lines)", () => {
    const a: AcceptPreview = {
      kind: "places",
      change: {
        before: { places: 12, booked: 9, toFill: 3 },
        after: { places: 16, booked: 9, toFill: 7 },
        cancels: 0,
      },
      cancels: [],
      offers: "now",
    };
    expect(acceptLines(request(), a, TZ)).toEqual([
      { label: "North Gate Steward", text: "12 places become 16 (9 booked, 7 to fill)." },
      { label: "Offers", text: "the 7 open places go to the best eligible casuals now." },
      { label: "Client", text: 'Priya sees "Accepted" and gets an email.' },
    ]);
    expect(acceptButton(a)).toBe("Accept and offer the places");
    expect(acceptButton({ ...a, offers: "hidden" })).toBe("Accept");
  });

  it("fewer places: who is cancelled, with their notice", () => {
    const a: AcceptPreview = {
      kind: "places",
      change: {
        before: { places: 12, booked: 12, toFill: 0 },
        after: { places: 10, booked: 10, toFill: 0 },
        cancels: 2,
      },
      cancels: [
        { assignmentId: "a1", workerId: "w1", name: "Ana Steward", noticeHours: 52 },
        { assignmentId: "a2", workerId: "w2", name: "Ben Fraser", noticeHours: 52 },
      ],
      offers: "none",
    };
    const lines = acceptLines(request({ kind: "fewer_places", payload: { places: 2 } }), a, TZ);
    expect(lines[1]).toEqual({
      label: "Booked casuals",
      text: "2 bookings are cancelled by the firm, \"The client needs fewer staff\": Ana Steward (2 days' notice), Ben Fraser (2 days' notice). Each is told.",
    });
  });

  it("a planner's session, new times, a cancel, a new event and one that's gone", () => {
    expect(
      acceptLines(request(), { kind: "planner", owner: "planner", plannerName: "AXLR8" }, TZ)[0]
        ?.text,
    ).toBe(
      'this session comes from AXLR8, so nothing changes here. "To do in AXLR8" lists it until you mark it done.',
    );
    const times = acceptLines(
      request({ kind: "new_times" }),
      {
        kind: "times",
        from: { startsAt: at("2026-11-14T12:30:00Z"), endsAt: at("2026-11-14T19:30:00Z") },
        to: { startsAt: at("2026-11-14T12:00:00Z"), endsAt: at("2026-11-14T19:30:00Z") },
        curtailed: false,
        booked: [],
      },
      TZ,
    );
    expect(times[0]?.text).toBe("Sat 14 Nov 12:30–19:30 becomes Sat 14 Nov 12:00–19:30 (a move).");
    expect(times[1]?.text).toBe("no one is booked yet.");
    expect(acceptButton({ kind: "cancel", booked: [] })).toBe("Accept and cancel the session");
    const ev = acceptLines(
      request({ kind: "new_event", session: null }),
      {
        kind: "new_event",
        name: "Demo Rovers v City Demo",
        venue: { address: "1 Demo Road" },
        venues: [],
        sessions: [
          {
            role: "steward",
            places: 12,
            startsAt: at("2026-11-28T12:30:00Z"),
            endsAt: at("2026-11-28T19:30:00Z"),
            instructions: "North Gate",
          },
        ],
        problems: ["choose_venue"],
      },
      TZ,
    );
    expect(ev.map((l) => l.label)).toEqual(["New event", "Session 1", "Casuals", "Client"]);
    expect(ev[1]?.text).toBe("Steward, 12 places, Sat 28 Nov 12:30–19:30 · North Gate.");
    expect(acceptLines(request(), { kind: "gone", why: "started" }, TZ)).toEqual([
      { label: "Can't change it", text: "the session has started. Decline it, or ask the client." },
    ]);
  });
});

describe("every answer ends with its confirmation", () => {
  it("accept, decline, ask and mark done", () => {
    expect(
      acceptResultText({
        status: "accepted",
        applied: { kind: "more_places", from: 12, to: 16, offers: "offering" },
      }),
    ).toBe("Accepted. 12 places are now 16, and offers are going out. The client is told.");
    expect(acceptResultText({ status: "planner", owner: "planner" })).toBe(
      "Accepted. It's on your planner's to-do list until you mark it done. The client is told.",
    );
    expect(
      acceptResultText({
        status: "blocked",
        workers: [{ workerId: "w1", name: "Ana Steward", reasons: ["already booked then"] }],
      }),
    ).toBe(
      "Not changed: Ana Steward can't work the new times (already booked then). The request still waits: decline it, or ask the client.",
    );
    expect(answerResultText({ status: "declined" }, "decline")).toBe(
      "Declined. The client sees your reason and gets an email.",
    );
    expect(answerResultText({ status: "invalid" }, "decline")).toBe(
      "Type a reason: the client sees it.",
    );
    expect(answerResultText({ status: "asked" }, "ask")).toMatch(/^Sent\. The client sees/);
    expect(plannerDoneText({ status: "done" })).toBe("Marked done. It's off the to-do list.");
  });

  it("a contract's client logins", () => {
    expect(addContactText({ status: "added", clientContactId: "x" }, "Tom Reed")).toBe(
      "Added Tom Reed. Send them a link so they can log in.",
    );
    expect(addContactText({ status: "email_taken" }, "Tom")).toBe(
      "Someone already has a client login with that email.",
    );
    expect(addContactText({ status: "not_allowed" }, "Tom")).toBe(
      "Only admins can change client logins.",
    );
    expect(
      switchContactText({ status: "switched", on: false, sessions: 1, links: 0 }, "Tom Reed"),
    ).toBe("Tom Reed is off. They're logged out and their links don't work.");
    expect(sendLinkText({ status: "sent" }, "Tom Reed")).toBe(
      "Sent. Tom Reed has a login link by email. It works for 15 minutes.",
    );
    expect(sendLinkText({ status: "rate_limited", retryAfterMinutes: 12 }, "Tom Reed")).toBe(
      "You've sent Tom Reed 3 links. Try again in 12 minutes.",
    );
    expect(lastInText(null, NOW, TZ)).toBe("not logged in yet");
    expect(lastInText(at("2026-11-12T08:00:00Z"), NOW, TZ)).toBe("last in today");
    expect(lastInText(at("2026-11-09T08:00:00Z"), NOW, TZ)).toBe("last in Mon 9 Nov");
  });

  it("Needs attention's client requests line", () => {
    expect(clientRequestsNeedText({ waiting: 2, urgent: 1, plannerToDo: 1 })).toBe(
      "2 waiting for you (1 urgent) · 1 to do in your planner",
    );
    expect(clientRequestsNeedText({ waiting: 1, urgent: 0, plannerToDo: 0 })).toBe(
      "1 waiting for you",
    );
  });
});

import { describe, expect, it } from "vitest";
import { clientRequestInput, newEventPayload, payloadOf, PAYLOADS } from "@/lib/client/payloads";
import { placesChange } from "@/lib/client/preview-math";
import { CLIENT_URGENT_HOURS, urgentWhy, type UrgencyFacts } from "@/lib/client/urgency";
import {
  CLIENT_STATUS_WORDS,
  coverWords,
  KIND_WORDS,
  plannerTabWords,
  requestTitle,
  sentWords,
  tooManyRequestsWords,
} from "@/lib/client/words";
import { LIMITS } from "@/lib/auth/throttle";
import { CLIENT_REQUEST_KINDS, CLIENT_REQUEST_STATUSES } from "@/lib/db/schema";
import { passesLogCheck } from "@/lib/events/record";
import {
  clientLoginLinkEmail,
  clientRequestAnswerEmail,
  officeClientRequestPush,
  officeSummaryEmail,
} from "@/lib/messaging/templates";
import { eventWords, type Names } from "@/lib/office/event-words";
import { ALL_LOGGED_ACTIONS, logTypeLabel } from "@/lib/office/log-types";
import { DEFAULT_TELL_ME, TELL_ME_KINDS, TELL_ME_ROWS } from "@/lib/office/tell-me-copy";
import type { ClientRequestUpdate } from "@/lib/office/updates";
import { needsAction, isNew } from "@/lib/office/updates";
import { summaryLine, updateRow } from "@/lib/office/updates-copy";

// Client requests (Phase 36.4) in pure code: what a client may send (one zod schema per kind), when
// the rules call one urgent, what accepting does to a session's places, and every line of words
// (the client's, the office's, the emails, the notification, Updates and the action log).

const NOW = new Date("2026-11-11T12:00:00Z");
const H = 3_600_000;
const later = (h: number) => new Date(NOW.getTime() + h * H);
const SITE = "3f2b9c7e-8a1d-4c55-9a0e-2b7d1c4e5f60";
const SHIFT = "6a1c2d3e-4f50-4a61-8b72-9c0d1e2f3a4b";

describe("what a client may send", () => {
  const event = {
    name: "Demo Rovers v City Demo",
    venue: { siteId: SITE },
    date: "2026-11-28",
    sessions: [
      { role: "SIA steward", places: 12, start: "12:30", end: "19:30", notes: "North Gate" },
    ],
  };

  it("a new event: name, a venue of theirs or an address, a date, 1 to 12 sessions; roles read as the firm spells them", () => {
    const parsed = newEventPayload.parse(event);
    expect(parsed.sessions[0]?.role).toBe("sia_steward");
    expect(
      newEventPayload.safeParse({ ...event, venue: { address: "1 Demo Road, ZZ1 4AA" } }).success,
    ).toBe(true);
    // Not both, not neither, nothing extra.
    expect(
      newEventPayload.safeParse({ ...event, venue: { siteId: SITE, address: "1 Demo Road" } })
        .success,
    ).toBe(false);
    expect(newEventPayload.safeParse({ ...event, venue: {} }).success).toBe(false);
    expect(newEventPayload.safeParse({ ...event, extra: 1 }).success).toBe(false);
    // Times as hh:mm, a real date, places 1 to 1,000, 1 to 12 sessions, a role the firm can spell.
    const session = event.sessions[0];
    for (const bad of [
      { ...event, date: "2026-02-30" },
      { ...event, sessions: [] },
      { ...event, sessions: Array.from({ length: 13 }, () => session) },
      { ...event, sessions: [{ ...session, start: "25:00" }] },
      { ...event, sessions: [{ ...session, end: "7pm" }] },
      { ...event, sessions: [{ ...session, places: 0 }] },
      { ...event, sessions: [{ ...session, places: 1001 }] },
      { ...event, sessions: [{ ...session, places: 2.5 }] },
      { ...event, sessions: [{ ...session, role: "Steward (12D)" }] },
      { ...event, name: "  " },
    ]) {
      expect(newEventPayload.safeParse(bad).success).toBe(false);
    }
  });

  it("a change to a session names it; the details are each kind's own", () => {
    const ok = (x: unknown) => clientRequestInput.safeParse(x).success;
    expect(ok({ kind: "more_places", shiftId: SHIFT, payload: { places: 4 } })).toBe(true);
    expect(ok({ kind: "more_places", payload: { places: 4 } })).toBe(false); // which session?
    expect(ok({ kind: "more_places", shiftId: SHIFT, payload: { places: 0 } })).toBe(false);
    expect(ok({ kind: "more_places", shiftId: SHIFT, payload: { places: 201 } })).toBe(false);
    expect(ok({ kind: "fewer_places", shiftId: SHIFT, payload: { places: 2 } })).toBe(true);
    expect(
      ok({
        kind: "new_times",
        shiftId: SHIFT,
        payload: { date: "2026-11-14", start: "12:00", end: "19:00" },
      }),
    ).toBe(true);
    expect(
      ok({ kind: "new_times", shiftId: SHIFT, payload: { start: "12:00", end: "19:00" } }),
    ).toBe(false);
    expect(ok({ kind: "cancel_session", shiftId: SHIFT, payload: {} })).toBe(true);
    expect(ok({ kind: "cancel_session", shiftId: SHIFT, payload: { places: 1 } })).toBe(false);
    expect(ok({ kind: "other", payload: { text: "Can we talk about December?" } })).toBe(true);
    expect(ok({ kind: "other", payload: { text: "" } })).toBe(false);
    expect(ok({ kind: "everything", payload: {} })).toBe(false);
    // A blank note is no note.
    const parsed = clientRequestInput.parse({
      kind: "other",
      payload: { text: "Hi" },
      note: "   ",
    });
    expect(parsed.note).toBeNull();
  });

  it("a stored payload is only used in its kind's shape", () => {
    expect(payloadOf("more_places", { places: 4 })).toEqual({ places: 4 });
    expect(payloadOf("more_places", { places: "4" })).toBeNull();
    expect(payloadOf("new_times", { places: 4 })).toBeNull();
    // Every kind has its schema, and the database's lists match.
    expect(Object.keys(PAYLOADS).sort()).toEqual([...CLIENT_REQUEST_KINDS].sort());
    expect([...CLIENT_REQUEST_STATUSES].sort()).toEqual(Object.keys(CLIENT_STATUS_WORDS).sort());
  });
});

describe("when a request is urgent (the rules, never the client)", () => {
  const facts = (f: Partial<UrgencyFacts>): UrgencyFacts => ({
    kind: "more_places",
    now: NOW,
    startsAt: later(100),
    booked: 0,
    free: 0,
    ...f,
  });

  it("it starts within 48 hours", () => {
    expect(CLIENT_URGENT_HOURS).toBe(48);
    expect(urgentWhy(facts({ startsAt: later(47) }))).toBe("starts_soon");
    expect(urgentWhy(facts({ startsAt: later(48) }))).toBe("starts_soon");
    expect(urgentWhy(facts({ startsAt: later(48.01) }))).toBeNull();
    // Under way or over: too late to be "soon" (the office declines it).
    expect(urgentWhy(facts({ startsAt: later(-1) }))).toBeNull();
    expect(urgentWhy(facts({ kind: "new_event", startsAt: later(20) }))).toBe("starts_soon");
    expect(urgentWhy(facts({ kind: "other", startsAt: null }))).toBeNull();
    // New times asked for inside 48 hours, for a session further away now.
    expect(urgentWhy(facts({ kind: "new_times", newStartsAt: later(30) }))).toBe("starts_soon");
  });

  it("it takes places or hours from casuals already booked", () => {
    // 2 fewer with 3 free: nobody booked loses out.
    expect(urgentWhy(facts({ kind: "fewer_places", places: 2, free: 3, booked: 5 }))).toBeNull();
    expect(urgentWhy(facts({ kind: "fewer_places", places: 4, free: 3, booked: 5 }))).toBe(
      "affects_booked",
    );
    expect(urgentWhy(facts({ kind: "new_times", booked: 1 }))).toBe("affects_booked");
    expect(urgentWhy(facts({ kind: "new_times", booked: 0 }))).toBeNull();
    expect(urgentWhy(facts({ kind: "cancel_session", booked: 2 }))).toBe("affects_booked");
    expect(urgentWhy(facts({ kind: "cancel_session", booked: 0 }))).toBeNull();
    // More places never take anything away.
    expect(urgentWhy(facts({ kind: "more_places", booked: 9, free: 0, places: 4 }))).toBeNull();
  });
});

describe("what accepting does to the places (the mock-up's numbers)", () => {
  it("more places: 12 become 16, 9 booked, 7 to fill", () => {
    expect(placesChange("more_places", { headcount: 12, booked: 9 }, { places: 4 })).toEqual({
      before: { places: 12, booked: 9, toFill: 3 },
      after: { places: 16, booked: 9, toFill: 7 },
      cancels: 0,
    });
  });

  it("fewer places: the free ones first, then bookings, each cancelled with notice", () => {
    expect(placesChange("fewer_places", { headcount: 10, booked: 6 }, { places: 3 })).toEqual({
      before: { places: 10, booked: 6, toFill: 4 },
      after: { places: 7, booked: 6, toFill: 1 },
      cancels: 0,
    });
    expect(placesChange("fewer_places", { headcount: 10, booked: 9 }, { places: 3 })).toEqual({
      before: { places: 10, booked: 9, toFill: 1 },
      after: { places: 7, booked: 7, toFill: 0 },
      cancels: 2,
    });
    // Down to none is cancelling the session.
    expect(placesChange("fewer_places", { headcount: 3, booked: 1 }, { places: 3 })).toBe(
      "last_place",
    );
  });

  it("cancel: every booking goes; new times: the places stay", () => {
    expect(placesChange("cancel_session", { headcount: 5, booked: 4 })).toEqual({
      before: { places: 5, booked: 4, toFill: 1 },
      after: { places: 0, booked: 0, toFill: 0 },
      cancels: 4,
    });
    expect(placesChange("new_times", { headcount: 5, booked: 4 })).toEqual({
      before: { places: 5, booked: 4, toFill: 1 },
      after: { places: 5, booked: 4, toFill: 1 },
      cancels: 0,
    });
    expect(placesChange("new_event", { headcount: 0, booked: 0 })).toBeNull();
  });
});

describe("the words", () => {
  const session = {
    role: "sia_steward",
    startsAt: new Date("2026-11-14T12:30:00Z"),
    site: "North Gate",
  };
  const tz = "Europe/London";

  it("each request in one line, numbers only", () => {
    expect(requestTitle({ kind: "more_places", payload: { places: 4 }, session }, tz)).toBe(
      "+4 places · SIA steward · North Gate · Sat 14 Nov 12:30",
    );
    expect(requestTitle({ kind: "fewer_places", payload: { places: 1 }, session }, tz)).toBe(
      "1 place fewer · SIA steward · North Gate · Sat 14 Nov 12:30",
    );
    expect(
      requestTitle(
        {
          kind: "new_times",
          payload: { date: "2026-11-14", start: "12:00", end: "19:00" },
          session,
        },
        tz,
      ),
    ).toBe("New times Sat 14 Nov 12:00–19:00 · SIA steward · North Gate · Sat 14 Nov 12:30");
    expect(requestTitle({ kind: "cancel_session", payload: {}, session }, tz)).toBe(
      "Cancel · SIA steward · North Gate · Sat 14 Nov 12:30",
    );
    expect(
      requestTitle(
        {
          kind: "new_event",
          payload: newEventPayload.parse({
            name: "Demo Rovers v City Demo",
            venue: { siteId: SITE },
            date: "2026-11-28",
            sessions: [
              { role: "steward", places: 80, start: "11:00", end: "18:00" },
              { role: "supervisor", places: 6, start: "11:00", end: "18:00" },
            ],
          }),
          session: null,
        },
        tz,
      ),
    ).toBe("New event: Demo Rovers v City Demo · Sat 28 Nov · 86 places");
    expect(requestTitle({ kind: "other", payload: { text: "x" }, session: null }, tz)).toBe(
      "Something else",
    );
    expect(KIND_WORDS.more_places).toBe("More places on a session");
  });

  it("the client's statuses and cover chips; a planner's to-do reads as accepted to them", () => {
    expect(CLIENT_STATUS_WORDS.done_in_planner).toBe("Accepted");
    expect(CLIENT_STATUS_WORDS.asked).toBe("Question for you");
    expect(coverWords({ toFill: 15, offering: false, cancelled: false })).toBe("15 to fill");
    expect(coverWords({ toFill: 15, offering: true, cancelled: false })).toBe("Offers going out");
    expect(coverWords({ toFill: 0, offering: false, cancelled: false })).toBe("Covered");
    expect(coverWords({ toFill: 2, offering: true, cancelled: true })).toBe("Cancelled");
    expect(plannerTabWords("AXLR8")).toBe("To do in AXLR8");
    expect(plannerTabWords(null)).toBe("To do in your planner");
    expect(sentWords("Acme Events", true)).toContain("treat it as urgent");
  });

  const firm = { name: "Acme Events", signOff: "Acme Events Shift Team" };
  it("the client's emails: the login link, and each answer, signed by the Shift Team", () => {
    const login = clientLoginLinkEmail(firm, "https://acme.example.test/client/l#tok");
    expect(login.subject).toBe("Your Acme Events client login link");
    expect(login.body).toContain("https://acme.example.test/client/l#tok");
    expect(login.body).toContain("It works for 15 minutes, once, and only for you.");
    expect(login.body.trim().endsWith("— Acme Events Shift Team")).toBe(true);

    const link = "https://acme.example.test/client/requests";
    const title = "+4 places · SIA steward · North Gate · Sat 14 Nov 12:30";
    const accepted = clientRequestAnswerEmail(firm, {
      answer: "accepted",
      title,
      words: null,
      link,
    });
    expect(accepted.subject).toBe("Acme Events accepted your request");
    expect(accepted.body).toBe(
      [
        "We've accepted your request:",
        title,
        `See your events and requests: ${link}`,
        "— Acme Events Shift Team",
      ].join("\n\n"),
    );
    const declined = clientRequestAnswerEmail(firm, {
      answer: "declined",
      title,
      words: "Under 24 hours: casuals are paid anyway.",
      link,
    });
    expect(declined.subject).toBe("Acme Events can't do your request");
    expect(declined.body).toContain("Why: Under 24 hours: casuals are paid anyway.");
    const asked = clientRequestAnswerEmail(firm, {
      answer: "asked",
      title,
      words: "Which gate do they report to?",
      link,
    });
    expect(asked.subject).toBe("Acme Events has a question about your request");
    expect(asked.body).toContain("Which gate do they report to?");
    expect(asked.body).toContain(`Reply on your requests page: ${link}`);
  });

  it("the office's notification and summary: the contract and the request, no casual", () => {
    expect(
      officeClientRequestPush({ contract: "Demo Stadium Ltd", title: "+4 places · Steward" }),
    ).toEqual({ title: "Urgent client request · Demo Stadium Ltd", body: "+4 places · Steward." });
    const base = {
      day: "Wed 11 Nov",
      mine: false,
      needs: [],
      moreNeeds: 0,
      took: 1,
      cancelled: 0,
      under48: 0,
      uploads: 0,
      link: "https://x.test/office/updates",
    };
    expect(officeSummaryEmail(firm, base).body).toContain(
      "Since 08:00 yesterday: 1 place taken, no cancellations, 0 uploads to check.",
    );
    expect(officeSummaryEmail(firm, { ...base, clientRequests: 2 }).body).toContain(
      "Since 08:00 yesterday: 1 place taken, no cancellations, 0 uploads to check, 2 client requests.",
    );
  });

  it("in Updates: needs action while it waits for the office, new until seen, with its button", () => {
    const u: ClientRequestUpdate = {
      kind: "client-request",
      at: NOW,
      requestId: SHIFT,
      requestKind: "more_places",
      status: "waiting",
      contract: "Demo Stadium Ltd",
      title: "+4 places · SIA steward · North Gate · Sat 14 Nov 12:30",
      urgent: "starts_soon",
    };
    expect(needsAction(u)).toBe(true);
    expect(needsAction({ ...u, status: "asked" })).toBe(false);
    expect(needsAction({ ...u, status: "done_in_planner" })).toBe(true);
    expect(isNew(u, null, false)).toBe(true);
    expect(isNew(u, later(1), false)).toBe(false);
    expect(isNew({ ...u, status: "done_in_planner" }, null, false)).toBe(false);
    expect(updateRow(u, NOW, "Europe/London")).toEqual({
      title: "Client request: +4 places · SIA steward · North Gate · Sat 14 Nov 12:30",
      line: "Demo Stadium Ltd · urgent · starts within 2 days",
      tone: "urgent",
      href: "/office/client-requests",
      action: { label: "Answer", href: `/office/client-requests?request=${SHIFT}` },
    });
    expect(
      updateRow({ ...u, status: "done_in_planner", urgent: null }, NOW, "Europe/London"),
    ).toMatchObject({
      line: "Demo Stadium Ltd · accepted: still to do in your planner",
      action: { label: "Mark done" },
    });
    expect(summaryLine(u, NOW, "Europe/London")).toBe(
      "A client request, urgent (Demo Stadium Ltd): +4 places · SIA steward · North Gate · Sat 14 Nov 12:30",
    );
  });

  it("'Tell me about: client requests' is a kind of its own, on by default", () => {
    expect(TELL_ME_KINDS).toContain("client_requests");
    expect(DEFAULT_TELL_ME).toContain("client_requests");
    expect(TELL_ME_ROWS.client_requests.title).toBe("Client requests");
  });
});

describe("the action log", () => {
  const names: Names = {
    worker: () => "Ann Booker",
    office: () => "Olu Office",
    client: () => "Priya Shah",
    contract: () => "Demo Stadium Ltd",
  };
  const say = (action: string, actorType: string, data: Record<string, unknown>) =>
    eventWords({ action, actorType, actorId: "a", data }, names);

  it("every client entry has its words and its group, and holds ids, kinds and counts only", () => {
    const actions = ALL_LOGGED_ACTIONS.filter(
      (a) => a.startsWith("client_request.") || a.startsWith("client_contact."),
    );
    expect(actions.length).toBe(13);
    for (const a of actions) {
      expect(logTypeLabel(a)).toBe("Client logins and requests");
      expect(say(a, "office", { contractId: SITE, kind: "more_places" })).not.toMatch(/^Recorded:/);
    }
    // Each entry's data as the code writes it passes the log's check.
    for (const data of [
      { contractId: SITE, kind: "new_event", urgent: true },
      {
        contractId: SITE,
        kind: "more_places",
        shiftId: SHIFT,
        from: 12,
        to: 16,
        offers: "offering",
      },
      { contractId: SITE, kind: "fewer_places", plannerToDo: true, owner: "planner" },
      { contractId: SITE, sessions: 1, links: 2 },
      { answerEventId: 123, answer: "declined" },
    ]) {
      expect(passesLogCheck(data)).toBe(true);
    }
  });

  it("in plain words, the client by name (theirs, never a casual's)", () => {
    expect(say("client_request.created", "client", { kind: "more_places", urgent: true })).toBe(
      "Priya Shah (Demo Stadium Ltd) asked for more places: urgent.",
    );
    expect(
      say("client_request.accepted", "office", {
        kind: "fewer_places",
        from: 10,
        to: 7,
        cancelled: 2,
      }),
    ).toBe(
      "Olu Office accepted a client's request for fewer places: 10 places became 7 (2 bookings cancelled with notice).",
    );
    expect(
      say("client_request.accepted", "office", {
        kind: "new_times",
        plannerToDo: true,
        owner: "planner",
      }),
    ).toBe(
      "Olu Office accepted a client's request for different times: it's on the to-do list for your planner.",
    );
    expect(say("client_request.accepted", "office", { kind: "new_event", sessions: 2 })).toBe(
      "Olu Office accepted a client's request for a new event: a new event with 2 sessions, hidden from casuals.",
    );
    expect(say("client_request.declined", "office", { kind: "cancel_session" })).toBe(
      "Olu Office declined a client's request for a session to be cancelled.",
    );
    expect(say("client_contact.switched_off", "office", { sessions: 2 })).toBe(
      "Olu Office switched off a client login on Demo Stadium Ltd and logged them out of 2 devices.",
    );
    expect(say("auth.login", "client", { kind: "client" })).toBe("Priya Shah logged in.");
    expect(say("auth.link_requested", "system", { kind: "client", matched: false })).toBe(
      "A client login link was asked for (an address we don't know).",
    );
    expect(say("client.removed", "office", { sites: 1, clientLogins: 2 })).toBe(
      "Olu Office removed a contract and its 2 client logins.",
    );
  });
});

describe("the limits on a client's requests and replies (M6)", () => {
  it("20 an hour each, per contact, and plain words when it's reached", () => {
    expect(LIMITS.clientRequestPerContact).toEqual({
      name: "client_request:contact",
      max: 20,
      windowMs: 3_600_000,
    });
    expect(LIMITS.clientReplyPerContact).toEqual({
      name: "client_reply:contact",
      max: 20,
      windowMs: 3_600_000,
    });
    expect(tooManyRequestsWords(1)).toBe(
      "Too many requests. Nothing was sent. Try again in 1 minute.",
    );
    expect(tooManyRequestsWords(25)).toBe(
      "Too many requests. Nothing was sent. Try again in 25 minutes.",
    );
    expect(tooManyRequestsWords(60)).toBe(
      "Too many requests. Nothing was sent. Try again in an hour.",
    );
  });

  it("the action log says whose limit it was", () => {
    const names: Names = {
      worker: () => "Ann Booker",
      office: () => "Olu Office",
      client: () => "Priya Shah",
      contract: () => "Demo Stadium Ltd",
    };
    for (const limit of ["client_request:contact", "client_reply:contact"]) {
      expect(
        eventWords(
          { action: "auth.rate_limited", actorType: "system", actorId: null, data: { limit } },
          names,
        ),
      ).toBe(
        "Too many client requests from one client login: sending them was paused for a while.",
      );
    }
  });
});

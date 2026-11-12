import { describe, expect, it } from "vitest";
import {
  blankLine,
  checkForm,
  FIELD_WORDS,
  FORM_ADDRESS_MAX,
  FORM_LINE_NOTES_MAX,
  FORM_MORE_MAX,
  FORM_NAME_MAX,
  FORM_NOTE_MAX,
  FORM_SESSIONS_MAX,
  FORM_TEXT_MAX,
  formUrgent,
  sendProblemErrors,
  zonedStart,
  type FormState,
  type SessionChoice,
} from "@/lib/client/form";
import {
  ADDRESS_MAX,
  CLIENT_NOTE_MAX,
  CLIENT_TEXT_MAX,
  clientRequestInput,
  EVENT_NAME_MAX,
  MORE_PLACES_MAX,
  NEW_EVENT_SESSIONS_MAX,
  SESSION_NOTES_MAX,
} from "@/lib/client/payloads";

// The client's request form (Phase 36.4; src/lib/client/form.ts): each problem next to its field
// before anything is sent, the request it makes is exactly what the server's zod schema takes, and
// the yellow box shows when the rules will find it urgent. NOW is Monday 2 November 2026, 09:00
// London (GMT).

const NOW = new Date("2026-11-02T09:00:00Z");
const TZ = "Europe/London";
const HOUR = 3_600_000;

const session = (o: Partial<SessionChoice> = {}): SessionChoice => ({
  shiftId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  label: "North Gate · Steward · Thu 5 Nov 12:30–19:30",
  startsAt: Date.parse("2026-11-05T12:30:00Z"),
  places: 12,
  booked: 9,
  date: "2026-11-05",
  start: "12:30",
  end: "19:30",
  ...o,
});
const blank = (o: Partial<FormState> = {}): FormState => ({
  kind: "",
  shiftId: "",
  places: "",
  date: "",
  start: "",
  end: "",
  text: "",
  note: "",
  name: "",
  venue: "",
  address: "",
  eventDate: "",
  lines: [blankLine()],
  ...o,
});
const opts = (sessions = [session()]) => ({ sessions, timeZone: TZ, now: NOW });
const sent = (r: ReturnType<typeof checkForm>) => {
  if (!r.ok) throw new Error(`not ok: ${JSON.stringify(r.errors)}`);
  // What the server checks it against.
  expect(clientRequestInput.safeParse(r.request).success).toBe(true);
  return r.request;
};

describe("the client's request form", () => {
  it("has the server's limits", () => {
    expect(FORM_NOTE_MAX).toBe(CLIENT_NOTE_MAX);
    expect(FORM_TEXT_MAX).toBe(CLIENT_TEXT_MAX);
    expect(FORM_SESSIONS_MAX).toBe(NEW_EVENT_SESSIONS_MAX);
    expect(FORM_MORE_MAX).toBe(MORE_PLACES_MAX);
    expect(FORM_NAME_MAX).toBe(EVENT_NAME_MAX);
    expect(FORM_ADDRESS_MAX).toBe(ADDRESS_MAX);
    expect(FORM_LINE_NOTES_MAX).toBe(SESSION_NOTES_MAX);
  });

  it("asks what they need, and which session", () => {
    expect(checkForm(blank(), opts())).toEqual({ ok: false, errors: { kind: FIELD_WORDS.kind } });
    const r = checkForm(blank({ kind: "more_places", places: "4" }), opts());
    expect(r).toEqual({ ok: false, errors: { shiftId: FIELD_WORDS.shiftId } });
  });

  it("more places: 1 to 200, with the note", () => {
    for (const places of ["", "0", "201", "2.5", "four"]) {
      const r = checkForm(
        blank({ kind: "more_places", shiftId: session().shiftId, places }),
        opts(),
      );
      expect(r).toEqual({ ok: false, errors: { places: FIELD_WORDS.morePlaces } });
    }
    expect(
      sent(
        checkForm(
          blank({
            kind: "more_places",
            shiftId: session().shiftId,
            places: " 4 ",
            note: " Category B. ",
          }),
          opts(),
        ),
      ),
    ).toEqual({
      kind: "more_places",
      shiftId: session().shiftId,
      payload: { places: 4 },
      note: "Category B.",
    });
  });

  it("fewer places: fewer than the session has (none is cancelling it)", () => {
    const r = checkForm(
      blank({ kind: "fewer_places", shiftId: session().shiftId, places: "12" }),
      opts(),
    );
    expect(r).toEqual({ ok: false, errors: { places: FIELD_WORDS.fewerPlaces(11) } });
    expect(FIELD_WORDS.fewerPlaces(11)).toBe(
      "Type how many fewer, from 1 to 11. To have none, cancel the session.",
    );
    expect(
      sent(
        checkForm(
          blank({ kind: "fewer_places", shiftId: session().shiftId, places: "11" }),
          opts(),
        ),
      ),
    ).toMatchObject({ kind: "fewer_places", payload: { places: 11 } });
  });

  it("new times: a date and two times, not passed and not the same as now", () => {
    const base = { kind: "new_times" as const, shiftId: session().shiftId };
    expect(checkForm(blank(base), opts())).toEqual({
      ok: false,
      errors: { date: FIELD_WORDS.date, start: FIELD_WORDS.start, end: FIELD_WORDS.end },
    });
    expect(
      checkForm(blank({ ...base, date: "2026-11-05", start: "12:30", end: "19:30" }), opts()),
    ).toEqual({ ok: false, errors: { start: FIELD_WORDS.sameTimes } });
    expect(
      checkForm(blank({ ...base, date: "2026-11-01", start: "12:00", end: "18:00" }), opts()),
    ).toEqual({ ok: false, errors: { start: FIELD_WORDS.past } });
    // A finish before the start is the next day: fine.
    expect(
      sent(checkForm(blank({ ...base, date: "2026-11-05", start: "20:00", end: "02:00" }), opts())),
    ).toEqual({
      kind: "new_times",
      shiftId: session().shiftId,
      payload: { date: "2026-11-05", start: "20:00", end: "02:00" },
    });
  });

  it("cancel a session, and something else (about a session, the event, or nothing)", () => {
    expect(
      sent(checkForm(blank({ kind: "cancel_session", shiftId: session().shiftId }), opts())),
    ).toEqual({ kind: "cancel_session", shiftId: session().shiftId, payload: {} });
    expect(checkForm(blank({ kind: "other" }), opts())).toEqual({
      ok: false,
      errors: { text: FIELD_WORDS.text },
    });
    expect(sent(checkForm(blank({ kind: "other", text: "Radios?" }), opts()))).toEqual({
      kind: "other",
      payload: { text: "Radios?" },
    });
    const eventId = session().eventId;
    expect(
      sent(checkForm(blank({ kind: "other", text: "Radios?" }), { ...opts(), eventId })),
    ).toEqual({
      kind: "other",
      eventId,
      payload: { text: "Radios?" },
    });
    expect(
      sent(
        checkForm(blank({ kind: "other", text: "Radios?", shiftId: session().shiftId }), opts()),
      ),
    ).toMatchObject({ shiftId: session().shiftId });
  });

  it("a new event: a name, a venue or an address, a date and 1 to 12 sessions, each problem by its line", () => {
    const r = checkForm(blank({ kind: "new_event", venue: "address", address: "x" }), opts());
    expect(r).toEqual({
      ok: false,
      errors: {
        name: FIELD_WORDS.name,
        address: FIELD_WORDS.address,
        eventDate: FIELD_WORDS.date,
        "line-0-role": FIELD_WORDS.role,
        "line-0-places": FIELD_WORDS.places,
        "line-0-start": FIELD_WORDS.start,
        "line-0-end": FIELD_WORDS.end,
      },
    });
    const good = blank({
      kind: "new_event",
      name: "Demo Rovers v City Demo",
      venue: "33333333-3333-4333-8333-333333333333",
      eventDate: "2026-11-28",
      lines: [
        { role: "steward", places: "12", start: "12:30", end: "19:30", notes: "North Gate" },
        { role: "steward", places: "4", start: "14:00", end: "20:00", notes: "" },
      ],
    });
    expect(sent(checkForm(good, opts()))).toEqual({
      kind: "new_event",
      payload: {
        name: "Demo Rovers v City Demo",
        venue: { siteId: "33333333-3333-4333-8333-333333333333" },
        date: "2026-11-28",
        sessions: [
          { role: "steward", places: 12, start: "12:30", end: "19:30", notes: "North Gate" },
          { role: "steward", places: 4, start: "14:00", end: "20:00" },
        ],
      },
    });
    expect(
      sent(checkForm({ ...good, venue: "address", address: "1 Demo Road, ZZ1 4AA" }, opts())),
    ).toMatchObject({ payload: { venue: { address: "1 Demo Road, ZZ1 4AA" } } });
    // A session that has started already.
    expect(
      checkForm(
        { ...good, eventDate: "2026-11-02", lines: [{ ...good.lines[0]!, start: "08:00" }] },
        opts(),
      ),
    ).toEqual({ ok: false, errors: { "line-0-start": FIELD_WORDS.past } });
  });

  it("a note over 1,000 characters is marked", () => {
    const r = checkForm(
      blank({ kind: "cancel_session", shiftId: session().shiftId, note: "x".repeat(1001) }),
      opts(),
    );
    expect(r).toEqual({ ok: false, errors: { note: FIELD_WORDS.note } });
  });

  it("the server's answers land next to their fields", () => {
    expect(sendProblemErrors("same_times", "new_times")).toEqual({ start: FIELD_WORDS.sameTimes });
    expect(sendProblemErrors("in_past", "new_event")).toEqual({ eventDate: FIELD_WORDS.past });
    expect(sendProblemErrors("not_found", "more_places")).toHaveProperty("shiftId");
    expect(sendProblemErrors("error", "more_places")).toEqual({});
  });
});

describe("the yellow box (urgent by the rules)", () => {
  it("a session starting within 48 hours", () => {
    const soon = session({ startsAt: NOW.getTime() + 30 * HOUR, booked: 0 });
    const later = session({ startsAt: NOW.getTime() + 72 * HOUR, booked: 0 });
    const s = blank({ kind: "more_places", shiftId: soon.shiftId, places: "2" });
    expect(formUrgent(s, opts([soon]))).toBe("starts_soon");
    expect(formUrgent(s, opts([later]))).toBeNull();
    expect(formUrgent(blank({ kind: "more_places" }), opts([soon]))).toBeNull();
  });

  it("taking places or hours from casuals booked", () => {
    const later = session({ startsAt: NOW.getTime() + 72 * HOUR, places: 12, booked: 9 });
    // 3 free: 3 fewer reaches no one, 4 fewer does.
    const fewer = (places: string) =>
      formUrgent(blank({ kind: "fewer_places", shiftId: later.shiftId, places }), opts([later]));
    expect(fewer("3")).toBeNull();
    expect(fewer("4")).toBe("affects_booked");
    expect(
      formUrgent(blank({ kind: "cancel_session", shiftId: later.shiftId }), opts([later])),
    ).toBe("affects_booked");
    const none = session({ startsAt: NOW.getTime() + 72 * HOUR, booked: 0 });
    expect(
      formUrgent(blank({ kind: "cancel_session", shiftId: none.shiftId }), opts([none])),
    ).toBeNull();
  });

  it("new times asked for within 48 hours, and a new event's first session", () => {
    const later = session({ startsAt: NOW.getTime() + 96 * HOUR, booked: 0 });
    expect(
      formUrgent(
        blank({
          kind: "new_times",
          shiftId: later.shiftId,
          date: "2026-11-03",
          start: "10:00",
          end: "12:00",
        }),
        opts([later]),
      ),
    ).toBe("starts_soon");
    const event = (eventDate: string) =>
      formUrgent(
        blank({
          kind: "new_event",
          eventDate,
          lines: [{ role: "steward", places: "2", start: "10:00", end: "16:00", notes: "" }],
        }),
        opts([]),
      );
    expect(event("2026-11-03")).toBe("starts_soon");
    expect(event("2026-11-10")).toBeNull();
  });

  it("reads dates and times in the firm's zone (London in summer is an hour ahead)", () => {
    expect(zonedStart("2026-07-01", "09:00", TZ)?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedStart("2026-02-30", "09:00", TZ)).toBeNull();
    expect(zonedStart("2026-07-01", "25:00", TZ)).toBeNull();
  });
});

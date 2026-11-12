"use client";

import Link from "next/link";
import { useId, useState, useTransition, type ReactNode } from "react";
import { btn, field, hint, label, staffChoice } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { useHydrated } from "@/app/use-hydrated";
import { tooManyRequestsWords } from "@/lib/client/words";
import {
  blankLine,
  checkForm,
  FORM_MORE_MAX,
  FORM_NOTE_MAX,
  FORM_SESSIONS_MAX,
  formUrgent,
  sendProblemErrors,
  sendProblemText,
  SESSION_FORM_KINDS,
  type FieldErrors,
  type FormKind,
  type FormState,
  type SessionChoice,
} from "@/lib/client/form";
import { sendClientRequestAction, type SendResult } from "../../../actions";

// "Ask for a change" and "New request" (Phase 36.4; the approved mock-up's phone form;
// docs/screens.md "## Phase 36", "36.3 and 36.4 screens"): "What do you need?" as choice cards, then
// that kind's fields (which session, how many, the new times, what else; or a new event's name,
// venue, date and 1 to 12 sessions), "Why (optional)", the yellow box when the rules will find it
// urgent, and "Send to {firm}". Each problem shows next to its field before anything is sent
// (src/lib/client/form.ts); the server checks it all again with the contact's own contract. Sent:
// "Sent to {firm}. You'll get an answer here and by email." Waits for the page to be ready.

export interface FormWords {
  kinds: Record<FormKind, string>;
  firmName: string;
  sent: { plain: string; urgent: string };
  // The yellow box's title and words, by why it's urgent.
  urgent: Record<"starts_soon" | "affects_booked", { title: string; text: string }>;
}

const Problem = ({ id, text }: { id: string; text: string | undefined }) =>
  text ? (
    <p id={id} className="mt-1 font-semibold text-urgent-ink">
      {text}
    </p>
  ) : null;

function Field({
  id,
  name,
  words,
  error,
  hintText,
  children,
}: {
  id: string;
  name: string;
  words: string;
  error: string | undefined;
  hintText?: string;
  children: (a: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const fieldId = `${id}-${name}`;
  const described = [error ? `${fieldId}-problem` : null, hintText ? `${fieldId}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className={label}>
        {words}
      </label>
      {hintText && (
        <p id={`${fieldId}-hint`} className={hint}>
          {hintText}
        </p>
      )}
      {children({
        id: fieldId,
        "aria-invalid": Boolean(error),
        ...(described ? { "aria-describedby": described } : {}),
      })}
      <Problem id={`${fieldId}-problem`} text={error} />
    </div>
  );
}

export function RequestForm({
  kinds,
  initialKind,
  sessions,
  initialSession,
  venues,
  roles,
  timeZone,
  eventId,
  words,
}: {
  kinds: FormKind[];
  initialKind: FormKind | "";
  sessions: SessionChoice[];
  initialSession: string;
  venues: { siteId: string; name: string }[];
  roles: { code: string; label: string }[];
  timeZone: string;
  eventId?: string;
  words: FormWords;
}) {
  const id = useId();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [s, setS] = useState<FormState>({
    kind: initialKind,
    shiftId: initialSession,
    places: "",
    date: "",
    start: "",
    end: "",
    text: "",
    note: "",
    name: "",
    venue: venues[0]?.siteId ?? "address",
    address: "",
    eventDate: "",
    lines: [blankLine()],
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<SendResult | null>(null);
  const set = (patch: Partial<FormState>) => setS((x) => ({ ...x, ...patch }));
  const session = sessions.find((x) => x.shiftId === s.shiftId) ?? null;
  // On the server and before the page is ready there's no "now" to compare with: no yellow box.
  const urgent = ready ? formUrgent(s, { sessions, timeZone, now: new Date() }) : null;
  const fieldFor = (name: string) => ({ id, name, error: errors[name] });

  if (sent?.status === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <Slip tone="done" role="status" title="Sent">
          <p>{sent.urgent ? words.sent.urgent : words.sent.plain}</p>
        </Slip>
        <div className="flex flex-wrap gap-3">
          <Link href="/client/requests" className={btn.primary}>
            See your requests
          </Link>
          <Link href={eventId ? `/client/events/${eventId}` : "/client"} className={btn.secondary}>
            {eventId ? "Back to the event" : "Back to your events"}
          </Link>
        </div>
      </div>
    );
  }

  const isSessionKind = s.kind !== "" && SESSION_FORM_KINDS.includes(s.kind);
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        const checked = checkForm(s, { sessions, timeZone, now: new Date(), eventId });
        if (!checked.ok) {
          setErrors(checked.errors);
          setProblem("Nothing was sent. Check the fields marked.");
          return;
        }
        setErrors({});
        start(async () => {
          const r = await sendClientRequestAction(checked.request).catch((): SendResult => ({
            status: "error",
          }));
          if (r.status === "sent") {
            setSent(r);
            window.scrollTo({ top: 0 });
            return;
          }
          if (r.status === "rate_limited") {
            setProblem(tooManyRequestsWords(r.retryAfterMinutes));
            return;
          }
          setErrors(sendProblemErrors(r.status, s.kind));
          setProblem(sendProblemText(r.status));
        });
      }}
    >
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={errors.kind ? `${id}-kind-problem` : undefined}
      >
        <legend className={`${label} mb-2`}>What do you need?</legend>
        {kinds.map((k) => (
          <label key={k} className={`${staffChoice} cursor-pointer`}>
            <input
              disabled={!ready}
              type="radio"
              name="kind"
              value={k}
              checked={s.kind === k}
              onChange={() => {
                set({ kind: k });
                setErrors({});
                setProblem(null);
              }}
              className="size-5 shrink-0 accent-ink"
            />
            {words.kinds[k]}
          </label>
        ))}
        <Problem id={`${id}-kind-problem`} text={errors.kind} />
      </fieldset>

      {(isSessionKind || s.kind === "other") && (
        <Field
          {...fieldFor("shiftId")}
          words={s.kind === "other" ? "Which session? (optional)" : "Which session?"}
          hintText={
            session && s.kind !== "other"
              ? `It has ${session.places} ${session.places === 1 ? "place" : "places"}, ${session.booked} booked.`
              : undefined
          }
        >
          {(a) => (
            <select
              disabled={!ready}
              id={a.id}
              aria-invalid={a["aria-invalid"]}
              aria-describedby={a["aria-describedby"]}
              value={s.shiftId}
              onChange={(e) => set({ shiftId: e.target.value })}
              className={`${field} w-full`}
            >
              <option value="">
                {s.kind === "other" ? "No session in particular" : "Choose a session"}
              </option>
              {sessions.map((x) => (
                <option key={x.shiftId} value={x.shiftId}>
                  {x.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {(s.kind === "more_places" || s.kind === "fewer_places") && (
        <Field
          {...fieldFor("places")}
          words={s.kind === "more_places" ? "How many more?" : "How many fewer?"}
        >
          {(a) => (
            <input
              disabled={!ready}
              id={a.id}
              aria-invalid={a["aria-invalid"]}
              aria-describedby={a["aria-describedby"]}
              inputMode="numeric"
              value={s.places}
              onChange={(e) => set({ places: e.target.value })}
              maxLength={4}
              className={`${field} w-32`}
              placeholder={s.kind === "more_places" ? `1 to ${FORM_MORE_MAX}` : undefined}
            />
          )}
        </Field>
      )}

      {s.kind === "new_times" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field {...fieldFor("date")} words="Date">
            {(a) => (
              <input
                disabled={!ready}
                id={a.id}
                aria-invalid={a["aria-invalid"]}
                aria-describedby={a["aria-describedby"]}
                type="date"
                value={s.date}
                onChange={(e) => set({ date: e.target.value })}
                className={`${field} w-full`}
              />
            )}
          </Field>
          <Field {...fieldFor("start")} words="Start">
            {(a) => (
              <input
                disabled={!ready}
                id={a.id}
                aria-invalid={a["aria-invalid"]}
                aria-describedby={a["aria-describedby"]}
                type="time"
                value={s.start}
                onChange={(e) => set({ start: e.target.value })}
                className={`${field} w-full`}
              />
            )}
          </Field>
          <Field {...fieldFor("end")} words="Finish" hintText="Before the start: the next day.">
            {(a) => (
              <input
                disabled={!ready}
                id={a.id}
                aria-invalid={a["aria-invalid"]}
                aria-describedby={a["aria-describedby"]}
                type="time"
                value={s.end}
                onChange={(e) => set({ end: e.target.value })}
                className={`${field} w-full`}
              />
            )}
          </Field>
        </div>
      )}

      {s.kind === "cancel_session" && (
        <p className={hint}>
          If {words.firmName} accepts, the session is cancelled and anyone booked on it is told.
        </p>
      )}

      {s.kind === "other" && (
        <Field {...fieldFor("text")} words="What do you need?">
          {(a) => (
            <textarea
              disabled={!ready}
              id={a.id}
              aria-invalid={a["aria-invalid"]}
              aria-describedby={a["aria-describedby"]}
              rows={4}
              maxLength={FORM_NOTE_MAX}
              value={s.text}
              onChange={(e) => set({ text: e.target.value })}
              className={`${field} w-full`}
            />
          )}
        </Field>
      )}

      {s.kind === "new_event" && (
        <>
          <Field {...fieldFor("name")} words="The event's name">
            {(a) => (
              <input
                disabled={!ready}
                id={a.id}
                aria-invalid={a["aria-invalid"]}
                aria-describedby={a["aria-describedby"]}
                value={s.name}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={200}
                className={`${field} w-full`}
              />
            )}
          </Field>
          <Field {...fieldFor("venue")} words="Venue">
            {(a) => (
              <select
                disabled={!ready}
                id={a.id}
                aria-invalid={a["aria-invalid"]}
                aria-describedby={a["aria-describedby"]}
                value={s.venue}
                onChange={(e) => set({ venue: e.target.value })}
                className={`${field} w-full`}
              >
                {venues.map((v) => (
                  <option key={v.siteId} value={v.siteId}>
                    {v.name}
                  </option>
                ))}
                <option value="address">Somewhere else (type the address)</option>
              </select>
            )}
          </Field>
          {s.venue === "address" && (
            <Field {...fieldFor("address")} words="The venue's address">
              {(a) => (
                <textarea
                  disabled={!ready}
                  id={a.id}
                  aria-invalid={a["aria-invalid"]}
                  aria-describedby={a["aria-describedby"]}
                  rows={2}
                  maxLength={300}
                  value={s.address}
                  onChange={(e) => set({ address: e.target.value })}
                  className={`${field} w-full`}
                />
              )}
            </Field>
          )}
          <Field {...fieldFor("eventDate")} words="Date">
            {(a) => (
              <input
                disabled={!ready}
                id={a.id}
                aria-invalid={a["aria-invalid"]}
                aria-describedby={a["aria-describedby"]}
                type="date"
                value={s.eventDate}
                onChange={(e) => set({ eventDate: e.target.value })}
                className={`${field} w-full sm:w-56`}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className={`${label} mb-2`}>
              Sessions ({s.lines.length} of {FORM_SESSIONS_MAX})
            </legend>
            {s.lines.map((l, i) => {
              const line = (patch: Partial<typeof l>) =>
                set({ lines: s.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              const f = (name: string) => fieldFor(`line-${i}-${name}`);
              return (
                <div
                  key={i}
                  className="glass-tile grid gap-3 rounded-row p-3 sm:grid-cols-4"
                  data-line={i}
                >
                  <p className="font-semibold sm:col-span-4">Session {i + 1}</p>
                  <Field {...f("role")} words="Role">
                    {(a) => (
                      <select
                        disabled={!ready}
                        id={a.id}
                        aria-invalid={a["aria-invalid"]}
                        aria-describedby={a["aria-describedby"]}
                        value={l.role}
                        onChange={(e) => line({ role: e.target.value })}
                        className={`${field} w-full`}
                      >
                        <option value="">Choose a role</option>
                        {roles.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field {...f("places")} words="Places">
                    {(a) => (
                      <input
                        disabled={!ready}
                        id={a.id}
                        aria-invalid={a["aria-invalid"]}
                        aria-describedby={a["aria-describedby"]}
                        inputMode="numeric"
                        maxLength={4}
                        value={l.places}
                        onChange={(e) => line({ places: e.target.value })}
                        className={`${field} w-full`}
                      />
                    )}
                  </Field>
                  <Field {...f("start")} words="Start">
                    {(a) => (
                      <input
                        disabled={!ready}
                        id={a.id}
                        aria-invalid={a["aria-invalid"]}
                        aria-describedby={a["aria-describedby"]}
                        type="time"
                        value={l.start}
                        onChange={(e) => line({ start: e.target.value })}
                        className={`${field} w-full`}
                      />
                    )}
                  </Field>
                  <Field {...f("end")} words="Finish">
                    {(a) => (
                      <input
                        disabled={!ready}
                        id={a.id}
                        aria-invalid={a["aria-invalid"]}
                        aria-describedby={a["aria-describedby"]}
                        type="time"
                        value={l.end}
                        onChange={(e) => line({ end: e.target.value })}
                        className={`${field} w-full`}
                      />
                    )}
                  </Field>
                  <div className="sm:col-span-3">
                    <Field {...f("notes")} words="Location or notes (optional)">
                      {(a) => (
                        <input
                          disabled={!ready}
                          id={a.id}
                          aria-invalid={a["aria-invalid"]}
                          aria-describedby={a["aria-describedby"]}
                          maxLength={500}
                          value={l.notes}
                          onChange={(e) => line({ notes: e.target.value })}
                          className={`${field} w-full`}
                        />
                      )}
                    </Field>
                  </div>
                  {s.lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => set({ lines: s.lines.filter((_, j) => j !== i) })}
                      className={`${btn.text} self-end`}
                    >
                      Remove session {i + 1}
                    </button>
                  )}
                </div>
              );
            })}
            {s.lines.length < FORM_SESSIONS_MAX && (
              <button
                type="button"
                onClick={() => set({ lines: [...s.lines, blankLine()] })}
                className={`${btn.secondary} self-start`}
              >
                Add a session
              </button>
            )}
          </fieldset>
        </>
      )}

      {s.kind !== "" && (
        <Field {...fieldFor("note")} words="Why (optional)">
          {(a) => (
            <textarea
              disabled={!ready}
              id={a.id}
              aria-invalid={a["aria-invalid"]}
              aria-describedby={a["aria-describedby"]}
              rows={3}
              maxLength={FORM_NOTE_MAX}
              value={s.note}
              onChange={(e) => set({ note: e.target.value })}
              className={`${field} w-full`}
            />
          )}
        </Field>
      )}

      {urgent && (
        <Slip
          tone="attention"
          role="note"
          title={words.urgent[urgent].title}
          className="max-w-prose"
        >
          <p>{words.urgent[urgent].text}</p>
        </Slip>
      )}

      {problem && (
        <p role="alert" className="font-semibold text-urgent-ink">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={!ready || pending}
        className={`${btn.primary} w-full sm:w-auto sm:self-start`}
      >
        {pending ? "Sending…" : `Send to ${words.firmName}`}
      </button>
    </form>
  );
}

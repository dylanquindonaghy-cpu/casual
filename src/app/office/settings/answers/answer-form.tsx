"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { btn, field, hint, labelStack, meta } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { useHydrated } from "@/app/use-hydrated";
import { FILL_INS } from "@/lib/answers/fill-ins";
import { ANSWER_BODY_MAX, ANSWER_NAME_MAX, ANSWER_TEXT_PARTS_AT } from "@/lib/answers/limits";
import { previewAnswer } from "@/lib/answers/render";
import { ANSWER_ERRORS, ANSWER_NOTES, looksSignedByPerson } from "@/lib/answers/validate";
import { FORM, saveResultText, type SaveResult } from "@/lib/office/answers-copy";
import { resultBox } from "../../shifts/shift-tones";
import { saveAnswerAction } from "./actions";
import { AnswerWords } from "./answer-words";

const failed = { status: "error" as const };
type Field = "name" | "examples" | "body";

// Add and Edit an answer (Phase 35.3; docs/screens.md "## Phase 35", "Add and Edit"): its name, the
// ways casuals ask it (one a line), and the words, with the fill-ins picked from a fixed list
// (each button puts its {key} where the cursor is, never typed by hand) and, as it's written, what a
// casual would get, filled in with made-up examples (previewAnswer(): never a real casual's data).
// Saved with "Save and switch on" or "Save, keep off" (on Edit, the answer's current state can be
// kept: "Save, keep on" or "Save, keep off"); a problem shows under its field (ANSWER_ERRORS, the
// server's check). Under the words, two notes that never block a save (ANSWER_NOTES; the guardrails
// review, L1 and L3): words a text sends in several parts (over 300 characters as a casual would
// get them), and words that look signed by a person (golden rule 8). Saved, the list says so.
// Waits for the page (docs/ui-design.md).
export function AnswerForm({
  answer,
  example,
  signOff,
}: {
  answer: { id: string; name: string; examples: string[]; body: string; isOn: boolean } | null;
  example: string | null; // "Make this an answer": the casual's question
  signOff: string;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(answer?.name ?? "");
  const [examples, setExamples] = useState(answer ? answer.examples.join("\n") : (example ?? ""));
  const [body, setBody] = useState(answer?.body ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const words = useRef<HTMLTextAreaElement>(null);
  const ids = { name: useId(), examples: useId(), body: useId(), fillIns: useId() };

  // A fill-in's {key} where the cursor is (or at the end), the cursor after it.
  const insert = (key: string) => {
    const box = words.current;
    const token = `{${key}}`;
    const start = box?.selectionStart ?? body.length;
    const end = box?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    if (next.length > ANSWER_BODY_MAX) return;
    setBody(next);
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = (sw: "on" | "off" | "keep") =>
    startTransition(async () => {
      setMessage(null);
      const result: SaveResult = await saveAnswerAction({
        ...(answer ? { id: answer.id } : {}),
        name,
        examples,
        body,
        switch: sw,
      }).catch(() => failed);
      if (result.status === "saved") {
        router.push(`/office/settings/answers?saved=${result.id}`);
        return;
      }
      setErrors(result.status === "invalid" ? result.errors : {});
      setMessage(saveResultText(result));
      if (result.status === "logged_out") router.refresh();
    });

  const shown = body.trim() ? previewAnswer(body, { name, examples: examples.split("\n") }) : null;
  // As a casual would get them (fill-ins with their examples, the pay hint), else as written.
  const length = shown && "text" in shown ? shown.text.length : body.trim().length;
  const notes = [
    ...(length > ANSWER_TEXT_PARTS_AT ? [{ key: "long", text: ANSWER_NOTES.longText }] : []),
    ...(looksSignedByPerson(body) ? [{ key: "signed", text: ANSWER_NOTES.personSignOff }] : []),
  ];
  const on = answer?.isOn ?? false;
  const [mainLabel, mainSwitch, otherLabel, otherSwitch] = !answer
    ? [FORM.saveOn, "on", FORM.saveOff, "off"]
    : on
      ? [FORM.saveKeepOn, "keep", FORM.saveSwitchOff, "off"]
      : [FORM.saveOn, "on", FORM.saveOff, "keep"];
  const problem = (f: Field) =>
    errors[f] ? (
      <p id={`${ids[f]}-error`} className="text-sm font-semibold text-urgent-ink">
        {errors[f]}
      </p>
    ) : null;
  const describedBy = (f: Field) =>
    [`${ids[f]}-hint`, errors[f] ? `${ids[f]}-error` : null].filter(Boolean).join(" ");

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save(mainSwitch as "on" | "off" | "keep");
      }}
    >
      <div className="flex flex-col gap-1">
        <label className={labelStack}>
          {FORM.name}
          <input
            className={`${field} w-full`}
            value={name}
            maxLength={ANSWER_NAME_MAX}
            autoComplete="off"
            aria-describedby={describedBy("name")}
            aria-invalid={errors.name ? true : undefined}
            onChange={(e) => setName(e.target.value)}
            disabled={!ready}
          />
        </label>
        <p id={`${ids.name}-hint`} className={hint}>
          {FORM.nameHint}
        </p>
        {problem("name")}
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelStack}>
          {FORM.examples}
          <textarea
            className={`${field} w-full`}
            value={examples}
            rows={4}
            aria-describedby={describedBy("examples")}
            aria-invalid={errors.examples ? true : undefined}
            onChange={(e) => setExamples(e.target.value)}
            disabled={!ready}
          />
        </label>
        <p id={`${ids.examples}-hint`} className={hint}>
          {FORM.examplesHint}
        </p>
        {problem("examples")}
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelStack}>
          {FORM.body}
          <textarea
            ref={words}
            className={`${field} w-full`}
            value={body}
            rows={5}
            maxLength={ANSWER_BODY_MAX}
            aria-describedby={describedBy("body")}
            aria-invalid={errors.body ? true : undefined}
            onChange={(e) => setBody(e.target.value)}
            disabled={!ready}
          />
        </label>
        <p id={`${ids.body}-hint`} className={hint}>
          {FORM.bodyHint}
        </p>
        {problem("body")}
        <div aria-live="polite" className="flex flex-col gap-1">
          {notes.map((n) => (
            <p key={n.key} className={`${hint} font-semibold`} data-answer-note={n.key}>
              {n.text}
            </p>
          ))}
        </div>
        <div role="group" aria-labelledby={ids.fillIns} className="mt-2 flex flex-col gap-2">
          <p id={ids.fillIns} className={meta}>
            {FORM.fillIns}
          </p>
          <ul role="list" className="flex flex-wrap gap-2">
            {FILL_INS.map((f) => (
              <li key={f.key}>
                <button
                  type="button"
                  className={btn.small}
                  title={f.hint}
                  disabled={!ready}
                  onClick={() => insert(f.key)}
                >
                  <Icon name="plus" className="size-4" />
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section aria-labelledby={`${ids.body}-preview`} className="flex flex-col gap-2">
        <h2 id={`${ids.body}-preview`} className="font-semibold text-ink">
          {FORM.preview}
        </h2>
        {body.trim() && <AnswerWords body={body} />}
        <div className="rounded-row border border-done-line bg-done-soft px-4 py-3 text-ink">
          {!shown ? (
            <p className="text-ink-muted">{FORM.previewEmpty}</p>
          ) : "text" in shown ? (
            <>
              <p className="break-words whitespace-pre-wrap" data-preview>
                {shown.text}
              </p>
              <p className="mt-1 text-sm text-ink-muted">Automatic reply. — {signOff}</p>
            </>
          ) : (
            <p className="font-semibold text-urgent-ink">{ANSWER_ERRORS.unknownFillIn}</p>
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" className={btn.primary} disabled={pending || !ready}>
          {mainLabel}
        </button>
        <button
          type="button"
          className={btn.secondary}
          disabled={pending || !ready}
          onClick={() => save(otherSwitch as "on" | "off" | "keep")}
        >
          {otherLabel}
        </button>
      </div>
      {message && (
        <p role="status" className={`${resultBox} self-start`}>
          {message}
        </p>
      )}
    </form>
  );
}

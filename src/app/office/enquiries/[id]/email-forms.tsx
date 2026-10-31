"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { btn, field, label, meta, notice } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { useHydrated } from "@/app/use-hydrated";
import {
  CLOSE_REASON_WORDS,
  closeResultText,
  EMAIL_DRAFT_NOTE,
  EMAIL_PAY_NO_DRAFT,
  EMAIL_REPLY_BUTTON,
  EMAIL_REPLY_LABEL,
  emailReplyHint,
  emailReplyResultText,
  type CloseOutcome,
  type EmailReplyOutcome,
} from "@/lib/office/enquiries-copy";
import { CLOSE_REASONS, EMAIL_REPLY_MAX, type CloseReason } from "@/lib/office/enquiry-rules";
import { closeEnquiryAction, replyToEmailAction } from "../actions";

// Answering an email to the staffing inbox that needs a person (P7.5; Phase 25.5; docs/screens.md
// "The staffing inbox in Enquiries"), as a message's (./enquiry-forms.tsx): "Reply by email", the box
// holding the AI's draft when there is one (to check and change: what goes is what they send), how
// it will go, "Close, no reply needed" (asking why first) and "Send reply by email". The server
// checks everything again. Once one is done the forms go and the answer stays while the page
// refreshes (beside Enquiries' list it goes to `stayOn`, as a message's does).

const failed = { status: "error" as const };

export function EmailForms({
  waiting,
  emailId,
  draft,
  pay,
  firstName,
  signOff,
  level = 2,
  stayOn,
}: {
  waiting: boolean;
  emailId: string;
  draft: string | null; // the AI's, to start from (never for pay)
  pay: boolean;
  firstName: string;
  signOff: string;
  level?: 2 | 3;
  stayOn?: string;
}) {
  const id = useId();
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(draft ?? "");
  const [reason, setReason] = useState<CloseReason | "">("");
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const reasonBox = useRef<HTMLSelectElement>(null);
  const off = !ready || pending;
  const H = level === 2 ? "h2" : "h3";
  const settle = (done: boolean, words: string) => {
    setMessage(words);
    if (done) {
      setFinished(true);
      if (stayOn && `${window.location.pathname}${window.location.search}` !== stayOn) {
        router.replace(stayOn, { scroll: false });
      } else router.refresh();
    }
  };
  if (!waiting && !finished) return null;
  const forms = (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r: EmailReplyOutcome = await replyToEmailAction(emailId, text).catch(
              () => failed,
            );
            settle(
              r.status === "queued" || r.status === "not_waiting",
              emailReplyResultText(r, firstName),
            );
          });
        }}
      >
        <label htmlFor={`${id}-reply`} className={label}>
          {EMAIL_REPLY_LABEL}
        </label>
        {draft !== null ? (
          <p id={`${id}-draft`} className={notice}>
            {EMAIL_DRAFT_NOTE}
          </p>
        ) : (
          pay && (
            <p id={`${id}-draft`} className={meta}>
              {EMAIL_PAY_NO_DRAFT}
            </p>
          )
        )}
        <textarea
          id={`${id}-reply`}
          aria-describedby={`${draft !== null || pay ? `${id}-draft ` : ""}${id}-hint`}
          className={`${field} w-full`}
          rows={6}
          maxLength={EMAIL_REPLY_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!ready}
        />
        <div className="flex flex-wrap items-center gap-3">
          <p id={`${id}-hint`} className={`${meta} mr-auto`}>
            {emailReplyHint(firstName, signOff)}
          </p>
          <div className="ml-auto flex flex-wrap justify-end gap-3">
            {!closing && (
              <button
                ref={closeButton}
                type="button"
                className={btn.secondary}
                disabled={off}
                onClick={() => {
                  setClosing(true);
                  requestAnimationFrame(() => reasonBox.current?.focus());
                }}
              >
                Close, no reply needed
              </button>
            )}
            <button type="submit" className={btn.primary} disabled={off || !text.trim()}>
              {EMAIL_REPLY_BUTTON}
              <Icon name="send" size={18} />
            </button>
          </div>
        </div>
      </form>
      {closing && (
        <form
          className="flex animate-in flex-wrap items-end gap-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason) return;
            startTransition(async () => {
              const r: CloseOutcome = await closeEnquiryAction(emailId, reason).catch(() => failed);
              settle(r.status === "closed" || r.status === "not_waiting", closeResultText(r));
            });
          }}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-reason`} className={label}>
              Why close it?
            </label>
            <select
              id={`${id}-reason`}
              ref={reasonBox}
              className={`${field} w-56`}
              value={reason}
              onChange={(e) => setReason(e.target.value as CloseReason)}
              disabled={!ready}
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {CLOSE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {CLOSE_REASON_WORDS[r]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={btn.secondary} disabled={off || !reason}>
            Close without a reply
          </button>
          <button
            type="button"
            className={btn.text}
            disabled={pending}
            onClick={() => {
              setClosing(false);
              setReason("");
              requestAnimationFrame(() => closeButton.current?.focus());
            }}
          >
            Keep it open
          </button>
        </form>
      )}
      <p role="status" className="font-semibold">
        {message}
      </p>
    </div>
  );
  return (
    <section aria-labelledby="answer" className="flex flex-col gap-3">
      <H id="answer" className="sr-only">
        Answer it
      </H>
      <div className="glass-tile rounded-inner p-4">
        {finished ? (
          <p role="status" className="font-semibold">
            {message}
          </p>
        ) : (
          forms
        )}
      </div>
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { btn, field, label, meta } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { useHydrated } from "@/app/use-hydrated";
import {
  CLOSE_REASON_WORDS,
  closeResultText,
  replyResultText,
  type CloseOutcome,
  type ReplyOutcome,
} from "@/lib/office/enquiries-copy";
import { CLOSE_REASONS, REPLY_MAX, type CloseReason } from "@/lib/office/enquiry-rules";
import { closeEnquiryAction, replyToEnquiryAction } from "../actions";

// Answering a message that needs a person (docs/office-v2.md 3.6; docs/screens.md
// `/office/enquiries/[id]`; 12D.1; Phase 24, 24.4: round 7 of the canvas): the reply box in clear
// glass, and under it how the reply will go ("Sent from your shifts line, by WhatsApp"), "Close, no
// reply needed" and "Send reply". Closing asks why first (the log keeps a reason): "Why close it?"
// from the fixed list, then "Close without a reply", or "Keep it open". The server checks
// everything again. Once one is done, the forms go and the answer stays; the page refreshes under
// it. This component draws the "Answer it" section itself (its heading for screen readers: the box
// says what it's for): the page passes whether the message is still waiting, and once it's
// answered here the section stays with its confirmation after the refresh (the page alone would
// drop it, the confirmation with it, as soon as it's no longer waiting). Beside Enquiries' list the
// page is given the address that keeps this message chosen (`stayOn`): once answered it goes there
// instead of refreshing, since the message may have been the list's first only until now, or may
// leave this view, and the pane would move on to another message and lose the confirmation. Waits
// for the page (docs/ui-design.md).

const failed = { status: "error" as const };

export function EnquiryForms({
  waiting,
  messageId,
  canReply,
  planLine,
  level = 2,
  stayOn,
}: {
  waiting: boolean; // still waiting for a person (the page's reading)
  messageId: string;
  canReply: boolean; // false: a withheld number, or texts off
  planLine: string;
  level?: 2 | 3; // the section heading's (h3 beside Enquiries' list)
  stayOn?: string; // beside Enquiries' list: the list with this message chosen
}) {
  const id = useId();
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
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
  // Plain markup, not a component defined in here (that would remount the fields on every key).
  const forms = (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r: ReplyOutcome = await replyToEnquiryAction(messageId, text).catch(() => failed);
            settle(r.status === "queued" || r.status === "not_waiting", replyResultText(r));
          });
        }}
      >
        {canReply && (
          <>
            <label htmlFor={`${id}-reply`} className="sr-only">
              Reply
            </label>
            <textarea
              id={`${id}-reply`}
              aria-describedby={`${id}-plan`}
              className={`${field} w-full`}
              rows={3}
              maxLength={REPLY_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!ready}
            />
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <p id={`${id}-plan`} className={`${meta} mr-auto`}>
            {planLine}
          </p>
          {/* The two buttons together, at the right (on a line of their own when it's narrow). */}
          <div className="ml-auto flex flex-wrap justify-end gap-3">
            {!closing && (
              <button
                ref={closeButton}
                type="button"
                className={btn.secondary}
                disabled={off}
                onClick={() => {
                  setClosing(true);
                  // Asked as soon as it opens.
                  requestAnimationFrame(() => reasonBox.current?.focus());
                }}
              >
                Close, no reply needed
              </button>
            )}
            {canReply && (
              <button type="submit" className={btn.primary} disabled={off || !text.trim()}>
                Send reply
                <Icon name="send" size={18} />
              </button>
            )}
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
              const r: CloseOutcome = await closeEnquiryAction(messageId, reason).catch(
                () => failed,
              );
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
              // Back to the button that opened it, once it's there again.
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

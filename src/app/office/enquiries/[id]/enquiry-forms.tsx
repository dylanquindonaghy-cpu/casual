"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { btn, card, field, h2, headingGap, label, meta, sectionGap } from "@/app/ui/classes";
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
// `/office/enquiries/[id]`; 12D.1): a reply in your own words (the line above the box says how it
// will go), or "Close without a reply" with a reason from the fixed list. The server checks
// everything again. Once one is done, both forms go and the answer stays; the page refreshes
// under it. This component draws the "Answer it" section itself: the page passes whether the
// message is still waiting, and once it's answered here the section stays with its confirmation
// after the refresh (the page alone would drop it, the confirmation with it, as soon as it's no
// longer waiting). Waits for the page (docs/ui-design.md).

const failed = { status: "error" as const };

export function EnquiryForms({
  waiting,
  messageId,
  canReply,
  planLine,
}: {
  waiting: boolean; // still waiting for a person (the page's reading)
  messageId: string;
  canReply: boolean; // false: a withheld number, or texts off
  planLine: string;
}) {
  const id = useId();
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [reason, setReason] = useState<CloseReason | "">("");
  const [message, setMessage] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const off = !ready || pending;
  const settle = (done: boolean, words: string) => {
    setMessage(words);
    if (done) {
      setFinished(true);
      router.refresh();
    }
  };
  if (!waiting && !finished) return null;
  // Plain markup, not a component defined in here (that would remount the fields on every key).
  const forms = (
    <div className="mt-3 flex flex-col gap-6">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r: ReplyOutcome = await replyToEnquiryAction(messageId, text).catch(() => failed);
            settle(r.status === "queued" || r.status === "not_waiting", replyResultText(r));
          });
        }}
      >
        <label htmlFor={`${id}-reply`} className={label}>
          Reply
        </label>
        <p className={meta}>{planLine}</p>
        {canReply && (
          <>
            <textarea
              id={`${id}-reply`}
              className={`${field} w-full`}
              rows={3}
              maxLength={REPLY_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!ready}
            />
            <div>
              <button type="submit" className={btn.primary} disabled={off || !text.trim()}>
                Send reply
              </button>
            </div>
          </>
        )}
      </form>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason) return;
          startTransition(async () => {
            const r: CloseOutcome = await closeEnquiryAction(messageId, reason).catch(() => failed);
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
      </form>
      <p role="status" className="font-semibold">
        {message}
      </p>
    </div>
  );
  return (
    <section aria-labelledby="answer" className={sectionGap.office}>
      <h2 id="answer" className={h2}>
        Answer it
      </h2>
      <div className={`${card} ${headingGap}`}>
        {finished ? (
          <p role="status" className="mt-3 font-semibold">
            {message}
          </p>
        ) : (
          forms
        )}
      </div>
    </section>
  );
}

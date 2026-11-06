import Link from "next/link";
import type { ReactNode } from "react";
import { btn, emptyBox, nums } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { withLinks } from "@/app/ui/with-links";
import {
  FROM_WORDS,
  MESSAGES_EMPTY,
  MESSAGES_INTRO,
  PAY_QUERY_NOTE,
} from "@/lib/portal/messages-copy";
import type { Thread, ThreadItem } from "@/lib/portal/messages";
import { soonLabel, timeOnDay } from "@/lib/portal/format";
import { localDateOf } from "@/lib/time/zoned";

// Messages (P8; Phase 25.6; docs/screens.md "Messages: the in-app chat"): her messages to the
// office and their answers, oldest first: hers on the right in the firm's colour, the answers on
// the left in glass, each with its time and (an answer) who it's from; a link back to the firm's
// own address in an answer is a link. The form to write sits at the foot (`composer`). Pure and
// hook-free (page.tsx reads the thread), so the plain-language test renders every state. Phase
// 28.6: the bubbles take the office's 12px section corner, and "No messages yet." the empty box.
// Phase 29.1: under one of hers that went to payroll as a pay query, "Sent to payroll. See it on
// your Pay page" (a 44px link to /pay, where payroll's answer comes).

// "09:14" today, "09:14 on Mon 2 Nov" before.
export const messageTime = (at: Date, now: Date, timeZone: string) =>
  localDateOf(at, timeZone) === localDateOf(now, timeZone)
    ? soonLabel(at, now, timeZone)
    : timeOnDay(at, timeZone);

function Bubble({
  item,
  now,
  timeZone,
  linkOrigin,
}: {
  item: ThreadItem;
  now: Date;
  timeZone: string;
  linkOrigin: string;
}) {
  const text = item.text ?? "(A photo or file, with no text.)";
  const bubble = (
    <div
      className={`max-w-[85%] rounded-inner px-4 py-3 ${
        item.mine ? "glass-tint" : "glass-button text-ink"
      }`}
    >
      <p className="sr-only">
        {item.mine ? "You wrote:" : `${FROM_WORDS[item.from ?? "office"]}:`}
      </p>
      <p className="break-words whitespace-pre-wrap">
        {item.mine ? text : withLinks(text, linkOrigin, "as_needed")}
      </p>
      <p className={`mt-1 text-sm ${nums} ${item.mine ? "opacity-85" : "text-ink-muted"}`}>
        {item.from ? <span aria-hidden="true">{FROM_WORDS[item.from]} · </span> : null}
        {messageTime(item.at, now, timeZone)}
      </p>
    </div>
  );
  return (
    <li className={`flex ${item.mine ? "justify-end" : "justify-start"}`} data-mine={item.mine}>
      {item.toPayroll ? (
        // Sent to payroll (Phase 29.1): the note and its link under the bubble, on her side.
        <div className="flex w-full flex-col items-end" data-to-payroll>
          {bubble}
          <p className="mt-1 max-w-[85%] text-right text-ink-muted">
            {PAY_QUERY_NOTE.before}
            <Link href="/pay" className={btn.link}>
              {PAY_QUERY_NOTE.link}
            </Link>
          </p>
        </div>
      ) : (
        bubble
      )}
    </li>
  );
}

export function MessagesView({
  thread,
  now,
  timeZone,
  linkOrigin,
  composer,
  intro = MESSAGES_INTRO,
}: {
  thread: Thread;
  now: Date;
  timeZone: string;
  linkOrigin: string;
  composer: ReactNode;
  // Opened from Pay (28.10's about=pay): MESSAGES_INTRO_PAY, as the message goes to payroll (29.1).
  intro?: string;
}) {
  return (
    <>
      <PageHeader title="Messages">
        <p className="mt-2">{intro}</p>
      </PageHeader>
      {thread.items.length === 0 ? (
        <p className={emptyBox}>{MESSAGES_EMPTY}</p>
      ) : (
        <ol role="list" aria-label="Your messages" className="space-y-3">
          {thread.items.map((item) => (
            <Bubble
              key={item.id}
              item={item}
              now={now}
              timeZone={timeZone}
              linkOrigin={linkOrigin}
            />
          ))}
        </ol>
      )}
      <div className="mt-6">{composer}</div>
    </>
  );
}

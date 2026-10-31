import type { ReactNode } from "react";
import { meta, nums } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { withLinks } from "@/app/ui/with-links";
import { FROM_WORDS, MESSAGES_EMPTY, MESSAGES_INTRO } from "@/lib/portal/messages-copy";
import type { Thread, ThreadItem } from "@/lib/portal/messages";
import { soonLabel, timeOnDay } from "@/lib/portal/format";
import { localDateOf } from "@/lib/time/zoned";

// Messages (P8; Phase 25.6; docs/screens.md "Messages: the in-app chat"): her messages to the
// office and their answers, oldest first: hers on the right in the firm's colour, the answers on
// the left in glass, each with its time and (an answer) who it's from; a link back to the firm's
// own address in an answer is a link. The form to write sits at the foot (`composer`). Pure and
// hook-free (page.tsx reads the thread), so the plain-language test renders every state.

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
  return (
    <li className={`flex ${item.mine ? "justify-end" : "justify-start"}`} data-mine={item.mine}>
      <div
        className={`max-w-[85%] rounded-[1.25rem] px-4 py-3 ${
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
    </li>
  );
}

export function MessagesView({
  thread,
  now,
  timeZone,
  linkOrigin,
  composer,
}: {
  thread: Thread;
  now: Date;
  timeZone: string;
  linkOrigin: string;
  composer: ReactNode;
}) {
  return (
    <>
      <PageHeader title="Messages">
        <p className="mt-2">{MESSAGES_INTRO}</p>
      </PageHeader>
      {thread.items.length === 0 ? (
        <p className={meta}>{MESSAGES_EMPTY}</p>
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

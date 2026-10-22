import Link from "next/link";
import { meta, nums } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { StatusChip } from "@/app/ui/status-chip";
import type { EnquiryRow } from "@/lib/office/enquiries";
import {
  CHANNEL_WORDS,
  OUTCOME_TONES,
  OUTCOME_WORDS,
  PAY_LOCK,
  whoName,
} from "@/lib/office/enquiries-copy";
import { timeOnDay } from "@/lib/portal/format";
import { cutChars } from "@/lib/text/cut";

// One enquiry in a list (Enquiries, and the dashboard's latest four): who sent it, by which
// channel, the outcome chip and when; their words in quotes; on the dashboard, the first line of
// the reply they got. The name opens the message's own page.

// Their words, on one line and cut short for the list (the full text is on the message's page).
export const preview = (text: string | null) => {
  if (text === null) return null;
  const line = text.replace(/\s+/g, " ").trim();
  // Cut between characters, never inside an emoji (13.5).
  const cut = cutChars(line, 140);
  return cut === line ? line : `${cutChars(line, 139)}…`;
};

export function EnquiryItem({
  r,
  timeZone,
  reply,
}: {
  r: EnquiryRow;
  timeZone: string;
  reply?: string | null; // the dashboard: the first line of the reply (null: none yet)
}) {
  const words = preview(r.text);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icon name={r.channel} className="shrink-0 text-ink-muted" />
        <span className="sr-only">{CHANNEL_WORDS[r.channel]}:</span>
        <Link
          href={`/office/enquiries/${r.messageId}`}
          className="press font-semibold underline-offset-4 hover:underline"
        >
          {whoName(r.who)}
        </Link>
        <StatusChip tone={OUTCOME_TONES[r.outcome]}>{OUTCOME_WORDS[r.outcome]}</StatusChip>
        <span className={`${meta} ${nums} ml-auto`}>{timeOnDay(r.at, timeZone)}</span>
      </div>
      <p className="mt-1 break-words">
        {words === null ? (
          <span className="text-ink-muted">
            {r.channel === "voice"
              ? "(A voicemail we couldn't turn into text.)"
              : "(A photo or file, with no text.)"}
          </span>
        ) : (
          <>“{words}”</>
        )}
      </p>
      {reply !== undefined && (
        <p className={`${meta} mt-1 break-words`}>
          {reply === null ? "No reply yet." : <>Reply: {preview(reply)}</>}
        </p>
      )}
      {r.outcome === "pay" && <p className={`${meta} mt-1`}>{PAY_LOCK}</p>}
    </li>
  );
}

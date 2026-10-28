import { nums } from "@/app/ui/classes";
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
import { PaneLink } from "./pane-link";

// One enquiry in Enquiries' list (Phase 24, 24.4: round 7 of the canvas): the channel's icon, who
// sent it and when, the outcome chip, their words in quotes (and, on a pay message, that pay is
// never answered by AI). The whole row is its name's link (./pane-link.tsx): on a phone to the
// message's own page, from 1024px picking it into the pane beside the list. The chosen row has a
// dark outline there (only there: a phone shows no message beside the list). Drawn on the server:
// only the link runs in the browser, given its addresses and the name it shows.

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
  paneHref,
  chosen,
}: {
  r: EnquiryRow;
  timeZone: string;
  paneHref: string; // this list with the message chosen
  chosen: boolean;
}) {
  const words = preview(r.text);
  return (
    <li
      className={`relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 rounded-row px-4 py-4 ${
        chosen
          ? "hover:bg-active lg:glass-button lg:outline-2 lg:-outline-offset-2 lg:outline-ink"
          : "hover:bg-active"
      }`}
    >
      <Icon name={r.channel} className="mt-1 shrink-0 text-ink-muted" />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="flex items-baseline gap-3">
          <span className="sr-only">{CHANNEL_WORDS[r.channel]}:</span>
          <PaneLink
            href={`/office/enquiries/${r.messageId}`}
            paneHref={paneHref}
            chosen={chosen}
            name={whoName(r.who)}
          />
          <span className={`ml-auto shrink-0 text-sm text-ink-muted ${nums}`}>
            {timeOnDay(r.at, timeZone)}
          </span>
        </p>
        <p>
          <StatusChip tone={OUTCOME_TONES[r.outcome]}>{OUTCOME_WORDS[r.outcome]}</StatusChip>
        </p>
        <p className="break-words">
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
        {r.outcome === "pay" && <p className="text-sm text-ink-muted">{PAY_LOCK}</p>}
      </div>
    </li>
  );
}

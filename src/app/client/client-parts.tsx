import Link from "next/link";
import { card, meta, nums, textLink } from "@/app/ui/classes";
import { StatusChip } from "@/app/ui/status-chip";
import { coverChipTone, coverTone, CLIENT_STATUS_TONES, sentWhen } from "@/lib/client/page-copy";
import type { ClientRequestView } from "@/lib/client/reads";
import { CLIENT_STATUS_WORDS, coverWords, requestTitle } from "@/lib/client/words";

// The client's pages' small parts (Phase 36.3, 36.4): the cover bar, a session's chip and one
// request in a list. Numbers only: nothing here can name a casual (none of it is given one).

const BAR: Record<"urgent" | "attention" | "done", string> = {
  urgent: "bg-urgent-fill",
  attention: "bg-attention-ink",
  done: "bg-done-ink",
};

// "71 of 86 booked" as a bar: red under half booked, amber short of full, green when covered. Its
// words are beside it, so the bar itself is decorative.
export function CoverBar({ booked, places }: { booked: number; places: number }) {
  const pct = places === 0 ? 100 : Math.min(100, Math.round((booked * 100) / places));
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line"
    >
      <span
        className={`block h-full rounded-full ${BAR[coverTone(booked, places)]}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function CoverChip(s: { toFill: number; offering: boolean; cancelled: boolean }) {
  return <StatusChip tone={coverChipTone(s)}>{coverWords(s)}</StatusChip>;
}

// One request in a list: its status, what was asked, when, and the office's answer or question.
export function RequestLine({
  r,
  firmName,
  now,
  timeZone,
  children,
}: {
  r: ClientRequestView;
  firmName: string;
  now: Date;
  timeZone: string;
  children?: React.ReactNode;
}) {
  const title = requestTitle(
    {
      kind: r.kind,
      payload: r.payload,
      session: r.session
        ? { role: r.session.role, startsAt: r.session.startsAt, site: r.session.site }
        : null,
    },
    timeZone,
  );
  return (
    <li className="flex flex-col gap-2 px-4 py-4" data-request={r.id}>
      <p className="flex flex-wrap items-center gap-2">
        <StatusChip tone={CLIENT_STATUS_TONES[r.status]}>
          {CLIENT_STATUS_WORDS[r.status]}
        </StatusChip>
        {r.urgent && r.status === "waiting" && <StatusChip tone="urgent">Urgent</StatusChip>}
        <span className={`${meta} ${nums} ml-auto`}>{sentWhen(r.createdAt, now, timeZone)}</span>
      </p>
      <p className="font-semibold break-words text-ink">{title}</p>
      {r.payload && "text" in r.payload && (
        <p className="break-words">&ldquo;{r.payload.text}&rdquo;</p>
      )}
      {r.note && <p className="break-words text-ink-muted">Your note: &ldquo;{r.note}&rdquo;</p>}
      {!r.byYou && <p className={meta}>Sent by a colleague on your contract.</p>}
      {r.officeAnswer && r.status === "declined" && (
        <p className="break-words">
          <b>Reason from {firmName}:</b> &ldquo;{r.officeAnswer}&rdquo;
        </p>
      )}
      {r.officeAnswer && (r.status === "accepted" || r.status === "done_in_planner") && (
        <p className="break-words">
          <b>{firmName}:</b> &ldquo;{r.officeAnswer}&rdquo;
        </p>
      )}
      {r.eventId && r.status !== "declined" && (
        <p>
          <Link href={`/client/events/${r.eventId}`} className={textLink}>
            Open the event
          </Link>
        </p>
      )}
      {children}
    </li>
  );
}

export const panel = `${card} flex flex-col gap-3`;

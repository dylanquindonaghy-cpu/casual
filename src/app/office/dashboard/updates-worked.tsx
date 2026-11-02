"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import {
  everyoneElseLabel,
  EVERYONE_ELSE,
  noShowLabel,
  updateLines,
  updateWhen,
  UPDATES_ALL,
  workedHeading,
  workedHref,
  workedLabel,
  workedWhen,
} from "@/lib/office/dashboard-map-copy";
import type { Update, WhoWorkedGroup } from "@/lib/office/dashboard-map";
import { initials } from "@/lib/office/board-copy";
import { attendanceResultText, restWorkedResultText } from "@/lib/office/shifts-copy";
import { checkStep } from "../../ui/classes";
import { Icon, type IconName } from "../../ui/icons";
import { markAttendanceAction, markRestWorkedAction } from "../shifts/actions";

// Round 8's Updates and Who worked? (Phase 26.2; the spec's dash-5 and dash-6). Updates: the last
// two days' places taken, casuals' cancellations (their notice, the strike, whether the place is
// open again), photos and certificates waiting for a check, and offers with no reply, newest first,
// each a link to where it's dealt with, and the action log for the rest (the full Updates page comes
// with 26.4). Who worked?: Needs attention's first sessions to mark, alike ones together (with the
// day), each person still booked by name with "Worked" and "Didn't attend" on their own session (the
// shift page's own actions: the server checks everything again and logs it), and "Everyone else
// worked" for the rest after a "Yes" (the shift page's own action, for each session in turn).

const TONE: Record<ReturnType<typeof updateLines>["tone"], { bg: string; icon: IconName }> = {
  done: { bg: "bg-done-tile text-done-ink", icon: "check" },
  urgent: { bg: "bg-urgent-tile text-urgent-ink", icon: "cancel" },
  attention: { bg: "bg-attention-soft text-attention-ink", icon: "clock" },
  wait: { bg: "bg-wait-tile text-wait-ink", icon: "profile" },
};

export function UpdatesList({
  items,
  now,
  timeZone,
}: {
  items: Update[];
  now: Date;
  timeZone: string;
}) {
  return (
    <>
      <ul role="list" className="mt-3 flex flex-col divide-y divide-line">
        {items.map((u, i) => {
          const l = updateLines(u, timeZone);
          const tone = TONE[l.tone];
          return (
            <li key={`${u.kind}-${u.at.getTime()}-${i}`} className="py-1 first:pt-0 last:pb-0">
              <Link
                href={l.href}
                className="press grid min-h-11 grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-row px-1 py-2 hover:bg-active"
              >
                <span
                  aria-hidden="true"
                  className={`flex size-8 items-center justify-center rounded-full ${tone.bg}`}
                >
                  <Icon name={tone.icon} size={15} />
                </span>
                <span className="min-w-0">
                  <b className="block font-medium text-ink">{l.title}</b>
                  <span className="block text-sm text-ink-muted">{l.line}</span>
                </span>
                <span className="text-xs whitespace-nowrap text-ink-faint tabular-nums">
                  {updateWhen(u.at, now, timeZone)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href="/office/log"
        className="press mt-2 flex min-h-11 w-full items-center justify-center gap-1 rounded-row text-sm text-ink-muted hover:bg-active hover:text-ink active:bg-button-press"
      >
        {UPDATES_ALL}
        <Icon name="chevron" size={16} />
      </Link>
    </>
  );
}

const failed = { status: "error" as const };

function Person({
  shiftId,
  workerId,
  name,
  when,
}: {
  shiftId: string;
  workerId: string;
  name: string;
  when: string; // the session's day and start, in the buttons' names
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const mark = (outcome: "completed" | "no_show") =>
    start(async () => {
      const result = await markAttendanceAction(shiftId, workerId, outcome).catch(() => failed);
      setMessage(attendanceResultText(result, name));
      if (result.status === "marked") router.refresh();
    });
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-ink-muted"
        >
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
        <button
          type="button"
          disabled={pending || !ready}
          aria-label={workedLabel(name, when)}
          onClick={() => mark("completed")}
          className="press-glass glass-button inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-ink hover:bg-button-hover active:bg-button-press disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="check" size={15} />
          Worked
        </button>
        <button
          type="button"
          disabled={pending || !ready}
          aria-label={noShowLabel(name, when)}
          onClick={() => mark("no_show")}
          className="press-glass glass-button inline-flex size-11 items-center justify-center rounded-full text-urgent hover:bg-button-hover active:bg-button-press disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      {message && (
        <p role="status" className="pl-12 text-sm text-ink-muted">
          {message}
        </p>
      )}
    </li>
  );
}

// Each session's answer in turn: the people marked in all, or the first that went wrong (the ones
// before it stay marked, and the page shows who's left).
type RestResult = Awaited<ReturnType<typeof markRestWorkedAction>> | typeof failed;
async function markEachRest(shiftIds: string[]): Promise<RestResult> {
  let count = 0;
  for (const id of shiftIds) {
    const result = await markRestWorkedAction(id).catch(() => failed);
    if (result.status !== "marked") return result;
    count += result.count;
  }
  return { status: "marked", count };
}

function EveryoneElse({ g, timeZone }: { g: WhoWorkedGroup; timeZone: string }) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const mark = () =>
    start(async () => {
      const result = await markEachRest(g.shiftIds);
      setMessage(restWorkedResultText(result));
      router.refresh();
    });
  return (
    <div className="pt-1">
      <details className="group">
        <summary
          aria-label={everyoneElseLabel(g, timeZone)}
          className="press flex min-h-11 cursor-pointer list-none items-center justify-center rounded-row text-sm text-ink-muted hover:bg-active hover:text-ink [&::-webkit-details-marker]:hidden"
        >
          {EVERYONE_ELSE}
        </summary>
        <div className={`mt-2 flex flex-col gap-3 ${checkStep}`}>
          <p className="text-sm">Only if they all worked it. You can change anyone afterwards.</p>
          <button
            type="button"
            disabled={pending || !ready}
            onClick={mark}
            className="press-glass glass-tint inline-flex min-h-11 items-center justify-center self-start rounded-full px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            Yes, everyone else worked
          </button>
        </div>
      </details>
      {message && (
        <p role="status" className="mt-2 text-sm text-ink-muted">
          {message}
        </p>
      )}
    </div>
  );
}

export function WhoWorkedList({
  groups,
  timeZone,
}: {
  groups: WhoWorkedGroup[];
  timeZone: string;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.shiftIds[0]} className="flex flex-col">
          <Link
            href={workedHref(g)}
            className="press flex min-h-11 items-center rounded-row px-1 text-xs text-ink-faint hover:text-ink"
          >
            {workedHeading(g, timeZone)}
          </Link>
          <ul role="list" className="flex flex-col divide-y divide-line">
            {g.people.map((p) => (
              <Person
                key={`${p.shiftId}-${p.workerId}`}
                shiftId={p.shiftId}
                workerId={p.workerId}
                name={p.name}
                when={workedWhen(g, timeZone)}
              />
            ))}
          </ul>
          {g.people.length > 1 && <EveryoneElse g={g} timeZone={timeZone} />}
        </div>
      ))}
    </div>
  );
}

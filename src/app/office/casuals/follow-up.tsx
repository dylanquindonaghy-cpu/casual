"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import {
  ADD_NOTE,
  CALL,
  MARK_SORTED,
  NOTE_HINT,
  noteResultText,
  REMIND,
  remindAllButton,
  REMINDED,
  remindResultText,
  sortedResultText,
} from "@/lib/office/follow-up-copy";
import { btn, field, hint } from "../../ui/classes";
import { Icon } from "../../ui/icons";
import { summaryButton } from "../shifts/[id]/chevron";
import { addNoteAction, markSortedAction, remindAction } from "./actions";

const failed = { status: "error" as const };

// Casuals' follow-up buttons (Phase 26.7, cas-4): "Remind" on a row and "Remind all N" (the
// licence message again, each checked and logged on the server: src/lib/office/casual-follow-up.ts),
// and a row's "…" menu: Call (their phone), Add a note (the office's words, kept with them) and
// Mark as sorted. Each answer stays where the button was, in a status region mounted from the start.
// They wait for the page.

function Answer({ text }: { text: string | null }) {
  return (
    <p role="status" className={text ? "basis-full text-sm text-ink-muted" : "sr-only"}>
      {text ?? ""}
    </p>
  );
}

export function RemindButton({ workerId, name }: { workerId: string; name: string }) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const remind = () =>
    start(async () => {
      const r = await remindAction([workerId]).catch(() => failed);
      setSaid(remindResultText(r));
      if (r.status === "done" && r.reminded > 0) {
        setDone(true);
        router.refresh();
      }
    });
  return (
    <>
      {done ? (
        <span className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-done-ink">
          <Icon name="check" size={14} />
          {REMINDED}
        </span>
      ) : (
        <button
          type="button"
          onClick={remind}
          disabled={pending || !ready}
          aria-label={`${REMIND}: ${name}`}
          className={btn.secondary}
        >
          <Icon name="messages" size={16} />
          {REMIND}
        </button>
      )}
      <Answer text={said} />
    </>
  );
}

export function RemindAll({ workerIds }: { workerIds: string[] }) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const remind = () =>
    start(async () => {
      const r = await remindAction(workerIds).catch(() => failed);
      setSaid(remindResultText(r));
      router.refresh();
    });
  return (
    <>
      {workerIds.length > 0 && (
        <button type="button" onClick={remind} disabled={pending || !ready} className={btn.primary}>
          <Icon name="messages" size={16} />
          {remindAllButton(workerIds.length)}
        </button>
      )}
      <Answer text={said} />
    </>
  );
}

export function CasualMenu({
  workerId,
  name,
  mobile,
  canSort,
}: {
  workerId: string;
  name: string;
  mobile: string | null;
  canSort: boolean; // something needs updating
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  // The menu closes once a note is saved or they're marked as sorted: the answer shows under it.
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (menu.current) menu.current.open = false;
  };
  const first = name.split(" ")[0] ?? name;
  const save = () =>
    start(async () => {
      const r = await addNoteAction(workerId, note).catch(() => failed);
      setSaid(noteResultText(r));
      if (r.status === "added") {
        setNote("");
        setWriting(false);
        close();
        router.refresh();
      }
    });
  const sorted = () =>
    start(async () => {
      const r = await markSortedAction(workerId).catch(() => failed);
      setSaid(sortedResultText(r));
      if (r.status === "sorted") {
        close();
        router.refresh();
      }
    });
  return (
    <>
      <details ref={menu} className="group relative shrink-0">
        <summary
          aria-label={`More for ${name}`}
          className={`${summaryButton} press-glass glass-button inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-button-hover hover:text-ink active:bg-button-press group-open:bg-button-press group-open:text-ink`}
        >
          <Icon name="dots" />
        </summary>
        <div className="absolute top-full right-0 z-20 mt-2 flex w-72 max-w-[80vw] origin-top-right animate-pop flex-col gap-2 rounded-inner glass-float p-3">
          {mobile && (
            <a href={`tel:${mobile}`} className={`${btn.secondary} justify-start`}>
              <Icon name="phone" size={16} />
              {`${CALL} ${first}`}
            </a>
          )}
          {writing ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                {`A note about ${first}`}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className={`${field} w-full`}
                  disabled={!ready}
                  aria-describedby={`row-note-hint-${workerId}`}
                />
              </label>
              <p id={`row-note-hint-${workerId}`} className={hint}>
                {NOTE_HINT}
              </p>
              <button
                type="button"
                onClick={save}
                disabled={pending || !ready}
                className={`${btn.primary} self-start`}
              >
                Save note
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setWriting(true)}
              disabled={!ready}
              aria-label={`${ADD_NOTE}: ${name}`}
              className={`${btn.secondary} justify-start`}
            >
              {ADD_NOTE}
            </button>
          )}
          {canSort && (
            <button
              type="button"
              onClick={sorted}
              disabled={pending || !ready}
              aria-label={`${MARK_SORTED}: ${name}`}
              className={`${btn.secondary} justify-start`}
            >
              {MARK_SORTED}
            </button>
          )}
          <Link href={`/office/casuals/${workerId}`} className={`${btn.secondary} justify-start`}>
            {`See ${first}'s page`}
          </Link>
        </div>
      </details>
      <Answer text={said} />
    </>
  );
}

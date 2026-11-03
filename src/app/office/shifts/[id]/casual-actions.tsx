"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import {
  BOOK,
  BOOK_THEM,
  bookBestButton,
  bookBestConfirm,
  bookBestResultText,
  bookLabel,
  bookResultText,
  CASUALS_ASK,
  CASUALS_ASK_LINE,
  casualsAskResultText,
  KEEP_AS_IS,
  moreFor,
  NOT_THIS_TIME,
  notThisTimeResultText,
} from "@/lib/office/session-page-copy";
import { btn } from "../../../ui/classes";
import { Icon } from "../../../ui/icons";
import { summaryButton } from "./chevron";
import {
  assignAction,
  bookTheBestAction,
  notThisTimeAction,
  setCasualsAskAction,
} from "../actions";

const failed = { status: "error" as const };

// A session's "Casuals for this session" buttons (Phase 26.6, ses-3, ses-4): "Book" (the office's
// own booking: every rule and licence check, first yes wins), "Not this time" in a row's "…" menu
// (the casual is told), "Book the best N" after a "Yes", and the event's "Casuals ask, you choose"
// switch. The server checks the office user and logs each; the page then reads its lists again.
// Each answer stays where the button was, in a status region mounted from the start, so a screen
// reader hears it. They wait for the page.

function Answer({ text }: { text: string | null }) {
  return (
    <p role="status" className={text ? "basis-full text-sm text-ink-muted" : "sr-only"}>
      {text ?? ""}
    </p>
  );
}

export function BookButton({
  shiftId,
  workerId,
  name,
}: {
  shiftId: string;
  workerId: string;
  name: string;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const book = () =>
    start(async () => {
      const r = await assignAction({ shiftId, workerId, override: null }).catch(() => failed);
      setSaid(bookResultText(r, name));
      if (r.status === "booked") router.refresh();
    });
  return (
    <>
      <button
        type="button"
        onClick={book}
        disabled={pending || !ready}
        aria-label={bookLabel(name)}
        className={btn.primary}
      >
        {BOOK}
      </button>
      <Answer text={said} />
    </>
  );
}

export function RowMenu({
  shiftId,
  workerId,
  name,
  canDecline,
  profileHref,
}: {
  shiftId: string;
  workerId: string;
  name: string;
  canDecline: boolean; // an ask still waiting
  profileHref: string;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const decline = () =>
    start(async () => {
      const r = await notThisTimeAction(shiftId, workerId).catch(() => failed);
      setSaid(notThisTimeResultText(r, name));
      if (r.status === "declined") router.refresh();
    });
  return (
    <>
      <details className="group relative shrink-0">
        <summary
          aria-label={moreFor(name)}
          className={`${summaryButton} press-glass glass-button inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-button-hover hover:text-ink active:bg-button-press group-open:bg-button-press group-open:text-ink`}
        >
          <Icon name="dots" />
        </summary>
        <div className="absolute top-full right-0 z-10 mt-2 flex w-56 max-w-[80vw] origin-top-right animate-pop flex-col gap-2 rounded-inner glass-float p-3">
          {canDecline && (
            <button
              type="button"
              onClick={decline}
              disabled={pending || !ready}
              aria-label={`${NOT_THIS_TIME}: ${name}`}
              className={`${btn.secondary} justify-start`}
            >
              {NOT_THIS_TIME}
            </button>
          )}
          <Link href={profileHref} className={`${btn.secondary} justify-start`}>
            {`See ${name.split(" ")[0]}'s page`}
          </Link>
        </div>
      </details>
      <Answer text={said} />
    </>
  );
}

export function BookBest({
  shiftId,
  people,
}: {
  shiftId: string;
  people: { workerId: string; name: string }[]; // the page's best asks, as confirmed
}) {
  const names = people.map((p) => p.name);
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) yes.current?.focus();
  }, [asking]);
  const close = () => {
    setAsking(false);
    trigger.current?.focus();
  };
  const book = () =>
    start(async () => {
      const r = await bookTheBestAction(
        shiftId,
        people.map((p) => p.workerId),
      ).catch(() => failed);
      setSaid(bookBestResultText(r));
      setAsking(false);
      router.refresh();
    });
  return (
    <>
      {names.length > 0 && (
        <button
          ref={trigger}
          type="button"
          onClick={() => setAsking(true)}
          disabled={pending || !ready || asking}
          className={btn.primary}
        >
          <Icon name="check" size={16} />
          {bookBestButton(names.length)}
        </button>
      )}
      {asking && (
        <div className="flex basis-full flex-wrap items-center gap-2 rounded-inner glass-tile p-3 text-sm">
          <p className="basis-full text-ink">{bookBestConfirm(names)}</p>
          <button ref={yes} type="button" onClick={book} disabled={pending} className={btn.primary}>
            {BOOK_THEM}
          </button>
          <button type="button" onClick={close} disabled={pending} className={btn.secondary}>
            {KEEP_AS_IS}
          </button>
        </div>
      )}
      <Answer text={said} />
    </>
  );
}

export function CasualsAskSwitch({
  eventId,
  on,
  canChange,
}: {
  eventId: string;
  on: boolean;
  canChange: boolean;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const flip = () =>
    start(async () => {
      const r = await setCasualsAskAction({ eventId, on: !on }).catch(() => failed);
      setSaid(casualsAskResultText(r));
      if (r.status === "on" || r.status === "off") router.refresh();
    });
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={flip}
        disabled={pending || !ready || !canChange}
        className="press flex min-h-14 w-full items-center justify-between gap-4 rounded-row text-left disabled:opacity-60"
      >
        <span className="min-w-0">
          <b className="block font-medium text-ink">{CASUALS_ASK}</b>
          <span className="block text-sm text-ink-muted">{CASUALS_ASK_LINE}</span>
        </span>
        <span
          aria-hidden="true"
          className={`inline-flex h-6 w-10 shrink-0 items-center rounded-full p-1 transition-colors ${
            on ? "bg-accent" : "bg-switch-off"
          }`}
        >
          <span
            className={`size-4 rounded-full bg-knob transition-transform duration-150 ease-sd motion-reduce:transition-none ${
              on ? "translate-x-4" : ""
            }`}
          />
        </span>
      </button>
      <Answer text={said} />
    </div>
  );
}

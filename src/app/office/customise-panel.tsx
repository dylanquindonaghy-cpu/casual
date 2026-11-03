"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { MyDashboard } from "@/lib/office/contracts";
import {
  BACK_TO_DASHBOARD,
  contractLine,
  CONTRACTS_LINE,
  CUSTOMISE,
  CUSTOMISE_TITLE,
  customiseResultText,
  NO_CONTRACTS,
  SAVE_DASHBOARD,
  SAVING,
  WHAT_YOU_SEE,
  YOUR_CONTRACTS,
  type CustomiseState,
} from "@/lib/office/customise-copy";
import { CARD_WORDS, DASHBOARD_CARDS } from "@/lib/office/dashboard-cards";
import { btn } from "../ui/classes";
import { Icon } from "../ui/icons";
import { useHydrated } from "../use-hydrated";
import { saveDashboardAction } from "./customise-actions";

// Customise (Phase 26.3; the spec page's "Customise and contracts", cus-2 to cus-5): the contracts
// the person looks after (each a switch: its sites and sessions to come) and the cards they see
// (each a tick), saved to them with "Save my dashboard". A form posted to the server (it works
// before the page is ready, on /office/customise): the panel's and the page's are the same. The
// panel is a native <dialog>, from the right on a laptop and the whole screen on a phone, opened by
// "Customise" in the dashboard's title row (a link to the page until the page is ready). Saved, the
// dashboard reloads its data and the panel closes; Escape, the scrim and Close close it too, and
// focus goes back to the button.

const TITLE_ID = "customise-title";
const idle: CustomiseState = { status: "idle" };

export function CustomiseForm({
  me,
  onSaved,
  onBack,
}: {
  me: MyDashboard;
  onSaved?: () => void;
  // In the panel: its foot holds Save and "Back to the dashboard", always in view.
  onBack?: () => void;
}) {
  const [state, action, pending] = useActionState(saveDashboardAction, idle);
  const said = customiseResultText(state);
  const done = useRef(state);
  useEffect(() => {
    if (state.status === "saved" && done.current !== state) {
      done.current = state;
      onSaved?.();
    }
  }, [state, onSaved]);
  const mine = new Set(me.clientIds);
  const cards = new Set(me.cards);
  const save = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? SAVING : SAVE_DASHBOARD}
        </button>
        {onBack && (
          <button type="button" onClick={onBack} className={btn.secondary}>
            {BACK_TO_DASHBOARD}
          </button>
        )}
      </div>
      <p role="status" className={said ? "text-sm font-medium text-ink" : "sr-only"}>
        {said ?? ""}
      </p>
    </div>
  );
  const choices = (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold text-ink">{YOUR_CONTRACTS}</legend>
        <p className="text-sm text-ink-muted">{CONTRACTS_LINE}</p>
        {me.choices.length === 0 ? (
          <p className="rounded-row glass-tile p-4 text-sm text-ink-muted">{NO_CONTRACTS}</p>
        ) : (
          <ul role="list" className="flex flex-col divide-y divide-line">
            {me.choices.map((c) => (
              <li key={c.clientId}>
                <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-2">
                  <span className="min-w-0">
                    <b className="block font-medium text-ink">{c.name}</b>
                    <span className="block text-sm text-ink-faint">{contractLine(c)}</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    name="contract"
                    value={c.clientId}
                    defaultChecked={mine.has(c.clientId)}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-switch-off p-1 transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 [&>span]:transition-transform peer-checked:[&>span]:translate-x-4"
                  >
                    <span className="size-4 rounded-full bg-knob duration-150 ease-sd motion-reduce:transition-none" />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold text-ink">{WHAT_YOU_SEE}</legend>
        <ul role="list" className="grid gap-2 @min-[30rem]:grid-cols-2">
          {DASHBOARD_CARDS.map((k) => (
            <li key={k}>
              <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-row glass-tile p-3 has-[:checked]:outline-2 has-[:checked]:outline-ink">
                <input
                  type="checkbox"
                  name="card"
                  value={k}
                  defaultChecked={cards.has(k)}
                  className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
                />
                <span className="min-w-0">
                  <b className="block font-medium text-ink">{CARD_WORDS[k].name}</b>
                  <span className="block text-sm text-ink-faint">{CARD_WORDS[k].line}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </>
  );
  return onBack ? (
    <form action={action} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 pt-4 pb-6">
        {choices}
      </div>
      <div className="border-t border-line px-6 pt-4 pb-6">{save}</div>
    </form>
  ) : (
    <form action={action} className="flex flex-col gap-6">
      {choices}
      {save}
    </form>
  );
}

export function CustomiseButton({ me }: { me: MyDashboard }) {
  const router = useRouter();
  const ready = useHydrated();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLAnchorElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  // A new form each time it opens, with what's saved now.
  const [round, setRound] = useState(0);
  const label = (
    <>
      <Icon name="dashboard" size={16} />
      {CUSTOMISE}
    </>
  );
  const cls =
    "press-glass glass-button inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-ink hover:bg-button-hover active:bg-button-press";
  return (
    <>
      <Link
        ref={opener}
        href="/office/customise"
        aria-haspopup="dialog"
        onClick={(e) => {
          if (!ready || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          setRound((r) => r + 1);
          setOpen(true);
          dialog.current?.showModal();
          heading.current?.focus({ preventScroll: true });
        }}
        className={cls}
      >
        {label}
      </Link>
      <dialog
        ref={dialog}
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        data-customise-panel=""
        onClose={() => {
          setOpen(false);
          opener.current?.focus({ preventScroll: true });
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden glass-float p-0 text-base text-ink backdrop:animate-fade backdrop:bg-scrim/40 lg:top-3 lg:right-3 lg:bottom-3 lg:left-auto lg:h-[calc(100dvh-1.5rem)] lg:w-[30rem] lg:max-w-[calc(100vw-1.5rem)] lg:rounded-card"
      >
        <div className="@container flex h-full flex-col">
          <div className="flex items-start gap-3 px-6 pt-6">
            <h2
              id={TITLE_ID}
              ref={heading}
              tabIndex={-1}
              className="min-w-0 flex-1 text-2xl font-semibold tracking-heading text-ink focus:outline-none"
            >
              {CUSTOMISE_TITLE}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => dialog.current?.close()}
              className="press-glass glass-button inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-button-hover active:bg-button-press"
            >
              <Icon name="close" />
            </button>
          </div>
          {open && (
            <CustomiseForm
              key={round}
              me={me}
              onSaved={() => {
                router.refresh();
                dialog.current?.close();
              }}
              onBack={() => dialog.current?.close()}
            />
          )}
        </div>
      </dialog>
    </>
  );
}

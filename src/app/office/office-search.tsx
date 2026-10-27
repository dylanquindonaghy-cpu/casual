"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { SEARCH_EMPTY, SEARCH_LABEL, type SearchHits } from "@/lib/office/search-copy";
import { chip } from "../ui/classes";
import { Icon } from "../ui/icons";
import { useHydrated } from "../use-hydrated";
import type { SearchResult } from "./search-actions";

// The top bar's search (Phase 24, round 7; docs/ui-design.md "Office shell"), from 1024px, for the
// roles that can open what it finds (admins and resourcers): a glass capsule, "Search", with ⌘K
// (Ctrl K off a Mac) to reach it from anywhere. What's typed goes to the server as an action
// (search-actions.ts: never the address or a log) a moment after you stop typing, from 2
// characters; what comes back shows in a floating glass panel under it: casuals, shifts and sites,
// each a link to its page, with a line when there were more. The down arrow moves into the
// results (and up and down through them), Enter opens the first, Escape closes the panel (and from
// a result, goes back to the box); a click outside or the focus leaving closes it. Plain links in
// plain boxes (no list, heading or region roles, which the browser tests count on pages); a polite
// live line says how many were found.

const WAIT_MS = 200;
const MESSAGES = {
  logged_out: "Log in again, then try again.",
  not_allowed: "Your role can't search casuals or shifts.",
  error: "Search isn't working right now. Try again.",
} as const;

type Shown =
  | { state: "idle" }
  | { state: "searching"; q: string }
  | { state: "found"; q: string; hits: SearchHits }
  | { state: "message"; q: string; words: string };

// "3 found", or the empty line, for the live line.
export function foundWords(shown: Shown): string {
  if (shown.state === "found")
    return shown.hits.count === 0
      ? SEARCH_EMPTY(shown.q)
      : `${shown.hits.count} found for “${shown.q}”.`;
  if (shown.state === "message") return shown.words;
  return "";
}

export function OfficeSearch({ search }: { search: (q: string) => Promise<SearchResult> }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const asked = useRef(0);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<Shown>({ state: "idle" });
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // ⌘K or Ctrl K: said once the page is ready (the shortcut needs it).
  const mac = hydrated ? /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) : null;

  // ⌘K or Ctrl K, from anywhere on the page.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        const el = input.current;
        if (!el || el.offsetParent === null) return;
        e.preventDefault();
        el.focus();
        el.select();
        if (el.value.trim().length >= 2) setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A click outside closes the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // A moment after typing stops: ask the server (the last answer asked for wins).
  const ask = (value: string) => {
    clearTimeout(timer.current);
    const q = value.trim();
    const mine = ++asked.current;
    if (q.length < 2) {
      setShown({ state: "idle" });
      return;
    }
    setShown((s) => (s.state === "found" ? s : { state: "searching", q }));
    timer.current = setTimeout(() => {
      search(q)
        .catch((): SearchResult => ({ status: "error" }))
        .then((r) => {
          if (mine !== asked.current) return;
          setShown(
            r.status === "found"
              ? { state: "found", q, hits: r.hits }
              : { state: "message", q, words: MESSAGES[r.status] },
          );
        });
    }, WAIT_MS);
  };

  const results = () => [...(panel.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])];
  const close = () => setOpen(false);
  const done = () => {
    setOpen(false);
    setQuery("");
    ask("");
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      results()[0]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const first = shown.state === "found" ? shown.hits.groups[0]?.hits[0] : undefined;
      if (first) {
        router.push(first.href);
        done();
      }
    } else if (e.key === "Escape") {
      if (open) close();
      else {
        setQuery("");
        ask("");
      }
    }
  };
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const links = results();
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = at + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) input.current?.focus();
      else links[Math.min(next, links.length - 1)]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Back to the box, then shut (the box opens the panel as it takes focus).
      input.current?.focus();
      close();
    }
  };

  const showing = open && shown.state !== "idle";
  return (
    <div
      ref={box}
      className="relative hidden lg:block"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <div className="glass-float flex h-12 w-50 items-center gap-2 rounded-full pr-2 pl-4 @min-[73.25rem]:w-62.5">
        <Icon name="search" size={18} className="text-ink-muted" />
        <label htmlFor={`${id}-q`} className="sr-only">
          {SEARCH_LABEL}
        </label>
        <input
          ref={input}
          id={`${id}-q`}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search"
          disabled={!hydrated}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            ask(e.target.value);
          }}
          onFocus={() => {
            if (query.trim().length >= 2) setOpen(true);
          }}
          onKeyDown={onInputKey}
          aria-describedby={`${id}-found`}
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
        />
        {mac === null ? null : (
          <kbd
            aria-hidden="true"
            className="glass-button rounded-full px-2 py-1 font-sans text-xs font-medium text-ink-muted"
          >
            {mac ? "⌘K" : "Ctrl K"}
          </kbd>
        )}
      </div>
      <p id={`${id}-found`} aria-live="polite" className="sr-only">
        {showing ? foundWords(shown) : ""}
      </p>
      {showing ? (
        <div
          ref={panel}
          data-search-panel=""
          onKeyDown={onPanelKey}
          className="glass-float absolute top-full right-0 z-30 mt-2 max-h-[min(32rem,calc(100dvh-6rem))] w-[26rem] origin-top-right animate-pop overflow-y-auto overscroll-contain rounded-inner p-2 text-base text-ink"
        >
          {shown.state === "searching" ? (
            <p className="px-3 py-2 text-ink-muted">Searching…</p>
          ) : shown.state === "message" ? (
            <p className="px-3 py-2 text-ink-muted">{shown.words}</p>
          ) : shown.state === "found" && shown.hits.count === 0 ? (
            <p className="px-3 py-2 text-ink-muted">{SEARCH_EMPTY(shown.q)}</p>
          ) : shown.state === "found" ? (
            shown.hits.groups.map((g) => (
              <div key={g.kind} className="pb-1">
                <p className="px-3 pt-2 pb-1 text-xs font-bold tracking-[0.08em] text-ink-faint uppercase">
                  {g.label}
                </p>
                {g.hits.map((h) => (
                  <Link
                    key={h.href}
                    href={h.href}
                    onClick={done}
                    className="press flex min-h-11 flex-col justify-center rounded-row px-3 py-2 hover:bg-active focus-visible:bg-active active:bg-button-press"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <span className="min-w-0 truncate">{h.title}</span>
                      {h.urgent ? (
                        <span className={`${chip.base} ${chip.urgent}`}>Urgent</span>
                      ) : null}
                    </span>
                    {h.detail ? (
                      <span className="text-sm text-ink-muted tabular-nums">{h.detail}</span>
                    ) : null}
                  </Link>
                ))}
                {g.more ? <p className="px-3 py-1 text-sm text-ink-muted">{g.more}</p> : null}
              </div>
            ))
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

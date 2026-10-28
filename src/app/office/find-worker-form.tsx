"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { btn, field, labelStack } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { useHydrated } from "@/app/use-hydrated";
import type { WorkerMatch } from "@/lib/gdpr/worker-export";

// What the server's search answers (the data page's and the workers page's actions).
export type FindWorkersResult =
  | { status: "found"; matches: WorkerMatch[] }
  | { status: "logged_out" }
  | { status: "not_allowed" }
  | { status: "error" };

const failed = { status: "error" as const };

const STATUS_WORDS: Record<string, string> = {
  active: "Active",
  inactive: "Not active",
  blocked: "Blocked",
};
// The status word's colour (docs/ui-design.md "Status tones"); "Deleted" is quiet.
const STATUS_TONES: Record<string, StatusTone> = {
  active: "done",
  inactive: "quiet",
  blocked: "urgent",
};

// "Name or mobile number", "Find", then the matches (up to 20), each a link to their page under
// `hrefBase` (the data page's, or the workers page's) with "{mobile} · {status}". Sent to the
// server as a form action, never put in the address. Put it inside a card: the search on one line,
// then the matches as divided rows under it, in the same card. `compact` (Casuals, Phase 24: round
// 7's search box beside the filters): one round box, "Name or mobile number" in it (its label for
// screen readers), Find at its end, and the matches in a floating panel under it, which Escape or
// Close puts away.
export function FindWorkerForm({
  find: search,
  hrefBase,
  notAllowed,
  compact = false,
}: {
  find: (query: string) => Promise<FindWorkersResult>;
  hrefBase: string;
  notAllowed: string;
  compact?: boolean;
}) {
  const inputId = useId();
  const MESSAGES: Record<Exclude<FindWorkersResult["status"], "found">, string> = {
    logged_out: "Log in again, then try again.",
    not_allowed: notAllowed,
    error: "Something went wrong. Try again.",
  };
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [matches, setMatches] = useState<WorkerMatch[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ready = useHydrated();
  const find = () =>
    startTransition(async () => {
      const q = query.trim();
      if (!q) return;
      const result = await search(q).catch(() => failed);
      setSearched(q);
      setOpen(true);
      if (result.status === "found") {
        setMatches(result.matches);
        setMessage(null);
      } else {
        setMatches([]);
        setMessage(MESSAGES[result.status]);
      }
    });
  // In the box's panel (`compact`) the matches start at its top; under the full form, a line first.
  const results = (
    <>
      {message && (
        <p role="status" className={`${compact ? "pt-3" : "mt-4"} font-semibold`}>
          {message}
        </p>
      )}
      {!message && searched && matches.length === 0 && (
        <p className={compact ? "pt-3" : "mt-4"}>Nobody matches &ldquo;{searched}&rdquo;.</p>
      )}
      {matches.length > 0 && (
        <ul
          role="list"
          className={`divide-y divide-line ${compact ? "" : "mt-4 border-t border-line"}`}
        >
          {matches.map((m) => (
            <li
              key={m.id}
              className="flex flex-col items-start pt-1 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:py-2"
            >
              <Link
                href={`${hrefBase}/${m.id}`}
                className="press inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4 hover:text-ink-muted"
              >
                {m.name}
              </Link>
              <span className="text-ink-muted tabular-nums">
                {m.erased ? (
                  <StatusChip tone="quiet">Deleted</StatusChip>
                ) : (
                  <>
                    {`${m.mobile ?? ""} · `}
                    <StatusChip tone={STATUS_TONES[m.status] ?? "quiet"}>
                      {STATUS_WORDS[m.status] ?? m.status}
                    </StatusChip>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  if (compact) {
    return (
      <div
        className="relative w-full sm:w-80"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) setOpen(false);
        }}
      >
        <form
          role="search"
          // The ring round the whole box while its field has focus (the field's own is off).
          className="glass-tile flex min-h-12 items-center gap-2 rounded-full pr-1 pl-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <Icon name="search" size={18} className="shrink-0 text-ink-muted" />
          <label htmlFor={inputId} className="sr-only">
            Name or mobile number
          </label>
          <input
            id={inputId}
            name="q"
            type="search"
            enterKeyHint="search"
            placeholder="Name or mobile number"
            value={query}
            maxLength={100}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            disabled={!ready}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted pointer-coarse:text-lg"
          />
          <button type="submit" className={btn.text} disabled={pending || !ready}>
            Find
          </button>
        </form>
        {open && (searched || message) && (
          <div
            role="region"
            aria-label="Search results"
            className="absolute top-full right-0 z-20 mt-2 w-full min-w-72 animate-pop rounded-inner glass-float px-4 pb-3"
          >
            {results}
            <button
              type="button"
              className={`${btn.text} mt-2 -ml-3`}
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <label className={`${labelStack} min-w-0 grow basis-64 sm:max-w-md`}>
          Name or mobile number
          <input
            name="q"
            value={query}
            maxLength={100}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            disabled={!ready}
            className={`${field} w-full`}
          />
        </label>
        <button type="submit" className={btn.primary} disabled={pending || !ready}>
          Find
        </button>
      </form>
      {results}
    </div>
  );
}

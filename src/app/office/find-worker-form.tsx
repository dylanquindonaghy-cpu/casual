"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { btn, field, labelStack } from "@/app/ui/classes";
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
// then the matches as divided rows under it, in the same card.
export function FindWorkerForm({
  find: search,
  hrefBase,
  notAllowed,
}: {
  find: (query: string) => Promise<FindWorkersResult>;
  hrefBase: string;
  notAllowed: string;
}) {
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
  const ready = useHydrated();
  const find = () =>
    startTransition(async () => {
      const q = query.trim();
      if (!q) return;
      const result = await search(q).catch(() => failed);
      setSearched(q);
      if (result.status === "found") {
        setMatches(result.matches);
        setMessage(null);
      } else {
        setMatches([]);
        setMessage(MESSAGES[result.status]);
      }
    });
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
      {message && (
        <p role="status" className="mt-4 font-semibold">
          {message}
        </p>
      )}
      {!message && searched && matches.length === 0 && (
        <p className="mt-4">Nobody matches &ldquo;{searched}&rdquo;.</p>
      )}
      {matches.length > 0 && (
        <ul role="list" className="mt-4 divide-y divide-line border-t border-line">
          {matches.map((m) => (
            <li
              key={m.id}
              className="flex flex-col items-start pt-1 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:py-1.5"
            >
              <Link
                href={`${hrefBase}/${m.id}`}
                className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4 hover:text-ink-muted"
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
    </div>
  );
}

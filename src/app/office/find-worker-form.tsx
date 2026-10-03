"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import type { WorkerMatch } from "@/lib/gdpr/worker-export";

// What the server's search answers (the data page's and the workers page's actions).
export type FindWorkersResult =
  | { status: "found"; matches: WorkerMatch[] }
  | { status: "logged_out" }
  | { status: "not_allowed" }
  | { status: "error" };

const button = "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100";
const failed = { status: "error" as const };

const STATUS_WORDS: Record<string, string> = {
  active: "Active",
  inactive: "Not active",
  blocked: "Blocked",
};

// "Name or mobile number", "Find", then the matches (up to 20), each a link to their page under
// `hrefBase` (the data page's, or the workers page's). Sent to the server as a form action, never
// put in the address.
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
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <label className="flex flex-col font-semibold">
          Name or mobile number
          <input
            name="q"
            value={query}
            maxLength={100}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 rounded border border-slate-400 px-2 py-2 font-normal"
          />
        </label>
        <button type="submit" className={button} disabled={pending || !ready}>
          Find
        </button>
      </form>
      {message && (
        <p role="status" className="mt-3 font-semibold">
          {message}
        </p>
      )}
      {!message && searched && matches.length === 0 && (
        <p className="mt-3">Nobody matches &ldquo;{searched}&rdquo;.</p>
      )}
      {matches.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {matches.map((m) => (
            <li key={m.id} className="rounded-lg border border-slate-300 p-3">
              <Link href={`${hrefBase}/${m.id}`} className="font-semibold underline">
                {m.name}
              </Link>
              <span className="ml-2 text-slate-700">
                {m.erased ? "Deleted" : `${m.mobile ?? ""} · ${STATUS_WORDS[m.status] ?? m.status}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

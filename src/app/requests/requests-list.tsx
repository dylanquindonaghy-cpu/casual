import Link from "next/link";
import { KIND_NAMES, STATUS_WORDS } from "@/lib/portal/request-kinds";
import type { MyRequest } from "@/lib/portal/requests";
import { dayLabel } from "@/lib/rules/reasons";
import { localDateOf } from "@/lib/time/zoned";

// My requests (docs/screens.md, `/requests`): each request's kind, its shift, its status in plain
// words, when it was sent and its reference; "New request".
export function RequestsList({ requests, timeZone }: { requests: MyRequest[]; timeZone: string }) {
  return (
    <>
      <h1 className="text-3xl font-bold">My requests</h1>
      <Link
        href="/requests/new"
        className="mt-4 block w-full rounded-xl bg-slate-900 px-4 py-4 text-center text-lg font-semibold text-white"
      >
        New request
      </Link>
      {requests.length === 0 ? (
        <p className="mt-6">No requests yet.</p>
      ) : (
        <ul className="mt-6 divide-y">
          {requests.map((r) => (
            <li key={r.ref} className="py-3">
              <p className="font-semibold">
                {KIND_NAMES[r.type] ?? r.type}
                {r.shift ? `: ${r.shift.when}` : ""}
              </p>
              {r.shift && (
                <p className="text-base">
                  {r.shift.role}
                  {r.shift.siteName ? ` at ${r.shift.siteName}` : ""}
                </p>
              )}
              <p className="mt-1">
                <span className="font-semibold">{STATUS_WORDS[r.status] ?? r.status}</span>
              </p>
              {r.note && <p>The office says: {r.note}</p>}
              <p className="text-base text-slate-600">
                Sent {dayLabel(localDateOf(r.createdAt, timeZone))} · Reference {r.ref}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/"
        className="mt-8 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold"
      >
        Back to my shifts
      </Link>
    </>
  );
}

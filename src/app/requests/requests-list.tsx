import Link from "next/link";
import { muted, nums, row, rows, staffBtn } from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { KIND_NAMES, STATUS_WORDS } from "@/lib/portal/request-kinds";
import type { MyRequest } from "@/lib/portal/requests";
import { dayLabel } from "@/lib/rules/reasons";
import { localDateOf } from "@/lib/time/zoned";

// Each status word's colour (docs/ui-design.md "Status tones"): still waiting, done, or closed.
const TONES: Record<string, StatusTone> = {
  open: "attention",
  escalated: "attention",
  approved: "done",
  declined: "quiet",
  auto_resolved: "done",
};

// My requests (docs/screens.md, `/requests`): each request's status first, then its kind and
// shift, the office's note, when it was sent and its reference; "New request" at the top.
export function RequestsList({
  requests,
  timeZone,
  eyebrow,
}: {
  requests: MyRequest[];
  timeZone: string;
  eyebrow?: string; // the firm's name above the heading
}) {
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title="My requests"
        actions={
          <Link href="/requests/new" className={staffBtn.primary}>
            New request
          </Link>
        }
      />
      {requests.length === 0 ? (
        <p>No requests yet.</p>
      ) : (
        <ul className={rows}>
          {requests.map((r) => (
            <li key={r.ref} className={row}>
              <StatusChip tone={TONES[r.status] ?? "quiet"}>
                {STATUS_WORDS[r.status] ?? r.status}
              </StatusChip>
              <p className="mt-2 font-semibold">
                {KIND_NAMES[r.type] ?? r.type}
                {r.shift ? `: ${r.shift.when}` : ""}
              </p>
              {r.shift && (
                <p className="text-base">
                  {r.shift.role}
                  {r.shift.siteName ? ` at ${r.shift.siteName}` : ""}
                </p>
              )}
              {r.note && <p className="mt-2">The office says: {r.note}</p>}
              <p className={`mt-2 ${muted} ${nums}`}>
                Sent {dayLabel(localDateOf(r.createdAt, timeZone))} · Reference {r.ref}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/" className={`${staffBtn.secondary} mt-8`}>
        Back to my shifts
      </Link>
    </>
  );
}

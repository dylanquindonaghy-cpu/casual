"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  confirmStep,
  emptyBox,
  muted,
  nums,
  staffBtn,
  staffRow,
  staffRows,
} from "@/app/ui/classes";
import { PageHeader } from "@/app/ui/page-header";
import { Slip } from "@/app/ui/slip";
import { StatusChip, type StatusTone } from "@/app/ui/status-chip";
import { useHydrated } from "@/app/use-hydrated";
import { tryAgainText } from "@/lib/portal/copy";
import {
  KIND_NAMES,
  markNowText,
  statusWord,
  withdrawOutcomeText,
  type WithdrawOutcome,
} from "@/lib/portal/request-kinds";
import type { MyRequest } from "@/lib/portal/requests";
import { dayLabel } from "@/lib/rules/reasons";
import { localDateOf } from "@/lib/time/zoned";
import { LOGIN_AGAIN } from "@/lib/auth/login-again";
import { withdrawRequestAction } from "./actions";

// Each status word's colour (docs/ui-design.md "Status tones"): still waiting, done, or closed. A
// request she took back is closed (grey); any "Answered" is done (green), whatever's stored.
const TONES: Record<string, StatusTone> = {
  open: "attention",
  escalated: "attention",
  approved: "done",
  declined: "quiet",
  auto_resolved: "done",
  withdrawn: "quiet",
};

// A row as the page passes it: her request, and whether "Take back this request" can work on it
// (src/lib/portal/requests.ts canWithdrawRequest, worked out on the server).
export type RequestRow = MyRequest & { canTakeBack?: boolean };

type Shown = Exclude<WithdrawOutcome, { status: "logged_out" }>;

// My requests (docs/screens.md `/requests`, "### 28.9"): each request's status first (an answered
// attendance question with the mark as it is now beside it), then its kind and shift, the office's
// note, when it was sent and its reference; "Ask for a change to a shift" at the top. A request
// still waiting has "Take back this request", a step, then a slip with the answer and its
// reference. With none, what a request is for and where the answer shows.
export function RequestsList({ requests, timeZone }: { requests: RequestRow[]; timeZone: string }) {
  return (
    <>
      <PageHeader
        title="My requests"
        actions={
          <Link href="/requests/new" className={staffBtn.primary}>
            Ask for a change to a shift
          </Link>
        }
      />
      {requests.length === 0 ? (
        <p className={emptyBox}>
          No requests yet. To change a shift&apos;s times or swap it, tap Ask for a change to a
          shift. The office&apos;s answer shows here.
        </p>
      ) : (
        <ul role="list" className={staffRows}>
          {requests.map((r) => (
            <RequestItem key={r.id ?? r.ref} r={r} timeZone={timeZone} />
          ))}
        </ul>
      )}
      <Link href="/profile" className={`${staffBtn.secondary} mt-8`}>
        Back to my profile
      </Link>
    </>
  );
}

function RequestItem({ r, timeZone }: { r: RequestRow; timeZone: string }) {
  const router = useRouter();
  const ready = useHydrated();
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<Shown | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  // Taken back just now: the chip says so before the page is made again.
  const status = outcome?.status === "withdrawn" ? "withdrawn" : r.status;
  const word = statusWord(r.type, status);
  const tone = word === "Answered" ? "done" : (TONES[status] ?? "quiet");
  const answered = r.type === "attendance" && word === "Answered";
  const markNow = answered ? markNowText(r.mark) : null;
  // A failed tap leaves the step open to try again; any other answer closes it.
  const canTakeBack =
    Boolean(r.canTakeBack && r.id) && (outcome === null || outcome.status === "error");
  const titleId = `take-back-${r.ref}`;

  const takeBack = () => {
    if (sending.current || !r.id) return;
    sending.current = true;
    const id = r.id;
    startTransition(async () => {
      const result = await withdrawRequestAction(id).catch(() => ({ status: "error" as const }));
      sending.current = false;
      if (result.status === "logged_out") {
        router.replace(LOGIN_AGAIN);
        return;
      }
      if (result.status !== "error") setAsking(false);
      setOutcome(result);
      // The list made again from the server: the answer the office gave first, or "Taken back".
      if (result.status !== "error") router.refresh();
    });
  };

  const shown = outcome ? withdrawOutcomeText(outcome, tryAgainText()) : null;
  return (
    <li className={staffRow}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip tone={tone}>{word}</StatusChip>
        {markNow && <span className="font-semibold">{markNow}</span>}
      </p>
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
      {canTakeBack && !asking && (
        <button
          type="button"
          disabled={!ready}
          onClick={() => setAsking(true)}
          className={`${staffBtn.danger} mt-3`}
        >
          Take back this request
        </button>
      )}
      {canTakeBack && asking && (
        <div role="group" aria-labelledby={titleId} className={`${confirmStep} mt-3`}>
          <p id={titleId} className="font-semibold">
            Take back this request?
          </p>
          <p className="mt-1">The office won&apos;t answer it. You can ask again any time.</p>
          <div className="mt-3 flex flex-col gap-2.5">
            <button
              type="button"
              disabled={pending || !ready}
              onClick={takeBack}
              className={staffBtn.dangerSolid}
            >
              {pending ? "Taking it back…" : "Yes, take it back"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking(false)}
              className={staffBtn.secondary}
            >
              Keep my request
            </button>
          </div>
        </div>
      )}
      {shown && (
        <Slip
          tone={shown.tone}
          title={shown.title}
          role={shown.tone === "urgent" ? "alert" : "status"}
          className={`mt-3 ${nums}`}
        >
          {shown.line && <p>{shown.line}</p>}
        </Slip>
      )}
    </li>
  );
}

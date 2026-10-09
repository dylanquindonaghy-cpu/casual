"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, field, labelStack } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { keepText, withdrawText, WITHDRAW_REASON_MAX } from "@/lib/office/strike-actions-copy";
import { resultBox } from "../../shifts/shift-tones";
import { keepStrikeAction, withdrawStrikeAction } from "./actions";

const failed = { status: "error" as const };
// An answer that says where the strike stands now (not an error to try again after).
const settled = (status: string) =>
  ["withdrawn", "kept", "already_kept", "not_live", "erased", "not_found"].includes(status);

// "Withdraw strike…" (asks why: 1–500 characters, kept on the strike, never in the log; not once the
// casual's details were deleted) and, until someone has reviewed it, "Keep strike" (on any live
// strike, flagged or not, so the log's entry doesn't tell which were flagged). The page is
// refreshed after every answer but an error, so it shows where the strike stands. Waits for the
// page (docs/ui-design.md "Forms wait for the page").
export function StrikeActions({
  assignmentId,
  canWithdraw,
  canKeep,
}: {
  assignmentId: string;
  canWithdraw: boolean;
  canKeep: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = useHydrated();
  const busy = pending || !ready;
  return (
    <div className="flex flex-col gap-3">
      {!open && (
        <div className="flex flex-wrap gap-3">
          {canWithdraw && (
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
              onClick={() => {
                setMessage(null);
                setOpen(true);
              }}
            >
              Withdraw strike…
            </button>
          )}
          {canKeep && (
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  const result = await keepStrikeAction(assignmentId).catch(() => failed);
                  setMessage(keepText(result));
                  if (settled(result.status)) router.refresh();
                })
              }
            >
              Keep strike
            </button>
          )}
        </div>
      )}
      {open && (
        <form
          className="flex max-w-xl flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await withdrawStrikeAction(assignmentId, reason).catch(() => failed);
              setMessage(withdrawText(result));
              if (result.status === "withdrawn") setOpen(false);
              if (settled(result.status)) router.refresh();
            });
          }}
        >
          <label className={labelStack}>
            Why are you withdrawing it?
            <textarea
              value={reason}
              maxLength={WITHDRAW_REASON_MAX}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              className={`${field} w-full`}
              disabled={busy}
            />
          </label>
          <p className="text-sm text-ink-muted">
            Kept with the strike for the office. The casual sees only that it was withdrawn.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={btn.primary} disabled={busy || !reason.trim()}>
              Withdraw strike
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Don&apos;t withdraw
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role="status" className={`${resultBox} self-start`}>
          {message}
        </p>
      )}
    </div>
  );
}

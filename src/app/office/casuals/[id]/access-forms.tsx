"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, confirmStep, field, label } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { signOutResultText, siteBlockResultText, statusResultText } from "@/lib/office/worker-copy";
import {
  DEACTIVATE_REASONS,
  REACTIVATE_REASONS,
  SITE_BLOCK_REASON_WORDS,
  SITE_UNBLOCK_REASONS,
  UNBLOCK_REASONS,
} from "@/lib/office/worker-reasons";
import {
  blockFromSiteAction,
  changeWorkerStatusAction,
  signOutWorkerAction,
  unblockFromSiteAction,
} from "../actions";

// The browser's request failed: the server may have made the change, so don't say it didn't.
const failed = { status: "unknown" as const };
// A reason (or site) list beside its button: it grows to 384px, and the button wraps under it
// when there isn't room.
const fieldBox = "flex min-w-0 grow basis-56 flex-col gap-1 sm:max-w-sm";
// A choice and its button on one line, or the button under it on a phone.
const fieldRow = "flex flex-wrap items-end gap-3";

// The casual's page in the office (docs/screens.md `/office/casuals/[id]`). Each change has a
// reason from a fixed list; the server checks everything again. The confirmation shows in place,
// and the page refreshes under it to show the change. Changes that take something away look
// destructive (red outline, then a solid red "Yes, …"; "Block from this site", which blocks at
// once, is solid red); undoing them is a main or plain button. The choices and buttons wait for
// the page (docs/ui-design.md "Forms wait for the page").

function useChange() {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = <R extends { status: string }>(
    work: () => Promise<R>,
    text: (r: R | typeof failed) => string,
  ) =>
    startTransition(async () => {
      const result = await work().catch(() => failed);
      setMessage(text(result));
      if (result.status === "done" || result.status === "unchanged") router.refresh();
    });
  return { ready, off: !ready || pending, message, setMessage, run };
}

function Reasons({
  id,
  label: words,
  list,
  value,
  onChange,
}: {
  id: string;
  label: string;
  list: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
}) {
  const ready = useHydrated();
  return (
    <div className={fieldBox}>
      <label htmlFor={id} className={label}>
        {words}
      </label>
      <select
        id={id}
        className={`${field} w-full`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!ready}
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {Object.entries(list).map(([code, text]) => (
          <option key={code} value={code}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function Status({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className="mt-3 font-semibold">
      {message}
    </p>
  ) : null;
}

// Active: "Make inactive" (a reason, then "Yes"). Not active: "Make active again". Blocked:
// "Unblock".
export function StatusForm({
  workerId,
  name,
  status,
}: {
  workerId: string;
  name: string;
  status: "active" | "inactive" | "blocked";
}) {
  const { off, message, setMessage, run } = useChange();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  // After a change the page refreshes with the new status: start the choices afresh (a stale
  // reason or "Yes" must not carry over), but keep the confirmation on screen.
  const [shown, setShown] = useState(status);
  if (shown !== status) {
    setShown(status);
    setReason("");
    setConfirming(false);
  }
  const kind =
    status === "active" ? "deactivate" : status === "inactive" ? "reactivate" : "unblock";
  const list =
    kind === "deactivate"
      ? DEACTIVATE_REASONS
      : kind === "reactivate"
        ? REACTIVATE_REASONS
        : UNBLOCK_REASONS;
  const words = {
    deactivate: "Make inactive",
    reactivate: "Make active again",
    unblock: "Unblock",
  }[kind];
  const go = () =>
    run(
      () => changeWorkerStatusAction(workerId, { kind, reason }),
      (r) => statusResultText(r),
    );
  const asking = kind === "deactivate" && confirming;
  return (
    <div className="mt-4">
      <div className={fieldRow}>
        <Reasons
          id={`status-${workerId}`}
          label="Why?"
          list={list}
          value={reason}
          onChange={setReason}
        />
        {!asking && (
          <button
            type="button"
            className={kind === "deactivate" ? btn.danger : btn.primary}
            disabled={off}
            onClick={() => {
              if (!reason) return setMessage("Choose a reason.");
              setMessage(null);
              if (kind === "deactivate") setConfirming(true);
              else go();
            }}
          >
            {words}
          </button>
        )}
      </div>
      {asking && (
        <div className={`mt-4 ${confirmStep}`}>
          <p className="max-w-prose">
            Make {name} inactive? They&apos;re logged out at once, can&apos;t log in or take shifts,
            and get no reminders. Their bookings ahead go on the dashboard to cancel or keep.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={btn.dangerSolid} disabled={off} onClick={go}>
              Yes, make {name} inactive
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={off}
              onClick={() => setConfirming(false)}
            >
              Keep them active
            </button>
          </div>
        </div>
      )}
      <Status message={message} />
    </div>
  );
}

// "Log out on every device" (a lost phone): their sessions, unused links and phone notifications.
export function SignOutButton({ workerId }: { workerId: string }) {
  const { off, message, run } = useChange();
  return (
    <div className="mt-6 border-t border-line pt-6">
      <button
        type="button"
        className={btn.secondary}
        disabled={off}
        onClick={() => run(() => signOutWorkerAction(workerId), signOutResultText)}
      >
        Log out on every device
      </button>
      <Status message={message} />
    </div>
  );
}

// "Sites they can't work at": each with "Unblock from {site}" (a reason), then "Block from a
// site" (the site and a reason). One component, so its confirmation stays on screen while the
// refreshed page moves the site from one list to the other.
export function SiteBlocks({
  workerId,
  blocks,
  otherSites,
}: {
  workerId: string;
  blocks: { siteId: string; site: string; line: string }[];
  otherSites: { id: string; name: string }[];
}) {
  const { ready, off, message, setMessage, run } = useChange();
  const [unblockReasons, setUnblockReasons] = useState<Record<string, string>>({});
  const [siteId, setSiteId] = useState("");
  const [reason, setReason] = useState("");
  // A site just blocked leaves the list: don't keep pointing at it.
  const chosen = otherSites.some((s) => s.id === siteId) ? siteId : "";
  const unblock = (b: { siteId: string; site: string }) => {
    const why = unblockReasons[b.siteId] ?? "";
    if (!why) return setMessage("Choose a reason.");
    run(
      () => unblockFromSiteAction(workerId, b.siteId, why),
      (r) => siteBlockResultText(r, "unblock"),
    );
    setUnblockReasons((all) => ({ ...all, [b.siteId]: "" }));
  };
  const block = () => {
    if (!chosen) return setMessage("Choose a site.");
    if (!reason) return setMessage("Choose a reason.");
    run(
      () => blockFromSiteAction(workerId, chosen, reason),
      (r) => siteBlockResultText(r, "block"),
    );
    setSiteId("");
    setReason("");
  };
  return (
    <div>
      {blocks.length === 0 ? (
        <p className="mt-2 text-ink-muted">None.</p>
      ) : (
        <ul role="list" className="mt-3 divide-y divide-line border-y border-line">
          {blocks.map((b) => (
            <li key={b.siteId} className="py-4">
              <p className="font-semibold">{b.site}</p>
              <p className="text-ink-muted">{b.line}</p>
              <div className={`${fieldRow} mt-3`}>
                <Reasons
                  id={`unblock-${b.siteId}`}
                  label="Why?"
                  list={SITE_UNBLOCK_REASONS}
                  value={unblockReasons[b.siteId] ?? ""}
                  onChange={(v) => setUnblockReasons((all) => ({ ...all, [b.siteId]: v }))}
                />
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={off}
                  onClick={() => unblock(b)}
                >
                  Unblock from {b.site}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {otherSites.length > 0 && (
        <div className="mt-6 border-t border-line pt-6">
          <h3 className="text-lg font-semibold">Block from a site</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`site-${workerId}`} className={label}>
                Site
              </label>
              <select
                id={`site-${workerId}`}
                className={`${field} w-full`}
                value={chosen}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={!ready}
              >
                <option value="" disabled>
                  Choose a site
                </option>
                {otherSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <Reasons
              id={`block-${workerId}`}
              label="Why?"
              list={SITE_BLOCK_REASON_WORDS}
              value={reason}
              onChange={setReason}
            />
          </div>
          <button
            type="button"
            className={`${btn.dangerSolid} mt-4`}
            disabled={off}
            onClick={block}
          >
            Block from this site
          </button>
        </div>
      )}
      <Status message={message} />
    </div>
  );
}

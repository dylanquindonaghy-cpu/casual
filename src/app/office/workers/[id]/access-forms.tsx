"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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

const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";
const input = "mt-1 rounded border border-slate-400 px-2 py-2 font-normal";
// The browser's request failed: the server may have made the change, so don't say it didn't.
const failed = { status: "unknown" as const };

// The worker's page in the office (docs/screens.md `/office/workers/[id]`). Each change has a
// reason from a fixed list; the server checks everything again. The confirmation shows in place,
// and the page refreshes under it to show the change.

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
  return { off: !ready || pending, message, setMessage, run };
}

function Reasons({
  id,
  label,
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
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <select id={id} className={input} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Choose a reason
        </option>
        {Object.entries(list).map(([code, words]) => (
          <option key={code} value={code}>
            {words}
          </option>
        ))}
      </select>
    </div>
  );
}

function Status({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className="mt-2 font-semibold">
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
  const label = {
    deactivate: "Make inactive",
    reactivate: "Make active again",
    unblock: "Unblock",
  }[kind];
  const go = () =>
    run(
      () => changeWorkerStatusAction(workerId, { kind, reason }),
      (r) => statusResultText(r),
    );
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Reasons
        id={`status-${workerId}`}
        label="Why?"
        list={list}
        value={reason}
        onChange={setReason}
      />
      {kind === "deactivate" && confirming ? (
        <div className="rounded-lg border border-slate-400 p-3">
          <p>
            Make {name} inactive? They&apos;re logged out at once, can&apos;t log in or take shifts,
            and get no reminders. Their bookings ahead go on Today to cancel or keep.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={button} disabled={off} onClick={go}>
              Yes, make {name} inactive
            </button>
            <button
              type="button"
              className={button}
              disabled={off}
              onClick={() => setConfirming(false)}
            >
              Keep them active
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            className={button}
            disabled={off}
            onClick={() => {
              if (!reason) return setMessage("Choose a reason.");
              setMessage(null);
              if (kind === "deactivate") setConfirming(true);
              else go();
            }}
          >
            {label}
          </button>
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
    <div className="mt-4">
      <button
        type="button"
        className={button}
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
  const { off, message, setMessage, run } = useChange();
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
        <p className="mt-2">None.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {blocks.map((b) => (
            <li key={b.siteId} className="rounded-lg border border-slate-300 p-3">
              <p className="font-semibold">{b.site}</p>
              <p>{b.line}</p>
              <div className="mt-2 flex flex-col gap-2">
                <Reasons
                  id={`unblock-${b.siteId}`}
                  label="Why?"
                  list={SITE_UNBLOCK_REASONS}
                  value={unblockReasons[b.siteId] ?? ""}
                  onChange={(v) => setUnblockReasons((all) => ({ ...all, [b.siteId]: v }))}
                />
                <div>
                  <button
                    type="button"
                    className={button}
                    disabled={off}
                    onClick={() => unblock(b)}
                  >
                    Unblock from {b.site}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {otherSites.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="text-xl font-semibold">Block from a site</h3>
          <div className="flex flex-col">
            <label htmlFor={`site-${workerId}`} className="font-semibold">
              Site
            </label>
            <select
              id={`site-${workerId}`}
              className={input}
              value={chosen}
              onChange={(e) => setSiteId(e.target.value)}
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
          <div>
            <button type="button" className={button} disabled={off} onClick={block}>
              Block from this site
            </button>
          </div>
        </div>
      )}
      <Status message={message} />
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { btn, card, field, h2, label, meta, textLink } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import type { RejectReason } from "@/lib/db/schema";
import { REJECT_CHOICES } from "@/lib/portal/qualification-copy";
import {
  checkText,
  isSiaType,
  SIA_REGISTER_URL,
  type CheckOutcome,
} from "@/lib/portal/upload-copy";
import { approveUploadAction, recordCsasAction, rejectUploadAction } from "../actions";

// Checking a casual's upload on their page (docs/office-v2.md 3.7; docs/screens.md
// `/office/casuals/[id]`; 12F.2). A person reads the card: approving a certificate takes its expiry
// date and number as they read them (an SIA licence can be checked on GOV.UK's register first;
// there's no SIA API). Rejecting takes a reason from the fixed list. CSAS is recorded here only,
// after confirming it's under the firm's own scheme. The server checks everything again; the answer
// shows in place and the page refreshes under it. Waits for the page (docs/ui-design.md).

const failed = { status: "error" as const };
const done = (r: CheckOutcome) =>
  r.status === "approved" || r.status === "rejected" || r.status === "recorded";

// No date is a choice a person makes, never a field left empty by mistake (a licence with no expiry
// would count for ever).
function NoExpiry({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0 accent-ink"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      It has no expiry date
    </label>
  );
}

function useCheck() {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // Checked (here, or by someone else meanwhile): the forms go, the answer stays.
  const [finished, setFinished] = useState(false);
  const run = (work: () => Promise<CheckOutcome>) =>
    startTransition(async () => {
      const result = await work().catch(() => failed);
      setMessage(checkText(result));
      if (done(result) || result.status === "not_waiting") {
        setFinished(true);
        router.refresh();
      }
    });
  return { off: !ready || pending, ready, message, finished, run };
}

export function CheckUpload({
  uploadId,
  kind,
  type,
  name,
}: {
  uploadId: string;
  kind: "photo" | "certificate";
  type: string | null;
  name: string; // "staff photo", or the qualification's name mid-sentence
}) {
  const id = useId();
  const { off, ready, message, finished, run } = useCheck();
  const [expiresOn, setExpiresOn] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState<RejectReason | "">("");
  if (finished) {
    return (
      <p role="status" className="mt-3 font-semibold">
        {message}
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            approveUploadAction(
              uploadId,
              kind === "certificate" && !noExpiry ? expiresOn : "",
              kind === "certificate" && noExpiry,
              kind === "certificate" ? number : "",
            ),
          );
        }}
      >
        {kind === "certificate" && (
          <>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-expires`} className={label}>
                Expiry date on the card
              </label>
              <input
                id={`${id}-expires`}
                type="date"
                className={`${field} w-48`}
                value={noExpiry ? "" : expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                disabled={!ready || noExpiry}
              />
              <NoExpiry checked={noExpiry} onChange={setNoExpiry} disabled={!ready} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-number`} className={label}>
                Number on the card
              </label>
              <input
                id={`${id}-number`}
                className={`${field} w-56`}
                value={number}
                maxLength={50}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setNumber(e.target.value)}
                disabled={!ready}
              />
            </div>
          </>
        )}
        <button type="submit" className={btn.primary} disabled={off}>
          Approve {name}
        </button>
      </form>
      {type && isSiaType(type) && (
        <p className={meta}>
          Check an SIA licence on{" "}
          <a href={SIA_REGISTER_URL} target="_blank" rel="noreferrer" className={textLink}>
            GOV.UK&apos;s register of licence holders
          </a>{" "}
          first.
        </p>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason) run(() => rejectUploadAction(uploadId, reason));
        }}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-reason`} className={label}>
            Why not?
          </label>
          <select
            id={`${id}-reason`}
            className={`${field} w-56`}
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectReason)}
            disabled={!ready}
          >
            <option value="" disabled>
              Choose a reason
            </option>
            {(Object.keys(REJECT_CHOICES) as RejectReason[]).map((r) => (
              <option key={r} value={r}>
                {REJECT_CHOICES[r]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={btn.danger} disabled={off || !reason}>
          Don&apos;t accept
        </button>
      </form>
      <p role="status" className="font-semibold">
        {message}
      </p>
    </div>
  );
}

export function RecordCsas({ workerId, firmName }: { workerId: string; firmName: string }) {
  const id = useId();
  const { off, ready, message, run } = useCheck();
  const [expiresOn, setExpiresOn] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [number, setNumber] = useState("");
  const [ownScheme, setOwnScheme] = useState(false);
  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          recordCsasAction(workerId, noExpiry ? "" : expiresOn, noExpiry, number, ownScheme),
        );
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-expires`} className={label}>
            Expiry date
          </label>
          <input
            id={`${id}-expires`}
            type="date"
            className={`${field} w-48`}
            value={noExpiry ? "" : expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            disabled={!ready || noExpiry}
          />
          <NoExpiry checked={noExpiry} onChange={setNoExpiry} disabled={!ready} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-number`} className={label}>
            Accreditation number
          </label>
          <input
            id={`${id}-number`}
            className={`${field} w-56`}
            value={number}
            maxLength={50}
            autoComplete="off"
            onChange={(e) => setNumber(e.target.value)}
            disabled={!ready}
          />
        </div>
      </div>
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-ink"
          checked={ownScheme}
          onChange={(e) => setOwnScheme(e.target.checked)}
          disabled={!ready}
        />
        <span>
          This accreditation is under {firmName}&apos;s own CSAS scheme. (One held through another
          employer doesn&apos;t cover your shifts.)
        </span>
      </label>
      <div>
        <button type="submit" className={btn.primary} disabled={off || !ownScheme}>
          Record CSAS accreditation
        </button>
      </div>
      <p role="status" className="font-semibold">
        {message}
      </p>
    </form>
  );
}

export interface UploadToCheck {
  uploadId: string;
  kind: "photo" | "certificate";
  type: string | null;
  title: string; // "Staff photo", or the qualification's name as a heading
  name: string; // in "Approve …": "staff photo", or the name mid-sentence
  alt: string;
  sent: string; // "Sent 3 Nov"
}

// "Uploads to check" on the casual's page: each waiting image (opening full size, access-checked)
// with approve and reject. The list is the one the page opened with, so a checked item stays on
// screen with its answer while the rest of the page refreshes around it.
export function UploadsToCheck({ items }: { items: UploadToCheck[] }) {
  const [shown] = useState(items);
  if (shown.length === 0) return null;
  return (
    <section className={`${card} scroll-mt-4`} aria-labelledby="uploads-heading" id="uploads">
      <h2 id="uploads-heading" className={h2}>
        Uploads to check
      </h2>
      <ul role="list" className="mt-2 divide-y divide-line">
        {shown.map((item) => (
          <li key={item.uploadId} className="py-4">
            <div className="flex flex-wrap items-start gap-4">
              <a
                href={`/files/${item.uploadId}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/files/${item.uploadId}`}
                  alt={item.alt}
                  width={160}
                  height={160}
                  className="h-40 w-40 rounded-lg border border-line bg-quiet-soft object-contain"
                />
              </a>
              <div className="min-w-0">
                <p className="font-semibold">{item.title}</p>
                <p className={`${meta} tabular-nums`}>{item.sent}</p>
              </div>
            </div>
            <CheckUpload
              uploadId={item.uploadId}
              kind={item.kind}
              type={item.type}
              name={item.name}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

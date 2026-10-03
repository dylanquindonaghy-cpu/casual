"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useHydrated } from "@/app/use-hydrated";
import { ROLE_LABELS, type OfficeRole } from "@/lib/auth/roles";
import { teamResultText, type TeamActionResult } from "@/lib/office/team-copy";
import { changeOfficeAccessAction } from "./actions";

const button =
  "rounded-lg border border-slate-400 px-3 py-2 font-semibold hover:bg-slate-100 disabled:opacity-60";
// The request itself failed: the server may have made the change, so don't say it didn't.
const failed = { status: "unknown" as const };
const ROLES = Object.keys(ROLE_LABELS) as OfficeRole[];

type Change =
  | { change: "disable" }
  | { change: "enable" }
  | { change: "sign_out" }
  | { change: "role"; role: OfficeRole };

// One person's access on the office team page: change their role (making someone an admin after a
// second "Yes"), log them out on every device, turn their access off (after a second "Yes") or back
// on. The server checks everything again. The confirmation shows in place, and the page refreshes
// under it to show the new role or access.
export function MemberActions(props: {
  officeUserId: string;
  name: string;
  role: OfficeRole;
  active: boolean;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"disable" | "admin" | null>(null);
  // The role picked but not saved yet; otherwise the role they have (which a refresh updates).
  const [picked, setPicked] = useState<OfficeRole | null>(null);
  const role = picked ?? props.role;
  const run = (change: Change) =>
    startTransition(async () => {
      const result: TeamActionResult = await changeOfficeAccessAction({
        officeUserId: props.officeUserId,
        ...change,
      }).catch(() => failed);
      setConfirming(null);
      setMessage(teamResultText(result));
      if (result.status === "done" || result.status === "unchanged") {
        setPicked(null);
        router.refresh();
      }
    });
  const off = !ready || pending;
  const roleId = `role-${props.officeUserId}`;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={roleId} className="flex flex-col font-semibold">
          Role
          <select
            id={roleId}
            className="mt-1 rounded border border-slate-400 px-2 py-2 font-normal"
            value={role}
            onChange={(e) => setPicked(e.target.value as OfficeRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={button}
          disabled={off || role === props.role || confirming !== null}
          onClick={() => {
            if (role === "admin") {
              setMessage(null);
              setConfirming("admin");
            } else run({ change: "role", role });
          }}
        >
          Change role
        </button>
      </div>
      {props.active ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            disabled={off}
            onClick={() => run({ change: "sign_out" })}
          >
            Log out on every device
          </button>
          {confirming === null && (
            <button
              type="button"
              className={button}
              disabled={off}
              onClick={() => {
                setMessage(null);
                setConfirming("disable");
              }}
            >
              Turn off access
            </button>
          )}
        </div>
      ) : (
        <div>
          <button
            type="button"
            className={button}
            disabled={off}
            onClick={() => run({ change: "enable" })}
          >
            Turn access back on
          </button>
        </div>
      )}
      {confirming === "admin" && (
        <div className="rounded-lg border border-slate-400 p-3">
          <p>
            Make {props.name} an admin? Admins can change the office team and download or delete
            workers&apos; data.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={off}
              onClick={() => run({ change: "role", role: "admin" })}
            >
              Yes, make them an admin
            </button>
            <button
              type="button"
              className={button}
              disabled={off}
              onClick={() => {
                setConfirming(null);
                setPicked(null);
              }}
            >
              Keep their role
            </button>
          </div>
        </div>
      )}
      {confirming === "disable" && props.active && (
        <div className="rounded-lg border border-slate-400 p-3">
          <p>
            Turn off {props.name}&apos;s access? They&apos;re logged out at once and can&apos;t log
            in until it&apos;s turned back on.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={off}
              onClick={() => run({ change: "disable" })}
            >
              Yes, turn off access
            </button>
            <button
              type="button"
              className={button}
              disabled={off}
              onClick={() => setConfirming(null)}
            >
              Keep their access
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btn, field } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";
import { ROLE_LABELS, type OfficeRole } from "@/lib/auth/roles";
import { teamResultText, type TeamActionResult } from "@/lib/office/team-copy";
import { changeOfficeAccessAction } from "./actions";

// The request itself failed: the server may have made the change, so don't say it didn't.
const failed = { status: "unknown" as const };
const ROLES = Object.keys(ROLE_LABELS) as OfficeRole[];
// A second "Yes" before a change: red for taking access away, grey for making someone an admin.
const confirmPanel = "rounded-lg border-2 p-4";

type Change =
  | { change: "disable" }
  | { change: "enable" }
  | { change: "sign_out" }
  | { change: "role"; role: OfficeRole };

// One person's access on the office team page: change their role (making someone an admin after a
// second "Yes"), log them out on every device, turn their access off (after a second "Yes") or back
// on. The server checks everything again. The confirmation shows in place, and the page refreshes
// under it to show the new role or access. "Turn off access" looks destructive (red outline) and
// its "Yes" is solid red.
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
    <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={roleId} className="flex flex-col gap-1 font-semibold text-ink">
          Role
          <select
            id={roleId}
            className={`${field} w-44`}
            value={role}
            onChange={(e) => setPicked(e.target.value as OfficeRole)}
            disabled={!ready}
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
          className={btn.secondary}
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
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={btn.secondary}
            disabled={off}
            onClick={() => run({ change: "sign_out" })}
          >
            Log out on every device
          </button>
          {confirming === null && (
            <button
              type="button"
              className={btn.danger}
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
            className={btn.secondary}
            disabled={off}
            onClick={() => run({ change: "enable" })}
          >
            Turn access back on
          </button>
        </div>
      )}
      {confirming === "admin" && (
        <div className={`${confirmPanel} border-line-strong bg-quiet-soft`}>
          <p>
            Make {props.name} an admin? Admins can change the office team and download or delete
            workers&apos; data.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className={btn.primary}
              disabled={off}
              onClick={() => run({ change: "role", role: "admin" })}
            >
              Yes, make them an admin
            </button>
            <button
              type="button"
              className={btn.secondary}
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
        <div className={`${confirmPanel} border-urgent bg-urgent-soft`}>
          <p className="text-urgent-ink">
            Turn off {props.name}&apos;s access? They&apos;re logged out at once and can&apos;t log
            in until it&apos;s turned back on.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className={btn.dangerSolid}
              disabled={off}
              onClick={() => run({ change: "disable" })}
            >
              Yes, turn off access
            </button>
            <button
              type="button"
              className={btn.secondary}
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

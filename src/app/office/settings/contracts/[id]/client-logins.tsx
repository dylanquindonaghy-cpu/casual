"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { btn, confirmStep, field, label, row, rows } from "@/app/ui/classes";
import { StatusChip } from "@/app/ui/status-chip";
import { useHydrated } from "@/app/use-hydrated";
import {
  ADD_LOGIN,
  addContactText,
  NO_LOGINS,
  sendLinkText,
  switchContactText,
} from "@/lib/client/office-copy";
import { addClientContactAction, sendClientLinkAction, setClientContactOnAction } from "../actions";

// A contract's client logins (Phase 36.3; the approved mock-up's "A contract's client logins"):
// each person with their work email and when they last logged in, on or off; "Send link" (on
// ones), "Turn off" (a red step first: they're logged out at once) and "Turn on"; then "Add a client
// login" (name and work email). Every change ends with its confirmation, kept above the list while
// the page refreshes under it. Waits for the page to be ready.

export interface LoginRow {
  id: string;
  name: string;
  email: string;
  isOn: boolean;
  lastIn: string; // "last in today", "not logged in yet"
}

export function ClientLogins({ contractId, logins }: { contractId: string; logins: LoginRow[] }) {
  const id = useId();
  const router = useRouter();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [turningOff, setTurningOff] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [addProblem, setAddProblem] = useState<{
    field: "name" | "email" | null;
    text: string;
  } | null>(null);
  const off = !ready || pending;
  const answer = (ok: boolean, text: string) => {
    setSaid({ ok, text });
    if (ok) router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {said && (
        <p
          role={said.ok ? "status" : "alert"}
          className={`font-semibold ${said.ok ? "text-ink" : "text-urgent-ink"}`}
        >
          {said.text}
        </p>
      )}
      <ul role="list" className={rows} aria-label="Client logins">
        {logins.length === 0 && <li className={`${row} text-ink-muted`}>{NO_LOGINS}</li>}
        {logins.map((c) => (
          <li key={c.id} className={`${row} flex flex-col gap-3`} data-login={c.email}>
            <div className="flex flex-wrap items-start gap-3">
              <p className="min-w-0 flex-1">
                <b className="block break-words">{c.name}</b>
                <span className="block text-sm break-all text-ink-muted">
                  {c.email} · {c.lastIn}
                </span>
              </p>
              <StatusChip tone={c.isOn ? "done" : "quiet"}>{c.isOn ? "On" : "Off"}</StatusChip>
            </div>
            {turningOff === c.id ? (
              <div className={`${confirmStep} flex flex-col gap-3`}>
                <p>Turn off {c.name}? They&apos;re logged out now and their links stop working.</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={off}
                    className={btn.dangerSolid}
                    onClick={() =>
                      start(async () => {
                        const r = await setClientContactOnAction(c.id, false).catch(() => ({
                          status: "error" as const,
                        }));
                        setTurningOff(null);
                        answer(r.status === "switched", switchContactText(r, c.name));
                      })
                    }
                  >
                    Yes, turn off {c.name}
                  </button>
                  <button
                    type="button"
                    disabled={off}
                    className={btn.secondary}
                    onClick={() => setTurningOff(null)}
                  >
                    Keep them on
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {c.isOn ? (
                  <>
                    <button
                      type="button"
                      disabled={off}
                      className={btn.small}
                      aria-label={`Send link to ${c.name}`}
                      onClick={() =>
                        start(async () => {
                          const r = await sendClientLinkAction(c.id).catch(() => ({
                            status: "error" as const,
                          }));
                          answer(r.status === "sent", sendLinkText(r, c.name));
                        })
                      }
                    >
                      Send link
                    </button>
                    <button
                      type="button"
                      disabled={off}
                      className={btn.small}
                      aria-label={`Turn off ${c.name}`}
                      onClick={() => {
                        setSaid(null);
                        setTurningOff(c.id);
                      }}
                    >
                      Turn off
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={off}
                    className={btn.small}
                    aria-label={`Turn on ${c.name}`}
                    onClick={() =>
                      start(async () => {
                        const r = await setClientContactOnAction(c.id, true).catch(() => ({
                          status: "error" as const,
                        }));
                        answer(r.status === "switched", switchContactText(r, c.name));
                      })
                    }
                  >
                    Turn on
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <form
        className="glass flex flex-col gap-3 rounded-inner p-4"
        aria-labelledby={`${id}-add`}
        onSubmit={(e) => {
          e.preventDefault();
          setAddProblem(null);
          const who = name.trim();
          start(async () => {
            const r = await addClientContactAction(contractId, name, email).catch(() => ({
              status: "error" as const,
            }));
            const text = addContactText(r, who);
            if (r.status === "added") {
              setName("");
              setEmail("");
              answer(true, text);
            } else {
              setAddProblem({
                field:
                  r.status === "invalid" ? r.problem : r.status === "email_taken" ? "email" : null,
                text,
              });
            }
          });
        }}
      >
        <h3 id={`${id}-add`} className="font-semibold">
          {ADD_LOGIN}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-name`} className={label}>
              Their name
            </label>
            <input
              disabled={!ready}
              id={`${id}-name`}
              value={name}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={addProblem?.field === "name"}
              aria-describedby={addProblem?.field === "name" ? `${id}-problem` : undefined}
              className={`${field} w-full`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-email`} className={label}>
              Their work email
            </label>
            <input
              disabled={!ready}
              id={`${id}-email`}
              type="email"
              value={email}
              maxLength={254}
              autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={addProblem?.field === "email"}
              aria-describedby={addProblem?.field === "email" ? `${id}-problem` : undefined}
              className={`${field} w-full`}
            />
          </div>
        </div>
        {addProblem && (
          <p id={`${id}-problem`} role="alert" className="font-semibold text-urgent-ink">
            {addProblem.text}
          </p>
        )}
        <button type="submit" disabled={off} className={`${btn.primary} self-start`}>
          {ADD_LOGIN}
        </button>
      </form>
    </div>
  );
}

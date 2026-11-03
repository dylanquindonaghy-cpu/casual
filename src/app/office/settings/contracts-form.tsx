"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { ContractRow, SiteChoice } from "@/lib/office/contracts";
import {
  ADD_CONTRACT,
  CONTRACT_NAME,
  contractResultText,
  ITS_VENUES,
  otherContract,
  REMOVE_CHECK,
  REMOVE_CONTRACT,
  SAVE_CONTRACT,
  YES_REMOVE,
} from "@/lib/office/customise-copy";
import { btn, checkStep, field, label as labelClass } from "../../ui/classes";
import { useHydrated } from "../../use-hydrated";
import { removeContractAction, saveContractAction } from "./actions";

// One contract on Settings (Phase 26.3; the spec page's cus-1), or a new one: its name and the
// venues it owns (a venue in another contract says whose; ticking it moves it here), "Save", and
// for one that exists "Remove" after a check. The answer shows under it; the page reloads its data.
// A removal's answer goes to the list above (`onRemoved`): the reload takes this row away.

export function ContractForm({
  contract,
  sites,
  names,
  onRemoved,
}: {
  contract: ContractRow | null; // null: a new one
  sites: SiteChoice[];
  names: Record<string, string>; // each contract's name, by id
  onRemoved?: (message: string) => void;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const id = useId();
  const [pending, start] = useTransition();
  const [name, setName] = useState(contract?.name ?? "");
  const [picked, setPicked] = useState(new Set(contract?.siteIds ?? []));
  const [message, setMessage] = useState<string | null>(null);
  // When this contract changed on the server (a save, or a venue taken by another contract), the
  // form starts again from it; its answer stays. Another row's save leaves it as it is.
  const loaded = contract ? `${contract.name}|${contract.siteIds.join(",")}` : "";
  const [seen, setSeen] = useState(loaded);
  if (seen !== loaded) {
    setSeen(loaded);
    setName(contract?.name ?? "");
    setPicked(new Set(contract?.siteIds ?? []));
  }
  const save = () =>
    start(async () => {
      const result = await saveContractAction(
        contract?.clientId ?? null,
        name,
        [...picked],
        contract?.siteIds ?? [],
      ).catch(() => ({ status: "error" as const }));
      setMessage(contractResultText(result, name.trim()));
      if (result.status === "saved") {
        if (!contract) {
          setName("");
          setPicked(new Set());
        }
        router.refresh();
      }
    });
  const remove = () =>
    start(async () => {
      if (!contract) return;
      const result = await removeContractAction(contract.clientId).catch(() => ({
        status: "error" as const,
      }));
      const words = contractResultText(result, contract.name);
      if (result.status === "removed") {
        onRemoved?.(words);
        router.refresh();
      } else {
        setMessage(words);
      }
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-name`} className={labelClass}>
          {CONTRACT_NAME}
        </label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={120}
          required
          disabled={!ready}
          onChange={(e) => setName(e.target.value)}
          className={`${field} w-full max-w-md`}
        />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className={labelClass}>{ITS_VENUES}</legend>
        <ul role="list" className="mt-1 grid gap-1 sm:grid-cols-2">
          {sites.map((s) => {
            const elsewhere =
              s.clientId && s.clientId !== contract?.clientId ? names[s.clientId] : null;
            return (
              <li key={s.siteId}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-row px-2 hover:bg-active">
                  <input
                    type="checkbox"
                    checked={picked.has(s.siteId)}
                    disabled={!ready}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(s.siteId);
                      else next.delete(s.siteId);
                      setPicked(next);
                    }}
                    className="size-5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="text-ink">{s.name}</span>
                    {elsewhere && (
                      <span className="text-ink-faint"> {otherContract(elsewhere)}</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex flex-wrap items-start gap-3">
        <button
          type="submit"
          disabled={pending || !ready}
          className={contract ? btn.secondary : btn.primary}
        >
          {contract ? SAVE_CONTRACT : ADD_CONTRACT}
        </button>
        {contract && (
          <details className="group">
            <summary
              aria-label={`${REMOVE_CONTRACT} ${contract.name}`}
              className={`${btn.danger} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              {REMOVE_CONTRACT}
            </summary>
            <div className={`mt-2 flex flex-col gap-3 ${checkStep}`}>
              <p className="text-sm">{REMOVE_CHECK}</p>
              <button
                type="button"
                disabled={pending || !ready}
                onClick={remove}
                className={`${btn.danger} self-start`}
              >
                {YES_REMOVE}
              </button>
            </div>
          </details>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm font-medium text-ink">
          {message}
        </p>
      )}
    </form>
  );
}

"use client";

import { useId, useState } from "react";
import { hint } from "@/app/ui/classes";
import { useHydrated } from "@/app/use-hydrated";

// A session's extra requirements (docs/office-v2.md S2): the firm's qualification types as
// checkboxes, behind a button so a line stays short on a phone. A button that shows and hides a
// list, not <details> or a <fieldset>: both are "group"s, and the browser tests find the shift
// form's lines as the page's groups, in order.
export function RequirementsPicker({
  options,
  value,
  onChange,
  disabled,
  locked,
}: {
  options: { code: string; name: string }[];
  value: string[];
  onChange: (codes: string[]) => void;
  disabled: boolean;
  locked?: string; // why they can't change, shown instead of the boxes' effect
}) {
  const id = useId();
  const ready = useHydrated();
  const [open, setOpen] = useState(value.length > 0);
  const chosen = options.filter((o) => value.includes(o.code));
  const toggle = (code: string, on: boolean) =>
    onChange(on ? [...value, code] : value.filter((c) => c !== code));
  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled || !ready}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-ink underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Extra requirements{chosen.length > 0 ? ` (${chosen.length})` : " (optional)"}
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-1">
        <p className={hint}>Needed on top of what the role needs.</p>
        {locked && <p className={hint}>{locked}</p>}
        <ul role="list" className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
          {options.map((o) => (
            <li key={o.code}>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-current"
                  checked={value.includes(o.code)}
                  disabled={disabled || !ready || locked !== undefined}
                  onChange={(e) => toggle(o.code, e.target.checked)}
                />
                {qualificationLabel(o.name)}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Pack names are lower case after the first word ("first aid at work certificate").
export const qualificationLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

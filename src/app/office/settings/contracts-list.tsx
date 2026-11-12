"use client";

import Link from "next/link";
import { useState } from "react";
import { quietLink, row, rows } from "@/app/ui/classes";
import { Icon } from "@/app/ui/icons";
import type { ContractRow, SiteChoice } from "@/lib/office/contracts";
import { NO_CONTRACTS_YET } from "@/lib/office/customise-copy";
import { ContractForm } from "./contracts-form";

// Settings' list of contracts (Phase 26.3), each a form (and since Phase 36.3 a link to its own
// page, its client logins), then a blank one. A removal's answer
// ("Removed {Northgate Council}.") shows above the list, not in its row: the page reloads its data
// and the row goes with it, so the answer would go too (the browser tests caught it: Phase 26.10).
// This list keeps it through the reload.

export function ContractsList({
  contracts,
  sites,
  names,
  className,
}: {
  contracts: ContractRow[];
  sites: SiteChoice[];
  names: Record<string, string>;
  className: string;
}) {
  const [removed, setRemoved] = useState<string | null>(null);
  return (
    <>
      {removed && (
        <p role="status" className="mt-3 text-sm font-medium text-ink">
          {removed}
        </p>
      )}
      <ul role="list" className={`${rows} ${className}`}>
        {contracts.length === 0 && <li className={`${row} text-ink-muted`}>{NO_CONTRACTS_YET}</li>}
        {contracts.map((c) => (
          <li key={c.clientId} className={row}>
            <ContractForm contract={c} sites={sites} names={names} onRemoved={setRemoved} />
            {/* Its own page (Phase 36.3): who at the client may log in and send requests. */}
            <Link
              href={`/office/settings/contracts/${c.clientId}`}
              className={`${quietLink} mt-2`}
              aria-label={`Client logins for ${c.name}`}
            >
              Client logins
              <Icon name="chevron" size={16} />
            </Link>
          </li>
        ))}
        <li className={row}>
          {/* Not keyed by the list's length: a new key after an add rebuilt the form, and its
              answer ("Saved {Northgate Council}.") went before it could be read (the browser
              tests caught it, Phase 27.9's verify). The form clears its own fields on a save. */}
          <ContractForm contract={null} sites={sites} names={names} />
        </li>
      </ul>
    </>
  );
}

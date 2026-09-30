import { isLocalHost } from "../src/lib/db/admin/urls";

// Gate B (PLAN.md "Gates"; golden rule 7): no real data before a firm's agreement and DPA are
// signed. The import command (scripts/import.ts) saves rows into a live database only when the
// person running it repeats the firm's slug after --agreement-signed, saying the paperwork is
// signed for that firm. A dry run saves nothing, and a database on this machine (development,
// tests) holds fake data only, so neither is asked.

export type GateBCheck = { ok: true } | { ok: false; reason: "not_confirmed" | "wrong_firm" };

export function gateBCheck(input: {
  apply: boolean;
  databaseUrl: string;
  firm: string;
  agreementSigned: string | undefined;
}): GateBCheck {
  if (!input.apply || isLocalHost(input.databaseUrl)) return { ok: true };
  if (input.agreementSigned === undefined) return { ok: false, reason: "not_confirmed" };
  return input.agreementSigned.trim().toLowerCase() === input.firm.trim().toLowerCase()
    ? { ok: true }
    : { ok: false, reason: "wrong_firm" };
}

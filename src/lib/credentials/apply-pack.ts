import { sql } from "drizzle-orm";
import { credentialRules, credentialTypes } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent, type ActorType } from "../events/record";
import { ANY_SECTOR_TYPES, CREDENTIAL_PACKS, type Sector } from "../rules/packs";

// Gives the current firm a sector's credential pack: its credential types (plus the any-sector
// ones) and its default role rules, inside the caller's withFirm transaction. Never overwrites:
// a type or a role rule the firm already has stays exactly as it is, so re-running the seed or
// re-applying a pack can't undo the office's edits. Logged only when something was added.

export async function applyCredentialPack(
  tx: FirmTx,
  sector: Sector,
  actor: { type: ActorType; id?: string | null },
): Promise<{ typesAdded: number; rulesAdded: number }> {
  const pack = CREDENTIAL_PACKS[sector];
  const types = [
    ...pack.types.map((t) => ({ ...t, sector })),
    ...ANY_SECTOR_TYPES.map((t) => ({ ...t, sector: "any" as const })),
  ];
  const addedTypes = await tx
    .insert(credentialTypes)
    .values(
      types.map((t) => ({
        firmId: sql`app_current_firm_id()`,
        code: t.code,
        name: t.name,
        sector: t.sector,
        appliedAllowed: t.appliedAllowed ?? false,
      })),
    )
    .onConflictDoNothing({ target: [credentialTypes.firmId, credentialTypes.code] })
    .returning({ code: credentialTypes.code, appliedAllowed: credentialTypes.appliedAllowed });
  const addedRules = await tx
    .insert(credentialRules)
    .values(
      pack.rules.map((r) => ({
        firmId: sql`app_current_firm_id()`,
        sector,
        role: r.role,
        requiredTypes: r.requiredTypes,
      })),
    )
    .onConflictDoNothing({ target: [credentialRules.firmId, credentialRules.role] })
    .returning({ role: credentialRules.role, requiredTypes: credentialRules.requiredTypes });
  const result = { typesAdded: addedTypes.length, rulesAdded: addedRules.length };
  if (result.typesAdded + result.rulesAdded > 0) {
    await recordEvent(tx, {
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: "credential_pack.applied",
      entityType: "credential_pack",
      // Exactly what the firm started with: the pack in code may change later.
      data: { sector, ...result, types: addedTypes, rules: addedRules },
    });
  }
  return result;
}

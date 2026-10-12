import { inArray } from "drizzle-orm";
import { credentialRules, credentialTypes } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { RIGHT_TO_WORK } from "./status";

// What a session needs (docs/office-v2.md 3.3, 4.3, 4.4; 12H.2), read one way for the office's
// session rows and the casual app's chips and "What it needs": its role's qualifications (the
// firm's rules) and then its own extras (`shifts.required_credentials`), each once, with its name.
// Never right to work: that's a status, not a requirement shown on a shift (Rules 15). Reads only;
// the rules engine decides who may take the shift (golden rule 1).

export interface Requirement {
  code: string;
  name: string; // as stored, mid-sentence ("first aid at work certificate")
}

// Short names for the chips; any other qualification uses its own name.
const SHORT_NAMES: Record<string, string> = {
  SIA_DS: "SIA DS",
  SIA_SG: "SIA SG",
  SIA_CP: "SIA CP",
  STEWARD_L2: "Steward L2",
  FIRST_AID: "First aid",
  CSAS: "CSAS",
  MANUAL_HANDLING: "Manual handling",
};

export const requirementChip = (r: Requirement): string =>
  SHORT_NAMES[r.code] ?? r.name.charAt(0).toUpperCase() + r.name.slice(1);

export interface RequirementsReader {
  of: (role: string, extras: readonly string[]) => Requirement[];
}

// The firm's rules for these roles and every type's name, read once (two queries however many
// sessions); `of` then lists one session's requirements: the role's first, then its extras.
export async function readRequirements(
  tx: FirmTx,
  roles: readonly string[],
): Promise<RequirementsReader> {
  const wanted = [...new Set(roles)];
  const rules = wanted.length
    ? await tx
        .select({ role: credentialRules.role, types: credentialRules.requiredTypes })
        .from(credentialRules)
        .where(inArray(credentialRules.role, wanted))
    : [];
  const byRole = new Map<string, string[]>();
  for (const r of rules) byRole.set(r.role, [...(byRole.get(r.role) ?? []), ...r.types]);
  const names = new Map(
    (
      await tx
        .select({ code: credentialTypes.code, name: credentialTypes.name })
        .from(credentialTypes)
    ).map((t) => [t.code, t.name]),
  );
  return {
    of: (role, extras) =>
      [...new Set([...(byRole.get(role) ?? []), ...extras])]
        .filter((code) => code !== RIGHT_TO_WORK)
        .map((code) => ({ code, name: names.get(code) ?? code })),
  };
}

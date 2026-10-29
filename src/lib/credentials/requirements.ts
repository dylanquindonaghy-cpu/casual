import { inArray } from "drizzle-orm";
import { credentialRules, credentialTypes } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// What a session needs (docs/office-v2.md 3.3, 4.3, 4.4; 12H.2), read one way for the office's
// session rows and the casual app's chips and "What it needs": its role's qualifications (the
// firm's rules) and then its own extras (`shifts.required_credentials`), each once, with its name:
// every type the rules engine checks for it, so nothing it enforces goes unshown (a right to work
// check the office added as an extra included). A role's one-of group (P3.3) shows as its first
// type until the words for "A or B" are approved (after the UI chat's Phase 24, a mock-up first),
// and any type of it is one a casual may send. Reads only; the rules engine decides who may take
// the shift (golden rule 1).

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
  // Whether one of these roles' rules needs the type: what a casual may send herself (the upload
  // page and saveMyUpload() take only those: src/lib/uploads/save.ts).
  rolesNeed: (roles: readonly string[], code: string) => boolean;
  officeRecorded: (code: string) => boolean; // the firm's own word (credential_types)
}

// The firm's rules for these roles and every type's name, read once (two queries however many
// sessions); `of` then lists one session's requirements: the role's first, then its extras. Pass
// every role `rolesNeed` will be asked about.
export async function readRequirements(
  tx: FirmTx,
  roles: readonly string[],
): Promise<RequirementsReader> {
  const wanted = [...new Set(roles)];
  const rules = wanted.length
    ? await tx
        .select({
          role: credentialRules.role,
          types: credentialRules.requiredTypes,
          anyOf: credentialRules.anyOfTypes,
        })
        .from(credentialRules)
        .where(inArray(credentialRules.role, wanted))
    : [];
  // What each role's sessions show (its types, then its group's first), and every type it needs.
  const byRole = new Map<string, string[]>();
  const allOf = new Map<string, string[]>();
  for (const r of rules) {
    byRole.set(r.role, [...(byRole.get(r.role) ?? []), ...r.types, ...r.anyOf.slice(0, 1)]);
    allOf.set(r.role, [...(allOf.get(r.role) ?? []), ...r.types, ...r.anyOf]);
  }
  const types = await tx
    .select({
      code: credentialTypes.code,
      name: credentialTypes.name,
      officeRecorded: credentialTypes.officeRecorded,
    })
    .from(credentialTypes);
  const names = new Map(types.map((t) => [t.code, t.name]));
  const officeOnly = new Set(types.filter((t) => t.officeRecorded).map((t) => t.code));
  return {
    of: (role, extras) =>
      [...new Set([...(byRole.get(role) ?? []), ...extras])].map((code) => ({
        code,
        name: names.get(code) ?? code,
      })),
    rolesNeed: (roles, code) => roles.some((role) => allOf.get(role)?.includes(code)),
    officeRecorded: (code) => officeOnly.has(code),
  };
}

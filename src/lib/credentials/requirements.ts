import { inArray } from "drizzle-orm";
import { credentialRules, credentialTypes } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { orList } from "../rules/reasons";

// What a session needs (docs/office-v2.md 3.3, 4.3, 4.4; 12H.2), read one way for the office's
// session rows and the casual app's chips and "What it needs": its role's qualifications (the
// firm's rules) and then its own extras (`shifts.required_credentials`), each once, with its name:
// every type the rules engine checks for it, so nothing it enforces goes unshown (a right to work
// check the office added as an extra included). A role's one-of group (P3.3): of() lists its first
// type, which a casual's own view replaces with the one that stands best for her
// (src/lib/portal/shift-facts.ts); the office reads it as "A or B" (officeOf, Phase 25.2); any type
// of it is one a casual may send. Reads only; the rules engine decides who may take
// the shift (golden rule 1).

export interface Requirement {
  code: string;
  name: string; // as stored, mid-sentence ("first aid at work certificate")
  // A one-of group, as the office reads it (Phase 25.2): any one of these will do. `code` is its
  // first, `name` "A or B".
  group?: Requirement[];
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

const oneChip = (r: Requirement): string =>
  SHORT_NAMES[r.code] ?? r.name.charAt(0).toUpperCase() + r.name.slice(1);

export const requirementChip = (r: Requirement): string =>
  r.group ? orList(r.group.map(oneChip)) : oneChip(r);

export interface RequirementsReader {
  of: (role: string, extras: readonly string[]) => Requirement[];
  // The office's reading (Phase 25.2): the role's one-of group as one "A or B", unless the session
  // asks for one of it outright (then each as of() lists it).
  officeOf: (role: string, extras: readonly string[]) => Requirement[];
  // The role's one-of group (P3.3), [] for none: of() shows its first; a casual's own view shows
  // the one that stands best for her (src/lib/portal/shift-facts.ts).
  groupOf: (role: string) => string[];
  nameOf: (code: string) => string;
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
  const groups = new Map<string, string[]>();
  for (const r of rules) {
    groups.set(r.role, [...r.anyOf]);
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
  const of = (role: string, extras: readonly string[]): Requirement[] =>
    [...new Set([...(byRole.get(role) ?? []), ...extras])].map((code) => ({
      code,
      name: names.get(code) ?? code,
    }));
  return {
    of,
    officeOf: (role, extras) => {
      const group = groups.get(role) ?? [];
      const shown = of(role, extras);
      if (group.length < 2 || group.some((code) => extras.includes(code))) return shown;
      return shown.map((r) => {
        if (r.code !== group[0]) return r;
        const members = group.map((code) => ({ code, name: names.get(code) ?? code }));
        return { ...r, name: orList(members.map((a) => a.name)), group: members };
      });
    },
    groupOf: (role) => groups.get(role) ?? [],
    nameOf: (code) => names.get(code) ?? code,
    rolesNeed: (roles, code) => roles.some((role) => allOf.get(role)?.includes(code)),
    officeRecorded: (code) => officeOnly.has(code),
  };
}

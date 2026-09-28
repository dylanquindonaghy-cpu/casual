import type { SECTORS } from "../db/schema/tenancy";

// The credential packs (docs/rules-and-credentials.md, "Credential packs"): per sector, the
// credential types firms in it use, with the name workers know each by, and default rules for
// which credentials a role needs. Data, not logic (golden rule 6: never hardcoded to SIA): the
// rules engine reads whatever a firm's rules and types say. A firm gets its sector's pack when it
// is set up (applyCredentialPack); every sector's pack is here, used only once a firm needs it.
// tests/unit/credential.packs.test.ts fails if this and the doc's table ever differ.
//
// Typical validity is a guide only: the expiry on the card is what's stored and used.

export type Sector = (typeof SECTORS)[number];

export interface PackType {
  code: string;
  name: string; // as workers know it, lower case after the first word ("SIA door supervisor licence")
  typicalValidity: string; // from the doc, for the office; never used for expiry
  // Whether an application in progress may count within the firm's allowance (an SIA approved
  // contractor rule; confirm the current SIA position before a firm turns it on).
  appliedAllowed?: boolean;
}

export interface PackRule {
  role: string;
  requiredTypes: string[]; // every one needed; [] = the role needs none
}

export interface CredentialPack {
  sector: Sector;
  types: PackType[];
  rules: PackRule[];
}

// Types every sector's firms may use (checked at onboarding, not per shift).
export const ANY_SECTOR_TYPES: PackType[] = [
  { code: "RTW", name: "right to work check", typicalValidity: "Per document" },
];

export const CREDENTIAL_PACKS: Record<Sector, CredentialPack> = {
  security: {
    sector: "security",
    types: [
      {
        code: "SIA_DS",
        name: "SIA door supervisor licence",
        typicalValidity: "3 years",
        appliedAllowed: true,
      },
      {
        code: "SIA_SG",
        name: "SIA security guard licence",
        typicalValidity: "3 years",
        appliedAllowed: true,
      },
      {
        code: "SIA_CP",
        name: "SIA close protection licence",
        typicalValidity: "3 years",
        appliedAllowed: true,
      },
      {
        code: "STEWARD_L2",
        name: "Level 2 spectator safety qualification",
        typicalValidity: "No expiry",
      },
      { code: "FIRST_AID", name: "first aid at work certificate", typicalValidity: "3 years" },
    ],
    rules: [
      { role: "steward", requiredTypes: ["STEWARD_L2"] },
      { role: "door_supervisor", requiredTypes: ["SIA_DS"] },
      { role: "security_officer", requiredTypes: ["SIA_SG"] },
      { role: "close_protection_officer", requiredTypes: ["SIA_CP"] },
    ],
  },
  rail: {
    sector: "rail",
    types: [
      { code: "PTS", name: "PTS card", typicalValidity: "Renewal typically every 2 years" },
      { code: "SENTINEL", name: "Sentinel card", typicalValidity: "Ongoing" },
      {
        code: "RAIL_DA",
        name: "drugs and alcohol test",
        typicalValidity: "Recent test required (e.g. within 3 months for new sponsorship)",
      },
      { code: "RAIL_MEDICAL", name: "rail safety-critical medical", typicalValidity: "Varies" },
    ],
    rules: [
      { role: "track_operative", requiredTypes: ["PTS", "SENTINEL", "RAIL_DA"] },
      { role: "lookout", requiredTypes: ["PTS", "SENTINEL", "RAIL_DA"] },
    ],
  },
  construction: {
    sector: "construction",
    types: [
      { code: "CSCS", name: "CSCS card", typicalValidity: "Typically 5 years" },
      {
        code: "CPCS_NPORS",
        name: "plant operator card (CPCS or NPORS)",
        typicalValidity: "Varies",
      },
      {
        code: "SMSTS_SSSTS",
        name: "site supervision certificate (SMSTS or SSSTS)",
        typicalValidity: "5 years",
      },
    ],
    rules: [
      { role: "labourer", requiredTypes: ["CSCS"] },
      { role: "plant_operator", requiredTypes: ["CSCS", "CPCS_NPORS"] },
      { role: "site_supervisor", requiredTypes: ["CSCS", "SMSTS_SSSTS"] },
    ],
  },
  cleaning: {
    sector: "cleaning",
    types: [
      {
        code: "DBS",
        name: "DBS check",
        typicalValidity: "No fixed expiry; firm policy (or update service)",
      },
    ],
    // DBS is needed where the site requires it, not for the role everywhere.
    rules: [{ role: "cleaner", requiredTypes: [] }],
  },
};

import type { NeedsItem, Qualification } from "@/lib/credentials/status";

// Qualifications and "Needs updating" rows for page tests (12F.1): the shapes
// src/lib/credentials/status.ts returns, made up.

export const qual = (o: Partial<Qualification> = {}): Qualification => ({
  type: "SIA_DS",
  name: "SIA door supervisor licence",
  status: "valid",
  expiresOn: "2029-01-01",
  neededFor: ["door_supervisor"],
  appliedCounts: false,
  renewing: false,
  ...o,
});

export const need = (
  level: NeedsItem["level"],
  q: Partial<Qualification>,
  blocks: NeedsItem["blocks"] = null,
): NeedsItem => ({ level, qualification: qual(q), blocks });

// One of each status, worst first, as Profile lists them.
export const EVERY_STATUS: Qualification[] = [
  qual({
    type: "SIA_CP",
    name: "SIA close protection licence",
    status: "suspended",
    expiresOn: null,
    neededFor: ["close_protection_officer"],
  }),
  qual({
    type: "FIRST_AID",
    name: "first aid at work certificate",
    status: "expired",
    expiresOn: "2026-10-01",
    neededFor: ["response_team_lead"],
  }),
  qual({
    type: "CSAS",
    name: "CSAS accreditation",
    status: "missing",
    expiresOn: null,
    neededFor: ["csas_officer"],
  }),
  qual({ type: "SIA_DS", status: "expiring_soon", expiresOn: "2026-11-20" }),
  qual({
    type: "SIA_SG",
    name: "SIA security guard licence",
    status: "applied",
    expiresOn: null,
    neededFor: ["security_officer"],
  }),
  qual({
    type: "STEWARD_L2",
    name: "Level 2 spectator safety qualification",
    status: "valid",
    expiresOn: null,
    neededFor: ["steward"],
  }),
];

// One row of each level, in order.
export const EVERY_LEVEL: NeedsItem[] = [
  need(
    1,
    { status: "expiring_soon", expiresOn: "2026-11-05" },
    { role: "door_supervisor", day: "2026-11-06" },
  ),
  need(2, {
    type: "SIA_CP",
    name: "SIA close protection licence",
    status: "suspended",
    expiresOn: null,
    neededFor: ["close_protection_officer"],
  }),
  need(2, {
    type: "FIRST_AID",
    name: "first aid at work certificate",
    status: "expired",
    expiresOn: "2026-10-01",
    neededFor: ["response_team_lead"],
  }),
  need(3, {
    type: "SIA_SG",
    name: "SIA security guard licence",
    status: "expiring_soon",
    expiresOn: "2026-11-25",
    neededFor: ["security_officer"],
  }),
  need(4, {
    type: "CSAS",
    name: "CSAS accreditation",
    status: "missing",
    expiresOn: null,
    neededFor: ["csas_officer", "steward"],
  }),
];

import type { OFFICE_ROLES } from "../db/schema";

// Office roles (docs/product-spec.md): admin (the firm's owner or manager), resourcer (fills
// shifts), payroll (pay queries). Each office area lists the roles that may use it; every page
// and action for an area checks it on the server. Areas are added as later phases build them.

export type OfficeRole = (typeof OFFICE_ROLES)[number];

export const OFFICE_AREAS = {
  dashboard: ["admin", "resourcer", "payroll"],
  team: ["admin"], // who has office access, and their roles
  today: ["admin", "resourcer"], // gaps, urgent shifts, cancellations, requests, expiries
  shifts: ["admin", "resourcer"], // the shift list, creating, editing, importing, assigning
  requests: ["admin", "resourcer"], // workers' requests: approve or decline with a note
  log: ["admin", "resourcer"], // the action log, with filters
  reports: ["admin", "resourcer"], // the notice and cancellation report (and its CSV)
} as const satisfies Record<string, readonly OfficeRole[]>;

export type OfficeArea = keyof typeof OFFICE_AREAS;

export function canAccess(role: OfficeRole, area: OfficeArea): boolean {
  return (OFFICE_AREAS[area] as readonly OfficeRole[]).includes(role);
}

export const ROLE_LABELS: Record<OfficeRole, string> = {
  admin: "Admin",
  resourcer: "Resourcer",
  payroll: "Payroll",
};

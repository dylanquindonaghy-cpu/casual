import { nameMap, ROLE_PATTERN, type NameKind } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// A firm's name map (P3.2; "Connecting the firm's systems" 2; the table: name_map, set by the owner
// with `npm run firm:names`): what the firm's own system calls a role ("Door Supervisor (NLW)",
// "12D"), mapped to a ShiftDesk code, or to skip ("Holiday", "Not Set"). The sheet sync and the file
// import read a role's name through it, with normaliseRole() (below) as the fallback for a name
// the firm hasn't mapped; a name neither can read is a bad role, as before,
// so its row is never brought in and never offered. A firm with no map reads every name exactly as
// before. The credentials import reads a qualification's name through it the same way (the
// import's own spelling as the fallback). Staff types and cancellation reasons, which neither the
// sheet nor a file carries, and a role's pay rate are for the connector (P5). Pure, but for
// loadNameMap().

export const NAME_MAX = 200;

// A role as ShiftDesk spells it: "Door supervisor" is door_supervisor. Null for one it can't
// (brackets, "12D"). The rota sheet, the file import, the planner API and the office's editor all
// read roles with it (re-exported from src/lib/roster/sheets/parse.ts).
const rolePattern = new RegExp(ROLE_PATTERN);
export function normaliseRole(raw: string): string | null {
  const role = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return rolePattern.test(role) ? role : null;
}

// A qualification as the file import spells it: "SIA ds" is SIA_DS. Null for one it can't.
export function normaliseQualification(raw: string): string | null {
  const code = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return /^[A-Z][A-Z0-9_]*$/.test(code) && code.length <= 50 ? code : null;
}

// The key a name is held by: trimmed, lower case, one space between words. Null for a name that's
// empty, too long or holds a control or format character (whatever the database's own reading of
// "control" is: an ICU one counts format characters such as a soft hyphen).
export function nameKey(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (key === "" || key.length > NAME_MAX) return null;
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(key) ? null : key;
}

export interface MappedName {
  code: string | null; // null: skip
  payRatePence: number | null;
}

// kind -> key -> what it maps to.
export type NameMap = ReadonlyMap<NameKind, ReadonlyMap<string, MappedName>>;
export const NO_NAMES: NameMap = new Map();

export type RoleName = { role: string } | { skip: true } | null;

// A role's name as the firm's map reads it, else as normaliseRole() does (null: neither can).
export function readRoleName(raw: string, names: NameMap = NO_NAMES): RoleName {
  const key = nameKey(raw);
  const mapped = key === null ? undefined : names.get("role")?.get(key);
  if (mapped) return mapped.code === null ? { skip: true } : { role: mapped.code };
  const role = normaliseRole(raw);
  return role === null ? null : { role };
}

export type QualificationName = { code: string } | { skip: true } | null;

// A qualification's name as the firm's map reads it, else as normaliseQualification() does.
export function readQualificationName(raw: string, names: NameMap = NO_NAMES): QualificationName {
  const key = nameKey(raw);
  const mapped = key === null ? undefined : names.get("qualification")?.get(key);
  if (mapped) return mapped.code === null ? { skip: true } : { code: mapped.code };
  const code = normaliseQualification(raw);
  return code === null ? null : { code };
}

// A list of role names (a worker's): the codes, each once, with the skipped names left out; null
// if any can't be read.
export function readRoleNames(raws: string[], names: NameMap = NO_NAMES): string[] | null {
  const roles: string[] = [];
  for (const raw of raws) {
    const read = readRoleName(raw, names);
    if (read === null) return null;
    if ("role" in read && !roles.includes(read.role)) roles.push(read.role);
  }
  return roles;
}

// The firm's map, from its rows (RLS scopes them to the transaction's firm).
export async function loadNameMap(tx: FirmTx): Promise<NameMap> {
  const rows = await tx
    .select({
      kind: nameMap.kind,
      outsideName: nameMap.outsideName,
      code: nameMap.code,
      payRatePence: nameMap.payRatePence,
    })
    .from(nameMap);
  const map = new Map<NameKind, Map<string, MappedName>>();
  for (const r of rows) {
    const kind = map.get(r.kind) ?? new Map<string, MappedName>();
    kind.set(r.outsideName, { code: r.code, payRatePence: r.payRatePence });
    map.set(r.kind, kind);
  }
  return map;
}

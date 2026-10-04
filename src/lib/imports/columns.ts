import { ImportFileError } from "./errors";

// Which header names mean what, per kind of import. Firms' spreadsheets name columns differently,
// so each field accepts a few common names (case, spaces and punctuation ignored).

export const IMPORT_KINDS = ["workers", "credentials", "shifts", "pay"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

interface FieldSpec {
  names: readonly string[];
  required?: boolean;
}

export const COLUMNS = {
  workers: {
    ref: { names: ["staff id", "staff no", "staff number", "employee id", "payroll id"] },
    firstName: { names: ["first name", "forename", "given name"], required: true },
    lastName: { names: ["last name", "surname", "family name"], required: true },
    mobile: {
      names: ["mobile", "mobile number", "phone", "phone number", "mobile phone"],
      required: true,
    },
    email: { names: ["email", "email address", "e mail"] },
    roles: { names: ["roles", "role", "job roles"] },
    status: { names: ["status"] },
  },
  credentials: {
    // One of ref or mobile identifies the worker (checked below).
    ref: { names: ["staff id", "staff no", "staff number", "employee id", "payroll id"] },
    mobile: { names: ["mobile", "mobile number", "phone", "phone number", "mobile phone"] },
    // A row found by mobile (no Staff ID) must name the worker too (src/lib/imports/import.ts).
    firstName: { names: ["first name", "forename", "given name"] },
    lastName: { names: ["last name", "surname", "family name"] },
    name: { names: ["name", "full name", "worker", "worker name", "employee name", "staff name"] },
    type: {
      names: ["type", "credential", "credential type", "licence type", "license type", "card type"],
      required: true,
    },
    number: {
      names: ["number", "licence number", "license number", "card number", "credential number"],
    },
    expires: { names: ["expires", "expiry", "expiry date", "expires on", "valid until"] },
    status: { names: ["status"] },
  },
  shifts: {
    ref: { names: ["shift id", "shift ref", "shift reference"] },
    date: { names: ["date", "shift date"], required: true },
    start: { names: ["start", "start time", "from"], required: true },
    end: { names: ["end", "end time", "finish", "finish time", "to"], required: true },
    site: { names: ["site", "venue", "location"] },
    role: { names: ["role", "position"], required: true },
    headcount: { names: ["needed", "headcount", "number needed", "staff needed", "qty"] },
    instructions: { names: ["instructions", "notes"] },
  },
  pay: {
    // One of ref or mobile identifies the worker (checked below).
    ref: { names: ["staff id", "staff no", "staff number", "employee id", "payroll id"] },
    mobile: { names: ["mobile", "mobile number", "phone", "phone number", "mobile phone"] },
    // A row found by mobile (no Staff ID) must name the worker too (src/lib/imports/import.ts).
    firstName: { names: ["first name", "forename", "given name"] },
    lastName: { names: ["last name", "surname", "family name"] },
    name: { names: ["name", "full name", "worker", "worker name", "employee name", "staff name"] },
    periodStart: {
      names: ["period start", "week start", "from", "from date", "start date"],
      required: true,
    },
    periodEnd: {
      names: ["period end", "week end", "week ending", "to", "to date", "end date"],
      required: true,
    },
    hours: { names: ["hours", "hours worked", "total hours"], required: true },
    rate: { names: ["rate", "hourly rate", "pay rate", "rate per hour"], required: true },
    // Not "amount" or "total pay": in many payroll files those mean net pay.
    gross: { names: ["gross", "gross pay"] },
    payDate: { names: ["pay date", "paid on", "payment date", "pay day"] },
  },
} as const satisfies Record<ImportKind, Record<string, FieldSpec>>;

export type ColumnsOf<K extends ImportKind> = {
  [F in keyof (typeof COLUMNS)[K]]: number | undefined;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function resolveColumns<K extends ImportKind>(kind: K, header: string[]): ColumnsOf<K> {
  const specs = COLUMNS[kind] as Record<string, FieldSpec>;
  const headers = header.map(norm);
  const found: Record<string, number | undefined> = {};
  const used = new Set<number>();
  for (const [field, spec] of Object.entries(specs)) {
    const hits = headers.flatMap((h, i) => (spec.names.includes(h) ? [i] : []));
    if (hits.length > 1) throw new ImportFileError("duplicate_column");
    if (hits.length === 0 && spec.required) throw new ImportFileError("missing_column");
    const [hit] = hits;
    if (hit !== undefined && used.has(hit)) throw new ImportFileError("duplicate_column");
    if (hit !== undefined) used.add(hit);
    found[field] = hit;
  }
  if (
    (kind === "credentials" || kind === "pay") &&
    found.ref === undefined &&
    found.mobile === undefined
  ) {
    throw new ImportFileError("missing_column");
  }
  return found as ColumnsOf<K>;
}

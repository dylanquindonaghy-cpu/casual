import { Pool } from "pg";
import { testUrls } from "../setup/test-db";

export const urls = testUrls();

// Ground truth and fixtures: the local superuser bypasses RLS entirely.
export const superuserPool = (max = 2) => new Pool({ connectionString: urls.superuser, max });
// The non-superuser owner, as migrations and admin scripts run.
export const ownerPool = (max = 2) => new Pool({ connectionString: urls.admin, max });
// The restricted app role, as the web and worker connect.
export const appRolePool = (max = 4) => new Pool({ connectionString: urls.app, max });

let counter = 0;
// Short, unique, valid slugs for firms created by tests (2-20 chars, a-z0-9-).
export function uniqueSlug(prefix = "t"): string {
  counter += 1;
  return `${prefix}${process.pid.toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.slice(
    0,
    20,
  );
}

// The shifts-line number tests ask for as "a number no firm has" (07700 900499, Ofcom's drama
// range). Test firms keep their lines for the whole run (one database, files one after another),
// so a test frees it first with `freeNoFirmLine()` rather than assuming no earlier file used it.
// Files that hand out random lines stay off it.
export const NO_FIRM_LINE = "+447700900499";
export async function freeNoFirmLine(su: Pool): Promise<void> {
  await su.query("update firms set shifts_line_e164 = null where shifts_line_e164 = $1", [
    NO_FIRM_LINE,
  ]);
}

// An event for a shift inserted straight into the table: every shift belongs to one
// (shift_events, docs/office-v2.md 3.3). Inserted as the superuser.
export async function testEvent(su: Pool, firmId: string, name = "Test event"): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "insert into shift_events (firm_id, name) values ($1, $2) returning id::text as id",
    [firmId, name],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("event insert returned no id");
  return id;
}

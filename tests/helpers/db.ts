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

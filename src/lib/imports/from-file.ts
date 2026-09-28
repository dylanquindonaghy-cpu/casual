import { readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { systemClock, type Clock } from "../auth/clock";
import { officeUsers } from "../db/schema";
import type { WithFirm } from "../db/scoped";
import type { ResolveFirmBySlug } from "../db/directory";
import { IMPORT_KINDS, type ImportKind } from "./columns";
import { runImport, type ImportResult } from "./import";
import { readTable } from "./table";

// Imports a file for a firm, as one of its office users (admin or resourcer), the way the office
// import screen will (Phase 5). Used by `npm run import` until then. Dry run unless apply is set.

export interface FromFileInput {
  firmSlug: string;
  kind: string;
  officeEmail: string;
  path: string;
  apply: boolean;
}

export interface FromFileDeps {
  run: WithFirm;
  resolveFirm: ResolveFirmBySlug;
  clock?: Clock;
}

export class ImportSetupError extends Error {}

export async function importFromFile(
  input: FromFileInput,
  deps: FromFileDeps,
): Promise<ImportResult> {
  const kind = IMPORT_KINDS.find((k) => k === input.kind);
  if (!kind) throw new ImportSetupError(`--kind must be one of: ${IMPORT_KINDS.join(", ")}`);
  const firm = await deps.resolveFirm(input.firmSlug);
  if (!firm) throw new ImportSetupError(`no firm with the slug "${input.firmSlug}"`);
  const rows = readTable(await readFile(input.path));
  return deps.run(firm.id, async (tx) => {
    const [office] = await tx
      .select({ id: officeUsers.id })
      .from(officeUsers)
      .where(
        and(
          eq(officeUsers.email, input.officeEmail.trim().toLowerCase()),
          eq(officeUsers.status, "active"),
          inArray(officeUsers.role, ["admin", "resourcer"]),
        ),
      );
    if (!office) {
      throw new ImportSetupError("--as must be an active admin or resourcer of that firm");
    }
    return runImport(tx, {
      kind: kind as ImportKind,
      rows,
      dryRun: !input.apply,
      actorId: office.id,
      timeZone: firm.timezone,
      now: (deps.clock ?? systemClock).now(),
      via: "cli",
    });
  });
}

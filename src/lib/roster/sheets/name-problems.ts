import { eq, sql } from "drizzle-orm";
import { sheetNameProblems } from "../../db/schema";
import type { FirmTx } from "../../db/scoped";
import type { ParsedSheet } from "./parse";

// The names a rota sheet's sync couldn't use (Phase 25.2; docs/screens.md "The firm's model on the
// office's screens"), kept for Needs attention in sheet_name_problems: a role it can't read, and a
// role the firm's name map skips on a row that made a session still to come. Each sync replaces
// the last one's rows, in its own transaction, so the list is always the last sync's and an item
// goes once a sync no longer finds it. A failed sync leaves them as they were.

// A skipped row whose session is still on (the sync's skipped_live problem), with that session.
export interface SkippedLive {
  row: number;
  name: string;
  shiftId: string;
}

// At most this many a sync (the list shows the first 50, as Needs attention's other parts do). The
// skipped names on sessions still to come are kept first: each is a session the office must act
// on, where a name it can't read only keeps a row out.
export const NAME_PROBLEMS_MAX = 200;

export async function replaceNameProblems(
  tx: FirmTx,
  sourceId: string,
  seenAt: Date,
  unreadable: ParsedSheet["unreadable"],
  skippedLive: SkippedLive[],
): Promise<void> {
  await tx.delete(sheetNameProblems).where(eq(sheetNameProblems.sourceId, sourceId));
  const rows = [
    ...skippedLive.map((s) => ({
      kind: "skipped_live" as const,
      tab: "shifts" as const,
      row: s.row,
      outsideName: s.name,
      shiftId: s.shiftId,
    })),
    ...unreadable.map((u) => ({
      kind: "unreadable" as const,
      tab: u.tab,
      row: u.row,
      outsideName: u.name,
      shiftId: null,
    })),
  ].slice(0, NAME_PROBLEMS_MAX);
  if (rows.length === 0) return;
  await tx.insert(sheetNameProblems).values(
    rows.map((r) => ({
      ...r,
      firmId: sql`app_current_firm_id()`,
      sourceId,
      seenAt,
    })),
  );
}

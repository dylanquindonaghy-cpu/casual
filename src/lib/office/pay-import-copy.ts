import { FILE_ERROR_TEXT, PROBLEM_TEXT } from "../imports/messages";
import type { PayImportResult } from "./pay-import";

// "Import pay records" in plain words (docs/screens.md `/office/pay/import`): what a checked file
// would do, or what the import did, then each problem by row (never a cell's contents).

type Common = { status: "logged_out" } | { status: "not_allowed" } | { status: "error" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function payImportLines(result: PayImportResult | Common): string[] {
  switch (result.status) {
    case "done": {
      const r = result.result;
      const counts = r.dryRun
        ? `This file would add ${plural(r.created, "pay line", "pay lines")}, change ${r.updated}, leave ${r.unchanged} as they are and skip ${r.skipped}.`
        : `Imported: ${plural(r.created, "pay line", "pay lines")} added, ${r.updated} changed, ${r.unchanged} left as they were, ${r.skipped} skipped.`;
      const moved =
        result.regrouped > 0
          ? [
              `${plural(result.regrouped, "waiting pay query", "waiting pay queries")} moved to the group that matches the new pay lines.`,
            ]
          : [];
      return [
        counts,
        ...moved,
        ...r.problems.map((p) => `Row ${p.row}: ${PROBLEM_TEXT[p.problem]}.`),
      ];
    }
    case "file_error":
      return [FILE_ERROR_TEXT[result.code]];
    case "too_big":
      return ["The file is too big for the web (1 MB at most). Split it into smaller files."];
    case "logged_out":
      return ["Your session has ended. Log in again."];
    case "not_allowed":
      return ["You can't import pay records."];
    case "error":
      return ["Something went wrong. Try again."];
  }
}

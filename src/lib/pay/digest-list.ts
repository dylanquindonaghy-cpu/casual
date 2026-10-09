import type { PayQueryGroup } from "../office/pay-query-groups";
import { csvCell, localStamp } from "../office/notice-report";
import { ISSUE_LABELS } from "../portal/pay-query-kinds";

// The payroll digest's attached list (docs/messaging-templates.md `pay_digest`): one row per
// query, group by group in the email's order (biggest first, oldest first within a group). Cells
// are made safe for spreadsheets (csvCell: no formulas), with a byte-order mark so Excel reads
// accented names as UTF-8, like the notice report's CSV.

export const DIGEST_CSV_HEADER = [
  "Reference",
  "Worker",
  "Day worked",
  "Shift",
  "Issue",
  "What they wrote",
  "Sent (firm time)",
  "Group",
];

export function payDigestFilename(date: string): string {
  return `pay-queries-${date}.csv`;
}

export function payDigestCsv(groups: PayQueryGroup[], timeZone: string): string {
  const lines = [DIGEST_CSV_HEADER.map(csvCell).join(",")];
  for (const g of groups) {
    for (const q of g.queries) {
      lines.push(
        [
          q.ref,
          q.worker,
          q.day,
          q.shift ?? "",
          ISSUE_LABELS[g.facts.issue],
          q.details ?? "",
          localStamp(q.createdAt, timeZone),
          g.heading,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

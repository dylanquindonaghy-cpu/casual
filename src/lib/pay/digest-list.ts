import type { PayQueryGroup, PayQueryItem } from "../office/pay-query-groups";
import { csvCell, localStamp } from "../office/notice-report";
import { ISSUE_LABELS } from "../portal/pay-query-kinds";

// The payroll digest's attached list (docs/messaging-templates.md `pay_digest`): one row per
// query, group by group in the email's order (biggest first, oldest first within a group), with
// where it was sent from (Phase 29.1: the Pay page, or Messages about her pay). Cells
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
  "Sent from",
];

// Where a query came from (Phase 29.1): the Pay page, or Messages opened about her pay when Pay
// couldn't take the question, with why when the app knew it. The list's last column, and the line
// under the query on payroll's page (`note`: null for the Pay page's, which is every other).
export function sentFromWords(q: Pick<PayQueryItem, "fromMessages">): {
  cell: string;
  note: string | null;
} {
  if (!q.fromMessages) return { cell: "Pay page", note: null };
  return q.fromMessages.why === "no_code"
    ? {
        cell: "Messages (we couldn't send them a pay code)",
        note: "Sent from Messages: we couldn't send them a pay code, so the Pay page couldn't take it.",
      }
    : { cell: "Messages", note: "Sent from Messages." };
}

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
          sentFromWords(q).cell,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import {
  noticeReportCsv,
  officeNoticeReport,
  parseNoticeQuery,
  REPORT_CSV_ROWS,
} from "@/lib/office/notice-report";
import { requestLog } from "@/lib/request";

// GET: the notice and cancellation report as a CSV file, with the page's filters (docs/screens.md
// `/office/reports/notice`). The firm comes from the host and the office user from their session
// (an admin or resourcer, checked here and again in the report). Every row or none: more than
// 20,000 and it asks for fewer days rather than hand over a file that looks complete. Not cached.

export async function GET(request: Request): Promise<Response> {
  const session = await getOfficeSession();
  if (!session) return new Response("Log in again.", { status: 401 });
  if (!canAccess(session.officeUser.role, "reports")) {
    return new Response("Not found.", { status: 404 });
  }
  const url = new URL(request.url);
  const query = parseNoticeQuery(Object.fromEntries(url.searchParams));
  try {
    const report = await officeNoticeReport(
      { firm: session.firm },
      (await readSessionToken("office")) ?? "",
      query,
      REPORT_CSV_ROWS,
    );
    if (!report) return new Response("Not found.", { status: 404 });
    // An evidence file is never cut short: too many rows, and it asks for fewer days instead.
    if (report.total > REPORT_CSV_ROWS) {
      return new Response(
        `These dates have ${report.total} rows, more than one file holds (${REPORT_CSV_ROWS}). Choose fewer days.`,
        { status: 422, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    const name = `notice-report-${report.filters.from}-to-${report.filters.to}.csv`;
    return new Response(noticeReportCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    (await requestLog()).error("notice report export failed", { firmId: session.firm.id, error });
    return new Response("Something went wrong. Try again.", { status: 500 });
  }
}

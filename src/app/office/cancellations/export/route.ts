import { fromOwnPages } from "@/lib/auth/own-pages";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import {
  CANCELLATIONS_CSV_ROWS,
  logDownload,
  officeCancellations,
} from "@/lib/office/cancellations";
import {
  CANCELLATION_VIEWS,
  cancellationsCsv,
  type CancellationView,
} from "@/lib/office/cancellations-copy";
import { requestLog } from "@/lib/request";
import { localDateOf } from "@/lib/time/zoned";

// GET: the chosen view of cancellations as a CSV (docs/office-v2.md 3.4; 12C.3), and with
// ?day=today only today's (the page's own filter, from the dashboard's link), for admins and
// resourcers (checked here and again in the loader), started from ShiftDesk's own pages
// (fromOwnPages). Every row or none: more than 20,000 and it says so (counted first, nothing
// loaded) rather than hand over a file that looks complete. A casual's reason always reads
// "Casual's own reason (see ShiftDesk)". Built, then logged export.downloaded (the view and the
// row count), then handed over. Nothing cached.

const plain = (text: string, status: number) =>
  new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

export async function GET(request: Request): Promise<Response> {
  if (!fromOwnPages(request)) return plain("Open this from ShiftDesk.", 403);
  const session = await getOfficeSession();
  if (!session) return plain("Log in again.", 401);
  if (!canAccess(session.officeUser.role, "cancellations")) return plain("Not found.", 404);
  const asked = new URL(request.url).searchParams.get("view");
  const view: CancellationView = (CANCELLATION_VIEWS as readonly string[]).includes(asked ?? "")
    ? (asked as CancellationView)
    : "all";
  const day = new URL(request.url).searchParams.get("day") === "today" ? ("today" as const) : null;
  const token = (await readSessionToken("office")) ?? "";
  try {
    const list = await officeCancellations({ firm: session.firm }, token, view, {
      limit: CANCELLATIONS_CSV_ROWS,
      allOrNothing: true,
      ...(day ? { day } : {}),
    });
    if (!list) return plain("Not found.", 404);
    if (list.total > CANCELLATIONS_CSV_ROWS) {
      return plain(
        `This view has ${list.total} cancellations, more than one file holds (${CANCELLATIONS_CSV_ROWS}). Choose a smaller view.`,
        422,
      );
    }
    const csv = cancellationsCsv(list.rows, { tz: list.timeZone, threshold: list.threshold });
    const logged = await logDownload({ firm: session.firm }, token, {
      kind: "cancellations_csv",
      view,
      ...(day ? { day } : {}),
      rows: list.rows.length,
    });
    if (!logged) return plain("Not found.", 404);
    // Today's file names the day (the firm's), so it still makes sense once saved.
    const fileName = day
      ? `cancellations-${view}-${localDateOf(new Date(), list.timeZone)}.csv`
      : `cancellations-${view}.csv`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    (await requestLog()).error("cancellations export failed", { firmId: session.firm.id, error });
    return plain("Something went wrong. Try again.", 500);
  }
}

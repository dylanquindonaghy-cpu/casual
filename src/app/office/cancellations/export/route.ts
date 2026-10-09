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

// GET: the chosen view of cancellations as a CSV (docs/office-v2.md 3.4; 12C.3), for admins and
// resourcers (checked here and again in the loader). Every row or none: more than 20,000 and it
// says so rather than hand over a file that looks complete. A casual's reason always reads
// "Casual's own reason (see ShiftDesk)". Logged export.downloaded (the view and the row count).

export async function GET(request: Request): Promise<Response> {
  const session = await getOfficeSession();
  if (!session) return new Response("Log in again.", { status: 401 });
  if (!canAccess(session.officeUser.role, "cancellations")) {
    return new Response("Not found.", { status: 404 });
  }
  const asked = new URL(request.url).searchParams.get("view");
  const view: CancellationView = (CANCELLATION_VIEWS as readonly string[]).includes(asked ?? "")
    ? (asked as CancellationView)
    : "all";
  const token = (await readSessionToken("office")) ?? "";
  try {
    const list = await officeCancellations(
      { firm: session.firm },
      token,
      view,
      CANCELLATIONS_CSV_ROWS + 1,
    );
    if (!list) return new Response("Not found.", { status: 404 });
    if (list.total > CANCELLATIONS_CSV_ROWS) {
      return new Response(
        `This view has ${list.total} cancellations, more than one file holds (${CANCELLATIONS_CSV_ROWS}). Choose a smaller view.`,
        { status: 422, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    const logged = await logDownload({ firm: session.firm }, token, {
      kind: "cancellations_csv",
      view,
      rows: list.rows.length,
    });
    if (!logged) return new Response("Not found.", { status: 404 });
    return new Response(
      cancellationsCsv(list.rows, { tz: list.timeZone, threshold: list.threshold }),
      {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="cancellations-${view}.csv"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    (await requestLog()).error("cancellations export failed", { firmId: session.firm.id, error });
    return new Response("Something went wrong. Try again.", { status: 500 });
  }
}

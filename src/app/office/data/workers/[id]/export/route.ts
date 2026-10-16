import { fromOwnPages } from "@/lib/auth/own-pages";
import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { exportWorkerData } from "@/lib/gdpr/worker-export";
import { requestLog } from "@/lib/request";

// GET ?format=json|csv: everything held about one worker (docs/screens.md
// `/office/data/workers/[id]`). The firm comes from the host and the office user from their
// session (an admin: checked here and again inside the export, which logs it), started from
// ShiftDesk's own pages (fromOwnPages). Not cached.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!fromOwnPages(request)) return new Response("Open this from ShiftDesk.", { status: 403 });
  const session = await getOfficeSession();
  if (!session) return new Response("Log in again.", { status: 401 });
  if (!canAccess(session.officeUser.role, "data")) {
    return new Response("Not found.", { status: 404 });
  }
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  try {
    const result = await exportWorkerData(
      { firm: session.firm, officeUserId: session.officeUser.id },
      id,
      format,
    );
    if (result.status !== "ok") return new Response("Not found.", { status: 404 });
    return new Response(result.body, {
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    (await requestLog()).error("worker data export failed", { firmId: session.firm.id, error });
    return new Response("Something went wrong. Try again.", { status: 500 });
  }
}

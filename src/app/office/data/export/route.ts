import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { exportFirmData } from "@/lib/gdpr/firm-export";
import { requestLog } from "@/lib/request";

// GET: all the firm's data as one JSON file (docs/screens.md `/office/data`). The firm comes from
// the host and the office user from their session (an admin: checked here and again inside the
// export, which logs it). Not cached.

export async function GET(): Promise<Response> {
  const session = await getOfficeSession();
  if (!session) return new Response("Log in again.", { status: 401 });
  if (!canAccess(session.officeUser.role, "data")) {
    return new Response("Not found.", { status: 404 });
  }
  try {
    const result = await exportFirmData({
      firm: session.firm,
      officeUserId: session.officeUser.id,
    });
    if (result.status !== "ok") return new Response("Not found.", { status: 404 });
    return new Response(result.body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    (await requestLog()).error("firm data export failed", { firmId: session.firm.id, error });
    return new Response("Something went wrong. Try again.", { status: 500 });
  }
}

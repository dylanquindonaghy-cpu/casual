import { getWorkerSession } from "@/lib/auth/current-worker";
import { appEnv } from "@/lib/env";
import { calendarForWorker } from "@/lib/portal/calendar";
import { requestLog } from "@/lib/request";
import { currentFirmAddress, getCurrentFirm } from "@/lib/tenancy/current-firm";

// GET /shifts/{id}/calendar: "Add to my calendar" on a booked shift's page (Phase 28.5;
// docs/api-and-jobs.md "HTTP endpoints"; docs/screens.md "The casual app, Phase 28" 28.5). The firm
// comes from the host, the casual from her session; the booking is read inside her firm
// (calendarForWorker(), withFirm: RLS), and must be her own live booking on a session that isn't
// cancelled. Anything else, with or without a session, is "Not found." whether or not the shift
// exists. The file holds no pay and no instructions. Never cached (private, no-store) and never
// in the offline copy (public/sw.js keeps only My shifts and the build's files). A download
// changes nothing, so nothing is logged.

const NOT_FOUND = () =>
  new Response("Not found.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
  });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const firm = await getCurrentFirm();
  try {
    const casual = await getWorkerSession();
    if (!casual) return NOT_FOUND();
    const file = await calendarForWorker(
      {
        firm: casual.firm,
        baseDomain: appEnv().APP_BASE_DOMAIN,
        address: await currentFirmAddress(),
      },
      casual.worker.id,
      id,
    );
    if (!file) return NOT_FOUND();
    return new Response(file.body, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${file.fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  } catch (error) {
    (await requestLog()).error("calendar file failed", { firmId: firm.id, error });
    return new Response("Something went wrong. Try again.", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "private, no-store",
      },
    });
  }
}

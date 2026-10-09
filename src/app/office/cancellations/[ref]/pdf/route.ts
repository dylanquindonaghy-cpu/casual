import { getOfficeSession } from "@/lib/auth/current-office";
import { canAccess } from "@/lib/auth/roles";
import { readSessionToken } from "@/lib/auth/session-cookie";
import { logDownload, officeCancellationRecord } from "@/lib/office/cancellations";
import { recordFields } from "@/lib/office/cancellations-copy";
import { timeOnDay } from "@/lib/portal/format";
import { recordPdf } from "@/lib/pdf/record";
import { requestLog } from "@/lib/request";

// GET: one cancellation's record as a PDF (docs/office-v2.md 3.4; 12C.3), for admins and
// resourcers (checked here and again in the loader). The record page links here by the booking's
// full id; a reference two cancellations share is refused, never one picked. The casual's reason
// reads "Casual's own reason (see ShiftDesk)". Logged export.downloaded before it's handed over.
// Not cached.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
): Promise<Response> {
  const session = await getOfficeSession();
  if (!session) return new Response("Log in again.", { status: 401 });
  if (!canAccess(session.officeUser.role, "cancellations")) {
    return new Response("Not found.", { status: 404 });
  }
  const { ref } = await params;
  const token = (await readSessionToken("office")) ?? "";
  try {
    const found = await officeCancellationRecord({ firm: session.firm }, token, ref);
    if (!found) return new Response("Not found.", { status: 404 });
    if (found.status === "several") {
      return new Response(
        "More than one cancellation has this reference. Open the one you want from Cancellations.",
        { status: 409 },
      );
    }
    const { record } = found;
    const now = new Date();
    const bytes = await recordPdf({
      title: `Cancellation record ${record.row.ref}`,
      firmName: record.firmName,
      fields: recordFields(record.row, {
        tz: record.timeZone,
        threshold: record.threshold,
        liveStrikes: record.liveStrikes,
        forExport: true,
      }),
      generatedAt: timeOnDay(now, record.timeZone),
    });
    const logged = await logDownload({ firm: session.firm }, token, {
      kind: "cancellation_pdf",
      assignmentId: record.row.assignmentId,
    });
    if (!logged) return new Response("Not found.", { status: 404 });
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="cancellation-${record.row.ref}.pdf"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    (await requestLog()).error("cancellation pdf failed", { firmId: session.firm.id, error });
    return new Response("Something went wrong. Try again.", { status: 500 });
  }
}

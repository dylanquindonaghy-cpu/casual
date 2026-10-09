import { getOfficeSession } from "@/lib/auth/current-office";
import { getWorkerSession } from "@/lib/auth/current-worker";
import { requestLog } from "@/lib/request";
import { getCurrentFirm } from "@/lib/tenancy/current-firm";
import { casualFile, officeFile, type FileResult } from "@/lib/uploads/files";

// GET /files/{id}: a photo or certificate image (docs/office-v2.md 5.5; docs/screens.md
// `/files/[id]`; 12F.2), the only way one leaves the database. The firm comes from the host; an
// active admin or resourcer of that firm sees any of its uploads, a casual only their own
// (src/lib/uploads/files.ts). Anything else is "Not found", whether or not it exists. Never cached
// (private, no-store) and never in the offline copy (public/sw.js keeps only My shifts and the
// build's files). `?download=1` saves it as a file (the data page's "each image is its own
// download").

const NOT_FOUND = () =>
  new Response("Not found.", { status: 404, headers: { "cache-control": "private, no-store" } });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const firm = await getCurrentFirm();
  try {
    let file: FileResult = { status: "not_found" };
    const office = await getOfficeSession();
    if (office) {
      file = await officeFile({ firm: office.firm, officeUserId: office.officeUser.id }, id);
    }
    if (file.status !== "ok") {
      const casual = await getWorkerSession();
      if (casual) file = await casualFile({ firm }, casual.worker.id, id);
    }
    if (file.status !== "ok") return NOT_FOUND();
    const download = new URL(request.url).searchParams.get("download") === "1";
    const name = `${file.kind}-${file.createdAt.toISOString().slice(0, 10)}.jpg`;
    return new Response(new Uint8Array(file.data), {
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.data.length),
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    (await requestLog()).error("file failed", { firmId: firm.id, error });
    return new Response("Something went wrong. Try again.", {
      status: 500,
      headers: { "cache-control": "private, no-store" },
    });
  }
}

import { apiMethodNotAllowed } from "@/lib/integrations/api";
import { getCancellationsRequest } from "@/lib/integrations/cancellations";

// The planner API's cancellation records, oldest first, 100 a page (docs/integrations.md;
// docs/office-v2.md 5.3.2). Everything is in src/lib/integrations/. Any other method: the API's
// own 405 (apiMethodNotAllowed).
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return getCancellationsRequest(request);
}

// What this address takes (HEAD and OPTIONS are Next.js's, from GET and the exports): the same
// list in the 405's Allow header and in OPTIONS's.
const ALLOW = ["GET", "HEAD", "OPTIONS"] as const;
export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: { allow: ALLOW.join(", "), "cache-control": "no-store" },
  });
}
export function PUT(request: Request): Response {
  return apiMethodNotAllowed(request, "PUT", ALLOW);
}
export function POST(request: Request): Response {
  return apiMethodNotAllowed(request, "POST", ALLOW);
}
export function PATCH(request: Request): Response {
  return apiMethodNotAllowed(request, "PATCH", ALLOW);
}
export function DELETE(request: Request): Response {
  return apiMethodNotAllowed(request, "DELETE", ALLOW);
}

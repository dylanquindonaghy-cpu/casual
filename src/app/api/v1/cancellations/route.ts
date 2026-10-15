import { apiMethodNotAllowed } from "@/lib/integrations/api";
import { getCancellationsRequest } from "@/lib/integrations/cancellations";

// The planner API's cancellation records, oldest first, 100 a page (docs/integrations.md;
// docs/office-v2.md 5.3.2). Everything is in src/lib/integrations/. Any other method: the API's
// own 405 (apiMethodNotAllowed).
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return getCancellationsRequest(request);
}

const ALLOW = ["GET"] as const;
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

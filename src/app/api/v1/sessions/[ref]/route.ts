import { apiMethodNotAllowed } from "@/lib/integrations/api";
import { getSessionRequest, putSessionRequest } from "@/lib/integrations/sessions";

// The planner API's sessions (docs/integrations.md; docs/office-v2.md 5.3.2): PUT creates or
// updates one by the planner's own ref, GET reads it back with its bookings. Server to server, on
// the platform address only, with an API key; everything is in src/lib/integrations/. Any other
// method: the API's own 405 (apiMethodNotAllowed).
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ref: string }> };

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  return putSessionRequest(request, (await params).ref);
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return getSessionRequest(request, (await params).ref);
}

const ALLOW = ["GET", "PUT"] as const;
export function POST(request: Request): Response {
  return apiMethodNotAllowed(request, "POST", ALLOW);
}
export function PATCH(request: Request): Response {
  return apiMethodNotAllowed(request, "PATCH", ALLOW);
}
export function DELETE(request: Request): Response {
  return apiMethodNotAllowed(request, "DELETE", ALLOW);
}

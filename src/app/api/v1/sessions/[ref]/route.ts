import { getSessionRequest, putSessionRequest } from "@/lib/integrations/sessions";

// The planner API's sessions (docs/integrations.md; docs/office-v2.md 5.3.2): PUT creates or
// updates one by the planner's own ref, GET reads it back with its bookings. Server to server, on
// the platform address only, with an API key; everything is in src/lib/integrations/.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ref: string }> };

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  return putSessionRequest(request, (await params).ref);
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return getSessionRequest(request, (await params).ref);
}

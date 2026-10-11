import { getCancellationsRequest } from "@/lib/integrations/cancellations";

// The planner API's cancellation records, oldest first, 100 a page (docs/integrations.md;
// docs/office-v2.md 5.3.2). Everything is in src/lib/integrations/.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return getCancellationsRequest(request);
}

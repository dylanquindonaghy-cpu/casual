import { apiRefusal, handleApiRequest, type ApiCall, type ApiDeps, type ApiResult } from "./api";
import { cancellationPage } from "./records";
import { cancellationsQuery } from "./schemas";

// GET /api/v1/cancellations?since={time} or ?cursor={next_cursor} (docs/office-v2.md 5.3.2):
// every cancelled booking of the key's firm, by anyone, oldest first, at most 100 a page, as the
// webhooks' `data` (src/lib/integrations/records.ts). A cancellation can commit a moment after a
// later one, so a planner polling starts each poll from since= a few minutes before its last
// record; repeats are safe (each record carries the booking's id).

export const CANCELLATIONS_ROUTE = "/api/v1/cancellations";

export function getCancellationsRequest(request: Request, deps?: ApiDeps): Promise<Response> {
  return handleApiRequest(
    request,
    { route: CANCELLATIONS_ROUTE, method: "GET", body: false, handler: getCancellations },
    deps,
  );
}

export async function getCancellations(call: ApiCall): Promise<ApiResult> {
  const query = cancellationsQuery(call.url);
  if ("problem" in query) return apiRefusal(query.problem);
  const page = await call.run(call.firmId, (tx) => cancellationPage(tx, query, call.now));
  return { status: 200, body: page };
}

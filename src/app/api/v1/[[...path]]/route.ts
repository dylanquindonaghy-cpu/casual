import { apiNotFound } from "@/lib/integrations/api";

// Any other /api/v1 address: the API's own JSON 404 (not the site's page), with no key look-up.
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return apiNotFound(request, "GET");
}
export function PUT(request: Request): Response {
  return apiNotFound(request, "PUT");
}
export function POST(request: Request): Response {
  return apiNotFound(request, "POST");
}
export function PATCH(request: Request): Response {
  return apiNotFound(request, "PATCH");
}
export function DELETE(request: Request): Response {
  return apiNotFound(request, "DELETE");
}

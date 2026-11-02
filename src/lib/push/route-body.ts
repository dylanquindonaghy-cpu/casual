// The checks both push routes make before reading a subscription (casuals' /api/push/subscribe and
// the office's /api/office/push): the request comes from the site's own page (its Origin is this
// host), and the body is small JSON (refused before reading where its size is declared, and
// counted after).

export const MAX_PUSH_BODY = 4096;

export async function checkedPushBody(request: Request): Promise<Response | { body: unknown }> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && !!host && new URL(origin).host === host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return Response.json({ status: "forbidden" }, { status: 403 });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_PUSH_BODY) return Response.json({ status: "too_large" }, { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_PUSH_BODY) {
    return Response.json({ status: "too_large" }, { status: 413 });
  }
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return Response.json({ status: "invalid" }, { status: 400 });
  }
}

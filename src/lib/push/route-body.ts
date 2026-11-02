// The checks both push routes make before reading a subscription (casuals' /api/push/subscribe and
// the office's /api/office/push): the request comes from the site's own page (its Origin is this
// host), and the body is small JSON (refused before reading where its size is declared, and never
// read past MAX_PUSH_BODY bytes where it isn't).

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
  // Read no more than MAX_PUSH_BODY bytes, whatever was declared (a body sent in chunks declares
  // nothing): past it, the rest is never read.
  const text = await readAtMost(request, MAX_PUSH_BODY);
  if (text === null) return Response.json({ status: "too_large" }, { status: 413 });
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return Response.json({ status: "invalid" }, { status: 400 });
  }
}

// The body as text, or null when it's longer than `max` bytes (the stream is cancelled there).
async function readAtMost(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

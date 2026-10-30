// A request's body, read up to `maxBytes` and no further: a missing or wrong content-length can't
// get round it (a chunked body is counted as it comes and the rest never read). For the planner
// API (src/lib/integrations/api.ts) and a connector's webhooks (src/lib/connector/webhook.ts).
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<{ bytes: Uint8Array } | { tooBig: true }> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return { tooBig: true };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { tooBig: true };
      }
      chunks.push(value);
    }
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return { bytes: all };
}

// The bytes as strict UTF-8, or null if they aren't.
export function strictUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

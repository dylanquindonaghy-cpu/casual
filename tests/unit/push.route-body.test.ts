import { describe, expect, it } from "vitest";
import { checkedPushBody, MAX_PUSH_BODY } from "@/lib/push/route-body";

// The checks both push routes make before reading a subscription (casuals' /api/push/subscribe and,
// since Phase 26.4, the office's /api/office/push): the site's own page only, small JSON only, and
// a body sent in chunks (no declared size) never read past the limit.

const host = "acme.localhost:3000";
const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(`http://${host}/api/office/push`, {
    method: "POST",
    body,
    headers: { host, origin: `http://${host}`, ...headers },
    // A stream body needs this in Node's fetch.
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
const status = async (r: Response | { body: unknown }) =>
  r instanceof Response ? [r.status, await r.json()] : ["ok", r.body];

describe("a push route's body", () => {
  it("from the site's own page, small JSON: read", async () => {
    expect(await status(await checkedPushBody(req('{"a":1}')))).toEqual(["ok", { a: 1 }]);
  });

  it("from another site, or none named: 403", async () => {
    expect(
      await status(await checkedPushBody(req("{}", { origin: "https://evil.example" }))),
    ).toEqual([403, { status: "forbidden" }]);
    const none = new Request(`http://${host}/x`, { method: "POST", body: "{}", headers: { host } });
    expect((await checkedPushBody(none)) instanceof Response).toBe(true);
  });

  it("too large: 413, declared or not; not JSON: 400", async () => {
    const big = "x".repeat(MAX_PUSH_BODY + 1);
    expect(await status(await checkedPushBody(req(big)))).toEqual([413, { status: "too_large" }]);
    // Sent in chunks with no size declared: refused once past the limit, the rest never read.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) return controller.close();
        controller.enqueue(new Uint8Array(1024).fill(120));
      },
    });
    expect(await status(await checkedPushBody(req(stream)))).toEqual([
      413,
      { status: "too_large" },
    ]);
    expect(pulled).toBeLessThan(10);
    expect(await status(await checkedPushBody(req("{not json")))).toEqual([
      400,
      { status: "invalid" },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { readCapped } from "@/lib/travel/body";

// Reading an outside service's answer (postcodes.io, TravelTime): never more than the cap, however
// the answer is sent.

// A body sent in chunks with no content-length, counting how many chunks were pulled.
function streamed(chunks: string[]) {
  const bytes = chunks.map((c) => new TextEncoder().encode(c));
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = bytes[pulled];
      if (next === undefined) return controller.close();
      pulled += 1;
      controller.enqueue(next);
    },
  });
  return { response: new Response(body), pulled: () => pulled };
}

describe("readCapped", () => {
  it("reads an answer within the cap", async () => {
    expect(await readCapped(new Response('{"ok":true}'), 100)).toBe('{"ok":true}');
    expect(await readCapped(new Response(null), 100)).toBe("");
  });

  it("a content-length over the cap: refused before reading", async () => {
    const s = streamed(["x".repeat(10)]);
    const response = new Response(s.response.body, { headers: { "content-length": "101" } });
    expect(await readCapped(response, 100)).toBeNull();
    expect(s.pulled()).toBe(0);
  });

  it("no content-length, too long: stops at the cap and downloads no more", async () => {
    const s = streamed(Array.from({ length: 50 }, () => "x".repeat(10)));
    expect(await readCapped(s.response, 25)).toBeNull();
    expect(s.pulled()).toBeLessThan(5);
  });

  it("counts bytes, not letters; a character split across chunks still reads whole", async () => {
    const pound = new TextEncoder().encode("£"); // 2 bytes
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(pound.slice(0, 1));
        controller.enqueue(pound.slice(1));
        controller.close();
      },
    });
    expect(await readCapped(new Response(body), 2)).toBe("£");
    expect(await readCapped(new Response("££"), 3)).toBeNull();
  });

  it("a read that fails: null", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    expect(await readCapped(new Response(body), 100)).toBeNull();
  });
});

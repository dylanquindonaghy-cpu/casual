import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readOutbox } from "../e2e/outbox";

// The browser tests' reader of the console transport's outbox (tests/e2e/outbox.ts): a line still
// being written is left for the next read, never parsed half-written (a P4.9 verify run's flake:
// "Unterminated string in JSON" reading a long email mid-write).

const outbox = async () => join(await mkdtemp(join(tmpdir(), "e2e-outbox-")), "outbox.jsonl");
const line = (n: number) =>
  `${JSON.stringify({ at: "2026-10-26T18:00:00.000Z", to: `n${n}`, body: "x".repeat(n) })}\n`;

describe("reading the e2e outbox", () => {
  it("whole lines only: a last line still being written waits for the next read", async () => {
    const file = await outbox();
    const long = line(150_000);
    await writeFile(file, line(1) + long.slice(0, 142_942));
    expect((await readOutbox<{ to: string }>(file)).map((m) => m.to)).toEqual(["n1"]);
    await appendFile(file, long.slice(142_942));
    expect((await readOutbox<{ to: string }>(file)).map((m) => m.to)).toEqual(["n1", "n150000"]);
  });

  it("no file yet, or an empty one: nothing", async () => {
    const file = await outbox();
    expect(await readOutbox(file)).toEqual([]);
    await writeFile(file, "");
    expect(await readOutbox(file)).toEqual([]);
  });

  it("a whole line that isn't JSON still fails", async () => {
    const file = await outbox();
    await writeFile(file, `${line(1)}not json\n${line(2)}`);
    await expect(readOutbox(file)).rejects.toThrow(SyntaxError);
  });
});

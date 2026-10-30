import { describe, expect, it } from "vitest";
import { eachAtMost, oneAtATime } from "@/lib/notify/parallel";

// Several sends at once (src/lib/notify/parallel.ts, P4.4): never more than the limit, started in
// order, a stop or an error starting no more, and the caller hearing of an error only once nothing
// is still running.

// A promise to finish by hand.
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("eachAtMost", () => {
  it("never runs more than the limit at once, and starts them in order", async () => {
    let running = 0;
    let most = 0;
    const started: number[] = [];
    await eachAtMost(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (i) => {
        started.push(i);
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 1 + (i % 3)));
        running -= 1;
      },
    );
    expect(most).toBe(4);
    expect(started).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("a lane takes the next item as soon as its own is done", async () => {
    const gates = [gate(), gate(), gate()];
    const started: number[] = [];
    const run = eachAtMost([0, 1, 2], 2, async (i) => {
      started.push(i);
      await gates[i]?.opened;
    });
    await tick();
    expect(started).toEqual([0, 1]);
    gates[1]?.open(); // the second finishes first: its lane starts the third
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0]?.open();
    gates[2]?.open();
    await run;
  });

  it("'stop' starts no more, and the ones already going finish", async () => {
    const done: number[] = [];
    await eachAtMost([0, 1, 2, 3, 4, 5], 2, async (i) => {
      await new Promise((resolve) => setTimeout(resolve, i === 0 ? 20 : 1));
      done.push(i);
      return i === 1 ? "stop" : undefined;
    });
    // 1 stopped it; 0 was already going and finished; nothing after was started.
    expect(done.sort()).toEqual([0, 1]);
  });

  it("an error starts no more, waits for the others to finish, then is thrown (the first one)", async () => {
    const slow = gate();
    const done: number[] = [];
    let settled = false;
    const run = eachAtMost([0, 1, 2, 3], 2, async (i) => {
      if (i === 0) {
        await slow.opened;
        done.push(0);
        throw new Error("second");
      }
      if (i === 1) throw new Error("first");
      done.push(i);
    }).finally(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false); // 0 is still going
    slow.open();
    await expect(run).rejects.toThrow("first");
    expect(done).toEqual([0]); // 2 and 3 never started
  });

  it("nothing to do, or fewer items than the limit; a limit that makes no sense is refused", async () => {
    let calls = 0;
    await eachAtMost([], 4, async () => {
      calls += 1;
    });
    await eachAtMost([1], 4, async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(eachAtMost([1], bad, async () => undefined)).rejects.toThrow(RangeError);
    }
  });
});

describe("oneAtATime", () => {
  it("runs each after the one before has finished, in order, a failure included", async () => {
    const inTurn = oneAtATime();
    const log: string[] = [];
    const first = gate();
    const a = inTurn(async () => {
      log.push("a starts");
      await first.opened;
      log.push("a ends");
      throw new Error("a failed");
    });
    const b = inTurn(async () => {
      log.push("b starts");
      return "b";
    });
    await tick();
    expect(log).toEqual(["a starts"]);
    first.open();
    await expect(a).rejects.toThrow("a failed");
    expect(await b).toBe("b");
    expect(log).toEqual(["a starts", "a ends", "b starts"]);
  });
});
